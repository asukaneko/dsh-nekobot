import { spawn } from "node:child_process";
import { mkdtemp, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { createApi } from "../src/api.ts";

const executable = process.env.DSH_DESKTOP_EXE;
if (!executable)
  throw new Error(
    "Set DSH_DESKTOP_EXE to the installed DeepSeek Harness executable.",
  );
const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const home = await mkdtemp(path.join(tmpdir(), "nekobot-dsh-test-"));
const cli = path.join(
  path.dirname(executable),
  "resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js",
);
const env = { ...process.env, ELECTRON_RUN_AS_NODE: "1", DSH_HOME: home };
const launch = (args) =>
  spawn(executable, ["--expose-internals", cli, ...args], {
    env,
    cwd: root,
    windowsHide: true,
  });
async function run(args) {
  const child = launch(args);
  let log = "";
  child.stdout.on("data", (data) => {
    log += data;
  });
  child.stderr.on("data", (data) => {
    log += data;
  });
  const exit = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", resolve);
  });
  if (exit !== 0) throw new Error(log);
  return log;
}
await run(["--profile", "web", "--dump-config"]);
await run([
  "plugin",
  "--profile",
  "web",
  "add",
  process.env.DSH_TEST_PACKAGE || root,
]);
const patch = path.join(home, "probe.yml");
const probe = path.join(home, "probe");
await mkdir(probe);
await writeFile(
  path.join(probe, "package.json"),
  JSON.stringify({ name: "nekobot-integration-probe", type: "module" }),
);
await writeFile(
  path.join(probe, "index.mjs"),
  await readFile(path.join(root, "tests/integration-probe.mjs")),
);
await writeFile(
  patch,
  `- insert:\n    - id: nekobot-integration-probe\n      name: ${JSON.stringify(path.join(probe, "index.mjs"))}\n`,
);
let server, stopped;
async function start() {
  server = launch([
    "--profile",
    "web",
    "--patch",
    patch,
    "--no-open",
    "--port",
    "0",
  ]);
  stopped = new Promise((resolve) => server.on("exit", resolve));
  let log = "";
  const address = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error("DSH startup timeout: " + log.replace(/\?token=\S+/g, "")),
        ),
      45000,
    );
    const collect = (data) => {
      log += data;
      const match = log.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+/);
      if (match) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    };
    server.stdout.on("data", collect);
    server.stderr.on("data", collect);
    server.on("error", reject);
    server.on("exit", () => {
      clearTimeout(timer);
      reject(new Error("DSH stopped: " + log));
    });
  });
  assert.doesNotMatch(log, /did not activate|failed to import/);
  const auth = await fetch(address, { redirect: "manual" }),
    cookie = auth.headers.get("set-cookie")?.split(";")[0],
    origin = new URL(address).origin;
  assert.ok(cookie, "Owner authentication cookie");
  const invoke = async (method, args) => {
    const response = await fetch(origin + "/api/" + method, {
      method: "POST",
      headers: { "content-type": "application/json", origin, cookie },
      body: JSON.stringify({
        type: "client-request",
        rpcId: crypto.randomUUID(),
        method,
        payload: { args },
      }),
    });
    const envelope = await response.json();
    assert.ok(envelope.result?.ok, JSON.stringify(envelope));
    return envelope.result.value;
  };
  invoke.origin = origin;
  invoke.request = (url, init) =>
    fetch(new URL(url, origin + "/"), {
      ...init,
      headers: { ...init.headers, origin, cookie },
    });
  return invoke;
}
async function stop() {
  if (server && server.exitCode === null) {
    server.kill();
    await stopped;
  }
}
let rpc;
const command = async (sessionId, name, value) => {
  const result = await rpc("commands/execute", {
    agentId: sessionId,
    line: "/" + name + " " + JSON.stringify(value),
    submittedAttachments: [],
  });
  assert.equal(result.result.kind, "success");
  return JSON.parse(result.result.text);
};
const operation = async (value, sessionId = "nekobot-integration") => {
  const reply = await command(sessionId, "nekobot", value);
  assert.ok(reply.ok, JSON.stringify(reply));
  return reply.data;
};
try {
  rpc = await start();
  await rpc("session/create", {
    request: { sessionId: "nekobot-integration", cwd: root },
  });
  const book = await operation({
    action: "save",
    kind: "worldbook",
    value: {
      name: "山间世界",
      entries: [{ keys: ["后山"], content: "后山有一座小屋", constant: true }],
    },
  });
  const card = await operation({
    action: "save",
    kind: "character",
    value: {
      name: "小满",
      personality: "温柔",
      firstMessage: "你好{{user}}",
      worldBookIds: [book.id],
    },
  });
  await operation({
    action: "bind",
    value: { characterId: card.id, userName: "小星", enabled: true },
  });
  const memory = await command("nekobot-integration", "nekobot-probe", {
    action: "tool",
    value: {
      action: "save",
      kind: "memory",
      value: '{"content":"喜欢乌龙茶"}',
    },
  });
  assert.ok(memory.ok);
  const tool = async (name, value) =>
    command("nekobot-integration", "nekobot-probe", {
      action: "tool",
      name,
      value,
    });
  const schemas = await command("nekobot-integration", "nekobot-probe", {
    action: "tools",
  });
  const schemaNames = schemas.map((schema) => schema.name);
  for (const name of [
    "nekobot_character_list",
    "nekobot_character_get",
    "nekobot_character_save",
    "nekobot_character_delete",
    "nekobot_worldbook_list",
    "nekobot_worldbook_get",
    "nekobot_worldbook_save",
    "nekobot_worldbook_delete",
    "nekobot_worldbook_entry_save",
    "nekobot_worldbook_entry_delete",
    "nekobot_memory_list",
    "nekobot_memory_save",
    "nekobot_memory_delete",
    "nekobot_preview",
    "nekobot_library",
  ])
    assert.ok(schemaNames.includes(name), name);
  assert.equal(
    schemas.find((schema) => schema.name === "nekobot_character_save")
      .parameters.type,
    "object",
  );
  const listed = await tool("nekobot_character_list", {});
  assert.equal(listed.total, 1);
  assert.equal(listed.characters[0].id, card.id);
  assert.equal(listed.characters[0].avatar, "");
  const patched = await tool("nekobot_character_save", {
    id: card.id,
    personality: "安静",
  });
  assert.equal(patched.character.name, "小满");
  assert.equal(patched.character.personality, "安静");
  assert.deepEqual(patched.character.worldBookIds, [book.id]);
  const entry = await tool("nekobot_worldbook_entry_save", {
    bookId: book.id,
    comment: "夜话",
    content: "夜里很静",
    keys: ["夜"],
  });
  assert.ok(entry.ok && entry.entry.id);
  const page = await tool("nekobot_worldbook_get", {
    id: book.id,
    query: "夜",
  });
  assert.equal(page.total, 1);
  assert.equal(page.entries[0].content, "夜里很静");
  const memories = await tool("nekobot_memory_list", {});
  assert.equal(memories.characterId, card.id);
  assert.equal(memories.memories[0].content, "喜欢乌龙茶");
  const changed = await tool("nekobot_memory_save", {
    id: memories.memories[0].id,
    category: "important_event",
  });
  assert.equal(changed.memory.content, "喜欢乌龙茶");
  assert.equal(changed.memory.category, "important_event");
  assert.equal(
    (await tool("nekobot_character_delete", { id: card.id })).error,
    "inUse",
  );
  const preview = await operation({
    action: "preview",
    value: { latest: "后山" },
  });
  assert.match(preview.prompt, /山间|小屋/);
  assert.match(preview.prompt, /乌龙茶/);
  assert.match(preview.prompt, /小星/);
  const assembly = await command("nekobot-integration", "nekobot-probe", {
    action: "prompt",
  });
  const section = assembly.sections.find((s) => s.name === "nekobot:character");
  assert.ok(section, "Agent-scoped character section");
  assert.match(section.text, /小满/);
  assert.equal(section.interpolate, false);
  await rpc("session/create", {
    request: { sessionId: "nekobot-other", cwd: root },
  });
  assert.equal(
    (await operation({ action: "preview" }, "nekobot-other")).prompt,
    "",
  );
  const other = await command("nekobot-other", "nekobot-probe", {
    action: "prompt",
  });
  assert.equal(
    other.sections.find((s) => s.name === "nekobot:character").text,
    "",
  );
  const exported = await operation({ action: "export" });
  assert.equal(exported.characters.length, 1);
  assert.equal(exported.worldbooks.length, 1);
  console.log(
    "PASS: real DSH CRUD, tool/UI shared operations, native prompt assembly and session isolation",
  );
  let workspaceSession = "";
  const workspaceApi = createApi(
    () => workspaceSession,
    (url, init) => rpc.request(url, init),
  );
  assert.equal(
    (await workspaceApi({ action: "list" })).characters[0].id,
    card.id,
  );
  const opened = await workspaceApi({ action: "start", id: card.id });
  workspaceSession = opened.sessionId;
  const workspaceState = await workspaceApi({ action: "list" });
  assert.equal(workspaceState.binding.characterId, card.id);
  assert.ok(workspaceState.sessions.some((row) => row.id === workspaceSession));
  assert.match((await workspaceApi({ action: "preview" })).prompt, /小满/);
  await workspaceApi({
    action: "session",
    id: workspaceSession,
    value: { title: "山间初遇", pinned: true },
  });
  const roleMemory = await workspaceApi({
    action: "save",
    kind: "memory",
    value: { content: "记得山间初遇" },
  });
  await workspaceApi({
    action: "save",
    kind: "memory",
    id: roleMemory.id,
    value: { content: "记得月下山林初遇" },
  });
  assert.match(
    (await workspaceApi({ action: "preview" })).prompt,
    /月下山林初遇/,
  );
  const originalSession = workspaceSession;
  const extra = await workspaceApi({ action: "start", id: card.id });
  workspaceSession = extra.sessionId;
  await workspaceApi({
    action: "save",
    kind: "memory",
    value: { content: "临时记忆" },
  });
  assert.equal((await workspaceApi({ action: "list" })).memories.length, 1);
  assert.equal(
    (await workspaceApi({ action: "session-delete", id: extra.sessionId })).id,
    extra.sessionId,
  );
  const afterDelete = await workspaceApi({ action: "list" });
  assert.equal(afterDelete.binding.characterId, "");
  assert.equal(afterDelete.memories.length, 0);
  assert.equal(
    afterDelete.sessions.some((row) => row.id === extra.sessionId),
    false,
  );
  const workspaceFile = JSON.parse(
    await readFile(path.join(home, "storages/workspace.json"), "utf8"),
  );
  assert.ok(
    workspaceFile.global.archivedSessionIds.includes(extra.sessionId),
    "deleted conversation is archived in DSH",
  );
  workspaceSession = originalSession;
  assert.ok(
    (await workspaceApi({ action: "list" })).sessions.some(
      (row) => row.id === originalSession,
    ),
  );
  assert.match(
    (await workspaceApi({ action: "preview" })).prompt,
    /月下山林初遇/,
  );
  console.log(
    "PASS: session delete removes the Nekobot binding and memories without touching other conversations",
  );
  const denied = await fetch(rpc.origin + "/api/nekobot", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: '{"operation":{"action":"list"}}',
  });
  assert.ok([401, 403].includes(denied.status));
  console.log(
    "PASS: workspace client API loads without a session, creates role conversations and enforces authentication",
  );
  await stop();
  rpc = await start();
  const restored = await operation({ action: "list" });
  assert.equal(restored.binding.characterId, card.id);
  assert.equal(restored.memories[0].content, "喜欢乌龙茶");
  assert.equal(restored.worldbooks[0].name, "山间世界");
  assert.equal(
    (await workspaceApi({ action: "list" })).binding.characterId,
    card.id,
  );
  const roleRestored = await workspaceApi({ action: "list" });
  assert.equal(roleRestored.sessions[0].name, "山间初遇");
  assert.equal(roleRestored.sessions[0].pinned, true);
  assert.equal(roleRestored.memories[0].content, "记得月下山林初遇");
  console.log(
    "PASS: process restart restores character, worldbook, binding and session memory",
  );
  console.log("Isolated test data: " + home);
} finally {
  await stop();
}
