import React, { useEffect, useState, useSyncExternalStore } from "react";
import { App } from "./views.tsx";
import {
  WorkspaceController,
  type WorkspaceTab,
} from "./workspace-controller.ts";
import { messages, type Translate, type TextKey } from "./locales.ts";
import type { Character } from "./types.ts";
import { workspaceStyles } from "./workspace-styles.ts";
import { PageBoundary } from "./page-boundary.tsx";

export function Avatar({
  card,
  large = false,
  controller,
}: {
  card: Pick<Character, "name" | "avatar"> & {
    id?: string;
    hasAvatar?: boolean;
  };
  large?: boolean;
  controller?: WorkspaceController;
}) {
  const [portrait, setPortrait] = useState(card.avatar);
  useEffect(() => {
    let live = true;
    setPortrait(card.avatar);
    if (!card.avatar && card.hasAvatar && card.id && controller)
      controller
        .api({ action: "get", kind: "character", id: card.id })
        .then((full: Character) => {
          if (live) setPortrait(full.avatar);
        })
        .catch(() => {});
    return () => {
      live = false;
    };
  }, [card.id, card.avatar, card.hasAvatar, controller]);
  return portrait ? (
    <img
      className={`nkw-avatar${large ? " is-large" : ""}`}
      src={portrait}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
    />
  ) : (
    <span
      className={`nkw-avatar nkw-letter${large ? " is-large" : ""}`}
      aria-hidden="true"
    >
      {card.name.slice(0, 1)}
    </span>
  );
}
const copy =
  (language: string, host: Translate): Translate =>
  (key) =>
    language === "auto" ? host(key) : (messages[language] || messages.en)[key];
