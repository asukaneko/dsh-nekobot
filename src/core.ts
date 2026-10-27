import { unzipSync, unzlibSync, strFromU8 } from "fflate";
import type {
  Character,
  WorldBook,
  WorldEntry,
  ImportResult,
  Settings,
  Memory,
} from "./types.ts";

export class NekoError extends Error {
  constructor(
    public code: string,
    public detail = "",
  ) {
    super(code);
  }
}
export const DEFAULT_SETTINGS: Settings = {
  maxWorldChars: 6000,
  recentMessages: 6,
};
export const newId = (): string => crypto.randomUUID();
const object = (x: unknown): Record<string, any> =>
  x !== null && typeof x === "object" && !Array.isArray(x)
    ? (x as Record<string, any>)
    : {};
const text = (x: unknown, limit = 100_000): string =>
  typeof x === "string" ? x.slice(0, limit) : "";
const list = (x: unknown): string[] =>
  (Array.isArray(x) ? x : typeof x === "string" ? x.split(/[,，\n]/) : [])
    .map((v) => text(v).trim())
    .filter(Boolean);
const number = (x: unknown, fallback: number, min: number, max: number) =>
  Number.isFinite(Number(x)) && x !== "" && x != null
    ? Math.max(min, Math.min(max, Math.round(Number(x))))
    : fallback;
export const RELATIONS = [
  "affection",
  "trust",
  "familiarity",
  "dependency",
  "security",
  "jealousy",
] as const;
export function safeAvatar(x: unknown): string {
  const s = text(x, 6_000_000);
  return /^(?:data:image\/(?:png|jpeg|webp|gif);base64,[a-z\d+/=]+|https:\/\/[^\s]+)$/i.test(
    s,
  )
    ? s
    : "";
}
export function normalizeCharacter(value: unknown, id = newId()): Character {
  const wrapper = object(value),
    v = object(wrapper.data ?? value);
  const state = object(v.initialState ?? v.initial_state ?? v.state);
  const initialState = Object.fromEntries(
    RELATIONS.map((k) => [
      k,
      number(
        state[k],
        k === "jealousy"
          ? 0
          : k === "familiarity" || k === "dependency"
            ? 30
            : 50,
        0,
        100,
      ),
    ]),
  );
  const result: Character = {
    id,
    name: text(v.name, 200).trim(),
    description: text(v.description),
    avatar: safeAvatar(v.avatar ?? v.portrait),
    tags: list(v.tags).slice(0, 50),
    basicInfo: text(v.basicInfo ?? v.basic_info),
    personality: text(v.personality),
    scenario: text(v.scenario),
    firstMessage: text(
      v.firstMessage ?? v.first_message ?? v.first_mes ?? v.greeting,
    ),
    exampleDialogues: text(
      v.exampleDialogues ?? v.example_dialogues ?? v.mes_example,
    ),
    responseFormat: text(v.responseFormat ?? v.response_format),
    rules: list(v.rules),
    systemPrompt: text(v.systemPrompt ?? v.system_prompt),
    worldBookIds: list(v.worldBookIds ?? v.world_book_ids),
    initialState,
    extra: structuredClone(object(v.extra ?? value)),
  };
  if (!result.name) throw new NekoError("nameRequired");
  return result;
}
export function normalizeEntry(value: unknown, id = newId()): WorldEntry {
  const v = object(value),
    ex = object(v.extensions);
  const raw = v.position ?? ex.position ?? "before_char";
  const positions: Record<string, WorldEntry["position"]> = {
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
  const position = positions[String(raw).toLowerCase().replaceAll("_", "")];
  if (!position) throw new NekoError("invalidPosition", String(raw));
  return {
    id,
    comment: text(v.comment ?? v.name, 300),
    content: text(v.content),
    keys: list(v.keys ?? v.key ?? v.keywords),
    enabled: v.enabled !== false && v.disable !== true,
    constant: v.constant === true || v.always_on === true,
    caseSensitive: v.caseSensitive === true || v.case_sensitive === true,
    priority: number(
      v.priority ?? v.insertion_order ?? v.order,
      100,
      -10_000,
      10_000,
    ),
    position,
    depth: number(v.depth ?? ex.depth, 4, 0, 100),
    extra: structuredClone(object(v.extra ?? value)),
  };
}
export function normalizeWorldBook(value: unknown, id = newId()): WorldBook {
  const v = object(value),
    raw = Array.isArray(v.entries)
      ? v.entries
      : Object.values(object(v.entries));
  if (raw.length > 1000) throw new NekoError("tooManyEntries");
  const book: WorldBook = {
    id,
    name: text(v.name, 200).trim(),
    description: text(v.description),
    entries: raw.map((e) =>
      normalizeEntry(e, text(object(e).id, 128) || newId()),
    ),
    extra: structuredClone(object(v.extra ?? value)),
  };
  if (!book.name) throw new NekoError("nameRequired");
  if (new Set(book.entries.map((e) => e.id)).size !== book.entries.length)
    throw new NekoError("duplicateId");
  return book;
}
export function normalizeSettings(value: unknown): Settings {
  const v = object(value);
  return {
    maxWorldChars: number(v.maxWorldChars, 6000, 500, 24_000),
    recentMessages: number(v.recentMessages, 6, 0, 30),
  };
}

function fromBase64(data: string): Uint8Array {
  if (!/^[a-z\d+/\r\n]*={0,2}$/i.test(data)) throw new NekoError("invalidFile");
  try {
    return Uint8Array.from(atob(data.replace(/[\r\n]/g, "")), (c) =>
      c.charCodeAt(0),
    );
  } catch {
    throw new NekoError("invalidFile");
  }
}
const toBase64 = (bytes: Uint8Array) => {
  let out = "";
  for (let i = 0; i < bytes.length; i += 8192)
    out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(out);
};
function pngCard(bytes: Uint8Array): unknown {
  if (![137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b))
    throw new NekoError("invalidFile");
  let v2: string | undefined, v3: string | undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = view.getUint32(offset),
      type = strFromU8(bytes.subarray(offset + 4, offset + 8));
    if (length > 8_000_000 || offset + 12 + length > bytes.length)
      throw new NekoError("invalidFile");
    const chunk = bytes.subarray(offset + 8, offset + 8 + length),
      zero = chunk.indexOf(0);
    if (zero > 0 && (type === "tEXt" || type === "iTXt" || type === "zTXt")) {
      const key = strFromU8(chunk.subarray(0, zero));
      if (key === "chara" || key === "ccv3") {
        let payload = chunk.subarray(zero + 1);
        if (type === "iTXt") {
          if (payload[0] !== 0) throw new NekoError("compressedPng");
          let pos = 2;
          for (let i = 0; i < 2; i++) {
            const end = payload.indexOf(0, pos);
            if (end < 0) throw new NekoError("invalidFile");
            pos = end + 1;
          }
          payload = payload.subarray(pos);
        } else if (type === "zTXt") {
          // 解压目标有硬上限，避免压缩块无限分配内存。
          payload = unzlibSync(payload.subarray(1), {
            out: new Uint8Array(4_000_000),
          });
          const end = payload.indexOf(0);
          if (end >= 0) payload = payload.subarray(0, end);
        }
        if (key === "ccv3") v3 = strFromU8(payload);
        else v2 = strFromU8(payload);
      }
    }
    offset += length + 12;
  }
  if (!(v3 ?? v2)) throw new NekoError("noCardInPng");
  return JSON.parse(strFromU8(fromBase64((v3 ?? v2)!)));
}

