import { readFileSync } from "node:fs";
import vm from "node:vm";
import React from "react";

export function clientRuntime(request: typeof fetch = fetch) {
  let registration: any;
  let catalog: Record<string, unknown> = {};
  const catalogListeners = new Set<() => void>();
  const refreshCatalog = async () => {
    const result = await request("api/nekobot", {
      method: "POST",
      body: JSON.stringify({ operation: { action: "list" }, sessionId: "" }),
    });
    const reply = await result.json();
    catalog = Object.fromEntries(
      (reply.data.sessions || []).map((row: any) => [row.id, row]),
    );
    for (const listener of catalogListeners) listener();
  };
  const sandbox: any = {
    window: {
      __ModuleLoader__: {
        load: (value: any) => {
          registration = value;
        },
      },
    },
    crypto,
    structuredClone,
    TextDecoder,
    TextEncoder,
    atob,
    btoa,
    Uint8Array,
    DataView,
    console,
    fetch: request,
    Response,
    FileReader: globalThis.FileReader,
    AbortController,
    setTimeout,
    clearTimeout,
    confirm: () => true,
  };
  vm.runInNewContext(
    readFileSync(new URL("../dist/client.js", import.meta.url), "utf8"),
    sandbox,
  );
  const plugin = registration.factory((id: string) => {
    if (id !== "react") throw new Error("Unexpected module: " + id);
    return React;
  });
  const owned: (() => void)[] = [],
    entries: any[] = [],
    dictionaries: any[] = [],
    changes = new Set<() => void>();
  let panel = { activePanelId: null as string | null };
  const register = (options: any, component: any) => {
    const entry = { options, component };
    entries.push(entry);
    return () => {
      const index = entries.indexOf(entry);
      if (index >= 0) entries.splice(index, 1);
    };
  };
  const selectPanel = (id: string | null) => {
    panel = { activePanelId: id };
    for (const listener of [...changes]) listener();
  };
  const context = {
    effect: (fn: () => (() => void) | void) => {
      const dispose = fn();
      if (typeof dispose === "function") owned.push(dispose);
    },
    locale: {
      register: (...args: any[]) => {
        dictionaries.push(args);
        return () => {};
      },
      bind: () => (key: string) => dictionaries[0]?.[1]?.zh?.[key] || key,
    },
    layout: {
      selectPanel,
      panelInfo: {
        getSnapshot: () => panel,
        subscribe: (listener: () => void) => {
          changes.add(listener);
          return () => changes.delete(listener);
        },
      },
    },
    uiWorkspace: { openSession: async (_id: string) => {} },
    sessions: {
      list: {
        getSnapshot: () => ({ byId: catalog }),
        subscribe: (listener: () => void) => {
          catalogListeners.add(listener);
          return () => catalogListeners.delete(listener);
        },
      },
      refresh: refreshCatalog,
      retain: (id: string) => {
        if (!catalog[id]) throw new Error("sessions.retain: unknown session");
        const binding = { sessionId: id };
        return {
          sessionId: id,
          binding,
          ready: Promise.resolve(binding),
          release: () => {},
        };
      },
    },
    slots: {
      inject: (_name: string, fn: () => () => void) => {
        const dispose = fn();
        owned.push(dispose);
        return dispose;
      },
      register,
      entries: (name: string) =>
        entries.filter((entry) => entry.options.name === name),
    },
  };
  plugin.apply(context);
  return {
    registration,
    entries,
    dictionaries,
    sandbox,
    context,
    selectPanel,
    dispose: () => {
      for (const dispose of owned.reverse()) dispose();
    },
  };
}
