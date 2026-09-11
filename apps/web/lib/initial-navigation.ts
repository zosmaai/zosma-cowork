export interface ZosmaUrlNotice {
  status: "success" | "error";
  message?: string;
  models?: number;
}

export interface InitialNavigation {
  requestedCwd: string | null;
  sessionId: string | null;
  /** One-shot Zosma Router sign-in result, delivered by the callback
   *  redirect (GET /api/auth/zosma/callback → /?zosma=success|error). */
  zosmaNotice: ZosmaUrlNotice | null;
}

export function getInitialNavigation(searchParams: Pick<URLSearchParams, "get">): InitialNavigation {
  const requestedCwd = searchParams.get("cwd")?.trim() || null;

  const zosma = searchParams.get("zosma");
  let zosmaNotice: ZosmaUrlNotice | null = null;
  if (zosma === "success" || zosma === "error") {
    zosmaNotice = { status: zosma };
    const message = searchParams.get("message");
    if (message) zosmaNotice.message = message;
    const models = Number.parseInt(searchParams.get("models") ?? "", 10);
    if (Number.isFinite(models) && models > 0) zosmaNotice.models = models;
  }

  return {
    requestedCwd,
    sessionId: requestedCwd ? null : searchParams.get("session"),
    zosmaNotice,
  };
}
