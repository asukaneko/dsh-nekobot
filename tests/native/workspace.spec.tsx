import React from "react";
import { test, expect, vi } from "vitest";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { SlotTestRuntime } from "@deepseek-ai/dsh-client-test-runtime";
import { normalizeCharacter } from "../../src/core.ts";
import { messages } from "../../src/locales.ts";
import { nativeConversationContent } from "./conversation-content.tsx";

test("DSH 原生 Slot、会话作用域及页面导航", async () => {
  const runtime = await SlotTestRuntime.create();
  const ctx: any = runtime.ctx;
  const card = normalizeCharacter(
    { name: "小满", firstMessage: "{{user}}，欢迎来到{{char}}的小屋。" },
    "native-card",
  );
  let sessionId = "";
  let pendingId = "";
  const refresh = vi.fn(async () => {
    if (pendingId) {
      await runtime.sessions.add({ id: pendingId, snapshot: { blank: true } });
      pendingId = "";
    }
  });
  (runtime.sessions as any).refresh = refresh;
  const request = vi.fn(async (_url: any, init: any) => {
    const { operation } = JSON.parse(init.body);
    if (operation.action === "start") {
      sessionId = "native-session";
      pendingId = sessionId;
      return Response.json({ ok: true, data: { sessionId } });
    }
    return Response.json({
      ok: true,
      data:
        operation.action === "get"
          ? card
          : {
              characters: [card],
              worldbooks: [],
              memories: [],
              sessions: sessionId
                ? [
                    {
                      id: sessionId,
                      characterId: card.id,
                      name: card.name,
                      avatar: "",
                    },
                  ]
                : [],
              binding: {
                characterId: sessionId ? card.id : "",
                enabled: !!sessionId,
                userName: "",
              },
              settings: { maxWorldChars: 6000, recentMessages: 6 },
            },
    });
  });
  ctx.provide("locale", {
    register: () => () => {},
    bind: () => (key: string) =>
      messages.zh[key as keyof typeof messages.zh] || key,
    subscribe: () => () => {},
    getSnapshot: () => ({ revision: 0 }),
  });
  (runtime.slots as any).installLocale(ctx.get("locale"));
  ctx.provide("layout", {
    panelInfo: runtime.panelInfo,
    selectPanel: (id: string | null) =>
      runtime.panelInfo.set({ activePanelId: id }),
  });
  ctx.provide("uiWorkspace", {
    openSession: (id: string) => {
      runtime.sessions.retain(id as any, { source: "mainView" as any });
    },
  });
  let declaration: any;
  vm.runInNewContext(readFileSync(path.resolve("dist/client.js"), "utf8"), {
    window: {
      __ModuleLoader__: {
        load: (value: any) => {
          declaration = value;
        },
      },
    },
    fetch: request,
    localStorage,
    console,
    crypto,
    structuredClone,
    TextDecoder,
    TextEncoder,
    Uint8Array,
    DataView,
    atob,
    btoa,
    Response,
    Error,
    AbortController,
    setTimeout,
    clearTimeout,
    confirm: () => true,
  });
  const plugin = declaration.factory((name: string) => {
    if (name === "react") return React;
    throw new Error(name);
  });
  await runtime.declare({
    main: { kind: "keyed", scope: "root" },
    "sidebar.panellist": { kind: "list", scope: "root" },
    "sidebar.workspaces": { kind: "single", scope: "root" },
    "sidebar.brand.name": { kind: "single", scope: "root" },
    "sidebar.brand.mark": { kind: "single", scope: "root" },
  } as any);
  await runtime.mount(plugin);
  const native = nativeConversationContent();
  const style = document.createElement("style");
  style.textContent = native.css;
  document.head.append(style);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  (runtime.slots as any).registerFactory(
    {
      name: "conversation.content",
      scope: "session-maybe",
      children: {
        "conversation.session": { kind: "single", scope: "session" },
        "conversation.composer.bar": { kind: "single", scope: "session-maybe" },
        "conversation.composer": { kind: "chain", scope: "session" },
        "conversation.input.dock": { kind: "list", scope: "session" },
        "conversation.hero.workspace": { kind: "single", scope: "root" },
        "conversation.hero.agentPreset": {
          kind: "single",
          scope: "session-maybe",
        },
        "conversation.hero.options": { kind: "list", scope: "session" },
      },
      slots: { views: { scope: "session" }, widthControls: { scope: "root" } },
    },
    native.Content,
  );
  (runtime.slots as any).register(
    { name: "conversation.session" },
    ({ useSession }: any) =>
      useSession((s: any) => s.blank) ? null : (
        <article data-native-history="">原生历史消息</article>
      ),
  );
  (runtime.slots as any).register(
    { name: "conversation.composer.bar" },
    ({ sessionId }: any) => (
      <textarea aria-label="原生消息输入框" data-session={sessionId} />
    ),
  );
  await runtime.flush();
  const view = runtime.renderSlot("main" as any, {} as any, {
    entryKey: "nekobot",
  });
  await waitFor(() => expect(view.container.textContent).toContain("小满"));
  await act(async () => {
    runtime.panelInfo.set({ activePanelId: "nekobot" });
  });
  const sidebar = runtime.renderSlot("sidebar.workspaces" as any, {} as any);
  try {
    fireEvent.click(sidebar.view.getByRole("button", { name: "设置" }));
    await waitFor(() =>
      expect(
        view.view.getByRole("spinbutton", { name: "世界书字数预算" }),
      ).toBeTruthy(),
    );
    fireEvent.click(sidebar.view.getByRole("button", { name: "记忆" }));
    await waitFor(() =>
      expect(view.container.textContent).toContain("请先选择角色"),
    );
    fireEvent.click(sidebar.view.getByRole("button", { name: "会话" }));
    fireEvent.click(view.container.querySelector(".nkw-card")!);
    await waitFor(() =>
      expect(
        view.view
          .getByRole("textbox", { name: "原生消息输入框" })
          .getAttribute("data-session"),
      ).toBe("native-session"),
    );
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(
      view.container.querySelector(".nkw-opening-message")?.textContent,
    ).toContain("你，欢迎来到小满的小屋。");
    const scroller = view.container.querySelector(
      "[data-conversation-scroll]",
    )!;
    const messagesArea = scroller.querySelector("[data-nekobot-messages]")!;
    const composer = scroller.querySelector("[data-composer-seat]")!;
    expect(getComputedStyle(scroller).display).toBe("flex");
    expect(getComputedStyle(messagesArea).flexGrow).toBe("1");
    expect(getComputedStyle(composer).marginTop).toBe("auto");
    expect(getComputedStyle(composer).bottom).toBe("0px");
    expect(
      messagesArea.compareDocumentPosition(composer) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await runtime.sessions.updateSessionSnapshot(sessionId, (snapshot: any) => {
      snapshot.blank = false;
    });
    await waitFor(() =>
      expect(view.container.querySelector(".nkw-opening")).toBeNull(),
    );
    expect(view.container.querySelector("[data-native-history]")).toBeTruthy();
    expect(view.container.querySelector(".nkw-chat-views")).toBeNull();
    expect(
      view.container.querySelector('[data-slot="conversation.session"]')
        ?.parentElement,
    ).toBe(scroller);
    expect(
      (
        runtime.sessions.retainInfo(sessionId as any).getSnapshot()
          .retainedBy as any
      ).nekobot,
    ).toBe(1);
    fireEvent.click(sidebar.view.getByRole("button", { name: "记忆" }));
    await waitFor(() =>
      expect(view.view.getByRole("button", { name: "添加记忆" })).toBeTruthy(),
    );
    expect(
      (
        runtime.sessions.retainInfo(sessionId as any).getSnapshot()
          .retainedBy as any
      ).nekobot,
    ).toBeUndefined();
    fireEvent.click(sidebar.view.getByRole("button", { name: "设置" }));
    await waitFor(() =>
      expect(
        view.view.getByRole("spinbutton", { name: "世界书字数预算" }),
      ).toBeTruthy(),
    );
    fireEvent.click(sidebar.view.getByRole("button", { name: "会话" }));
    await waitFor(() =>
      expect(
        view.view.getByRole("textbox", { name: "原生消息输入框" }),
      ).toBeTruthy(),
    );
    expect(
      (
        runtime.sessions.retainInfo(sessionId as any).getSnapshot()
          .retainedBy as any
      ).nekobot,
    ).toBe(1);
  } finally {
    await runtime.dispose();
    style.remove();
    vi.unstubAllGlobals();
  }
});
