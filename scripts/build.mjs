import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { messages } from "../src/locales.ts";

await mkdir("dist", { recursive: true });
await build({
  entryPoints: ["src/host.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  external: ["@deepseek-ai/*"],
  sourcemap: true,
});
await build({
  entryPoints: ["src/client.tsx"],
  outfile: "dist/client.js",
  bundle: true,
  platform: "browser",
  format: "iife",
  globalName: "NekobotBundle",
  target: "es2022",
  external: ["react"],
  jsx: "transform",
  sourcemap: true,
  banner: {
    js: 'window.__ModuleLoader__.load({id:"dsh-nekobot",factory(require){',
  },
  footer: { js: "return NekobotBundle.default;}});" },
});
await mkdir("locale", { recursive: true });
for (const [locale, dictionary] of Object.entries(messages)) {
  await writeFile(
    `locale/${locale}.json`,
    JSON.stringify(
      {
        meta: { title: dictionary.title, description: dictionary.description },
      },
      null,
      2,
    ) + "\n",
  );
}
