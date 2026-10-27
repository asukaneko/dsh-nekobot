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
