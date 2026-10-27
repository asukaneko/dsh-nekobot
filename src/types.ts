export type Position =
  "before_char" | "after_char" | "before_an" | "after_an" | "at_depth";
export interface Character {
  id: string;
  name: string;
  description: string;
  avatar: string;
  tags: string[];
  basicInfo: string;
  personality: string;
  scenario: string;
  firstMessage: string;
  exampleDialogues: string;
  responseFormat: string;
  rules: string[];
  systemPrompt: string;
  worldBookIds: string[];
  initialState: Record<string, number>;
  extra: Record<string, unknown>;
}
export interface WorldEntry {
  id: string;
  comment: string;
  content: string;
  keys: string[];
  enabled: boolean;
  constant: boolean;
  caseSensitive: boolean;
  priority: number;
  position: Position;
  depth: number;
  extra: Record<string, unknown>;
}
export interface WorldBook {
  id: string;
  name: string;
  description: string;
  entries: WorldEntry[];
  extra: Record<string, unknown>;
}
export interface Binding {
  characterId: string;
  userName: string;
  enabled: boolean;
  title?: string;
  pinned?: boolean;
  createdAt?: number;
}
export interface Settings {
  maxWorldChars: number;
  recentMessages: number;
}
export interface Memory {
  id: string;
  characterId: string;
  sessionId: string;
  content: string;
  category: "user_persona" | "character_persona" | "important_event";
}
export interface Notice {
  code: string;
  detail: string;
}
export interface ImportResult {
  characters: Character[];
  worldbooks: WorldBook[];
  notices: Notice[];
}
export type Kind = "character" | "worldbook" | "memory";
export interface Operation {
  action:
    | "list"
    | "get"
    | "save"
    | "delete"
    | "import"
    | "export"
    | "bind"
    | "preview"
    | "settings"
    | "session"
    | "start";
  kind?: Kind;
  id?: string;
  value?: unknown;
  data?: string;
  fileName?: string;
}
export interface RoleSession {
  id: string;
  characterId: string;
  name: string;
  avatar: string;
  characterName?: string;
  pinned?: boolean;
  createdAt?: number;
}
export interface LibrarySnapshot {
  characters: (Character & { hasAvatar?: boolean })[];
  worldbooks: WorldBook[];
  memories: Memory[];
  binding: Binding;
  settings: Settings;
  sessions: RoleSession[];
}
export interface Reply {
  ok: boolean;
  data?: any;
  error?: string;
}
