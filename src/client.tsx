import React, { useEffect, useState, useSyncExternalStore } from "react";
import type { SessionReference } from "@deepseek-ai/dsh-api-session-controller/client";
import { waitForListedSession } from "./session-access.ts";
import {
  Workspace,
  WorkspaceSidebar,
  ConversationOpening,
} from "./workspace.tsx";
import { WorkspaceController } from "./workspace-controller.ts";
import { messages, type Translate } from "./locales.ts";

const plugin = {
  inject: ["slots", "locale", "layout", "sessions", "uiWorkspace"],
  apply(ctx: any) {
    ctx.effect(() =>
      ctx.locale.register("nekobot", { zh: messages.zh, en: messages.en }),
    );
    for (const locale of ["zh-tw", "ja", "ko"])
      ctx.effect(() =>
        ctx.locale.register("nekobot", locale, messages[locale]),
      );
    const t: Translate = ctx.locale.bind("nekobot");
    let storage: Storage | undefined;
    try {
      storage = globalThis.localStorage;
    } catch {}
    const controller = new WorkspaceController(
      {
        openSession: async (id) => {
          await waitForListedSession(ctx.sessions, id);
          ctx.uiWorkspace.openSession(id);
        },
        show: () => {
          if (ctx.layout.panelInfo.getSnapshot().activePanelId !== "nekobot")
            ctx.layout.selectPanel("nekobot");
        },
        leave: () => ctx.layout.selectPanel(null),
      },
      globalThis.fetch,
      storage,
    );
    ctx.effect(() => () => controller.dispose());
    const SessionArea = ({ id, renderSlot, SessionProvider }: any) => {
      const [reference, setReference] = useState<SessionReference | null>(null);
      const [failed, setFailed] = useState("");
      useEffect(() => {
        const abort = new AbortController();
        let retained: SessionReference | undefined;
        setFailed("");
        void waitForListedSession(ctx.sessions, id, abort.signal)
          .then(() => {
            if (abort.signal.aborted) return;
            retained = ctx.sessions.retain(id, {
              source: "nekobot",
              signal: abort.signal,
            });
            setReference(retained!);
            return retained!.ready;
          })
          .catch((error) => {
            if (!abort.signal.aborted)
              setFailed(String(error?.message || error));
          });
        return () => {
          abort.abort();
          retained?.release();
        };
      }, [id]);
      if (failed)
        return (
          <div role="alert" className="nkw-error">
            {t("sessionUnavailable")}
            <details>
              <summary>{t("details")}</summary>
              <pre>{failed}</pre>
            </details>
          </div>
        );
      if (!reference || reference.sessionId !== id)
        return (
          <div role="status" className="nkw-empty">
            {t("loading")}
          </div>
        );
      return (
        <SessionProvider session={reference}>
          {renderSlot("nekobot.chat", {})}
        </SessionProvider>
      );
    };
    const Main = ({ renderSlot, SessionProvider }: any) => (
      <Workspace
        controller={controller}
        t={t}
        renderChat={(id) => (
          <SessionArea
            key={id}
            id={id}
            renderSlot={renderSlot}
            SessionProvider={SessionProvider}
          />
        )}
      />
    );
    const ChatViews = ({ useSession, renderSlot }: any) => {
      const blank = useSession((snapshot: any) => snapshot?.blank === true);
      const state = useSyncExternalStore(
        controller.subscribe,
        controller.getSnapshot,
      );
      const translate: Translate = (key) =>
        state.language === "auto"
          ? t(key)
          : (messages[state.language] || messages.en)[key];
      return (
        <>
          {blank && (
            <div className="nkw-chat-views" data-nekobot-messages="">
              <ConversationOpening controller={controller} t={translate} />
            </div>
          )}
          {renderSlot("conversation.session", {})}
        </>
      );
    };
    const NativeChat = ({ renderFactorySlot }: any) => (
      <div className="nkw-chat-frame">
        {renderFactorySlot(
          "conversation.content",
          {
            variant: "embedded",
            phase: "active",
            hero: false,
          },
          { slots: { views: ChatViews } },
        )}
      </div>
    );
    const Sidebar = ({ wide = true }: { wide?: boolean }) => (
      <WorkspaceSidebar controller={controller} t={t} wide={wide} />
    );
    const Brand = () => (
      <span style={{ fontSize: 15, fontWeight: 600 }}>Nekobot</span>
    );
    const Mark = ({ size = 24 }: { size?: number }) => (
      <span
        aria-hidden
        style={{
          display: "inline-grid",
          placeItems: "center",
          width: size,
          height: size,
          fontSize: size * 0.65,
          fontWeight: 650,
        }}
      >
        N
      </span>
    );
    ctx.slots.inject("main", () =>
      ctx.slots.register(
        {
          name: "main",
          key: "nekobot",
          locale: "nekobot",
          children: { "nekobot.chat": { kind: "single", scope: "session" } },
        },
        Main,
      ),
    );
    ctx.slots.inject("nekobot.chat", () =>
      ctx.slots.register({ name: "nekobot.chat" }, NativeChat),
    );
    ctx.slots.inject("sidebar.panellist", () =>
      ctx.slots.register(
        {
          name: "sidebar.panellist",
          id: "nekobot",
          order: 5,
          locale: "nekobot",
          label: () => t("title"),
        },
        Mark,
      ),
    );
    ctx.effect(() => {
      let release: (() => void)[] = [];
      const sync = () => {
        const active =
          ctx.layout.panelInfo.getSnapshot().activePanelId === "nekobot";
        if (active && !release.length) {
          const shadow = (name: string, component: any) =>
            ctx.slots.inject(name, () => {
              const priority = Math.min(
                -100,
                ...ctx.slots
                  .entries(name)
                  .map((entry: any) => (entry.options.priority ?? 0) - 1),
              );
              return ctx.slots.register(
                { name, priority, locale: "nekobot" },
                component,
              );
            });
          release = [
            shadow("sidebar.workspaces", Sidebar),
            shadow("sidebar.brand.name", Brand),
            shadow("sidebar.brand.mark", Mark),
          ];
        } else if (!active && release.length) {
          for (const dispose of release.reverse()) dispose();
          release = [];
        }
      };
      const stop = ctx.layout.panelInfo.subscribe(sync);
      sync();
      return () => {
        stop();
        for (const dispose of release.reverse()) dispose();
      };
    });
  },
};
export default plugin;
