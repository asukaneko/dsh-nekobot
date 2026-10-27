import { z } from "zod";
import { NekoError } from "./core.ts";
import { Library } from "./library.ts";
import type { Operation, Reply } from "./types.ts";

export const name = "nekobot";
export const inject = [
  "storageDomain",
  "commands",
  "systemPrompt",
  "agents",
  "tools",
  "connection",
  "sessionController",
];
const recordSchema = z.object({ json: z.string() });
const spec = {
  name: "nekobot",
  version: 1,
  tables: Object.fromEntries(
    ["characters", "worldbooks", "memories", "bindings", "settings"].map(
      (name) => [name, { valueSchema: recordSchema }],
    ),
  ),
};
export function messageText(message: any): string {
  if (typeof message?.content === "string") return message.content;
  return Array.isArray(message?.content)
    ? message.content
        .filter((block: any) => block.type === "text")
        .map((block: any) => block.text)
        .join("\n")
    : "";
}
export async function apply(ctx: any) {
  const domain = await ctx.storageDomain.open(spec),
    library = new Library(domain);
  ctx.effect(() => () => domain.close());
  const operate = async (
    op: Operation,
    sessionId: string,
    caller: "user" | "agent",
  ): Promise<Reply> => {
    try {
      if (!op || typeof op !== "object" || typeof op.action !== "string")
        throw new NekoError("invalidOperation");
      if (
        !sessionId &&
        (op.action === "bind" || (op.kind === "memory" && op.action !== "list"))
      )
        throw new NekoError("sessionUnavailable");
      if (op.action === "start") {
        if (caller !== "user") throw new NekoError("userOnly");
        if (!op.id || !library.read("characters", op.id))
          throw new NekoError("notFound");
        library.assertCharacterSupported(op.id);
        const created = await ctx.sessionController.create({});
        await library.execute(
          {
            action: "bind",
            value: {
              characterId: op.id,
              userName: library.binding(sessionId).userName,
              enabled: true,
            },
          },
          created.sessionId,
        );
        return { ok: true, data: created };
      }
      return { ok: true, data: await library.execute(op, sessionId, caller) };
    } catch (e) {
      if (!(e instanceof NekoError))
        ctx.logger.error(
          'Nekobot operation "%s" failed: %s',
          op?.action,
          e instanceof Error ? e.stack : String(e),
        );
      return {
        ok: false,
        error: e instanceof NekoError ? e.code : "operationFailed",
      };
    }
  };
  // Connection 的自定义 Fetch 路由统一验证浏览器身份、Origin 和 owner 权限。
  ctx.connection.fetch.register({
    path: "/api/nekobot",
    methods: ["POST"],
    requestBody: "buffered",
    fetch: async (request: Request) => {
      try {
        const raw = await request.text();
        if (raw.length > 16_500_000)
          return Response.json(
            { ok: false, error: "fileTooLarge" },
            { status: 413 },
          );
        const body = JSON.parse(raw);
        if (body.sessionId != null && typeof body.sessionId !== "string")
          throw new NekoError("invalidOperation");
        return Response.json(
          await operate(body.operation, body.sessionId || "", "user"),
          { headers: { "cache-control": "no-store" } },
        );
      } catch {
        return Response.json(
          { ok: false, error: "invalidOperation" },
          { status: 400 },
        );
      }
    },
  });
  ctx.commands.register({
    name: "nekobot",
    description: "Nekobot · 角色卡与世界书 / Characters and worldbooks",
    recordInput: false,
    handler: async ({ agent, rawInput }: any) => {
      let result: Reply;
      try {
        result = await operate(JSON.parse(rawInput), agent.session.id, "user");
      } catch {
        result = { ok: false, error: "invalidOperation" };
      }
      // 命令本身正常结算，业务失败保留为可本地化的错误码。
      return { kind: "success", text: JSON.stringify(result) };
    },
  });
  ctx.tools.register({
    name: "nekobot_library",
    description:
      "管理 Nekobot 角色卡、世界书和本会话记忆。先 list/get 查看，save 使用 JSON 字符串。会话绑定和设置由用户配置。",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["action"],
      properties: {
        action: {
          type: "string",
          enum: ["list", "get", "save", "delete", "export"],
        },
        kind: { type: "string", enum: ["character", "worldbook", "memory"] },
        id: { type: "string", description: "已有条目的 ID；新建时省略。" },
        value: {
          type: "string",
          description:
            "save 的完整 JSON 对象。角色至少有 name；世界书有 name 和 entries；记忆有 content。",
        },
      },
    },
    output: {
      schema: {},
      render: (_args: unknown, value: unknown) => [
        { type: "text", text: JSON.stringify(value) },
      ],
    },
    execute: async (args: any, exec: any) => {
      if (
        !args ||
        !["list", "get", "save", "delete", "export"].includes(args.action) ||
        (args.kind && !["character", "worldbook", "memory"].includes(args.kind))
      )
        return { ok: false, error: "invalidOperation" };
      const sessionId = exec.agent?.session?.id;
      if (!sessionId) return { ok: false, error: "sessionUnavailable" };
      let value: unknown;
      try {
        value = args.value ? JSON.parse(args.value) : undefined;
      } catch {
        return { ok: false, error: "invalidOperation" };
      }
      return operate({ ...args, value }, sessionId, "agent");
    },
  });
  const scopes = new Map<string, () => void>();
  const attach = (agent: any) => {
    if (scopes.has(agent.id)) return;
    let latest = "";
    const dispose = agent.ctx.effect(() => {
      const claimed = agent.ctx.on(
        "agent/inbox/claimed",
        ({ message }: any) => {
          if (message.source?.kind === "user") latest = messageText(message);
        },
      );
      const prompt = agent.ctx.systemPrompt.section({
        name: "nekobot:character",
        order: 10_150,
        interpolate: false,
        text: () => {
          const messages = agent.session.deriveMessages();
          const recent = messages
            .slice(-library.settings().recentMessages)
            .map(messageText);
          const user = [...messages]
            .reverse()
            .find((m: any) => m.role === "user" && m.source?.kind === "user");
          return library.preview(
            agent.session.id,
            latest || messageText(user),
            recent,
          ).prompt;
        },
      });
      return () => {
        claimed();
        prompt();
      };
    });
    scopes.set(agent.id, dispose);
  };
  ctx.on("agent/created", ({ agent }: any) => attach(agent));
  ctx.on("agent/disposed", ({ agent }: any) => {
    scopes.get(agent.id)?.();
    scopes.delete(agent.id);
  });
  for (const agent of ctx.agents.list()) attach(agent);
  ctx.effect(() => () => {
    for (const dispose of scopes.values()) dispose();
    scopes.clear();
  });
}