export function importData(bytes: Uint8Array, fileName: string): ImportResult {
  if (bytes.length > 12_000_000) throw new NekoError("fileTooLarge");
  const result: ImportResult = { characters: [], worldbooks: [], notices: [] };
  const absorb = (value: unknown, avatar = "") => {
    const v = object(value);
    if (v.format === "nekobot-dsh" && v.schemaVersion !== 1)
      throw new NekoError("unsupportedVersion");
    if (v.format === "nekobot-dsh") {
      const ids = new Map<string, string>();
      if (
        !Array.isArray(v.worldbooks) ||
        !Array.isArray(v.characters) ||
        v.worldbooks.length + v.characters.length > 1000
      )
        throw new NekoError("invalidFile");
      for (const raw of v.worldbooks) {
        const b = normalizeWorldBook(raw);
        ids.set(object(raw).id, b.id);
        result.worldbooks.push(b);
      }
      for (const raw of v.characters) {
        const c = normalizeCharacter(raw);
        c.worldBookIds = c.worldBookIds
          .map((id) => ids.get(id))
          .filter((id): id is string => !!id);
        result.characters.push(c);
      }
    } else if (v.entries != null && v.personality == null && v.spec == null)
      result.worldbooks.push(
        normalizeWorldBook({
          ...v,
          name: v.name || fileName.replace(/\.[^.]+$/, ""),
        }),
      );
    else {
      const c = normalizeCharacter(value);
      if (avatar) c.avatar = avatar;
      const cardData = object(v.data ?? value),
        embedded = object(cardData.character_book);
      if (embedded.entries) {
        const b = normalizeWorldBook({
          ...embedded,
          name: embedded.name || c.name,
        });
        result.worldbooks.push(b);
        c.worldBookIds.push(b.id);
      }
      result.characters.push(c);
    }
  };
  try {
    if (/\.png$/i.test(fileName))
      absorb(pngCard(bytes), `data:image/png;base64,${toBase64(bytes)}`);
    else if (/\.zip$/i.test(fileName)) {
      let total = 0,
        count = 0;
      const files = unzipSync(bytes, {
        filter: (entry) => {
          if (
            ++count > 1000 ||
            entry.originalSize > 12_000_000 ||
            (total += entry.originalSize) > 24_000_000
          )
            throw new NekoError("fileTooLarge");
          return (
            /(?:^|\/)character\.json$/i.test(entry.name) ||
            /^portrait\.(png|jpe?g|webp|gif)$/i.test(entry.name)
          );
        },
      });
      const card = Object.entries(files).find(([name]) =>
        /(?:^|\/)character\.json$/i.test(name),
      );
      if (!card) throw new NekoError("invalidFile");
      const portrait = Object.entries(files).find(([name]) =>
        /^portrait\.(png|jpe?g|webp|gif)$/i.test(name),
      );
      const ext = portrait?.[0].split(".").pop()?.toLowerCase();
      absorb(
        JSON.parse(strFromU8(card[1])),
        portrait
          ? `data:image/${ext === "jpg" ? "jpeg" : ext};base64,${toBase64(portrait[1])}`
          : "",
      );
    } else if (/\.json$/i.test(fileName)) absorb(JSON.parse(strFromU8(bytes)));
    else throw new NekoError("invalidFile");
  } catch (e) {
    if (e instanceof NekoError) throw e;
    throw new NekoError("invalidFile");
  }
  for (const book of result.worldbooks)
    for (const entry of book.entries) {
      if (entry.position === "at_depth")
        result.notices.push({
          code: "depthUnsupported",
          detail: `${book.name}: ${entry.comment || entry.id}`,
        });
      if (
        Object.keys(entry.extra).some(
          (k) =>
            /selective|probability|cooldown|sticky|delay/i.test(k) &&
            entry.extra[k],
        )
      )
        result.notices.push({
          code: "advancedWorldUnsupported",
          detail: book.name,
        });
    }
  result.notices.push({ code: "importPreserved", detail: "" });
  return result;
}
export function decodeImport(data: string, fileName: string): ImportResult {
  return importData(fromBase64(data), fileName);
}

