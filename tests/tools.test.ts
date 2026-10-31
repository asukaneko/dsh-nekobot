import { test } from "node:test";
import assert from "node:assert/strict";
import { registerTools } from "../src/tools.ts";
import type { Operation, Reply } from "../src/types.ts";

function harness(data?: (operation: Operation) => unknown) {
  const tools = new Map<string, any>();
  const operations: Operation[] = [];
  const callers: string[] = [];
  const ctx = {
    tools: {
      register(definition: any) {
        tools.set(definition.name, definition);
        return definition;
      },
    },
  };
  const operate = async (
    operation: Operation,
    _sessionId: string,
    caller: "user" | "agent",
  ): Promise<Reply> => {
    operations.push(operation);
    callers.push(caller);
    return { ok: true, data: data ? data(operation) : {} };
  };
  registerTools(ctx, operate);
  const exec = { agent: { session: { id: "session-1" } } };
  return { tools, operations, callers, exec };
}
const baseData = (operation: Operation): unknown => {
  if (operation.action === "list" && operation.kind === "character")
    return [
      {
        id: "c1",
        name: "小满",
        description: "山间少女",
        tags: ["温柔"],
        worldBookIds: ["b1"],
        avatar: "data:image/png;base64,AAAA",
        extra: { imported: true },
      },
      {
        id: "c2",
        name: "阿岚",
        description: "旅人",
        tags: [],
        worldBookIds: [],
        avatar: "https://example.com/a.png",
        extra: {},
      },
    ];
  if (operation.action === "list" && operation.kind === "worldbook")
    return [
      {
        id: "b1",
        name: "山间",
        description: "",
        entries: [
          { id: "e1", content: "小屋", comment: "", keys: [], enabled: true },
          { id: "e2", content: "溪流", comment: "", keys: [], enabled: false },
        ],
      },
    ];
  if (operation.action === "list" && operation.kind === "memory")
    return {
      characterId: "c1",
      memories: [
        { id: "m1", content: "喜欢乌龙茶", category: "user_persona" },
        { id: "m2", content: "山间初遇", category: "important_event" },
      ],
    };
  if (operation.action === "get" && operation.kind === "worldbook")
    return {
      id: "b1",
      name: "山间",
      description: "",
      entries: [
        {
          id: "e1",
          comment: "小屋",
          content: "后山有一座小屋",
          keys: ["后山"],
          enabled: true,
        },
        {
          id: "e2",
          comment: "溪流",
          content: "溪水很凉",
          keys: ["溪"],
          enabled: true,
        },
      ],
    };
  if (operation.action === "preview")
    return { prompt: "【角色】小满", matches: [], character: "小满" };
  return { id: operation.id ?? "new", name: "小满" };
};

test("注册角色卡、世界书、条目、记忆和预览工具", () => {
  const { tools } = harness(baseData);
  assert.deepEqual(
    [...tools.keys()].sort(),
    [
      "nekobot_character_delete",
      "nekobot_character_get",
      "nekobot_character_list",
      "nekobot_character_save",
      "nekobot_library",
      "nekobot_memory_delete",
      "nekobot_memory_list",
      "nekobot_memory_save",
      "nekobot_preview",
      "nekobot_worldbook_delete",
      "nekobot_worldbook_entry_delete",
      "nekobot_worldbook_entry_save",
      "nekobot_worldbook_get",
      "nekobot_worldbook_list",
      "nekobot_worldbook_save",
    ].sort(),
  );
  for (const [name, definition] of tools) {
    assert.ok(definition.description, name);
    assert.equal(definition.parameters?.type, "object", name);
    assert.equal(typeof definition.execute, "function", name);
    assert.equal(
      definition.output.render({}, { ok: true })[0].type,
      "text",
      name,
    );
  }
});

test("角色卡工具新建、局部更新并隐藏立绘数据", async () => {
  const { tools, operations, callers, exec } = harness(baseData);
  const created = await tools.get("nekobot_character_save").execute(
    {
      name: "小满",
      tags: "温柔, 安静",
      first_mes: "你好{{user}}",
      worldBookIds: ["b1"],
      initialState: { affection: 80 },
    },
    exec,
  );
  assert.deepEqual(created, {
    ok: true,
    character: {
      id: "new",
      name: "小满",
      avatar: "",
      hasAvatar: false,
      worldBookCount: 0,
    },
  });
  assert.deepEqual(operations.at(-1), {
    action: "create",
    kind: "character",
    value: {
      name: "小满",
      tags: ["温柔", "安静"],
      firstMessage: "你好{{user}}",
      worldBookIds: ["b1"],
      initialState: { affection: 80 },
    },
  });
  await tools
    .get("nekobot_character_save")
    .execute({ id: "c1", personality: "安静" }, exec);
  assert.deepEqual(operations.at(-1), {
    action: "update",
    kind: "character",
    id: "c1",
    value: { personality: "安静" },
  });
  const listed = await tools
    .get("nekobot_character_list")
    .execute({ query: "温柔", limit: 1 }, exec);
  assert.equal(listed.total, 1);
  assert.equal(listed.characters[0].id, "c1");
  assert.equal(listed.characters[0].avatar, "");
  assert.equal("extra" in listed.characters[0], false);
  assert.deepEqual(callers, ["agent", "agent", "agent"]);
});

