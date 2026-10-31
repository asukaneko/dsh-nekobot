import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CharacterEditor, BookEditor } from "../src/views.tsx";
import { messages } from "../src/locales.ts";
import { normalizeCharacter, normalizeWorldBook } from "../src/core.ts";
test("五种语言的角色编辑表单和世界书表单可渲染，用户内容按文本显示", () => {
  for (const dictionary of Object.values(messages)) {
    const t = (key: keyof typeof dictionary) => dictionary[key];
    const html = renderToStaticMarkup(
      <CharacterEditor
        value={normalizeCharacter({
          name: "<script>alert(1)</script>",
          personality: "温柔",
          portrait: "https://example.com/card.png",
        })}
        books={[]}
        onChange={() => {}}
        t={t}
      />,
    );
    assert.ok(html.includes(dictionary.personality));
    assert.ok(html.includes(dictionary.linkedBooks));
    assert.ok(html.includes(dictionary.uploadPortrait));
    assert.ok(html.includes(dictionary.portraitHint));
    assert.ok(!html.includes("<script>"));
    assert.ok(html.includes("&lt;script&gt;"));
    assert.ok(html.includes('referrerPolicy="no-referrer"'));
    const book = renderToStaticMarkup(
      <BookEditor
        value={normalizeWorldBook({
          name: "B",
          entries: [{ keys: ["后山"], content: "小屋" }],
        })}
        onChange={() => {}}
        t={t}
      />,
    );
    assert.ok(book.includes(dictionary.caseSensitive));
    assert.ok(book.includes(dictionary.position));
    assert.ok(book.includes("小屋"));
    assert.equal(
      Object.keys(dictionary).length,
      Object.keys(messages.en).length,
    );
  }
});
