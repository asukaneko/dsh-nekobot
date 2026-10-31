import { z } from "zod";
import { NekoError } from "./core.ts";
import { Library } from "./library.ts";
import { registerTools } from "./tools.ts";
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
  // DSH 没有会话物理删除接口，只能归档：日志保留，会话从列表隐藏。
  const workspace = (() => {
    try {
      return ctx.get?.("workspaceRegistry");
    } catch {
      return undefined;
    }
  })();
  const archive = async (id: string) => {
    if (typeof workspace?.archiveSession !== "function") return false;
    try {
      await workspace.archiveSession(id, { stopActivity: true });
      return true;
    } catch (error) {
      ctx.logger.warn(
        'Nekobot could not archive session "%s": %s',
        id,
        error instanceof Error ? error.message : String(error),
      );
      return false;
    }
  };
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
      const data = await library.execute(op, sessionId, caller);
      if (op.action === "session-delete" && typeof op.id === "string")
        await archive(op.id);
      return { ok: true, data };
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
  // 角色卡、世界书、条目和记忆分别由专用工具增删查改，旧入口作为兼容保留。
  registerTools(ctx, operate);
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
