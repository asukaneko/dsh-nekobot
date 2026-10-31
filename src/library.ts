import {
  DEFAULT_SETTINGS,
  NekoError,
  compilePrompt,
  decodeImport,
  matchWorldBooks,
  newId,
  normalizeCharacter,
  normalizeEntry,
  normalizeSettings,
  normalizeWorldBook,
} from "./core.ts";
import type {
  Binding,
  Character,
  Kind,
  Memory,
  Operation,
  Settings,
  WorldBook,
  WorldEntry,
} from "./types.ts";

export interface Table {
  get(id: string): { json: string } | undefined;
  entries(): IterableIterator<[string, { json: string }]>;
  put(id: string, value: { json: string }): Promise<void>;
  delete(id: string): Promise<void>;
}
export interface Domain {
  table(name: string): Table;
  close(): Promise<void>;
}
const names = {
  character: "characters",
  worldbook: "worldbooks",
  memory: "memories",
};
const isRecord = (value: unknown): value is Record<string, any> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const record = (value: unknown): Record<string, any> => {
  if (isRecord(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
};
const entriesOf = (value: unknown): unknown => {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed) || isRecord(parsed)) return parsed;
    } catch {
      return [];
    }
    return [];
  }
  return Array.isArray(value) ? value : Object.values(record(value));
};
// 局部更新使用与导入相同的别名，但只合并已提交的字段。
const CHARACTER_ALIASES: Record<string, string> = {
  portrait: "avatar",
  avatar_url: "avatar",
  basic_info: "basicInfo",
  first_mes: "firstMessage",
  first_message: "firstMessage",
  greeting: "firstMessage",
  mes_example: "exampleDialogues",
  example_dialogues: "exampleDialogues",
  response_format: "responseFormat",
  system_prompt: "systemPrompt",
  world_book_ids: "worldBookIds",
  initial_state: "initialState",
  state: "initialState",
};
const ENTRY_ALIASES: Record<string, string> = {
  name: "comment",
  title: "comment",
  key: "keys",
  keywords: "keys",
  always_on: "constant",
  case_sensitive: "caseSensitive",
  insertion_order: "priority",
  insert_order: "priority",
  order: "priority",
};
function canonical(value: unknown, aliases: Record<string, string>) {
  const out: Record<string, any> = {};
  for (const [key, field] of Object.entries(record(value)))
    out[aliases[key] ?? key] = field;
  return out;
}
function mergeCharacter(existing: Character, patch: unknown) {
  const fields = canonical(patch, CHARACTER_ALIASES);
  const merged: Record<string, any> = { ...existing, ...fields };
  // 嵌套对象按子键合并，局部更新不会清空未提交的关系或扩展数据。
  if ("initialState" in fields)
    merged.initialState = {
      ...existing.initialState,
      ...record(fields.initialState),
    };
  if ("extra" in fields)
    merged.extra = { ...existing.extra, ...record(fields.extra) };
  return merged;
}
function mergeWorldBook(existing: WorldBook, patch: unknown) {
  const fields = canonical(patch, {});
  const merged: Record<string, any> = { ...existing, ...fields };
  if ("entries" in fields) merged.entries = entriesOf(fields.entries);
  else merged.entries = existing.entries;
  if ("extra" in fields)
    merged.extra = { ...existing.extra, ...record(fields.extra) };
  return merged;
}
function mergeEntry(existing: WorldEntry, patch: unknown) {
  const fields = canonical(patch, ENTRY_ALIASES);
  const extensions = record(fields.extensions);
  if (fields.position === undefined && extensions.position !== undefined)
    fields.position = extensions.position;
  if (fields.depth === undefined && extensions.depth !== undefined)
    fields.depth = extensions.depth;
  const merged: Record<string, any> = { ...existing, ...fields };
  if ("extra" in fields)
    merged.extra = { ...existing.extra, ...record(fields.extra) };
  return merged;
}
export class Library {
  // 导入和关系检查共享串行写队列，避免检查后其他操作改变引用。
  private writes: Promise<unknown> = Promise.resolve();
  constructor(private domain: Domain) {}
  read<T>(table: string, id: string): T | undefined {
    const row = this.domain.table(table).get(id);
    return row ? (JSON.parse(row.json) as T) : undefined;
  }
  all<T>(table: string): T[] {
    return Array.from(
      this.domain.table(table).entries(),
      ([, row]) => JSON.parse(row.json) as T,
    );
  }
  private put(table: string, id: string, value: unknown) {
    return this.domain.table(table).put(id, { json: JSON.stringify(value) });
  }
  binding(sessionId: string): Binding {
    return (
      this.read<Binding>("bindings", sessionId) ?? {
        characterId: "",
        userName: "",
        enabled: false,
      }
    );
  }
  settings(): Settings {
    return this.read<Settings>("settings", "global") ?? DEFAULT_SETTINGS;
  }
  assertCharacterSupported(id: string): Character {
    const card = this.read<Character>("characters", id);
    if (!card) throw new NekoError("notFound");
    for (const bookId of card.worldBookIds) {
      if (
        this.read<WorldBook>("worldbooks", bookId)?.entries.some(
          (entry) => entry.enabled && entry.position === "at_depth",
        )
      )
        throw new NekoError("depthUnsupported");
    }
    return card;
  }
  memories(sessionId: string, characterId: string): Memory[] {
    return this.all<Memory>("memories").filter(
      (m) => m.sessionId === sessionId && m.characterId === characterId,
    );
  }
  preview(sessionId: string, latest = "", recent: string[] = []) {
    const binding = this.binding(sessionId),
      card = this.read<Character>("characters", binding.characterId);
    if (!card || !binding.enabled)
      return { prompt: "", matches: [], character: null };
    const books = card.worldBookIds
      .map((id) => this.read<WorldBook>("worldbooks", id))
      .filter((v): v is WorldBook => !!v);
    const matches = matchWorldBooks(books, latest, recent, this.settings());
    if (matches.some((m) => m.position === "at_depth"))
      throw new NekoError("depthUnsupported");
    return {
      prompt: compilePrompt(
        card,
        binding.userName,
        matches,
        this.memories(sessionId, card.id),
      ),
      matches,
      character: card.name,
    };
  }
  async execute(
    op: Operation,
    sessionId: string,
    caller: "user" | "agent" = "user",
  ): Promise<unknown> {
    if (["list", "get", "preview", "export"].includes(op.action))
      return this.perform(op, sessionId, caller);
    const run = this.writes.then(() => this.perform(op, sessionId, caller));
    this.writes = run.catch(() => undefined);
    return run;
  }
  private async write(
    kind: Kind,
    id: string,
    input: unknown,
    sessionId: string,
    existing: Character | WorldBook | Memory | undefined,
    merge: boolean,
  ): Promise<Character | WorldBook | Memory> {
    if (kind === "character") {
      const value = normalizeCharacter(
        merge && existing
          ? mergeCharacter(existing as Character, input)
          : input,
        id,
      );
      for (const bookId of value.worldBookIds)
        if (!this.read("worldbooks", bookId)) throw new NekoError("notFound");
      await this.put("characters", id, value);
      return value;
    }
    if (kind === "worldbook") {
      const value = normalizeWorldBook(
        merge && existing
          ? mergeWorldBook(existing as WorldBook, input)
          : input,
        id,
      );
      await this.put("worldbooks", id, value);
      return value;
    }
    const binding = this.binding(sessionId);
    if (!binding.characterId) throw new NekoError("chooseCharacter");
    const old = existing as Memory | undefined;
    if (
      old &&
      (old.sessionId !== sessionId || old.characterId !== binding.characterId)
    )
      throw new NekoError("notFound");
    const patch = isRecord(input) ? input : {},
      content = String(
        (merge && old ? (patch.content ?? old.content) : patch.content) ?? "",
      );
    if (!content.trim() || content.length > 10_000)
      throw new NekoError("contentRequired");
    const category = patch.category ?? old?.category ?? "important_event",
      value: Memory = {
        id,
        sessionId,
        characterId: binding.characterId,
        content: content.trim(),
        category: [
          "user_persona",
          "character_persona",
          "important_event",
        ].includes(category)
          ? category
          : "important_event",
      };
    await this.put("memories", id, value);
    return value;
  }
  private async perform(
    op: Operation,
    sessionId: string,
    caller: "user" | "agent",
  ) {
    const kind = op.kind,
      table = kind && names[kind];
    switch (op.action) {
      case "list":
        // 指定 kind 时返回轻量集合，供 Agent 工具按资源读取；无 kind 保持工作台快照。
        if (kind === "character")
          return this.all<Character>("characters").map(
            ({ avatar, extra, ...c }) => ({
              ...c,
              avatar: avatar.length <= 128_000 ? avatar : "",
              hasAvatar: !!avatar,
            }),
          );
        if (kind === "worldbook") return this.all<WorldBook>("worldbooks");
        if (kind === "memory")
          return {
            characterId: this.binding(sessionId).characterId,
            memories: this.memories(
              sessionId,
              this.binding(sessionId).characterId,
            ),
          };
        return {
          characters: this.all<Character>("characters").map(
            ({ avatar, extra, ...c }) => ({
              ...c,
              avatar: avatar.length <= 128_000 ? avatar : "",
              hasAvatar: !!avatar,
            }),
          ),
          worldbooks: this.all<WorldBook>("worldbooks"),
          memories: this.memories(
            sessionId,
            this.binding(sessionId).characterId,
          ),
          binding: this.binding(sessionId),
          settings: this.settings(),
          sessions: Array.from(this.domain.table("bindings").entries())
            .flatMap(([id, row]) => {
              const binding = JSON.parse(row.json) as Binding,
                card = this.read<Character>("characters", binding.characterId);
              return card
                ? [
                    {
                      id,
                      characterId: card.id,
                      name: binding.title || card.name,
                      characterName: card.name,
                      pinned: !!binding.pinned,
                      createdAt: binding.createdAt || 0,
                      avatar: card.avatar.length <= 128_000 ? card.avatar : "",
                    },
                  ]
                : [];
            })
            .sort(
              (a, b) =>
                Number(b.pinned) - Number(a.pinned) ||
                b.createdAt - a.createdAt,
            ),
        };
      case "get": {
        if (!table || !op.id) throw new NekoError("invalidOperation");
        const row = this.read<any>(table, op.id);
        if (
          !row ||
          (kind === "memory" &&
            (row.sessionId !== sessionId ||
              row.characterId !== this.binding(sessionId).characterId))
        )
          throw new NekoError("notFound");
        return row;
      }
      case "save": {
        // 工作台保存完整对象：提供 id 时覆盖，未提供时新建。
        if (!table) throw new NekoError("invalidOperation");
        const id = op.id || newId(),
          existing = op.id ? this.read<any>(table, id) : undefined;
        if (op.id && !existing) throw new NekoError("notFound");
        return this.write(kind!, id, op.value, sessionId, existing, false);
      }
      case "create": {
        if (!table || op.id) throw new NekoError("invalidOperation");
        return this.write(
          kind!,
          newId(),
          op.value,
          sessionId,
          undefined,
          false,
        );
      }
      case "update": {
        // Agent 局部更新：只覆盖提交的字段，其余保留。
        if (!table || !op.id) throw new NekoError("invalidOperation");
        const existing = this.read<any>(table, op.id);
        if (!existing) throw new NekoError("notFound");
        if (!isRecord(op.value)) throw new NekoError("invalidOperation");
        return this.write(kind!, op.id, op.value, sessionId, existing, true);
      }
      case "entry-save": {
        if (kind !== "worldbook" || !op.id)
          throw new NekoError("invalidOperation");
        if (!isRecord(op.value)) throw new NekoError("invalidOperation");
        const book = this.read<WorldBook>("worldbooks", op.id);
        if (!book) throw new NekoError("notFound");
        const entryId = op.entryId || newId(),
          index = book.entries.findIndex((entry) => entry.id === entryId);
        if (op.entryId && index < 0) throw new NekoError("notFound");
        const entry = normalizeEntry(
          index < 0 ? op.value : mergeEntry(book.entries[index], op.value),
          entryId,
        );
        const entries = [...book.entries];
        if (index < 0) entries.push(entry);
        else entries[index] = entry;
        await this.put("worldbooks", book.id, { ...book, entries });
        return entry;
      }
      case "entry-delete": {
        if (kind !== "worldbook" || !op.id || !op.entryId)
          throw new NekoError("invalidOperation");
        const book = this.read<WorldBook>("worldbooks", op.id);
        if (!book) throw new NekoError("notFound");
        const entries = book.entries.filter((entry) => entry.id !== op.entryId);
        if (entries.length === book.entries.length)
          throw new NekoError("notFound");
        await this.put("worldbooks", book.id, { ...book, entries });
        return { bookId: book.id, entryId: op.entryId };
      }
      case "delete": {
        if (!table || !op.id || !this.read(table, op.id))
          throw new NekoError("notFound");
        if (
          kind === "character" &&
          this.all<Binding>("bindings").some((b) => b.characterId === op.id)
        )
          throw new NekoError("inUse");
        if (
          kind === "worldbook" &&
          this.all<Character>("characters").some((c) =>
            c.worldBookIds.includes(op.id!),
          )
        )
          throw new NekoError("inUse");
        if (kind === "memory") {
          const memory = this.read<Memory>(table, op.id)!;
          if (
            memory.sessionId !== sessionId ||
            memory.characterId !== this.binding(sessionId).characterId
          )
            throw new NekoError("notFound");
        }
        await this.domain.table(table).delete(op.id);
        return { id: op.id };
      }
      case "bind": {
        if (caller !== "user") throw new NekoError("userOnly");
        const input = op.value as Partial<Binding>;
        if (!input || typeof input.characterId !== "string")
          throw new NekoError("invalidOperation");
        const card = this.read<Character>("characters", input.characterId);
        if (input.characterId && !card) throw new NekoError("notFound");
        if (input.enabled && card) this.assertCharacterSupported(card.id);
        const binding: Binding = {
          ...this.binding(sessionId),
          characterId: input.characterId,
          userName: String(input.userName || "").slice(0, 100),
          enabled: !!input.enabled && !!card,
          createdAt: this.binding(sessionId).createdAt || Date.now(),
        };
        await this.put("bindings", sessionId, binding);
        return binding;
      }
      case "session": {
        if (caller !== "user") throw new NekoError("userOnly");
        if (!op.id || !this.read<Binding>("bindings", op.id)?.characterId)
          throw new NekoError("notFound");
        const input = op.value as Partial<Binding> | undefined;
        if (
          !input ||
          (input.title !== undefined && typeof input.title !== "string") ||
          (input.pinned !== undefined && typeof input.pinned !== "boolean")
        )
          throw new NekoError("invalidOperation");
        const binding = this.binding(op.id);
        if (input.title !== undefined) {
          if (!input.title.trim() || input.title.trim().length > 120)
            throw new NekoError("sessionTitleRequired");
          binding.title = input.title.trim();
        }
        if (input.pinned !== undefined) binding.pinned = input.pinned;
        await this.put("bindings", op.id, binding);
        return binding;
      }
      case "settings": {
        if (caller !== "user") throw new NekoError("userOnly");
        const settings = normalizeSettings(op.value);
        await this.put("settings", "global", settings);
        return settings;
      }
      case "preview": {
        const input = op.value as { latest?: string } | undefined;
        return this.preview(
          sessionId,
          String(input?.latest || "").slice(0, 20_000),
        );
      }
      case "import": {
        if (typeof op.data !== "string" || op.data.length > 16_000_000)
          throw new NekoError("fileTooLarge");
        const imported = decodeImport(op.data, op.fileName || "import.json");
        // 先完成全量解析验证，再写入；失败时回滚本次新建的条目。
        const written: [string, string][] = [];
        try {
          for (const book of imported.worldbooks) {
            await this.put("worldbooks", book.id, book);
            written.push(["worldbooks", book.id]);
          }
          for (const card of imported.characters) {
            await this.put("characters", card.id, card);
            written.push(["characters", card.id]);
          }
        } catch (error) {
          for (const [name, id] of written.reverse())
            await this.domain.table(name).delete(id);
          throw error;
        }
        return {
          characters: imported.characters.length,
          worldbooks: imported.worldbooks.length,
          notices: imported.notices,
        };
      }
      case "export": {
        const card = op.id
          ? this.read<Character>("characters", op.id)
          : undefined;
        if (op.id && !card) throw new NekoError("notFound");
        return {
          format: "nekobot-dsh",
          schemaVersion: 1,
          characters: card ? [card] : this.all<Character>("characters"),
          worldbooks: this.all<WorldBook>("worldbooks").filter(
            (b) => !card || card.worldBookIds.includes(b.id),
          ),
        };
      }
      default:
        throw new NekoError("invalidOperation");
    }
  }
}
