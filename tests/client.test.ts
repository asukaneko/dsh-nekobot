import { test } from "node:test";
import assert from "node:assert/strict";
import { clientRuntime } from "./client-runtime.ts";
test("客户端产物仅使用宿主 React，并通过原生 slot 注册和释放", () => {
  const runtime = clientRuntime();
  assert.equal(runtime.registration.id, "dsh-nekobot");
  const main = runtime.entries.find((entry) => entry.options.name === "main");
  assert.equal(main.options.key, "nekobot");
  assert.equal(main.options.children["nekobot.chat"].scope, "session");
  assert.ok(
    runtime.entries.some((entry) => entry.options.name === "sidebar.panellist"),
  );
  runtime.selectPanel("nekobot");
  assert.ok(
    runtime.entries.some(
      (entry) => entry.options.name === "sidebar.workspaces",
    ),
  );
  runtime.selectPanel(null);
  assert.ok(
    !runtime.entries.some(
      (entry) => entry.options.name === "sidebar.workspaces",
    ),
  );
  assert.equal(runtime.dictionaries.length, 4);
  runtime.dispose();
  assert.equal(runtime.entries.length, 0);
});
