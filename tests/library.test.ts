import { test } from "node:test";
import assert from "node:assert/strict";
import { Library, type Domain, type Table } from "../src/library.ts";
import type {
  Character,
  WorldBook,
  WorldEntry,
  Memory,
  LibrarySnapshot,
} from "../src/types.ts";
export function memoryDomain(): Domain {
  const tables = new Map<string, Map<string, { json: string }>>();
  return {
    table(name) {
      if (!tables.has(name)) tables.set(name, new Map());
      const data = tables.get(name)!;
      return {
        get: (id) => data.get(id),
        entries: () => data.entries(),
        put: async (id, v) => {
          data.set(id, v);
        },
        delete: async (id) => {
          data.delete(id);
        },
      };
    },
    close: async () => {},
  };
}
test("会话标题与置顶独立保存，重绑和存储重启保留元数据", async () => {
  const domain = memoryDomain(),
    library = new Library(domain);
  const card = (await library.execute(
    { action: "save", kind: "character", value: { name: "小满" } },
    "",
  )) as Character;
  for (const id of ["s1", "s2"])
    await library.execute(
      { action: "bind", value: { characterId: card.id, enabled: true } },
      id,
    );
  await library.execute(
    {
      action: "session",
      id: "s1",
      value: { title: " 山间初遇 ", pinned: true, characterId: "ignored" },
    },
    "s2",
  );
  await library.execute(
    {
      action: "bind",
      value: { characterId: card.id, enabled: false, userName: "小星" },
    },
    "s1",
  );
  const restored = new Library(domain);
  const data = (await restored.execute(
    { action: "list" },
    "s2",
  )) as LibrarySnapshot;
  assert.equal(data.sessions[0].id, "s1");
  assert.equal(data.sessions[0].name, "山间初遇");
  assert.equal(data.sessions[0].characterName, "小满");
  assert.equal(restored.binding("s1").characterId, card.id);
  assert.equal(restored.binding("s1").enabled, false);
  assert.ok(data.sessions[0].createdAt);
  await assert.rejects(
    restored.execute(
      { action: "session", id: "s1", value: { title: " " } },
      "s1",
    ),
    /sessionTitleRequired/,
  );
  await assert.rejects(
    restored.execute(
      { action: "session", id: "s1", value: { pinned: "yes" } },
      "s1",
    ),
    /invalidOperation/,
  );
  await assert.rejects(
    restored.execute(
      { action: "session", id: "s1", value: { pinned: false } },
      "s1",
      "agent",
    ),
    /userOnly/,
  );
});
test("角色、世界书共享操作，引用检查与会话记忆隔离", async () => {
  const library = new Library(memoryDomain());
  const book = (await library.execute(
    {
      action: "save",
      kind: "worldbook",
      value: {
        name: "世界",
        entries: [{ content: "山中小屋", constant: true }],
      },
    },
    "s1",
  )) as WorldBook;
  const card = (await library.execute(
    {
      action: "save",
      kind: "character",
      value: { name: "小满", worldBookIds: [book.id] },
    },
    "s1",
  )) as Character;
  await library.execute(
    {
      action: "bind",
      value: { characterId: card.id, userName: "小星", enabled: true },
    },
    "s1",
  );
  await library.execute(
    { action: "save", kind: "memory", value: { content: "用户喜欢乌龙茶" } },
    "s1",
    "agent",
  );
  assert.match(library.preview("s1").prompt, /山中小屋/);
  assert.match(library.preview("s1").prompt, /乌龙茶/);
  assert.equal(library.preview("s2").prompt, "");
  assert.equal(library.memories("s2", card.id).length, 0);
  await assert.rejects(
    library.execute({ action: "delete", kind: "worldbook", id: book.id }, "s1"),
    /inUse/,
  );
  await assert.rejects(
    library.execute({ action: "delete", kind: "character", id: card.id }, "s1"),
    /inUse/,
  );
  await assert.rejects(
    library.execute(
      { action: "bind", value: { characterId: card.id } },
      "s1",
      "agent",
    ),
    /userOnly/,
  );
});
test("关闭绑定与不同角色不会继续注入旧记忆", async () => {
  const library = new Library(memoryDomain());
  const a = (await library.execute(
    { action: "save", kind: "character", value: { name: "A" } },
    "s",
  )) as Character;
  const b = (await library.execute(
    { action: "save", kind: "character", value: { name: "B" } },
    "s",
  )) as Character;
  await library.execute(
    { action: "bind", value: { characterId: a.id, enabled: true } },
    "s",
  );
  await library.execute(
    { action: "save", kind: "memory", value: { content: "A的秘密" } },
    "s",
  );
  await library.execute(
    { action: "bind", value: { characterId: b.id, enabled: true } },
    "s",
  );
  assert.doesNotMatch(library.preview("s").prompt, /A的秘密/);
  await library.execute(
    { action: "bind", value: { characterId: b.id, enabled: false } },
    "s",
  );
  assert.equal(library.preview("s").prompt, "");
});
test("导入写入失败回滚新条目，失败后队列仍可继续工作", async () => {
  const domain = memoryDomain(),
    table = domain.table.bind(domain);
  let fail = true;
  domain.table = (name) => {
    const original = table(name);
    return name === "characters"
      ? {
          ...original,
          put: async (id, v) => {
            if (fail) throw new Error("disk full");
            return original.put(id, v);
          },
        }
      : original;
  };
  const library = new Library(domain);
  const data = Buffer.from(
    JSON.stringify({
      format: "nekobot-dsh",
      schemaVersion: 1,
      worldbooks: [{ id: "b", name: "B", entries: [] }],
      characters: [{ name: "A", worldBookIds: ["b"] }],
    }),
  ).toString("base64");
  await assert.rejects(
    library.execute({ action: "import", data, fileName: "library.json" }, "s"),
    /disk full/,
  );
  assert.equal(library.all("worldbooks").length, 0);
  fail = false;
  await library.execute(
    { action: "import", data, fileName: "library.json" },
    "s",
  );
  assert.equal(library.all("characters").length, 1);
});
test("角色卡局部更新只覆盖提交字段并合并关系值", async () => {
  const library = new Library(memoryDomain());
  const book = (await library.execute(
    {
      action: "create",
      kind: "worldbook",
      value: { name: "山间", entries: [{ content: "小屋", keys: ["后山"] }] },
    },
    "s",
  )) as WorldBook;
  const card = (await library.execute(
    {
      action: "create",
      kind: "character",
      value: {
        name: "小满",
        personality: "温柔",
        first_mes: "你好{{user}}",
        rules: ["保持角色"],
        worldBookIds: [book.id],
        initialState: { affection: 20, trust: 10 },
      },
    },
    "s",
  )) as Character;
  assert.equal(card.firstMessage, "你好{{user}}");
  const updated = (await library.execute(
    {
      action: "update",
      kind: "character",
      id: card.id,
      value: { personality: "安静", initial_state: { affection: 90 } },
    },
    "s",
  )) as Character;
  assert.equal(updated.name, "小满");
  assert.equal(updated.personality, "安静");
  assert.equal(updated.firstMessage, "你好{{user}}");
  assert.deepEqual(updated.rules, ["保持角色"]);
  assert.deepEqual(updated.worldBookIds, [book.id]);
  assert.equal(updated.initialState.affection, 90);
  assert.equal(updated.initialState.trust, 10);
  assert.equal(updated.initialState.familiarity, 30);
  await assert.rejects(
    library.execute(
      { action: "update", kind: "character", id: "missing", value: {} },
      "s",
    ),
    /notFound/,
  );
  await assert.rejects(
    library.execute(
      { action: "update", kind: "character", id: card.id, value: "name" },
      "s",
    ),
    /invalidOperation/,
  );
  await assert.rejects(
    library.execute(
      { action: "create", kind: "character", value: { name: " " } },
      "s",
    ),
    /nameRequired/,
  );
});

