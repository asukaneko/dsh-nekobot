import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, createApi, readCommandResult } from "../src/api.ts";

test("DSH Remote 成功信封必须解包 value.result，业务错误保持原错误码", () => {
  const snapshot = { characters: [{ name: "小满" }], worldbooks: [] };
  assert.deepEqual(
    readCommandResult({
      ok: true,
      value: {
        commandId: "c1",
        result: {
          kind: "success",
          text: JSON.stringify({ ok: true, data: snapshot }),
        },
      },
    }),
    snapshot,
  );
  assert.throws(
    () =>
      readCommandResult({ ok: false, error: { code: "gateway/forbidden" } }),
    (e: unknown) => e instanceof ApiError && e.detail === "gateway/forbidden",
  );
  assert.throws(
    () =>
      readCommandResult({
        ok: true,
        value: {
          result: {
            kind: "success",
            text: '{"ok":false,"error":"nameRequired"}',
          },
        },
      }),
    /nameRequired/,
  );
  assert.throws(
    () =>
      readCommandResult({
        ok: true,
        value: { result: { kind: "success", text: "broken" } },
      }),
    /operationFailed/,
  );
});
test("全局界面 API 在空会话时也可以加载角色库，使用宿主同源认证", async () => {
  let body: any,
    url = "",
    credentials: unknown;
  const api = createApi(
    () => "",
    async (input, init) => {
      url = String(input);
      body = JSON.parse(init!.body as string);
      credentials = init!.credentials;
      return Response.json({
        ok: true,
        data: { characters: [{ name: "小满" }] },
      });
    },
  );
  assert.deepEqual(await api({ action: "list" }), {
    characters: [{ name: "小满" }],
  });
  assert.equal(url, "api/nekobot");
  assert.equal(credentials, "same-origin");
  assert.equal(body.sessionId, "");
  await assert.rejects(
    createApi(
      () => "",
      async () => new Response("", { status: 403 }),
    )({ action: "list" }),
    /accessDenied/,
  );
  await assert.rejects(
    createApi(
      () => "",
      async () => {
        throw new Error("fetch failed");
      },
    )({ action: "list" }),
    /connectionFailed/,
  );
  await assert.rejects(
    createApi(
      () => "",
      async () => Response.json({ ok: false, error: "inUse" }),
    )({ action: "delete", id: "a" }),
    /inUse/,
  );
});
