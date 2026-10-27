import type { Operation, Reply } from "./types.ts";

export class ApiError extends Error {
  constructor(
    public code: string,
    public detail = "",
  ) {
    super(code);
  }
}
// DSH Remote 层与业务层各有一个结果信封，必须分别验证。
export function readCommandResult(remote: any): unknown {
  if (remote?.ok !== true)
    throw new ApiError(
      "operationFailed",
      remote?.error?.code || "remote-invalid",
    );
  const result = remote.value?.result;
  if (result?.kind !== "success" || typeof result.text !== "string")
    throw new ApiError("operationFailed", "command-invalid");
  let reply: Reply;
  try {
    reply = JSON.parse(result.text);
  } catch {
    throw new ApiError("operationFailed", "reply-invalid");
  }
  if (!reply.ok) throw new ApiError(reply.error || "operationFailed");
  return reply.data;
}
export function createApi(
  sessionId: () => string,
  request: typeof fetch = fetch,
) {
  return async (operation: Operation): Promise<any> => {
    let response: Response;
    try {
      response = await request("api/nekobot", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation, sessionId: sessionId() }),
      });
    } catch {
      throw new ApiError("connectionFailed");
    }
    if (response.status === 401 || response.status === 403)
      throw new ApiError("accessDenied");
    if (!response.ok)
      throw new ApiError("operationFailed", `HTTP ${response.status}`);
    let reply: Reply;
    try {
      reply = await response.json();
    } catch {
      throw new ApiError("operationFailed", "reply-invalid");
    }
    if (!reply?.ok) throw new ApiError(reply?.error || "operationFailed");
    return reply.data;
  };
}