test("世界书局部更新与单条条目增删改", async () => {
  const library = new Library(memoryDomain());
  const book = (await library.execute(
    {
      action: "create",
      kind: "worldbook",
      value: {
        name: "山间",
        entries: [
          {
            comment: "小屋",
            content: "旧正文",
            keys: ["后山"],
            priority: 20,
          },
        ],
      },
    },
    "s",
  )) as WorldBook;
  const updated = (await library.execute(
    {
      action: "update",
      kind: "worldbook",
      id: book.id,
      value: { description: "简介" },
    },
    "s",
  )) as WorldBook;
  assert.equal(updated.name, "山间");
  assert.equal(updated.description, "简介");
  assert.equal(updated.entries.length, 1);
  assert.equal(updated.entries[0].content, "旧正文");
  const existing = updated.entries[0];
  const patched = (await library.execute(
    {
      action: "entry-save",
      kind: "worldbook",
      id: book.id,
      entryId: existing.id,
      value: { content: "新正文", enabled: false },
    },
    "s",
  )) as WorldEntry;
  assert.equal(patched.id, existing.id);
  assert.equal(patched.content, "新正文");
  assert.equal(patched.enabled, false);
  assert.deepEqual(patched.keys, ["后山"]);
  assert.equal(patched.priority, 20);
  const created = (await library.execute(
    {
      action: "entry-save",
      kind: "worldbook",
      id: book.id,
      value: { comment: "溪流", content: "溪水很凉", keys: ["溪"] },
    },
    "s",
  )) as WorldEntry;
  assert.equal(
    library.read<WorldBook>("worldbooks", book.id)!.entries.length,
    2,
  );
  await library.execute(
    {
      action: "entry-delete",
      kind: "worldbook",
      id: book.id,
      entryId: existing.id,
    },
    "s",
  );
  const remaining = library.read<WorldBook>("worldbooks", book.id)!;
  assert.deepEqual(
    remaining.entries.map((entry) => entry.id),
    [created.id],
  );
  assert.deepEqual(
    await library
      .execute(
        {
          action: "entry-delete",
          kind: "worldbook",
          id: book.id,
          entryId: existing.id,
        },
        "s",
      )
      .then(
        () => "deleted",
        (error) => error.code,
      ),
    "notFound",
  );
});

