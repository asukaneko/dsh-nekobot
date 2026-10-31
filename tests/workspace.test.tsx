import { test } from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { JSDOM } from "jsdom";
import { Library, type Domain } from "../src/library.ts";
import { clientRuntime } from "./client-runtime.ts";
import { messages } from "../src/locales.ts";
import type { Character } from "../src/types.ts";

test("工作台真实点击链：加载角色库、开聊、编辑保存世界书，并保护未保存内容", async () => {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="app"></div></body></html>',
    { url: "http://localhost/" },
  );
  const globals = [
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "HTMLInputElement",
    "Event",
    "MouseEvent",
    "localStorage",
    "File",
    "FileReader",
    "IS_REACT_ACT_ENVIRONMENT",
  ];
  const original = new Map(
    globals.map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  for (const key of globals)
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value:
        key === "IS_REACT_ACT_ENVIRONMENT" ? true : (dom.window as any)[key],
    });
  const tables = new Map<string, Map<string, { json: string }>>();
  const domain: Domain = {
    table(name) {
      if (!tables.has(name)) tables.set(name, new Map());
      const rows = tables.get(name)!;
      return {
        get: (id) => rows.get(id),
        entries: () => rows.entries(),
        put: async (id, row) => {
          rows.set(id, row);
        },
        delete: async (id) => {
          rows.delete(id);
        },
      };
    },
    close: async () => {},
  };
  const library = new Library(domain);
  const book: any = await library.execute(
    {
      action: "save",
      kind: "worldbook",
      value: {
        name: "山间世界",
        entries: [
          { keys: ["后山"], content: "后山有一座小屋", constant: true },
        ],
      },
    },
    "",
  );
  const card = (await library.execute(
    {
      action: "save",
      kind: "character",
      value: {
        name: "小满",
        description: "住在山间的朋友",
        worldBookIds: [book.id],
      },
    },
    "",
  )) as Character;
  let created = 0;
  const runtime = clientRuntime(async (_input, init) => {
    const { operation, sessionId } = JSON.parse(init!.body as string);
    try {
      if (operation.action === "start") {
        const id = `role-chat-${++created}`;
        await library.execute(
          {
            action: "bind",
            value: {
              characterId: operation.id,
              userName: "小星",
              enabled: true,
            },
          },
          id,
        );
        return Response.json({ ok: true, data: { sessionId: id } });
      }
      return Response.json({
        ok: true,
        data: await library.execute(operation, sessionId),
      });
    } catch (e) {
      return Response.json({ ok: false, error: (e as Error).message });
    }
  });
  runtime.context.locale.bind = () => (key: string) =>
    messages.zh[key as keyof typeof messages.zh] || key;
  // 组件已经在 apply 中绑定翻译，这里通过其注册字典重新装配用于实际渲染的 t。
  const Main = runtime.entries.find((e) => e.options.name === "main").component;
  const Native = runtime.entries.find(
    (e) => e.options.name === "nekobot.chat",
  ).component;
  const rootModule = await import("react-dom/client");
  const root = rootModule.createRoot(document.getElementById("app")!);
  let factory = "";
  const props = {
    SessionProvider: ({ session, children }: any) => {
      assert.equal(typeof session, "object");
      assert.ok(session.binding);
      return <div data-native-session={session.sessionId}>{children}</div>;
    },
    renderSlot: () => (
      <Native
        renderFactorySlot={(name: string) => {
          factory = name;
          return <div data-native-composer="true">Native conversation</div>;
        }}
      />
    ),
  };
  const click = async (button: Element) => {
    await act(async () => {
      button.dispatchEvent(
        new dom.window.MouseEvent("click", { bubbles: true }),
      );
    });
  };
  const button = (text: string, scope: ParentNode = document) =>
    [...scope.querySelectorAll("button")].find(
      (el) => el.textContent?.trim() === text,
    )!;
  const change = async (
    input: HTMLInputElement | HTMLTextAreaElement,
    value: string,
  ) => {
    await act(async () => {
      const prototype =
        input.tagName === "TEXTAREA"
          ? dom.window.HTMLTextAreaElement.prototype
          : dom.window.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
        input,
        value,
      );
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
  };
  try {
    await act(async () => {
      runtime.selectPanel("nekobot");
      const Sidebar = runtime.entries.find(
        (e) => e.options.name === "sidebar.workspaces",
      ).component;
      root.render(
        <>
          <Sidebar />
          <Main {...props} />
        </>,
      );
    });
    assert.equal(document.querySelectorAll(".nkw-card").length, 2);
    assert.ok(!document.querySelector("[role=alert]"));
    await click(document.querySelector(".nkw-card")!);
    assert.equal(created, 1);
    assert.equal(
      document
        .querySelector("[data-native-session]")
        ?.getAttribute("data-native-session"),
      "role-chat-1",
    );
    assert.equal(factory, "conversation.content");
    assert.ok(
      document.querySelector(".nkw-details")?.textContent?.includes("小满"),
    );
    await click(document.querySelector(".nkw-book-link")!);
    assert.ok(
      document.querySelector(".nk-list")?.textContent?.includes("山间世界"),
    );
    const nameInput = document.querySelector(
      ".nk-detail input",
    ) as HTMLInputElement;
    assert.equal(nameInput.value, "山间世界");
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        dom.window.HTMLInputElement.prototype,
        "value",
      )!.set!.call(nameInput, "月下山林");
      nameInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    runtime.sandbox.confirm = () => false;
    await click(document.querySelectorAll(".nkw-navigation button")[1]);
    assert.equal(
      (document.querySelector(".nk-detail input") as HTMLInputElement).value,
      "月下山林",
    );
    await act(async () => {
      document
        .querySelector(".nk-detail form")!
        .dispatchEvent(
          new dom.window.Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    assert.equal(
      (
        (await library.execute(
          { action: "get", kind: "worldbook", id: book.id },
          "",
        )) as any
      ).name,
      "月下山林",
    );
    assert.ok(!document.querySelector("[role=alert]"));
    assert.equal(library.binding("role-chat-1").characterId, card.id);
    await click(document.querySelectorAll(".nkw-navigation button")[0]);
    await click(button("重命名"));
    await change(document.querySelector(".nkw-rename input")!, "山间初遇");
    await act(async () => {
      document
        .querySelector(".nkw-rename")!
        .dispatchEvent(
          new dom.window.Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    assert.equal(library.binding("role-chat-1").title, "山间初遇");
    assert.ok(
      document.querySelector(".nkw-session")?.textContent?.includes("山间初遇"),
    );
    await click(button("置顶"));
    assert.equal(library.binding("role-chat-1").pinned, true);
    await click(
      button("编辑", document.querySelector(".nkw-details-actions")!),
    );
    assert.equal(
      (document.querySelector(".nk-detail input") as HTMLInputElement).value,
      "小满",
    );
    const portrait = new dom.window.File(
      [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])],
      "portrait.png",
      { type: "image/png" },
    );
    const uploadInput = document.querySelector(
      ".nk-field input[type=file]",
    ) as HTMLInputElement;
    assert.ok(uploadInput, "角色编辑器提供立绘上传");
    Object.defineProperty(uploadInput, "files", {
      configurable: true,
      value: [portrait],
    });
    await act(async () => {
      uploadInput.dispatchEvent(
        new dom.window.Event("change", { bubbles: true }),
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    assert.match(
      document.querySelector(".nk-portrait")?.getAttribute("src") || "",
      /^data:image\/png;base64,/,
    );
    await act(async () => {
      document
        .querySelector(".nk-detail form")!
        .dispatchEvent(
          new dom.window.Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    assert.match(
      library.read<Character>("characters", card.id)!.avatar,
      /^data:image\/png;base64,/,
    );
    await click(button("记忆", document.querySelector(".nkw-side-footer")!));
    await change(document.querySelector(".nk-panel textarea")!, "喜欢乌龙茶");
    await click(document.querySelectorAll(".nkw-navigation button")[0]);
    assert.ok(
      document.querySelector(".nk-panel textarea"),
      "未保存的记忆必须阻止离开页面",
    );
    await click(button("添加记忆"));
    assert.equal(
      library.memories("role-chat-1", card.id)[0].content,
      "喜欢乌龙茶",
    );
    await click(button("编辑", document.querySelector(".nk-memory")!));
    await change(
      document.querySelector(".nk-panel textarea")!,
      "喜欢清香乌龙茶",
    );
    await click(button("保存", document.querySelector(".nk-panel")!));
    assert.equal(library.memories("role-chat-1", card.id).length, 1);
    assert.equal(
      library.memories("role-chat-1", card.id)[0].content,
      "喜欢清香乌龙茶",
    );
    await click(button("+ 新建会话"));
    assert.ok(document.querySelector(".nkw-gallery"));
    assert.equal(created, 1, "选择角色之前不创建宿主会话");
    await click(document.querySelector(".nkw-card")!);
    assert.equal(created, 2);
    assert.equal(document.querySelectorAll(".nkw-session").length, 2);
    assert.ok(
      document.querySelector(".nkw-session")?.textContent?.includes("山间初遇"),
      "置顶会话保持在最前面",
    );
    const deleteSession = () =>
      button("删除", document.querySelector(".nkw-tools")!);
    runtime.sandbox.confirm = () => false;
    await click(deleteSession());
    assert.equal(
      document.querySelectorAll(".nkw-session").length,
      2,
      "取消确认不会删除会话",
    );
    runtime.sandbox.confirm = () => true;
    await click(deleteSession());
    assert.equal(document.querySelectorAll(".nkw-session").length, 1);
    assert.equal(library.binding("role-chat-2").characterId, "");
    assert.equal(document.querySelector("[data-native-session]"), null);
  } finally {
    await act(async () => root.unmount());
    runtime.dispose();
    dom.window.close();
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