test("世界书列表、分页读取与条目增删", async () => {
  const { tools, operations, exec } = harness(baseData);
  const books = await tools.get("nekobot_worldbook_list").execute({}, exec);
  assert.deepEqual(books.worldbooks, [
    {
      id: "b1",
      name: "山间",
      description: "",
      entryCount: 2,
      enabledEntryCount: 1,
    },
  ]);
  const page = await tools
    .get("nekobot_worldbook_get")
    .execute({ id: "b1", query: "溪", entryLimit: 1 }, exec);
  assert.equal(page.entries.length, 1);
  assert.equal(page.entries[0].id, "e2");
  assert.equal(page.total, 1);
  assert.equal(page.nextOffset, undefined);
  await tools.get("nekobot_worldbook_entry_save").execute(
    {
      bookId: "b1",
      entryId: "e1",
      content: "新正文",
      keys: "后山",
      enabled: "false",
      priority: "20",
    },
    exec,
  );
  assert.deepEqual(operations.at(-1), {
    action: "entry-save",
    kind: "worldbook",
    id: "b1",
    entryId: "e1",
    value: {
      content: "新正文",
      keys: ["后山"],
      enabled: false,
      priority: 20,
    },
  });
  await tools
    .get("nekobot_worldbook_entry_delete")
    .execute({ bookId: "b1", entryId: "e1" }, exec);
  assert.deepEqual(operations.at(-1), {
    action: "entry-delete",
    kind: "worldbook",
    id: "b1",
    entryId: "e1",
  });
  assert.deepEqual(
    await tools
      .get("nekobot_worldbook_entry_save")
      .execute({ bookId: "b1", position: "sideways" }, exec),
    { ok: false, error: "invalidPosition" },
  );
  assert.deepEqual(
    await tools
      .get("nekobot_worldbook_save")
      .execute({ id: "b1", entries: "not json" }, exec),
    { ok: false, error: "invalidOperation" },
  );
});

test("记忆工具按会话读取、局部更新和删除", async () => {
  const { tools, operations, exec } = harness(baseData);
  const listed = await tools
    .get("nekobot_memory_list")
    .execute({ query: "乌龙", limit: 10 }, exec);
  assert.equal(listed.characterId, "c1");
  assert.equal(listed.total, 1);
  assert.equal(listed.memories[0].id, "m1");
  await tools
    .get("nekobot_memory_save")
    .execute({ id: "m1", category: "important_event" }, exec);
  assert.deepEqual(operations.at(-1), {
    action: "update",
    kind: "memory",
    id: "m1",
    value: { category: "important_event" },
  });
  assert.deepEqual(
    await tools
      .get("nekobot_memory_save")
      .execute({ id: "m1", category: "other" }, exec),
    { ok: false, error: "invalidOperation" },
  );
  await tools.get("nekobot_memory_delete").execute({ id: "m1" }, exec);
  assert.deepEqual(operations.at(-1), {
    action: "delete",
    kind: "memory",
    id: "m1",
  });
});

test("预览返回提示词，旧通用工具继续接受 JSON 字符串", async () => {
  const { tools, operations, exec } = harness(baseData);
  assert.deepEqual(await tools.get("nekobot_preview").execute({}, exec), {
    ok: true,
    prompt: "【角色】小满",
    matches: [],
    character: "小满",
  });
  await tools.get("nekobot_library").execute(
    {
      action: "save",
      kind: "memory",
      value: '{"content":"喜欢乌龙茶"}',
    },
    exec,
  );
  assert.deepEqual(operations.at(-1), {
    action: "save",
    kind: "memory",
    value: { content: "喜欢乌龙茶" },
  });
});

test("没有会话时工具返回 sessionUnavailable", async () => {
  const { tools } = harness(baseData);
  assert.deepEqual(await tools.get("nekobot_character_list").execute({}, {}), {
    ok: false,
    error: "sessionUnavailable",
  });
});