test("记忆按会话与角色隔离，支持局部更新、过滤与删除", async () => {
  const library = new Library(memoryDomain());
  const card = (await library.execute(
    { action: "create", kind: "character", value: { name: "小满" } },
    "s1",
  )) as Character;
  await library.execute(
    { action: "bind", value: { characterId: card.id, enabled: true } },
    "s1",
  );
  const memory = (await library.execute(
    {
      action: "create",
      kind: "memory",
      value: { content: " 喜欢乌龙茶 ", category: "user_persona" },
    },
    "s1",
  )) as Memory;
  assert.equal(memory.content, "喜欢乌龙茶");
  assert.equal(memory.characterId, card.id);
  assert.equal(memory.sessionId, "s1");
  const updated = (await library.execute(
    {
      action: "update",
      kind: "memory",
      id: memory.id,
      value: { category: "important_event" },
    },
    "s1",
  )) as Memory;
  assert.equal(updated.content, "喜欢乌龙茶");
  assert.equal(updated.category, "important_event");
  const listed = (await library.execute(
    { action: "list", kind: "memory" },
    "s1",
  )) as { characterId: string; memories: Memory[] };
  assert.equal(listed.characterId, card.id);
  assert.equal(listed.memories.length, 1);
  await assert.rejects(
    library.execute(
      {
        action: "update",
        kind: "memory",
        id: memory.id,
        value: { content: "改" },
      },
      "s2",
    ),
    /notFound|chooseCharacter/,
  );
  await library.execute(
    { action: "delete", kind: "memory", id: memory.id },
    "s1",
  );
  assert.equal(library.memories("s1", card.id).length, 0);
});

test("按资源列出角色卡和世界书，并回收内存中的条目", async () => {
  const library = new Library(memoryDomain());
  await library.execute(
    {
      action: "create",
      kind: "worldbook",
      value: { name: "世界", entries: [{ content: "常驻", constant: true }] },
    },
    "s",
  );
  await library.execute(
    { action: "create", kind: "character", value: { name: "小满" } },
    "s",
  );
  const characters = (await library.execute(
    { action: "list", kind: "character" },
    "s",
  )) as any[];
  assert.equal(characters.length, 1);
  assert.equal(characters[0].name, "小满");
  assert.equal(characters[0].hasAvatar, false);
  assert.equal("extra" in characters[0], false);
  const worldbooks = (await library.execute(
    { action: "list", kind: "worldbook" },
    "s",
  )) as WorldBook[];
  assert.equal(worldbooks[0].name, "世界");
  const snapshot = (await library.execute(
    { action: "list" },
    "s",
  )) as LibrarySnapshot;
  assert.equal(snapshot.characters.length, 1);
  assert.equal(snapshot.worldbooks.length, 1);
});

test("存储重建后恢复绑定、卡片和设置", async () => {
  const domain = memoryDomain(),
    first = new Library(domain);
  const card = (await first.execute(
    { action: "save", kind: "character", value: { name: "小满" } },
    "s",
  )) as Character;
  await first.execute(
    {
      action: "bind",
      value: { characterId: card.id, enabled: true, userName: "小星" },
    },
    "s",
  );
  await first.execute(
    { action: "settings", value: { maxWorldChars: 2000, recentMessages: 3 } },
    "s",
  );
  const resumed = new Library(domain);
  assert.equal(resumed.binding("s").userName, "小星");
  assert.equal(resumed.settings().maxWorldChars, 2000);
  assert.match(resumed.preview("s").prompt, /小满/);
});
