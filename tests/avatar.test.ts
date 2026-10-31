import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { AVATAR_LIMIT, readAvatarFile } from "../src/avatar.ts";

test("立绘上传校验类型和大小并生成 data URL", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  const original = new Map(
    ["File", "FileReader"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  for (const key of ["File", "FileReader"])
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value: (dom.window as any)[key],
    });
  try {
    const png = new dom.window.File(
      [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])],
      "portrait.png",
      { type: "image/png" },
    );
    assert.match(
      await readAvatarFile(png),
      /^data:image\/png;base64,[a-z\d+/=]+$/i,
    );
    const webp = new dom.window.File(
      [new Uint8Array([1, 2, 3])],
      "portrait.WEBP",
      {
        type: "",
      },
    );
    assert.match(await readAvatarFile(webp), /^data:image\/webp;base64,/);
    await assert.rejects(
      readAvatarFile({
        type: "text/plain",
        size: 10,
        name: "note.txt",
      } as unknown as File),
      /invalidAvatarType/,
    );
    await assert.rejects(
      readAvatarFile({
        type: "image/png",
        size: AVATAR_LIMIT + 1,
        name: "huge.png",
      } as unknown as File),
      /avatarTooLarge/,
    );
  } finally {
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    dom.window.close();
  }
});