export function WorkspaceSidebar({
  controller,
  t: hostT,
  wide = true,
}: {
  controller: WorkspaceController;
  t: Translate;
  wide?: boolean;
}) {
  const state = useSyncExternalStore(
      controller.subscribe,
      controller.getSnapshot,
    ),
    t = copy(state.language, hostT);
  const [search, setSearch] = useState("");
  const sessions = state.data?.sessions || [];
  const filtered = sessions.filter((s) =>
    `${s.name} ${s.characterName || ""}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <div className={`nkw-side${wide ? "" : " is-rail"}`}>
      <style>{workspaceStyles}</style>
      <nav className="nkw-navigation" aria-label={t("title")}>
        {(["chats", "characters", "worldbooks"] as const).map((tab) => (
          <button
            key={tab}
            disabled={state.busy}
            title={t(tab)}
            aria-label={t(tab)}
            onClick={() => controller.navigate(tab)}
            aria-current={state.tab === tab ? "page" : undefined}
          >
            <span className="nkw-nav-mark" aria-hidden>
              {tab === "chats" ? "◌" : tab === "characters" ? "◇" : "▤"}
            </span>
            <span className="nkw-nav-label">{t(tab)}</span>
            <small>
              {tab === "characters"
                ? state.data?.characters.length
                : tab === "worldbooks"
                  ? state.data?.worldbooks.length
                  : sessions.length}
            </small>
          </button>
        ))}
      </nav>
      <div className="nkw-side-search">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("search")}
          aria-label={t("search")}
        />
      </div>
      <div className="nkw-side-label">{t("chats")}</div>
      <div className="nkw-session-list">
        {filtered.map((session) => (
          <button
            key={session.id}
            className="nkw-session"
            aria-current={
              state.sessionId === session.id &&
              !state.choosing &&
              state.tab === "chats"
                ? "page"
                : undefined
            }
            disabled={state.busy}
            onClick={() => void controller.openSession(session.id)}
          >
            <Avatar
              card={
                state.data?.characters.find(
                  (c) => c.id === session.characterId,
                ) || session
              }
              controller={controller}
            />
            <span>
              <strong>
                {session.pinned && (
                  <span className="nkw-pin" aria-label={t("pinned")}>
                    ★{" "}
                  </span>
                )}
                {session.name}
              </strong>
              <small>{session.characterName || session.name}</small>
            </span>
          </button>
        ))}
        {state.data && !sessions.length && (
          <p className="nkw-muted">{t("chooseRole")}</p>
        )}
        {!!sessions.length && !filtered.length && (
          <p className="nkw-muted">{t("noSearchResults")}</p>
        )}
      </div>
      <footer className="nkw-side-footer">
        <button onClick={() => controller.navigate("memories")}>
          {t("memories")}
        </button>
        <button onClick={() => controller.navigate("settings")}>
          {t("settings")}
        </button>
        <button onClick={controller.leave}>{t("backToDsh")}</button>
      </footer>
    </div>
  );
}
function CharacterDetails({
  card,
  controller,
  t,
}: {
  card: Character;
  controller: WorkspaceController;
  t: Translate;
}) {
  const state = controller.getSnapshot(),
    books =
      state.data?.worldbooks.filter((book) =>
        card.worldBookIds.includes(book.id),
      ) || [];
  return (
    <aside className="nkw-details">
      <div className="nkw-profile">
        <Avatar card={card} large controller={controller} />
        <h2>{card.name}</h2>
        <p>{card.description}</p>
        <div className="nkw-tags">
          {card.tags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      </div>
      <div className="nkw-details-actions">
        <button onClick={() => controller.navigate("characters", card.id)}>
          {t("editor")}
        </button>
        <button onClick={() => controller.navigate("session")}>
          {t("settings")}
        </button>
      </div>
      {card.basicInfo && (
        <section>
          <h3>{t("basicInfo")}</h3>
          <p>{card.basicInfo}</p>
        </section>
      )}
      {card.personality && (
        <section>
          <h3>{t("personality")}</h3>
          <p>{card.personality}</p>
        </section>
      )}
      {card.scenario && (
        <section>
          <h3>{t("scenario")}</h3>
          <p>{card.scenario}</p>
        </section>
      )}
      <section>
        <h3>
          {t("relatedBooks")} <small>{books.length}</small>
        </h3>
        {books.map((book) => (
          <button
            className="nkw-book-link"
            key={book.id}
            onClick={() => controller.navigate("worldbooks", book.id)}
          >
            <span>{book.name}</span>
            <small>
              {book.entries.length} {t("entries")}
            </small>
          </button>
        ))}
        {!books.length && <p className="nkw-muted">{t("empty")}</p>}
      </section>
      <section>
        <h3>
          {t("memories")} <small>{state.data?.memories.length || 0}</small>
        </h3>
        <button onClick={() => controller.navigate("memories")}>
          {t("editor")}
        </button>
        {state.data?.memories.slice(-3).map((memory) => (
          <p className="nkw-memory-preview" key={memory.id}>
            {memory.content}
          </p>
        ))}
      </section>
    </aside>
  );
}
export function ConversationOpening({
  controller,
  t,
}: {
  controller: WorkspaceController;
  t: Translate;
}) {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  const card = state.card;
  if (!card) return null;
  const text = card.firstMessage
    .replaceAll("{{char}}", card.name)
    .replaceAll("{{user}}", state.data?.binding.userName || t("you"));
  return (
    <section className="nkw-opening" aria-label={t("opening")}>
      <Avatar card={card} large />
      <h1>{card.name}</h1>
      {card.description && (
        <p className="nkw-opening-description">{card.description}</p>
      )}
      {text ? (
        <div className="nkw-opening-message">
          <small>{t("openingReference")}</small>
          <p>{text}</p>
        </div>
      ) : (
        <p className="nkw-opening-description">{t("startHint")}</p>
      )}
      <div className="nkw-opening-actions">
        <button onClick={() => controller.navigate("session")}>
          {t("session")}
        </button>
        <button onClick={() => controller.navigate("characters", card.id)}>
          {t("roleInfo")}
        </button>
      </div>
    </section>
  );
}
export interface WorkspaceProps {
  controller: WorkspaceController;
  t: Translate;
  renderChat: (sessionId: string) => React.ReactNode;
}
export function Workspace({
  controller,
  t: hostT,
  renderChat,
}: WorkspaceProps) {
  const state = useSyncExternalStore(
      controller.subscribe,
      controller.getSnapshot,
    ),
    t = copy(state.language, hostT);
  useEffect(() => {
    void controller.enter();
  }, [controller]);
  const [renaming, setRenaming] = useState(false),
    [title, setTitle] = useState("");
  useEffect(
    () => setRenaming(false),
    [state.sessionId, state.tab, state.choosing],
  );
  const current = state.data?.sessions.find((s) => s.id === state.sessionId);
  const active =
    !state.choosing &&
    !!state.card &&
    !!state.sessionId &&
    !!state.data?.binding.enabled;
  const error =
    state.error in messages.en ? (state.error as TextKey) : "operationFailed";
  return (
    <div
      className="nkw"
      data-details={state.details && active ? "open" : "closed"}
    >
      <style>{workspaceStyles}</style>
      <header className="nkw-header">
        <div className="nkw-heading">
          {state.tab === "chats" && active ? (
            <>
              <Avatar card={state.card!} />
              <div>
                <strong>{current?.name || state.card!.name}</strong>
                <small>
                  {state.card!.name} · {t("roleplay")}
                </small>
              </div>
            </>
          ) : (
            <>
              <span className="nkw-wordmark">N</span>
              <strong>
                {state.tab === "chats" ? t("title") : t(state.tab)}
              </strong>
            </>
          )}
        </div>
        <div className="nkw-tools">
          <button
            className="nkw-new-chat"
            onClick={controller.chooseRole}
            disabled={state.busy}
          >
            + {t("newChat")}
          </button>
          {state.tab === "chats" && active && (
            <>
              <button
                onClick={() => {
                  setTitle(current?.name || state.card!.name);
                  setRenaming(true);
                }}
                disabled={state.busy}
              >
                {t("rename")}
              </button>
              <button
                aria-pressed={!!current?.pinned}
                onClick={() =>
                  void controller.updateSession(state.sessionId, {
                    pinned: !current?.pinned,
                  })
                }
                disabled={state.busy}
              >
                {t(current?.pinned ? "unpin" : "pin")}
              </button>
            </>
          )}
          <select
            aria-label={t("language")}
            value={state.language}
            onChange={(e) => controller.setLanguage(e.target.value)}
          >
            <option value="auto">{t("auto")}</option>
            {[
              ["zh", "简体中文"],
              ["zh-tw", "繁體中文"],
              ["en", "English"],
              ["ja", "日本語"],
              ["ko", "한국어"],
            ].map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          {state.tab === "chats" && active && (
            <button
              onClick={controller.toggleDetails}
              aria-expanded={state.details}
            >
              {t("details")}
            </button>
          )}
        </div>
      </header>
      {renaming && (
        <form
          className="nkw-rename"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await controller.updateSession(state.sessionId, { title }))
              setRenaming(false);
          }}
        >
          <label htmlFor="nkw-session-title">{t("sessionTitle")}</label>
          <input
            id="nkw-session-title"
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            required
          />
          <button type="submit" disabled={state.busy || !title.trim()}>
            {t("save")}
          </button>
          <button type="button" onClick={() => setRenaming(false)}>
            {t("cancel")}
          </button>
        </form>
      )}
      {state.error && (
        <div role="alert" className="nkw-error">
          {t(error)}{" "}
          <button onClick={() => void controller.refresh()}>
            {t("refresh")}
          </button>
        </div>
      )}
      <PageBoundary key={`${state.sessionId}:${state.tab}`} t={t}>
        {!state.data ? (
          <div className="nkw-empty" role="status">
            {state.busy ? t("loading") : t("empty")}
          </div>
        ) : state.tab !== "chats" ? (
          <App
            key={`${state.sessionId}:${state.tab}:${state.selectionId}`}
            sessionId={state.sessionId}
            api={controller.api}
            t={t}
            initialTab={state.tab}
            initialSelectionId={state.selectionId}
            embedded
            onGuard={controller.setGuard}
            onStart={(id) => void controller.startCharacter(id)}
          />
        ) : active ? (
          <div className="nkw-conversation">
            <main className="nkw-native-chat" aria-label={t("chats")}>
              {renderChat(state.sessionId)}
            </main>
            {state.details && (
              <CharacterDetails
                card={state.card!}
                controller={controller}
                t={t}
              />
            )}
          </div>
        ) : (
          <main className="nkw-home">
            <div className="nkw-welcome">
              <span className="nkw-wordmark is-large">N</span>
              <h1>{t("welcome")}</h1>
              <p>
                {state.data.characters.length ? t("chooseRole") : t("noRoles")}
              </p>
            </div>
            <div className="nkw-gallery">
              {state.data.characters.map((card) => (
                <button
                  className="nkw-card"
                  key={card.id}
                  disabled={state.busy}
                  onClick={() => void controller.startCharacter(card.id)}
                >
                  <Avatar card={card} large controller={controller} />
                  <strong>{card.name}</strong>
                  <p>{card.description || card.personality}</p>
                  <span>
                    {t("startChat")} <span aria-hidden>↗</span>
                  </span>
                </button>
              ))}
              <button
                className="nkw-card nkw-add-card"
                onClick={() => controller.navigate("characters")}
              >
                <span aria-hidden>+</span>
                <strong>{t("create")}</strong>
                <p>{t("characters")}</p>
              </button>
            </div>
          </main>
        )}
      </PageBoundary>
    </div>
  );
}
