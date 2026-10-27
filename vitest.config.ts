import { defineConfig } from "vitest/config";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const sdk = createRequire(
  require.resolve("@deepseek-ai/dsh-client-test-runtime"),
);
const renderer = sdk.resolve("@deepseek-ai/dsh-client-ui-renderer/client");
const sessionRoot = path.dirname(
  sdk.resolve("@deepseek-ai/dsh-api-session-controller/package.json"),
);

// 发行包提供浏览器模块；测试中仅解开其模块外壳，执行原有 Slot 与 Renderer 实现。
export default defineConfig({
  plugins: [
    {
      name: "nekobot-native-client-sdk",
      enforce: "pre",
      resolveId(id) {
        if (
          id === "@deepseek-ai/dsh-client-ui-renderer/src/client/bind.ts" ||
          id ===
            "@deepseek-ai/dsh-client-ui-renderer/src/client/scoped-slots.tsx"
        )
          return renderer;
        if (
          id === "@deepseek-ai/dsh-api-session-controller/src/client/scope.ts"
        )
          return path.join(sessionRoot, "lib/types/client/scope.js");
        if (id.startsWith("@deepseek-ai/") && id.endsWith("/client"))
          return sdk.resolve(id);
      },
      load(id) {
        if (!id.endsWith(".js") || !id.includes("@deepseek-ai")) return;
        let source: string;
        try {
          source = readFileSync(id, "utf8");
        } catch {
          return;
        }
        source = source.replace(/\/\/# sourceMappingURL=.*$/gm, "");
        if (!source.startsWith("window.__ModuleLoader__.load(")) return source;
        if (path.normalize(id) === path.normalize(renderer)) {
          const position = source.lastIndexOf("return module.exports;");
          source =
            source.slice(0, position) +
            "exports.createSlotRenderer = createSlotRenderer; exports.bindSnapshotSelector = bindSnapshotSelector;\n" +
            source.slice(position);
        }
        const dependencies = [
          ...new Set(
            [...source.matchAll(/require\("([^"]+)"\)/g)].map(
              (match) => match[1],
            ),
          ),
        ];
        const names = [
          ...new Set(
            [...source.matchAll(/exports\.([A-Za-z_$][\w$]*)\s*=/g)].map(
              (match) => match[1],
            ),
          ),
        ];
        const imports = dependencies
          .map(
            (dependency, index) =>
              `import * as dependency${index} from ${JSON.stringify(dependency)};`,
          )
          .join("\n");
        const modules = dependencies
          .map(
            (dependency, index) =>
              `${JSON.stringify(dependency)}: dependency${index}`,
          )
          .join(",");
        const exports = names
          .filter((name) => name !== "default")
          .map(
            (name) =>
              `export const ${name} = moduleValue[${JSON.stringify(name)}];`,
          )
          .join("\n");
        return `${imports}\nlet declaration;\n(function(window){${source}\n})({__ModuleLoader__:{load(value){declaration=value;}}});\nconst dependencies={${modules}};\nconst moduleValue=declaration.factory(name=>dependencies[name]);\n${exports}\nexport default moduleValue.default;`;
      },
    },
  ],
  test: {
    environment: "jsdom",
    include: ["tests/native/*.spec.tsx"],
    server: { deps: { inline: [/@deepseek-ai/] } },
  },
});
