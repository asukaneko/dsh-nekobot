import type { Operation, Reply } from "./types.ts";

type Operate = (
  operation: Operation,
  sessionId: string,
  caller: "user" | "agent",
) => Promise<Reply>;

// 与现有工具保持一致：返回结构化 JSON，由模型自行阅读字段。
const output = {
  schema: {},
  render: (_args: unknown, value: unknown) => [
    { type: "text", text: JSON.stringify(value) },
  ],
};
const POSITIONS = [
  "before_char",
  "after_char",
  "before_an",
  "after_an",
  "at_depth",
];
const CATEGORIES = ["user_persona", "character_persona", "important_event"];
const isRecord = (value: unknown): value is Record<string, any> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const inputOf = (value: unknown): Record<string, any> =>
  isRecord(value) ? value : {};
const text = (value: unknown, limit = 100_000) =>
  typeof value === "string" ? value.slice(0, limit).trim() : "";
const reply = (error: string): Reply => ({ ok: false, error });
const pick = (value: Record<string, any>, ...keys: string[]) => {
  for (const key of keys)
    if (value[key] !== undefined && value[key] !== null) return value[key];
  return undefined;
};
const integer = (
  value: unknown,
  fallback: number,
  min: number,
  max: number,
) => {
  if (value === "" || value == null) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(min, Math.min(max, Math.round(parsed)))
    : fallback;
};
const numeric = (value: unknown): number | undefined => {
  if (value === "" || value == null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};
const flag = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && (value === 0 || value === 1))
    return value === 1;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off", ""].includes(normalized)) return false;
  }
  return undefined;
};
const list = (value: unknown): string[] => {
  let source = value;
  if (typeof source === "string" && source.trim().startsWith("[")) {
    try {
      source = JSON.parse(source);
    } catch {
      // 退回到分隔符解析。
    }
  }
  return (
    Array.isArray(source)
      ? source
      : typeof source === "string"
        ? source.split(/[,，、\n]/)
        : []
  )
    .map((item) =>
      typeof item === "string"
        ? item.trim()
        : typeof item === "number"
          ? String(item)
          : "",
    )
    .filter(Boolean)
    .slice(0, 500);
};
const positionOf = (value: unknown): string | number | undefined => {
  if (typeof value === "number") return value;
  const raw = text(value, 32);
  if (!raw) return undefined;
  const key = raw.toLowerCase().replaceAll("_", ""),
    aliases: Record<string, string> = {
      "0": "before_char",
      "1": "after_char",
      "2": "before_an",
      "3": "after_an",
      "4": "at_depth",
      beforechar: "before_char",
      afterchar: "after_char",
      beforean: "before_an",
      afteran: "after_an",
      atdepth: "at_depth",
    };
  return aliases[key] ?? raw;
};
const object = (value: unknown): Record<string, any> | undefined => {
  if (isRecord(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return isRecord(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
};
const objects = (value: unknown): Record<string, any>[] | undefined => {
  let source = value;
  if (typeof source === "string") {
    try {
      source = JSON.parse(source);
    } catch {
      return undefined;
    }
  }
  if (isRecord(source)) source = Object.values(source);
  if (!Array.isArray(source)) return undefined;
  const parsed = source.map((item) => object(item));
  return parsed.every((item): item is Record<string, any> => !!item)
    ? parsed
    : undefined;
};
const compact = (value: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(value).filter(([, field]) => field !== undefined),
  );
// 模型不需要 base64 立绘；只保留可直接理解的 http(s) 地址。
const characterView = (value: any) => {
  const { avatar, extra, ...card } = value ?? {};
  return {
    ...card,
    avatar:
      typeof avatar === "string" && /^https:\/\//i.test(avatar) ? avatar : "",
    hasAvatar: !!avatar || !!card.hasAvatar,
    worldBookCount: Array.isArray(card.worldBookIds)
      ? card.worldBookIds.length
      : 0,
  };
};
const entryView = (entry: any) => {
  const content = String(entry?.content ?? "");
  return {
    ...entry,
    content: content.slice(0, 20_000),
    ...(content.length > 20_000 ? { contentTruncated: true } : {}),
  };
};

export function registerTools(ctx: any, operate: Operate) {
  const run = async (exec: any, operation: Operation): Promise<Reply> => {
    const sessionId = exec?.agent?.session?.id;
    if (typeof sessionId !== "string" || !sessionId)
      return reply("sessionUnavailable");
    return operate(operation, sessionId, "agent");
  };
  const tool = (definition: any) => ctx.tools.register(definition);
  const idOf = (value: Record<string, any>, ...keys: string[]) =>
    text(pick(value, "id", ...keys) ?? "", 256);

  tool({
    name: "nekobot_character_list",
    description:
      "列出 Nekobot 角色卡，返回 id、名称、标签、关联世界书等摘要（不含立绘数据）。可用 query 按名称、标签或简介过滤。",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: {
          type: "string",
          description: "按名称、标签或简介过滤，不区分大小写",
        },
        limit: {
          type: "number",
          description: "最多返回数量，默认 50，最大 200",
        },
      },
    },
    output,
    execute: async (input: unknown, exec: any) => {
      const args = inputOf(input);
      const result = await run(exec, { action: "list", kind: "character" });
      if (!result.ok) return result;
      const query = text(args.query, 200).toLowerCase(),
        limit = integer(args.limit, 50, 1, 200),
        all = (Array.isArray(result.data) ? result.data : []).map(
          characterView,
        ),
        matched = query
          ? all.filter((card) =>
              [card.name, card.description, ...(card.tags ?? [])]
                .join(" ")
                .toLowerCase()
                .includes(query),
            )
          : all;
      return {
        ok: true,
        total: matched.length,
        characters: matched.slice(0, limit),
      };
    },
  });

  tool({
    name: "nekobot_character_get",
    description:
      "读取一张角色卡的全部设定字段（立绘只返回是否有图或 https 地址，不返回 base64 数据）。",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["id"],
      properties: {
        id: {
          type: "string",
          description: "角色卡 ID，来自 nekobot_character_list",
        },
      },
    },
    output,
    execute: async (input: unknown, exec: any) => {
      const args = inputOf(input),
        id = idOf(args, "characterId", "character_id");
      if (!id) return reply("invalidOperation");
      const result = await run(exec, { action: "get", kind: "character", id });
      if (!result.ok) return result;
      return { ok: true, character: characterView(result.data) };
    },
  });

  tool({
    name: "nekobot_character_save",
    description:
      "新建或更新角色卡。省略 id 时新建，必须提供 name；提供 id 时只修改提交的字段，其余字段保留。世界书 ID 需先用 nekobot_worldbook_save 创建。",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "string", description: "要更新的角色卡 ID；新建时省略" },
        name: { type: "string", description: "角色名；新建时必填" },
        description: { type: "string", description: "简介" },
        avatar: {
          type: "string",
          description: "立绘 https 地址；不接收 base64 数据",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "标签列表",
        },
        basicInfo: { type: "string", description: "基本信息" },
        personality: { type: "string", description: "性格" },
        scenario: { type: "string", description: "场景" },
        firstMessage: {
          type: "string",
          description: "开场白，可用 {{user}} 和 {{char}}",
        },
        exampleDialogues: { type: "string", description: "示例对话" },
        responseFormat: { type: "string", description: "回复格式" },
        rules: {
          type: "array",
          items: { type: "string" },
          description: "规则列表",
        },
        systemPrompt: { type: "string", description: "附加角色指令" },
        worldBookIds: {
          type: "array",
          items: { type: "string" },
          description: "关联的世界书 ID 列表",
        },
        initialState: {
          type: "object",
          description: "六维初始关系值（0-100）",
          additionalProperties: false,
          properties: {
            affection: { type: "number" },
            trust: { type: "number" },
            familiarity: { type: "number" },
            dependency: { type: "number" },
            security: { type: "number" },
            jealousy: { type: "number" },
          },
        },
      },
    },
    output,
    execute: async (input: unknown, exec: any) => {
      const args = inputOf(input),
        value = compact({
          name: pick(args, "name"),
          description: pick(args, "description"),
          avatar: pick(args, "avatar", "portrait"),
          tags: pick(args, "tags") === undefined ? undefined : list(args.tags),
          basicInfo: pick(args, "basicInfo", "basic_info"),
          personality: pick(args, "personality"),
          scenario: pick(args, "scenario"),
          firstMessage: pick(
            args,
            "firstMessage",
            "first_message",
            "first_mes",
          ),
          exampleDialogues: pick(
            args,
            "exampleDialogues",
            "example_dialogues",
            "mes_example",
          ),
          responseFormat: pick(args, "responseFormat", "response_format"),
          rules:
            pick(args, "rules") === undefined ? undefined : list(args.rules),
          systemPrompt: pick(args, "systemPrompt", "system_prompt"),
          worldBookIds:
            pick(args, "worldBookIds", "world_book_ids") === undefined
              ? undefined
              : list(pick(args, "worldBookIds", "world_book_ids")),
          initialState:
            pick(args, "initialState", "initial_state", "state") === undefined
              ? undefined
              : object(pick(args, "initialState", "initial_state", "state")),
        });
      for (const field of [
        "name",
        "description",
        "avatar",
        "basicInfo",
        "personality",
        "scenario",
        "firstMessage",
        "exampleDialogues",
        "responseFormat",
        "systemPrompt",
      ])
        if (typeof value[field] === "string")
          value[field] = text(value[field], 100_000);
      if (Object.keys(value).length === 0) return reply("invalidOperation");
      const id = idOf(args, "characterId", "character_id");
      const result = await run(
        exec,
        id
          ? { action: "update", kind: "character", id, value }
          : { action: "create", kind: "character", value },
      );
      if (!result.ok) return result;
      return { ok: true, character: characterView(result.data) };
    },
  });

  tool({
    name: "nekobot_character_delete",
    description:
      "删除一张角色卡。仍被角色会话绑定时会失败（inUse），请先解除绑定。",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["id"],
      properties: {
        id: { type: "string", description: "角色卡 ID" },
      },
    },
    output,
    execute: async (input: unknown, exec: any) => {
      const id = idOf(inputOf(input), "characterId", "character_id");
      if (!id) return reply("invalidOperation");
      const result = await run(exec, {
        action: "delete",
        kind: "character",
        id,
      });
      return result.ok ? { ok: true, deleted: id } : result;
    },
  });

  tool({
    name: "nekobot_worldbook_list",
    description:
      "列出世界书及其条目数量（不返回条目正文）。可用 query 按名称或简介过滤。",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: {
          type: "string",
          description: "按名称或简介过滤，不区分大小写",
        },
        limit: {
          type: "number",
          description: "最多返回数量，默认 50，最大 200",
        },
      },
    },
    output,
    execute: async (input: unknown, exec: any) => {
      const args = inputOf(input);
      const result = await run(exec, { action: "list", kind: "worldbook" });
      if (!result.ok) return result;
      const query = text(args.query, 200).toLowerCase(),
        limit = integer(args.limit, 50, 1, 200),
        books = (Array.isArray(result.data) ? result.data : []).map(
          (book: any) => ({
            id: book.id,
            name: book.name,
            description: book.description,
            entryCount: Array.isArray(book.entries) ? book.entries.length : 0,
            enabledEntryCount: Array.isArray(book.entries)
              ? book.entries.filter((entry: any) => entry.enabled).length
              : 0,
          }),
        ),
        matched = query
          ? books.filter((book) =>
              [book.name, book.description]
                .join(" ")
                .toLowerCase()
                .includes(query),
            )
          : books;
      return {
        ok: true,
        total: matched.length,
        worldbooks: matched.slice(0, limit),
      };
    },
  });

  tool({
    name: "nekobot_worldbook_get",
    description:
      "读取一本世界书及其中一部分条目。条目按 entryOffset/entryLimit 分页，可用 query 按标题、关键词或正文过滤；单条正文超过 20000 字会被截断并标记。",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["id"],
      properties: {
        id: { type: "string", description: "世界书 ID" },
        query: {
          type: "string",
          description: "按条目标题、关键词或正文过滤",
        },
        entryOffset: {
          type: "number",
          description: "跳过多少条目，默认 0",
        },
        entryLimit: {
          type: "number",
          description: "返回多少条目，默认 20，最大 100",
        },
      },
    },
    output,
    execute: async (input: unknown, exec: any) => {
      const args = inputOf(input),
        id = idOf(args, "bookId", "book_id", "worldbookId", "worldbook_id");
      if (!id) return reply("invalidOperation");
      const result = await run(exec, { action: "get", kind: "worldbook", id });
      if (!result.ok) return result;
      const book = result.data as any,
        query = text(args.query, 200).toLowerCase(),
        offset = integer(args.entryOffset, 0, 0, 100_000),
        limit = integer(args.entryLimit, 20, 1, 100),
        entries = Array.isArray(book.entries) ? book.entries : [],
        matched = query
          ? entries.filter((entry: any) =>
              [
                entry.comment,
                entry.content,
                ...(Array.isArray(entry.keys) ? entry.keys : []),
              ]
                .join(" ")
                .toLowerCase()
                .includes(query),
            )
          : entries,
        page = matched.slice(offset, offset + limit).map(entryView);
      return {
        ok: true,
        worldbook: {
          id: book.id,
          name: book.name,
          description: book.description,
          entryCount: entries.length,
        },
        total: matched.length,
        offset,
        entries: page,
        ...(offset + page.length < matched.length
          ? { nextOffset: offset + page.length }
          : {}),
      };
    },
  });

  tool({
    name: "nekobot_worldbook_save",
    description:
      "新建或更新世界书。省略 id 新建（name 必填）；提供 id 时只修改提交的字段。提交 entries 会整体替换条目；只改单条请用 nekobot_worldbook_entry_save。",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "string", description: "要更新的世界书 ID；新建时省略" },
        name: { type: "string", description: "世界书名称；新建时必填" },
        description: { type: "string", description: "简介" },
        entries: {
          type: "array",
          description:
            "完整条目列表，会替换原有条目；保留条目的 id 可避免重新生成",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              id: {
                type: "string",
                description: "条目 ID；更新已有条目时保留",
              },
              comment: { type: "string", description: "条目标题" },
              content: { type: "string", description: "条目正文" },
              keys: {
                type: "array",
                items: { type: "string" },
                description: "触发关键词",
              },
              enabled: { type: "boolean", description: "是否启用，默认 true" },
              constant: {
                type: "boolean",
                description: "是否常驻注入，不看关键词",
              },
              caseSensitive: {
                type: "boolean",
                description: "关键词是否区分大小写",
              },
              priority: {
                type: "number",
                description: "优先级，越大越先注入，默认 100",
              },
              position: {
                type: "string",
                enum: POSITIONS,
                description: "注入位置，默认 before_char",
              },
              depth: {
                type: "number",
                description: "历史深度，仅 at_depth 使用（本版不支持注入）",
              },
            },
          },
        },
      },
    },
    output,
    execute: async (input: unknown, exec: any) => {
      const args = inputOf(input),
        entries =
          pick(args, "entries") === undefined
            ? undefined
            : objects(pick(args, "entries"));
      if (pick(args, "entries") !== undefined && entries === undefined)
        return reply("invalidOperation");
      const value = compact({
        name: pick(args, "name"),
        description: pick(args, "description"),
        entries,
      });
      if (typeof value.name === "string") value.name = text(value.name, 200);
      if (typeof value.description === "string")
        value.description = text(value.description);
      if (Object.keys(value).length === 0) return reply("invalidOperation");
      const id = idOf(args, "bookId", "book_id", "worldbookId", "worldbook_id");
      const result = await run(
        exec,
        id
          ? { action: "update", kind: "worldbook", id, value }
          : { action: "create", kind: "worldbook", value },
      );
      if (!result.ok) return result;
      const book = result.data as any;
      return {
        ok: true,
        worldbook: {
          id: book.id,
          name: book.name,
          description: book.description,
          entryCount: Array.isArray(book.entries) ? book.entries.length : 0,
        },
      };
    },
  });

  tool({
    name: "nekobot_worldbook_delete",
    description:
      "删除一本世界书。仍被角色卡关联时会失败（inUse），请先更新角色卡的 worldBookIds。",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["id"],
      properties: {
        id: { type: "string", description: "世界书 ID" },
      },
    },
    output,
    execute: async (input: unknown, exec: any) => {
      const id = idOf(inputOf(input), "bookId", "book_id", "worldbookId");
      if (!id) return reply("invalidOperation");
      const result = await run(exec, {
        action: "delete",
        kind: "worldbook",
        id,
      });
      return result.ok ? { ok: true, deleted: id } : result;
    },
  });

  tool({
    name: "nekobot_worldbook_entry_save",
    description:
      "新建或更新世界书中的单条条目，不必提交整本世界书。省略 entryId 新建；提供 entryId 时只修改提交的字段。",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["bookId"],
      properties: {
        bookId: { type: "string", description: "世界书 ID" },
        entryId: {
          type: "string",
          description: "要更新的条目 ID；新建时省略",
        },
        comment: { type: "string", description: "条目标题" },
        content: { type: "string", description: "条目正文" },
        keys: {
          type: "array",
          items: { type: "string" },
          description: "触发关键词",
        },
        enabled: { type: "boolean", description: "是否启用" },
        constant: {
          type: "boolean",
          description: "是否常驻注入，不看关键词",
        },
        caseSensitive: {
          type: "boolean",
          description: "关键词是否区分大小写",
        },
        priority: {
          type: "number",
          description: "优先级，越大越先注入",
        },
        position: {
          type: "string",
          enum: POSITIONS,
          description: "注入位置",
        },
        depth: {
          type: "number",
          description: "历史深度，仅 at_depth 使用（本版不支持注入）",
        },
      },
    },
    output,
    execute: async (input: unknown, exec: any) => {
      const args = inputOf(input),
        bookId = idOf(args, "bookId", "book_id", "worldbookId", "worldbook_id"),
        entryId = text(pick(args, "entryId", "entry_id") ?? "", 256);
      if (!bookId) return reply("invalidOperation");
      const position = positionOf(pick(args, "position")),
        value = compact({
          comment: pick(args, "comment", "title", "name"),
          content: pick(args, "content"),
          keys:
            pick(args, "keys", "key", "keywords") === undefined
              ? undefined
              : list(pick(args, "keys", "key", "keywords")),
          enabled: flag(pick(args, "enabled")),
          constant: flag(pick(args, "constant", "always_on")),
          caseSensitive: flag(pick(args, "caseSensitive", "case_sensitive")),
          priority: numeric(pick(args, "priority", "insertion_order", "order")),
          position,
          depth: numeric(pick(args, "depth")),
        });
      if (typeof value.comment === "string")
        value.comment = text(value.comment, 300);
      if (typeof value.content === "string")
        value.content = text(value.content);
      if (typeof position === "string" && !POSITIONS.includes(position))
        return reply("invalidPosition");
      if (Object.keys(value).length === 0) return reply("invalidOperation");
      const result = await run(exec, {
        action: "entry-save",
        kind: "worldbook",
        id: bookId,
        ...(entryId ? { entryId } : {}),
        value,
      });
      if (!result.ok) return result;
      return { ok: true, bookId, entry: result.data };
    },
  });

  tool({
    name: "nekobot_worldbook_entry_delete",
    description: "删除世界书中的一条条目。",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["bookId", "entryId"],
      properties: {
        bookId: { type: "string", description: "世界书 ID" },
        entryId: { type: "string", description: "条目 ID" },
      },
    },
    output,
    execute: async (input: unknown, exec: any) => {
      const args = inputOf(input),
        bookId = idOf(args, "bookId", "book_id", "worldbookId", "worldbook_id"),
        entryId = text(pick(args, "entryId", "entry_id") ?? "", 256);
      if (!bookId || !entryId) return reply("invalidOperation");
      const result = await run(exec, {
        action: "entry-delete",
        kind: "worldbook",
        id: bookId,
        entryId,
      });
      return result.ok ? { ok: true, deleted: { bookId, entryId } } : result;
    },
  });

  tool({
    name: "nekobot_memory_list",
    description:
      "列出当前会话、当前绑定角色的记忆。可用 query 按正文过滤，或用 category 过滤类别。",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string", description: "按记忆正文过滤，不区分大小写" },
        category: {
          type: "string",
          enum: CATEGORIES,
          description: "只返回该类别的记忆",
        },
        limit: {
          type: "number",
          description: "最多返回数量，默认 50，最大 200",
        },
      },
    },
    output,
    execute: async (input: unknown, exec: any) => {
      const args = inputOf(input);
      const result = await run(exec, { action: "list", kind: "memory" });
      if (!result.ok) return result;
      const data = inputOf(result.data),
        query = text(args.query, 200).toLowerCase(),
        category = text(args.category, 32),
        limit = integer(args.limit, 50, 1, 200);
      if (category && !CATEGORIES.includes(category))
        return reply("invalidOperation");
      const memories = (
        Array.isArray(data.memories) ? data.memories : []
      ).filter(
        (memory: any) =>
          (!category || memory.category === category) &&
          (!query ||
            String(memory.content ?? "")
              .toLowerCase()
              .includes(query)),
      );
      return {
        ok: true,
        characterId: data.characterId || "",
        total: memories.length,
        memories: memories.slice(0, limit),
      };
    },
  });

  tool({
    name: "nekobot_memory_save",
    description:
      "为当前会话、当前绑定角色新建或更新一条记忆。省略 id 新建（content 必填）；提供 id 时只修改提交的字段。记忆按会话与角色隔离，需先绑定角色。",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "string", description: "要更新的记忆 ID；新建时省略" },
        content: {
          type: "string",
          description: "记忆正文，最多 10000 字；新建时必填",
        },
        category: {
          type: "string",
          enum: CATEGORIES,
          description:
            "user_persona（关于用户）、character_persona（关于角色）、important_event（重要事件，默认）",
        },
      },
    },
    output,
    execute: async (input: unknown, exec: any) => {
      const args = inputOf(input),
        id = idOf(args, "memoryId", "memory_id"),
        category = pick(args, "category"),
        value = compact({
          content:
            pick(args, "content") === undefined
              ? undefined
              : text(args.content, 10_000),
          category: category === undefined ? undefined : text(category, 32),
        });
      if (
        value.category !== undefined &&
        !CATEGORIES.includes(value.category as string)
      )
        return reply("invalidOperation");
      if (Object.keys(value).length === 0) return reply("invalidOperation");
      const result = await run(
        exec,
        id
          ? { action: "update", kind: "memory", id, value }
          : { action: "create", kind: "memory", value },
      );
      return result.ok ? { ok: true, memory: result.data } : result;
    },
  });

  tool({
    name: "nekobot_memory_delete",
    description: "删除当前会话、当前绑定角色的一条记忆。",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["id"],
      properties: {
        id: { type: "string", description: "记忆 ID" },
      },
    },
    output,
    execute: async (input: unknown, exec: any) => {
      const id = idOf(inputOf(input), "memoryId", "memory_id");
      if (!id) return reply("invalidOperation");
      const result = await run(exec, { action: "delete", kind: "memory", id });
      return result.ok ? { ok: true, deleted: id } : result;
    },
  });

  tool({
    name: "nekobot_preview",
    description:
      "预览当前会话的角色提示词：绑定角色、命中的世界书条目和最终注入文本。可用 latest 模拟用户最新消息来检查关键词触发。",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        latest: {
          type: "string",
          description: "要模拟的用户最新消息；省略时使用当前会话消息",
        },
      },
    },
    output,
    execute: async (input: unknown, exec: any) => {
      const latest = text(inputOf(input).latest, 20_000);
      const result = await run(exec, {
        action: "preview",
        value: { latest },
      });
      return result.ok ? { ok: true, ...(result.data as any) } : result;
    },
  });

  // 旧版通用入口保留，兼容既有会话提示与自动化调用。
  tool({
    name: "nekobot_library",
    description:
      "通用入口（兼容旧版）：用 action 操作角色卡、世界书和本会话记忆。日常增删查改优先使用 nekobot_character_*、nekobot_worldbook_*、nekobot_memory_* 专用工具。",
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
    output,
    execute: async (input: unknown, exec: any) => {
      const args = inputOf(input);
      if (
        !["list", "get", "save", "delete", "export"].includes(
          String(args.action),
        ) ||
        (args.kind && !["character", "worldbook", "memory"].includes(args.kind))
      )
        return reply("invalidOperation");
      let value: unknown;
      try {
        value = args.value ? JSON.parse(String(args.value)) : undefined;
      } catch {
        return reply("invalidOperation");
      }
      const sessionId = exec?.agent?.session?.id;
      if (typeof sessionId !== "string" || !sessionId)
        return reply("sessionUnavailable");
      return operate({ ...args, value } as Operation, sessionId, "agent");
    },
  });
}
