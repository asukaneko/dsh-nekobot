import React, { useEffect, useRef, useState } from "react";
import { readAvatarFile } from "./avatar.ts";
import {
  normalizeCharacter,
  normalizeWorldBook,
  normalizeEntry,
  compilePrompt,
} from "./core.ts";
import { messages, type TextKey, type Translate } from "./locales.ts";
import { styles } from "./styles.ts";
import type {
  Binding,
  Character,
  Memory,
  Operation,
  Reply,
  Settings,
  WorldBook,
} from "./types.ts";

export type Api = (operation: Operation) => Promise<unknown>;
interface Snapshot {
  characters: (Character & { hasAvatar?: boolean })[];
  worldbooks: WorldBook[];
  memories: Memory[];
  binding: Binding;
  settings: Settings;
}
// 列表会裁掉大立绘，只保留 hasAvatar；需要时再取完整角色卡。
function CharacterThumb({
  card,
  api,
}: {
  card: Character & { hasAvatar?: boolean };
  api: Api;
}) {
  const [avatar, setAvatar] = useState(card.avatar),
    request = useRef(api);
  request.current = api;
  useEffect(() => {
    let live = true;
    setAvatar(card.avatar);
    if (!card.avatar && card.hasAvatar)
      request
        .current({ action: "get", kind: "character", id: card.id })
        .then((full) => {
          if (live && typeof (full as Character)?.avatar === "string")
            setAvatar((full as Character).avatar);
        })
        .catch(() => {});
    return () => {
      live = false;
    };
  }, [card.id, card.avatar, card.hasAvatar]);
  return avatar ? (
    <img
      className="nk-initial"
      style={{ objectFit: "cover" }}
      src={avatar}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
    />
  ) : (
    <span className="nk-initial" aria-hidden>
      {card.name.slice(0, 1)}
    </span>
  );
}
function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="nk-field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="nk-check">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}
const asList = (s: string) =>
  s
    .split(/[,，\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
function ListInput({
  value,
  onChange,
}: {
  value: string[];
  onChange: (items: string[]) => void;
}) {
  const [raw, setRaw] = useState(() => value.join(", "));
  return (
    <input
      value={raw}
      onChange={(e) => {
        setRaw(e.target.value);
        onChange(asList(e.target.value));
      }}
    />
  );
}
export function CharacterEditor({
  value,
  onChange,
  books,
  t,
}: {
  value: Character;
  onChange: (value: Character) => void;
  books: WorldBook[];
  t: Translate;
}) {
  const [preview, setPreview] = useState(false),
    [portraitError, setPortraitError] = useState(""),
    fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => setPortraitError(""), [value.id]);
  const patch = (key: keyof Character, v: unknown) =>
    onChange({ ...value, [key]: v });
  const upload = async (file?: File) => {
    if (!file) return;
    setPortraitError("");
    try {
      patch("avatar", await readAvatarFile(file));
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      setPortraitError(code in messages.en ? code : "invalidFile");
    }
  };
  return (
    <>
      <div className="nk-actions" style={{ marginBottom: 18 }}>
        <button
          type="button"
          aria-pressed={!preview}
          onClick={() => setPreview(false)}
        >
          {t("editor")}
        </button>
        <button
          type="button"
          aria-pressed={preview}
          onClick={() => setPreview(true)}
        >
          {t("preview")}
        </button>
      </div>
      {preview ? (
        <pre className="nk-preview">{compilePrompt(value, "{{user}}", [])}</pre>
      ) : (
        <>
          <div className="nk-portrait-row">
            {value.avatar && (
              <img
                className="nk-portrait"
                src={value.avatar}
                alt={value.name}
                referrerPolicy="no-referrer"
              />
            )}
            <div>
              <Field label={t("name")}>
                <input
                  required
                  maxLength={200}
                  value={value.name}
                  onChange={(e) => patch("name", e.target.value)}
                />
              </Field>
              <Field label={t("tags")} hint={t("separate")}>
                <ListInput
                  value={value.tags}
                  onChange={(v) => patch("tags", v)}
                />
              </Field>
            </div>
          </div>
          <Field label={t("descriptionField")}>
            <textarea
              rows={2}
              value={value.description}
              onChange={(e) => patch("description", e.target.value)}
            />
          </Field>
          <div className="nk-field">
            <span>{t("avatar")}</span>
            <div className="nk-portrait-actions">
              <button type="button" onClick={() => fileInput.current?.click()}>
                {t("uploadPortrait")}
              </button>
              {value.avatar && (
                <button
                  type="button"
                  className="nk-danger"
                  onClick={() => {
                    setPortraitError("");
                    patch("avatar", "");
                  }}
                >
                  {t("removePortrait")}
                </button>
              )}
              <input
                ref={fileInput}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                aria-label={t("uploadPortrait")}
                style={{ display: "none" }}
                onChange={(e) => {
                  const file = e.currentTarget.files?.[0];
                  e.currentTarget.value = "";
                  void upload(file);
                }}
              />
            </div>
            <input
              type="url"
              placeholder="https://"
              aria-label={t("avatar")}
              value={value.avatar.startsWith("data:") ? "" : value.avatar}
              onChange={(e) => {
                setPortraitError("");
                patch("avatar", e.target.value);
              }}
            />
            <small>{t("portraitHint")}</small>
            {portraitError && (
              <small className="nk-help" role="alert">
                {portraitError in messages.en
                  ? t(portraitError as TextKey)
                  : t("operationFailed")}
              </small>
            )}
          </div>
          <div className="nk-grid">
            {(
              ["basicInfo", "personality", "scenario", "firstMessage"] as const
            ).map((key) => (
              <Field key={key} label={t(key)}>
                <textarea
                  value={value[key]}
                  onChange={(e) => patch(key, e.target.value)}
                />
              </Field>
            ))}
          </div>
          <Field label={t("exampleDialogues")}>
            <textarea
              rows={4}
              value={value.exampleDialogues}
              onChange={(e) => patch("exampleDialogues", e.target.value)}
            />
          </Field>
          <div className="nk-grid">
            <Field label={t("responseFormat")}>
              <textarea
                value={value.responseFormat}
                onChange={(e) => patch("responseFormat", e.target.value)}
              />
            </Field>
            <Field label={t("rules")}>
              <textarea
                value={value.rules.join("\n")}
                onChange={(e) => patch("rules", e.target.value.split("\n"))}
              />
            </Field>
          </div>
          <Field label={t("systemPrompt")}>
            <textarea
              rows={4}
              value={value.systemPrompt}
              onChange={(e) => patch("systemPrompt", e.target.value)}
            />
          </Field>
          <section className="nk-section">
            <h3>{t("linkedBooks")}</h3>
            <div className="nk-checks">
              {books.length ? (
                books.map((book) => (
                  <Check
                    key={book.id}
                    label={book.name}
                    checked={value.worldBookIds.includes(book.id)}
                    onChange={(v) =>
                      patch(
                        "worldBookIds",
                        v
                          ? [...value.worldBookIds, book.id]
                          : value.worldBookIds.filter((id) => id !== book.id),
                      )
                    }
                  />
                ))
              ) : (
                <span className="nk-help">{t("empty")}</span>
              )}
            </div>
          </section>
        </>
      )}
    </>
  );
}
export function BookEditor({
  value,
  onChange,
  t,
}: {
  value: WorldBook;
  onChange: (book: WorldBook) => void;
  t: Translate;
}) {
  const patchEntry = (index: number, key: string, data: unknown) =>
    onChange({
      ...value,
      entries: value.entries.map((entry, i) =>
        i === index ? { ...entry, [key]: data } : entry,
      ),
    });
  return (
    <>
      <Field label={t("name")}>
        <input
          required
          maxLength={200}
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
        />
      </Field>
      <Field label={t("descriptionField")}>
        <textarea
          rows={2}
          value={value.description}
          onChange={(e) => onChange({ ...value, description: e.target.value })}
        />
      </Field>
      <div className="nk-editor-top">
        <h3>
          {t("entries")} · {value.entries.length}
        </h3>
        <button
          type="button"
          onClick={() =>
            onChange({
              ...value,
              entries: [...value.entries, normalizeEntry({})],
            })
          }
        >
          + {t("addEntry")}
        </button>
      </div>
      {value.entries.map((entry, i) => (
        <details
          className="nk-entry"
          key={entry.id}
          open={value.entries.length === 1 || undefined}
        >
          <summary>
            {entry.comment || `${t("entry")} ${i + 1}`}
            {!entry.enabled ? ` · ${t("enabled")} ✕` : ""}
          </summary>
          <div className="nk-entry-body">
            <div className="nk-grid">
              <Field label={t("comment")}>
                <input
                  value={entry.comment}
                  onChange={(e) => patchEntry(i, "comment", e.target.value)}
                />
              </Field>
              <Field label={t("keys")} hint={t("separate")}>
                <ListInput
                  value={entry.keys}
                  onChange={(v) => patchEntry(i, "keys", v)}
                />
              </Field>
            </div>
            <Field label={t("content")}>
              <textarea
                rows={5}
                value={entry.content}
                onChange={(e) => patchEntry(i, "content", e.target.value)}
              />
            </Field>
            <div className="nk-grid">
              <Field label={t("priority")}>
                <input
                  type="number"
                  min={-10000}
                  max={10000}
                  value={entry.priority}
                  onChange={(e) =>
                    patchEntry(i, "priority", Number(e.target.value))
                  }
                />
              </Field>
              <Field label={t("position")}>
                <select
                  value={entry.position}
                  onChange={(e) => patchEntry(i, "position", e.target.value)}
                >
                  {(
                    [
                      "before_char",
                      "after_char",
                      "before_an",
                      "after_an",
                      ...(entry.position === "at_depth" ? ["at_depth"] : []),
                    ] as const
                  ).map((p) => (
                    <option key={p} value={p}>
                      {t(p as TextKey)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            {entry.position === "at_depth" && (
              <p role="alert" className="nk-help">
                {t("depthUnsupported")}
              </p>
            )}
            <div className="nk-checks">
              <Check
                label={t("enabled")}
                checked={entry.enabled}
                onChange={(v) => patchEntry(i, "enabled", v)}
              />
              <Check
                label={t("constant")}
                checked={entry.constant}
                onChange={(v) => patchEntry(i, "constant", v)}
              />
              <Check
                label={t("caseSensitive")}
                checked={entry.caseSensitive}
                onChange={(v) => patchEntry(i, "caseSensitive", v)}
              />
            </div>
            <div className="nk-entry-actions">
              <button
                type="button"
                className="nk-danger"
                onClick={() => {
                  if (confirm(t("confirmDelete")))
                    onChange({
                      ...value,
                      entries: value.entries.filter((_, index) => index !== i),
                    });
                }}
              >
                {t("remove")}
              </button>
            </div>
          </div>
        </details>
      ))}
    </>
  );
}
function SessionPanel({
  snapshot,
  api,
  perform,
  t,
  onDirty,
}: {
  snapshot: Snapshot;
  api: Api;
  perform: Perform;
  t: Translate;
  onDirty: (dirty: boolean) => void;
}) {
  const [binding, setBinding] = useState(snapshot.binding),
    [input, setInput] = useState(""),
    [preview, setPreview] = useState<any>(null),
    [opening, setOpening] = useState("");
  useEffect(() => setBinding(snapshot.binding), [snapshot.binding]);
  useEffect(() => {
    onDirty(
      binding.characterId !== snapshot.binding.characterId ||
        binding.userName !== snapshot.binding.userName ||
        binding.enabled !== snapshot.binding.enabled,
    );
    return () => onDirty(false);
  }, [binding, snapshot.binding, onDirty]);
  const selected = snapshot.characters.find(
    (c) => c.id === binding.characterId,
  );
  useEffect(() => {
    let live = true;
    setOpening("");
    if (binding.characterId)
      api({ action: "get", kind: "character", id: binding.characterId })
        .then((v) => {
          if (live) setOpening((v as Character).firstMessage);
        })
        .catch(() => {});
    return () => {
      live = false;
    };
  }, [binding.characterId, api]);
  return (
    <div className="nk-panel">
      <h2>{t("session")}</h2>
      <div className="nk-grid">
        <Field label={t("characters")}>
          <select
            value={binding.characterId}
            onChange={(e) =>
              setBinding({
                ...binding,
                characterId: e.target.value,
                enabled: !!e.target.value,
              })
            }
          >
            <option value="">{t("noCharacter")}</option>
            {snapshot.characters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("userName")}>
          <input
            maxLength={100}
            value={binding.userName}
            onChange={(e) =>
              setBinding({ ...binding, userName: e.target.value })
            }
          />
        </Field>
      </div>
      <Check
        label={t("roleplay")}
        checked={binding.enabled}
        onChange={(enabled) => setBinding({ ...binding, enabled })}
      />
      <p className="nk-help">{t("sessionHint")}</p>
      <button
        className="nk-primary"
        onClick={() =>
          perform(async () => {
            await api({ action: "bind", value: binding });
            setPreview(null);
          })
        }
      >
        {t("applySession")}
      </button>
      {selected && (
        <section className="nk-section">
          <h3>{selected.name}</h3>
          <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
            {selected.description}
          </p>
          {opening && (
            <>
              <h3>{t("opening")}</h3>
              <pre className="nk-preview">
                {opening
                  .replaceAll("{{char}}", selected.name)
                  .replaceAll("{{user}}", binding.userName || "{{user}}")}
              </pre>
            </>
          )}
        </section>
      )}
      <section className="nk-section">
        <h3>{t("preview")}</h3>
        <Field label={t("tryMessage")}>
          <textarea
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </Field>
        <button
          onClick={() =>
            perform(
              async () =>
                setPreview(
                  await api({ action: "preview", value: { latest: input } }),
                ),
              false,
            )
          }
        >
          {t("preview")}
        </button>
        {preview && (
          <>
            <h3 style={{ marginTop: 18 }}>{t("matches")}</h3>
            <div className="nk-chips">
              {preview.matches?.length ? (
                preview.matches.map((m: any) => (
                  <span className="nk-chip" key={`${m.bookId}:${m.entryId}`}>
                    {m.title}
                  </span>
                ))
              ) : (
                <span className="nk-help">{t("noMatches")}</span>
              )}
            </div>
            <pre className="nk-preview">{preview.prompt || t("noPrompt")}</pre>
          </>
        )}
      </section>
    </div>
  );
}
type Perform = (
  action: () => Promise<unknown>,
  refresh?: boolean,
) => Promise<void>;
function MemoryPanel({
  snapshot,
  api,
  perform,
  t,
  onDirty,
}: {
  snapshot: Snapshot;
  api: Api;
  perform: Perform;
  t: Translate;
  onDirty: (dirty: boolean) => void;
}) {
  const [content, setContent] = useState(""),
    [category, setCategory] = useState<Memory["category"]>("important_event"),
    [editing, setEditing] = useState<Memory | null>(null);
  useEffect(() => {
    onDirty(
      editing
        ? content !== editing.content || category !== editing.category
        : !!content.trim(),
    );
    return () => onDirty(false);
  }, [content, category, editing, onDirty]);
  const reset = () => {
    setEditing(null);
    setContent("");
    setCategory("important_event");
  };
  return (
    <div className="nk-panel">
      <h2>{t("memories")}</h2>
      <p className="nk-help">{t("memoryHint")}</p>
      {snapshot.binding.characterId ? (
        <>
          <Field label={t("category")}>
            <select
              value={category}
              onChange={(e) =>
                setCategory(e.target.value as Memory["category"])
              }
            >
              {(
                [
                  "user_persona",
                  "character_persona",
                  "important_event",
                ] as const
              ).map((k) => (
                <option key={k} value={k}>
                  {t(k)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("content")}>
            <textarea
              maxLength={10000}
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
          </Field>
          <button
            className="nk-primary"
            disabled={!content.trim()}
            onClick={() =>
              perform(async () => {
                await api({
                  action: "save",
                  kind: "memory",
                  id: editing?.id,
                  value: { content, category },
                });
                reset();
              })
            }
          >
            {t(editing ? "save" : "addMemory")}
          </button>
          {editing && <button onClick={reset}>{t("cancel")}</button>}
        </>
      ) : (
        <p>{t("chooseCharacter")}</p>
      )}
      {snapshot.memories.map((memory) => (
        <article className="nk-memory" key={memory.id}>
          <div className="nk-memory-head">
            <span>{t(memory.category)}</span>
            <button
              onClick={() => {
                if (
                  content.trim() &&
                  (content !== editing?.content ||
                    category !== editing?.category) &&
                  !confirm(t("discard"))
                )
                  return;
                setEditing(memory);
                setContent(memory.content);
                setCategory(memory.category);
              }}
            >
              {t("editor")}
            </button>
            <button
              onClick={() => {
                if (confirm(t("confirmDelete")))
                  void perform(async () => {
                    await api({
                      action: "delete",
                      kind: "memory",
                      id: memory.id,
                    });
                    if (editing?.id === memory.id) reset();
                  });
              }}
            >
              {t("remove")}
            </button>
          </div>
          <p>{memory.content}</p>
        </article>
      ))}
    </div>
  );
}
export function App({
  sessionId,
  api,
  t: hostT,
  initialTab = "characters",
  initialSelectionId = "",
  embedded = false,
  onGuard,
  onStart,
}: {
  sessionId: string;
  api: Api;
  t: Translate;
  initialTab?: TextKey;
  initialSelectionId?: string;
  embedded?: boolean;
  onGuard?: (guard: () => boolean) => void;
  onStart?: (id: string) => void;
}) {
  const [language, setLanguage] = useState(() => {
    try {
      return localStorage.getItem("nekobot.language") || "auto";
    } catch {
      return "auto";
    }
  });
  const t: Translate = (key) =>
    embedded || language === "auto"
      ? hostT(key)
      : (messages[language] || messages.en)[key];
  const [tab, setTab] = useState<TextKey>(initialTab),
    [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [selected, setSelected] = useState(""),
    [draft, setDraft] = useState<Character | WorldBook | null>(null),
    [baseline, setBaseline] = useState(""),
    [query, setQuery] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<TextKey | "">(""),
    [notice, setNotice] = useState<TextKey | "">(""),
    [notices, setNotices] = useState<TextKey[]>([]),
    [panelDirty, setPanelDirty] = useState(false);
  const upload = useRef<HTMLInputElement>(null),
    generation = useRef(0);
  const dirty =
    panelDirty || (draft !== null && JSON.stringify(draft) !== baseline);
  useEffect(() => {
    onGuard?.(() => !busy && (!dirty || confirm(t("discard"))));
    return () => onGuard?.(() => true);
  }, [dirty, busy, onGuard, language]);
  const refresh = async () => {
    const data = (await api({ action: "list" })) as Snapshot;
    setSnapshot(data);
  };
  const perform: Perform = async (action, reload = true) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      if (reload) await refresh();
      setNotice("saved");
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      setError(code in messages.en ? (code as TextKey) : "operationFailed");
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    const request = ++generation.current;
    setSnapshot(null);
    setDraft(null);
    setSelected("");
    setError("");
    api({ action: "list" })
      .then(async (v) => {
        if (request !== generation.current) return;
        setSnapshot(v as Snapshot);
        if (
          initialSelectionId &&
          (initialTab === "characters" || initialTab === "worldbooks")
        ) {
          const value = await api({
            action: "get",
            kind: initialTab === "characters" ? "character" : "worldbook",
            id: initialSelectionId,
          });
          if (request === generation.current) {
            setSelected(initialSelectionId);
            setDraft(value as Character | WorldBook);
            setBaseline(JSON.stringify(value));
          }
        }
      })
      .catch(() => {
        if (request === generation.current) setError("operationFailed");
      });
    return () => {
      generation.current++;
    };
  }, [sessionId, api, initialSelectionId, initialTab]);
  const discard = () => !dirty || confirm(t("discard"));
  const changeTab = (next: TextKey) => {
    if (next !== tab && discard()) {
      setTab(next);
      setPanelDirty(false);
      setDraft(null);
      setSelected("");
      setQuery("");
      setNotice("");
      setNotices([]);
    }
  };
  const select = async (id: string) => {
    if (!discard()) return;
    const kind = tab === "characters" ? "character" : "worldbook";
    await perform(async () => {
      const value = (await api({ action: "get", kind, id })) as
        Character | WorldBook;
      setSelected(id);
      setDraft(value);
      setBaseline(JSON.stringify(value));
    }, false);
  };
  const create = () => {
    if (!discard()) return;
    const value =
      tab === "characters"
        ? { ...normalizeCharacter({ name: "_" }), name: "" }
        : { ...normalizeWorldBook({ name: "_" }), name: "" };
    setSelected("");
    setDraft(value);
    setBaseline("");
    setNotice("");
  };
  const save = () =>
    perform(async () => {
      const value = (await api({
        action: "save",
        kind: tab === "characters" ? "character" : "worldbook",
        id: selected || undefined,
        value: draft,
      })) as Character | WorldBook;
      setDraft(value);
      setSelected(value.id);
      setBaseline(JSON.stringify(value));
    });
  const exportLibrary = () =>
    perform(async () => {
      const data = await api({ action: "export" });
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "nekobot-library.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, false);
  const importFile = (file: File) =>
    perform(async () => {
      if (file.size > 12_000_000) throw new Error("fileTooLarge");
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 8192)
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      const result = (await api({
        action: "import",
        data: btoa(binary),
        fileName: file.name,
      })) as { notices: { code: TextKey }[] };
      setNotices([...new Set(result.notices.map((n) => n.code))]);
    });
  const rows =
    (tab === "characters"
      ? snapshot?.characters
      : snapshot?.worldbooks
    )?.filter((item) =>
      `${item.name}\n${item.description}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    ) || [];
  return (
    <div className="neko" aria-busy={busy}>
      <style>{styles}</style>
      <header className="nk-head">
        <div className="nk-brand">
          <strong>{t("title")}</strong>
          <small>{t("description")}</small>
        </div>
        <div className="nk-actions">
          <select
            className="nk-language"
            aria-label={t("language")}
            value={language}
            onChange={(e) => {
              setLanguage(e.target.value);
              try {
                localStorage.setItem("nekobot.language", e.target.value);
              } catch {}
            }}
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
          <button disabled={busy} onClick={() => upload.current?.click()}>
            {t("import")}
          </button>
          <button disabled={busy || !snapshot} onClick={exportLibrary}>
            {t("export")}
          </button>
          <input
            hidden
            ref={upload}
            type="file"
            accept=".json,.png,.zip"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void importFile(file);
            }}
          />
        </div>
      </header>
      {!embedded && (
        <nav className="nk-nav" role="tablist" aria-label={t("title")}>
          {(
            [
              "characters",
              "worldbooks",
              "session",
              "memories",
              "settings",
            ] as const
          ).map((key) => (
            <button
              role="tab"
              aria-selected={tab === key}
              key={key}
              disabled={busy}
              onClick={() => changeTab(key)}
            >
              {t(key)}
            </button>
          ))}
        </nav>
      )}
      {error && (
        <div className="nk-status" role="alert">
          {t(error)}
        </div>
      )}
      {(notice || busy || notices.length > 0) && (
        <div className="nk-status" role="status">
          {busy ? t("saving") : notice ? t(notice) : ""}
          {notices.map((key) => (
            <div key={key}>{t(key)}</div>
          ))}
        </div>
      )}
      {!snapshot ? (
        <div className="nk-empty">
          {error ? (
            <button onClick={() => perform(refresh, false)}>
              {t("refresh")}
            </button>
          ) : (
            t("loading")
          )}
        </div>
      ) : (
        <>
          {(tab === "characters" || tab === "worldbooks") && (
            <div className="nk-work">
              <aside className="nk-library">
                <div className="nk-actions">
                  <input
                    aria-label={t("search")}
                    placeholder={t("search")}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <button disabled={busy} onClick={create}>
                    + {t("create")}
                  </button>
                </div>
                <div className="nk-list">
                  {rows.map((item) => (
                    <button
                      className="nk-item"
                      key={item.id}
                      aria-current={selected === item.id}
                      disabled={busy}
                      onClick={() => void select(item.id)}
                    >
                      {tab === "characters" ? (
                        <CharacterThumb
                          card={item as Character & { hasAvatar?: boolean }}
                          api={api}
                        />
                      ) : (
                        <span className="nk-initial" aria-hidden>
                          {item.name.slice(0, 1)}
                        </span>
                      )}
                      <span className="nk-item-copy">
                        <strong>{item.name}</strong>
                        <small>
                          {tab === "worldbooks"
                            ? `${(item as WorldBook).entries.length} ${t("entries")} · `
                            : ""}
                          {item.description}
                        </small>
                      </span>
                    </button>
                  ))}
                  {!rows.length && <div className="nk-empty">{t("empty")}</div>}
                </div>
              </aside>
              <main className="nk-detail">
                {draft ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void save();
                    }}
                  >
                    <div className="nk-editor-top">
                      <div>
                        <h2>
                          {draft.name || t("create")}
                          {dirty && (
                            <span className="nk-unsaved">{t("unsaved")}</span>
                          )}
                        </h2>
                      </div>
                      <div className="nk-actions">
                        {selected && (
                          <button
                            type="button"
                            disabled={busy}
                            className="nk-danger"
                            onClick={() => {
                              if (confirm(t("confirmDelete")))
                                void perform(async () => {
                                  await api({
                                    action: "delete",
                                    kind:
                                      tab === "characters"
                                        ? "character"
                                        : "worldbook",
                                    id: selected,
                                  });
                                  setDraft(null);
                                  setSelected("");
                                });
                            }}
                          >
                            {t("remove")}
                          </button>
                        )}
                        {onStart && tab === "characters" && selected && (
                          <button
                            type="button"
                            disabled={busy || dirty}
                            onClick={() => onStart(selected)}
                          >
                            {t("startChat")}
                          </button>
                        )}
                        <button
                          type="submit"
                          className="nk-primary"
                          disabled={busy || !dirty}
                        >
                          {t("save")}
                        </button>
                      </div>
                    </div>
                    {tab === "characters" ? (
                      <CharacterEditor
                        key={`c:${selected}`}
                        value={draft as Character}
                        onChange={setDraft}
                        books={snapshot.worldbooks}
                        t={t}
                      />
                    ) : (
                      <BookEditor
                        key={`b:${selected}`}
                        value={draft as WorldBook}
                        onChange={setDraft}
                        t={t}
                      />
                    )}
                  </form>
                ) : (
                  <div className="nk-empty">{t("selectItem")}</div>
                )}
              </main>
            </div>
          )}
          {tab === "session" && (
            <SessionPanel
              key={sessionId}
              snapshot={snapshot}
              api={api}
              perform={perform}
              t={t}
              onDirty={setPanelDirty}
            />
          )}
          {tab === "memories" && (
            <MemoryPanel
              key={sessionId}
              snapshot={snapshot}
              api={api}
              perform={perform}
              t={t}
              onDirty={setPanelDirty}
            />
          )}
          {tab === "settings" && (
            <SettingsPanel
              settings={snapshot.settings}
              api={api}
              perform={perform}
              t={t}
              onDirty={setPanelDirty}
            />
          )}
        </>
      )}
    </div>
  );
}
function SettingsPanel({
  settings,
  api,
  perform,
  t,
  onDirty,
}: {
  settings: Settings;
  api: Api;
  perform: Perform;
  t: Translate;
  onDirty: (dirty: boolean) => void;
}) {
  const [value, setValue] = useState(settings);
  useEffect(() => setValue(settings), [settings]);
  useEffect(() => {
    onDirty(
      value.maxWorldChars !== settings.maxWorldChars ||
        value.recentMessages !== settings.recentMessages,
    );
    return () => onDirty(false);
  }, [value, settings, onDirty]);
  return (
    <form
      className="nk-panel"
      onSubmit={(e) => {
        e.preventDefault();
        void perform(() => api({ action: "settings", value }));
      }}
    >
      <h2>{t("settings")}</h2>
      <div className="nk-grid">
        <Field label={t("maxWorldChars")}>
          <input
            type="number"
            required
            min={500}
            max={24000}
            value={value.maxWorldChars}
            onChange={(e) =>
              setValue({ ...value, maxWorldChars: Number(e.target.value) })
            }
          />
        </Field>
        <Field label={t("recentMessages")}>
          <input
            type="number"
            required
            min={0}
            max={30}
            value={value.recentMessages}
            onChange={(e) =>
              setValue({ ...value, recentMessages: Number(e.target.value) })
            }
          />
        </Field>
      </div>
      <button className="nk-primary" type="submit">
        {t("save")}
      </button>
    </form>
  );
}
