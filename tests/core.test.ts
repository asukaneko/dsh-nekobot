import { test } from "node:test";
import assert from "node:assert/strict";
import { strToU8, zipSync } from "fflate";
import {
  compilePrompt,
  importData,
  matchWorldBooks,
  normalizeCharacter,
  normalizeEntry,
  normalizeSettings,
  normalizeWorldBook,
} from "../src/core.ts";

test("导入 Nekobot、酒馆 V2/V3，并保留扩展与内嵌世界书", () => {
  for (const spec of ["chara_card_v2", "chara_card_v3"]) {
    const result = importData(
      strToU8(
        JSON.stringify({
          spec,
          data: {
            name: "小满",
            first_mes: "你好 {{user}}",
            mes_example: "示例",
            extensions: { custom: "保留" },
            character_book: {
              entries: [{ keys: ["后山"], content: "后山有一座小屋" }],
            },
          },
        }),
      ),
      "card.json",
    );
    assert.equal(result.characters[0].firstMessage, "你好 {{user}}");
    assert.equal(result.characters[0].exampleDialogues, "示例");
    assert.equal(
      (result.characters[0].extra.data as any).extensions.custom,
      "保留",
    );
    assert.equal((result.characters[0].extra as any).spec, spec);
    assert.deepEqual(result.characters[0].worldBookIds, [
      result.worldbooks[0].id,
    ]);
  }
  const c = normalizeCharacter({
    name: "A",
    state: { affection: 400 },
    rules: ["保留规则"],
    portrait: "/data/private/avatar.png",
  });
  assert.equal(c.initialState.affection, 100);
  assert.equal(c.avatar, "");
  assert.equal(c.rules[0], "保留规则");
});
test("Nekobot ZIP 导入立绘，异常包不产生条目", () => {
  const zip = zipSync({
    "character.json": strToU8('{"name":"小满"}'),
    "portrait.png": new Uint8Array([1, 2, 3]),
  });
  assert.equal(
    importData(zip, "card.zip").characters[0].avatar,
    "data:image/png;base64,AQID",
  );
  assert.throws(
    () => importData(zipSync({ "other.json": strToU8("{}") }), "bad.zip"),
    /invalidFile/,
  );
});
function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(data.length + 12);
  new DataView(chunk.buffer).setUint32(0, data.length);
  chunk.set(strToU8(type), 4);
  chunk.set(data, 8);
  return chunk;
}
test("PNG 优先读取 ccv3；损坏的 chunk 拒绝导入", () => {
  const chunks = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    ...["chara", "ccv3"].map((key, i) =>
      pngChunk(
        "tEXt",
        strToU8(
          `${key}\0${Buffer.from(JSON.stringify({ name: `角色${i}` })).toString("base64")}`,
        ),
      ),
    ),
    pngChunk("IEND", new Uint8Array()),
  ];
  const png = Buffer.concat(chunks);
  assert.equal(importData(png, "card.png").characters[0].name, "角色1");
  const broken = new Uint8Array(png);
  new DataView(broken.buffer).setUint32(8, 0xffffffff);
  assert.throws(() => importData(broken, "bad.png"), /invalidFile/);
});
test("批量导入重新映射关联 ID，导出包重入不覆盖原数据", () => {
  const source = {
    format: "nekobot-dsh",
    schemaVersion: 1,
    characters: [{ id: "old-card", name: "A", worldBookIds: ["old-book"] }],
    worldbooks: [{ id: "old-book", name: "B", entries: [] }],
  };
  const a = importData(strToU8(JSON.stringify(source)), "library.json"),
    b = importData(strToU8(JSON.stringify(source)), "library.json");
  assert.notEqual(a.characters[0].id, b.characters[0].id);
  assert.equal(a.characters[0].worldBookIds[0], a.worldbooks[0].id);
  assert.throws(
    () =>
      importData(
        strToU8(JSON.stringify({ ...source, schemaVersion: 9 })),
        "library.json",
      ),
    /unsupportedVersion/,
  );
});
test("世界书匹配覆盖常驻、当前用户、历史、大小写和字数预算", () => {
  const b = normalizeWorldBook({
    name: "B",
    entries: [
      { id: "off", content: "关闭", constant: true, enabled: false },
      { id: "always", content: "常驻", constant: true, priority: 200 },
      { id: "user", content: "当前消息", keys: ["Mountain"], priority: 150 },
      { id: "history", content: "历史消息", keys: ["小屋"] },
      {
        id: "case",
        content: "大小写",
        keys: ["MOUNTAIN"],
        caseSensitive: true,
      },
    ],
  });
  const config = { maxWorldChars: 500, recentMessages: 6 };
  const matches = matchWorldBooks([b], "mountain", ["小屋"], config);
  assert.deepEqual(
    matches.map((m) => m.entryId),
    ["always", "user", "history"],
  );
  assert.deepEqual(matches[1].sources, ["user"]);
  assert.deepEqual(
    matchWorldBooks([b], "", ["小屋"], { ...config, recentMessages: 0 }).map(
      (m) => m.entryId,
    ),
    ["always"],
  );
  assert.equal(
    matchWorldBooks([b], "mountain", ["小屋"], {
      ...config,
      maxWorldChars: 3,
    }).reduce((n, m) => n + m.content.length, 0),
    3,
  );
});
test("编译保留自定义提示词并替换角色变量", () => {
  const card = normalizeCharacter({
    name: "小满",
    systemPrompt: "我是{{char}}，称呼{{user}}为老师",
    personality: "温柔",
    rules: ["保持设定"],
  });
  const prompt = compilePrompt(card, "小星", [
    {
      bookId: "a",
      entryId: "1",
      title: "世界",
      content: "前置世界",
      position: "before_char",
      priority: 1,
      sources: ["constant"],
    },
  ]);
  assert.ok(prompt.indexOf("前置世界") < prompt.indexOf("你是角色"));
  assert.match(prompt, /我是小满，称呼小星为老师/);
  assert.match(prompt, /保持设定/);
});
test("保留不支持的世界书位置并明确告知兼容范围", () => {
  const result = importData(
    strToU8(
      JSON.stringify({
        name: "B",
        entries: [
          { content: "内容", constant: true, position: 4, selective: true },
        ],
      }),
    ),
    "book.json",
  );
  assert.equal(result.worldbooks[0].entries[0].position, "at_depth");
  assert.ok(result.notices.some((n) => n.code === "depthUnsupported"));
  assert.ok(result.notices.some((n) => n.code === "advancedWorldUnsupported"));
  assert.throws(() => normalizeEntry({ position: 17 }), /invalidPosition/);
  assert.deepEqual(
    normalizeSettings({ recentMessages: -1, maxWorldChars: 999999 }),
    { recentMessages: 0, maxWorldChars: 24000 },
  );
});
