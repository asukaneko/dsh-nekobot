import React from "react";
import * as jsx from "react/jsx-runtime";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import clsx from "clsx";

// 执行与桌面同版本的原生 ConversationContent，仅替换本测试不使用的宿主服务。
// 使用语法树提取，避免为布局回归手写一份原生组件。
export function nativeConversationContent() {
  const require = createRequire(import.meta.url);
  const source = readFileSync(
    require.resolve("@deepseek-ai/dsh-client-ui-conversation/client"),
    "utf8",
  );
  const tree = ts.createSourceFile(
    "native.js",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const functions = new Map<string, string>();
  let classes = "",
    css = "";
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name)
      functions.set(node.name.text, node.getText(tree));
    if (ts.isVariableDeclaration(node) && node.initializer) {
      if (node.name.getText(tree) === "ConversationRoot_module_css_default")
        classes = node.initializer.getText(tree);
      if (
        ts.isStringLiteral(node.initializer) &&
        node.initializer.text.includes("[data-content-phase=active]")
      )
        css = node.initializer.text;
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  if (!classes || !css || !functions.has("ConversationContent"))
    throw new Error("Native conversation contract changed");
  const factory = new Function(
    "react",
    "react_jsx_runtime",
    "clsx",
    `
    const ConversationRoot_module_css_default = ${classes};
    ${["ConversationSessionView", "NoConversationWidthControls", "workspaceDisplayTitle", "ConversationContent"].map((name) => functions.get(name)).join("\n")}
    const WorkspaceChip = () => null, HeroShell = () => null;
    const workspaceLabel = value => value;
    return ConversationContent;
  `,
  )(React, jsx, clsx);
  return {
    css,
    Content: (props: any) =>
      React.createElement(factory, {
        ...props,
        useInput: (select: any) => select(undefined),
        useComposerBlock: (select: any) => select(undefined),
      }),
  };
}
