import { NextResponse, type NextRequest } from "next/server";
import {
  isApiRequestAllowed,
  isApiRequestHostAllowed,
} from "@/lib/request-security";
import {
  isValidBasicAuthorization,
  isWebPasswordEnabled,
} from "@/lib/web-auth";
import { needsZosmaSession } from "@/lib/api-guard";
import {
  currentRouterKey,
  readSessionCookie,
  verifySessionToken,
} from "@/lib/zosma-auth/session";
import { agentDir } from "@/lib/agent-dir";

export function proxy(request: NextRequest) {
  const isApiRequest = request.nextUrl.pathname === "/api"
    || request.nextUrl.pathname.startsWith("/api/");
  const isTrustedRequest = isApiRequest
    ? isApiRequestAllowed(request)
    : isApiRequestHostAllowed(request);

  if (!isTrustedRequest) {
    if (!isApiRequest) {
      return new NextResponse("Untrusted request", { status: 403 });
    }
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  const password = process.env.PI_WEB_PASSWORD;
  const passwordEnabled = isWebPasswordEnabled(password);
  const basicAuthenticated = passwordEnabled
    && isValidBasicAuthorization(request.headers.get("authorization"), password);
  if (passwordEnabled && !basicAuthenticated) {
    return new NextResponse("Authentication required", {
      status: 401,
      headers: {
        "Cache-Control": "no-store",
        "WWW-Authenticate": 'Basic realm="Pi Web", charset="UTF-8"',
      },
    });
  }

  // Server-side sign-in boundary: the OAuth callback hands the browser a
  // session cookie; without one the app's API is closed. The onboarding
  // routes stay open or nobody could ever sign in, and Basic-auth callers
  // (scripts, remote clients) are already authenticated.
  if (isApiRequest && !basicAuthenticated) {
    // ponytail: re-reads models.json on every API request (sync, small file).
    // Add a short TTL cache if API throughput ever makes this show up.
    const apiKey = currentRouterKey(agentDir());
    const hasValidSession = verifySessionToken(
      readSessionCookie(request.headers.get("cookie")),
      apiKey,
    );
    if (needsZosmaSession({ pathname: request.nextUrl.pathname, hasValidSession })) {
      return NextResponse.json({ error: "Sign in with Zosma to continue" }, {
        status: 401,
        headers: { "Cache-Control": "no-store" },
      });
    }
  }

  return NextResponse.next();
}

export const config = { matcher: ["/", "/api/:path*"] };
