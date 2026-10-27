import { createApi } from "./api.ts";
import type { Character, LibrarySnapshot, Operation } from "./types.ts";
import type { TextKey } from "./locales.ts";

export type WorkspaceTab =
  "chats" | "characters" | "worldbooks" | "session" | "memories" | "settings";
export interface WorkspaceState {
  tab: WorkspaceTab;
  sessionId: string;
  data: LibrarySnapshot | null;
  card: Character | null;
  busy: boolean;
  error: string;
  details: boolean;
  language: string;
  choosing: boolean;
  selectionId: string;
}
interface Navigation {
  openSession(id: string): Promise<unknown> | unknown;
  show(): void;
  leave(): void;
}
export class WorkspaceController {
  private state: WorkspaceState;
  private listeners = new Set<() => void>();
  private generation = 0;
  private guard = () => true;
  private disposed = false;
  private entered = false;
  private entering: Promise<void> | null = null;
  private request: ReturnType<typeof createApi>;
  constructor(
    private navigation: Navigation,
    request: typeof fetch = fetch,
    private storage?: Pick<Storage, "getItem" | "setItem">,
  ) {
    const read = (key: string, fallback: string) => {
      try {
        return storage?.getItem(key) || fallback;
      } catch {
        return fallback;
      }
    };
    this.state = {
      tab: "chats",
      sessionId: read("nekobot.session", ""),
      data: null,
      card: null,
      busy: false,
      error: "",
      details: true,
      language: read("nekobot.language", "auto"),
      choosing: false,
      selectionId: "",
    };
    this.request = createApi(() => this.state.sessionId, request);
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<WorkspaceState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  setGuard = (guard: () => boolean) => {
    this.guard = guard;
  };
  enter(): Promise<void> {
    if (this.entering) return this.entering;
    if (this.entered) return this.refresh();
    this.entered = true;
    this.entering = (async () => {
      if (this.state.sessionId) {
        await this.openSession(this.state.sessionId);
        if (this.state.error) {
          this.update({ sessionId: "", card: null });
          try {
            this.storage?.setItem("nekobot.session", "");
          } catch {}
          await this.refresh();
        }
      } else await this.refresh();
    })().finally(() => {
      this.entering = null;
    });
    return this.entering;
  }
  api = async (operation: Operation) => {
    const session = this.state.sessionId;
    const data = await this.request(operation);
    if (operation.action === "list" && session === this.state.sessionId) {
      const snapshot = data as LibrarySnapshot;
      const id = snapshot.binding.characterId;
      const card = id
        ? ((await this.request({
            action: "get",
            kind: "character",
            id,
          })) as Character)
        : null;
      if (session === this.state.sessionId)
        this.update({ data: snapshot, card });
    }
    if (
      operation.action === "save" &&
      operation.kind === "character" &&
      data.id === this.state.card?.id
    )
      this.update({ card: data as Character });
    return data;
  };
  async refresh() {
    const generation = ++this.generation;
    this.update({ busy: true, error: "" });
    try {
      const data = (await this.request({ action: "list" })) as LibrarySnapshot;
      const card = data.binding.characterId
        ? ((await this.request({
            action: "get",
            kind: "character",
            id: data.binding.characterId,
          })) as Character)
        : null;
      if (generation === this.generation)
        this.update({ data, card, busy: false });
    } catch (error) {
      if (generation === this.generation)
        this.update({
          busy: false,
          error: error instanceof Error ? error.message : "operationFailed",
        });
    }
  }
  navigate = (tab: WorkspaceTab, selectionId = "") => {
    if (this.guard()) {
      this.update({ tab, selectionId, choosing: false, error: "" });
      this.navigation.show();
    }
  };
  chooseRole = () => {
    if (!this.state.busy && this.guard()) {
      this.update({ tab: "chats", choosing: true, error: "" });
      this.navigation.show();
    }
  };
  async updateSession(id: string, value: { title?: string; pinned?: boolean }) {
    if (this.state.busy || !this.guard()) return false;
    this.update({ busy: true, error: "" });
    try {
      await this.request({ action: "session", id, value });
      await this.refresh();
      return !this.state.error;
    } catch (error) {
      this.update({
        busy: false,
        error: error instanceof Error ? error.message : "operationFailed",
      });
      return false;
    }
  }
  toggleDetails = () => this.update({ details: !this.state.details });
  setLanguage = (language: string) => {
    this.update({ language });
    try {
      this.storage?.setItem("nekobot.language", language);
    } catch {}
  };
  leave = () => {
    if (this.guard()) this.navigation.leave();
  };
  async openSession(id: string) {
    if (!this.guard() || this.state.busy) return;
    this.update({ busy: true, error: "" });
    try {
      await this.navigation.openSession(id);
      this.update({
        sessionId: id,
        tab: "chats",
        choosing: false,
        selectionId: "",
      });
      try {
        this.storage?.setItem("nekobot.session", id);
      } catch {}
      this.navigation.show();
      await this.refresh();
    } catch (error) {
      this.update({
        busy: false,
        error: error instanceof Error ? error.message : "operationFailed",
      });
    }
  }
  async startCharacter(id: string) {
    if (!this.guard() || this.state.busy) return;
    this.update({ busy: true, error: "" });
    try {
      const created = await this.request({ action: "start", id });
      this.update({ busy: false });
      await this.openSession(created.sessionId);
    } catch (error) {
      this.update({
        busy: false,
        error: error instanceof Error ? error.message : "operationFailed",
      });
    }
  }
  errorKey(): TextKey {
    return this.state.error as TextKey;
  }
  dispose() {
    this.disposed = true;
    this.generation++;
    this.listeners.clear();
  }
}
