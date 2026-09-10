import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { createV1Jiti } from "./test-helper.mjs";

// ZOS-81: end-to-end wire round-trip.
//
// Exercises pi-backend facade -> /api/v1 route -> web/lib/api-v1-client parse
// for real (no hand-built fixtures): the route produces the wire Response, the
// client's apiFetch consumes it, and the client's model must match the facade
// output. Covers both the success and the BackendError -> ApiV1Error path.
//
// The route + BackendError go through one jiti with moduleCache ON so the
// facade stub's BackendError is the exact class the route's isBackendError
// checks (see api-envelope.test.mjs for the same constraint).
const EMPTY_SERVER_ONLY = new URL("./empty-server-only.mjs", import.meta.url).href;
const routeJiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd(), "server-only": EMPTY_SERVER_ONLY },
  interopDefault: true,
  moduleCache: true,
});

const { GET: skillsGET } = await routeJiti.import(new URL("./skills/route.ts", import.meta.url).href);
const { BackendError } = await routeJiti.import(new URL("../../../packages/pi-backend/errors.ts", import.meta.url).href);

const clientJiti = createV1Jiti();
const { listSkills, ApiV1Error } = await clientJiti.import(new URL("../../../lib/api-v1-client.ts", import.meta.url).href);

let originalFacade;
let originalFetch;
function useFacade(fn) {
  originalFacade = globalThis.__piBackend;
  globalThis.__piBackend = { listSkills: fn };
}

test("round-trip success: facade output -> route Response -> client model", async () => {
  const data = { skills: [{ name: "acme/tool", description: "a tool" }], diagnostics: [], projectResourcesLoaded: true };
  useFacade(async () => data);
  try {
    const res = await skillsGET(new Request("http://localhost/api/v1/skills"));
    assert.equal(res.status, 200);
    const wire = res.clone(); // client consumes a fresh body
    assert.deepEqual(await res.json(), { data }); // route wrapped the facade output
    originalFetch = globalThis.fetch;
    globalThis.fetch = async () => wire; // identity: route output becomes client fetch
    const parsed = await listSkills();
    assert.deepEqual(parsed, data); // client parsed route output identically
  } finally {
    globalThis.__piBackend = originalFacade;
    globalThis.fetch = originalFetch;
  }
});

test("round-trip error: facade BackendError -> api-envelope -> ApiV1Error", async () => {
  useFacade(async () => { throw new BackendError("access_denied", "no access"); });
  try {
    const res = await skillsGET(new Request("http://localhost/api/v1/skills"));
    assert.equal(res.status, 403);
    const wire = res.clone(); // client consumes a fresh body
    assert.deepEqual(await res.json(), { error: { code: "access_denied", message: "no access" } });
    originalFetch = globalThis.fetch;
    globalThis.fetch = async () => wire;
    await assert.rejects(
      () => listSkills(),
      (e) => e instanceof ApiV1Error && e.status === 403 && e.code === "access_denied",
    );
  } finally {
    globalThis.__piBackend = originalFacade;
    globalThis.fetch = originalFetch;
  }
});
