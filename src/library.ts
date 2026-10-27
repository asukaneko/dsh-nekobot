import {
  DEFAULT_SETTINGS,
  NekoError,
  compilePrompt,
  decodeImport,
  matchWorldBooks,
  newId,
  normalizeCharacter,
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
  private async perform(
    op: Operation,
    sessionId: string,
    caller: "user" | "agent",
  ) {
    const kind = op.kind,
      table = kind && names[kind];
    switch (op.action) {
      case "list":
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
        if (!table) throw new NekoError("invalidOperation");
        const id = op.id || newId();
        if (op.id && !this.read(table, id)) throw new NekoError("notFound");
        let value: Character | WorldBook | Memory;
        if (kind === "character") {
          value = normalizeCharacter(op.value, id);
          for (const bookId of value.worldBookIds)
            if (!this.read("worldbooks", bookId))
              throw new NekoError("notFound");
        } else if (kind === "worldbook")
          value = normalizeWorldBook(op.value, id);
        else {
          const input = op.value as Partial<Memory>,
            binding = this.binding(sessionId);
          if (!input?.content?.trim() || input.content.length > 10_000)
            throw new NekoError("contentRequired");
          if (!binding.characterId) throw new NekoError("chooseCharacter");
          const old = this.read<Memory>("memories", id);
          if (
            old &&
            (old.sessionId !== sessionId ||
              old.characterId !== binding.characterId)
          )
            throw new NekoError("notFound");
          value = {
            id,
            sessionId,
            characterId: binding.characterId,
            content: input.content.trim(),
            category: [
              "user_persona",
              "character_persona",
              "important_event",
            ].includes(input.category || "")
              ? input.category!
              : "important_event",
          };
        }
        await this.put(table, id, value);
        return value;
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