export interface Match {
  bookId: string;
  entryId: string;
  title: string;
  content: string;
  position: WorldEntry["position"];
  priority: number;
  sources: string[];
}
export function matchWorldBooks(
  books: WorldBook[],
  latest: string,
  recent: string[],
  settings: Settings,
): Match[] {
  const candidates: Match[] = [];
  for (const book of books)
    for (const entry of book.entries) {
      if (!entry.enabled || !entry.content.trim()) continue;
      const normalize = (s: string) =>
        entry.caseSensitive ? s : s.toLowerCase();
      const matches = (s: string) =>
        entry.keys.some((key) => normalize(s).includes(normalize(key)));
      const sources = entry.constant
        ? ["constant"]
        : [
            matches(latest) ? "user" : "",
            settings.recentMessages > 0 &&
            recent.slice(-settings.recentMessages).some(matches)
              ? "history"
              : "",
          ].filter(Boolean);
      if (sources.length)
        candidates.push({
          bookId: book.id,
          entryId: entry.id,
          title: entry.comment || book.name,
          content: entry.content,
          priority: entry.priority,
          position: entry.position,
          sources,
        });
    }
  candidates.sort(
    (a, b) =>
      b.priority - a.priority ||
      a.bookId.localeCompare(b.bookId) ||
      a.entryId.localeCompare(b.entryId),
  );
  let remaining = settings.maxWorldChars;
  return candidates.flatMap((entry) => {
    if (remaining <= 0) return [];
    const content = entry.content.slice(0, Math.min(2000, remaining));
    remaining -= content.length;
    return [{ ...entry, content }];
  });
}
export function compilePrompt(
  card: Character,
  userName: string,
  matches: Match[],
  memories: Memory[] = [],
): string {
  const blocks = (positions: string[]) =>
    matches
      .filter((m) => positions.includes(m.position))
      .map((m) => `【世界书：${m.title}】\n${m.content}`)
      .join("\n\n");
  const parts = [
    blocks(["before_char"]),
    `你是角色「${card.name}」。以角色的身份、性格和口吻与用户交流，保持人物设定与前文一致。`,
    ...[
      ["角色设定", card.systemPrompt],
      ["简介", card.description],
      ["基本信息", card.basicInfo],
      ["性格", card.personality],
      ["场景", card.scenario],
      ["回复格式", card.responseFormat],
      ["规则", card.rules.join("\n")],
      ["示例对话", card.exampleDialogues],
      ["开场白参考", card.firstMessage],
    ]
      .filter(([, v]) => v?.trim())
      .map(([label, content]) => `【${label}】\n${content}`),
    blocks(["after_char", "before_an", "after_an"]),
    memories.length
      ? `【本会话记忆】\n${memories.map((m) => `- ${m.content}`).join("\n")}`
      : "",
  ];
  return parts
    .filter(Boolean)
    .join("\n\n")
    .replaceAll("{{char}}", card.name)
    .replaceAll("{{user}}", userName || "用户");
}
