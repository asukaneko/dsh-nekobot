import { test } from "node:test";
import assert from "node:assert/strict";
import { WorkspaceController } from "../src/workspace-controller.ts";
import { normalizeCharacter } from "../src/core.ts";

test("恢复已保存会话时先打开宿主会话，同一轮进入不会重复导航", async () => {
  const card = normalizeCharacter({ name: "小满" }, "card1");
  const opened: string[] = [];
  const storage = new Map([["nekobot.session", "saved-chat"]]);
  const controller = new WorkspaceController(
    {
      openSession: async (id) => {
        opened.push(id);
      },
      show: () => {},
      leave: () => {},
    },
    async (_url, init) => {
      const { operation } = JSON.parse(init!.body as string);
      return Response.json({
        ok: true,
        data:
          operation.action === "get"
            ? card
            : {
                characters: [card],
                worldbooks: [],
                memories: [],
                sessions: [],
                binding: {
                  characterId: card.id,
                  enabled: true,
                  userName: "小星",
                },
                settings: { maxWorldChars: 6000, recentMessages: 6 },
              },
      });
    },
    {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => {
        storage.set(key, value);
      },
    },
  );
  const first = controller.enter(),
    second = controller.enter();
  assert.equal(first, second);
  await first;
  assert.deepEqual(opened, ["saved-chat"]);
  assert.equal(controller.getSnapshot().card?.name, "小满");
  await controller.enter();
  assert.deepEqual(opened, ["saved-chat"]);
  controller.dispose();
});
test("本地记住的会话失效时仍能打开角色库", async () => {
  const controller = new WorkspaceController(
    {
      openSession: async () => {
        throw new Error("notFound");
      },
      show: () => {},
      leave: () => {},
    },
    async (_url, init) => {
      const { sessionId } = JSON.parse(init!.body as string);
      assert.equal(sessionId, "");
      return Response.json({
        ok: true,
        data: {
          characters: [],
          worldbooks: [],
          memories: [],
          sessions: [],
          binding: { characterId: "", enabled: false, userName: "" },
          settings: { maxWorldChars: 6000, recentMessages: 6 },
        },
      });
    },
    {
      getItem: (key) => (key === "nekobot.session" ? "missing-chat" : null),
      setItem: () => {},
    },
  );
  await controller.enter();
  assert.equal(controller.getSnapshot().sessionId, "");
  assert.equal(controller.getSnapshot().busy, false);
  assert.equal(controller.getSnapshot().error, "");
  assert.ok(controller.getSnapshot().data);
  controller.dispose();
});
test("删除当前会话后清空记忆的会话，删除其他会话保留当前选择", async () => {
  const card = normalizeCharacter({ name: "小满" }, "card1"),
    storage = new Map([["nekobot.session", "s1"]]),
    operations: any[] = [];
  let sessions: any[] = ["s1", "s2", "s3"].map((id, index) => ({
    id,
    characterId: card.id,
    name: "会话" + id,
    characterName: "小满",
    pinned: false,
    createdAt: index,
    avatar: "",
  }));
  const controller = new WorkspaceController(
    {
      openSession: async () => {},
      show: () => {},
      leave: () => {},
    },
    async (_url, init) => {
      const { operation, sessionId } = JSON.parse(init!.body as string);
      operations.push(operation);
      if (operation.action === "session-delete") {
        sessions = sessions.filter((row) => row.id !== operation.id);
        return Response.json({ ok: true, data: { id: operation.id } });
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
                sessions,
                binding: sessions.some((row) => row.id === sessionId)
                  ? {
                      characterId: card.id,
                      enabled: true,
                      userName: "小星",
                    }
                  : { characterId: "", enabled: false, userName: "" },
                settings: { maxWorldChars: 6000, recentMessages: 6 },
              },
      });
    },
    {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => {
        storage.set(key, value);
      },
    },
  );
  await controller.enter();
  assert.equal(controller.getSnapshot().sessionId, "s1");
  assert.ok(await controller.deleteSession("s1"));
  assert.equal(controller.getSnapshot().sessionId, "");
  assert.equal(controller.getSnapshot().card, null);
  assert.equal(storage.get("nekobot.session"), "");
  assert.deepEqual(
    controller.getSnapshot().data?.sessions.map((row) => row.id),
    ["s2", "s3"],
  );
  await controller.openSession("s2");
  assert.equal(controller.getSnapshot().sessionId, "s2");
  assert.ok(await controller.deleteSession("s3"));
  assert.equal(controller.getSnapshot().sessionId, "s2");
  assert.equal(storage.get("nekobot.session"), "s2");
  assert.equal(controller.getSnapshot().card?.id, card.id);
  assert.deepEqual(
    controller.getSnapshot().data?.sessions.map((row) => row.id),
    ["s2"],
  );
  assert.deepEqual(
    operations.filter((operation) => operation.action === "session-delete"),
    [
      { action: "session-delete", id: "s1" },
      { action: "session-delete", id: "s3" },
    ],
  );
  controller.dispose();
});
