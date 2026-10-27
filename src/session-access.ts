import { ApiError } from "./api.ts";

declare module "@deepseek-ai/dsh-api-session-controller/client" {
  interface SessionReferenceSourceMap {
    nekobot: unknown;
  }
}

interface Catalog {
  list: {
    getSnapshot(): { byId: Record<string, unknown> };
    subscribe(listener: () => void): () => void;
  };
  refresh(): Promise<unknown> | unknown;
}

// Host 新建成功与 Client catalog 发布是两个边界；retain 只能使用已发布的身份。
export async function waitForListedSession(
  catalog: Catalog,
  id: string,
  signal?: AbortSignal,
  timeoutMs = 15_000,
): Promise<void> {
  signal?.throwIfAborted();
  if (catalog.list.getSnapshot().byId[id] !== undefined) return;
  await new Promise<void>((resolve, reject) => {
    let done = false;
    let unsubscribe = () => {};
    const finish = (error?: unknown) => {
      if (done) return;
      done = true;
      unsubscribe();
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve();
    };
    const abort = () =>
      finish(signal?.reason || new ApiError("sessionUnavailable"));
    const check = () => {
      if (catalog.list.getSnapshot().byId[id] !== undefined) finish();
    };
    const timer = setTimeout(
      () => finish(new ApiError("sessionUnavailable")),
      timeoutMs,
    );
    unsubscribe = catalog.list.subscribe(check);
    signal?.addEventListener("abort", abort, { once: true });
    check();
    if (!done)
      Promise.resolve()
        .then(() => catalog.refresh())
        .then(check, finish);
  });
}
