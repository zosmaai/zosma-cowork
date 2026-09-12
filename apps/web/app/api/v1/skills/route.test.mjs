import assert from "node:assert/strict";
import test from "node:test";
import { createV1Jiti, stubDaemon } from "../test-helper.mjs";

const jiti = createV1Jiti();
const { GET } = await jiti.import(new URL("./route.ts", import.meta.url).href);

test("GET /api/v1/skills relays to the daemon and returns installed skills under { data }", async (t) => {
  const seen = [];
  const restore = stubDaemon([
    (body) => {
      seen.push(body);
      return {
        body: {
          ok: true,
          data: {
            skills: [{ name: "a", description: "d", filePath: "/x", baseDir: "/y", disableModelInvocation: false, sourceInfo: {} }],
            diagnostics: [],
            projectResourcesLoaded: true,
          },
        },
      };
    },
  ]);
  t.after(restore);
  const res = await GET(new Request("http://localhost/api/v1/skills"));
  assert.equal(res.status, 200);
  assert.deepEqual(seen, [{ type: "read:skills-list" }]);
  const body = await res.json();
  assert.equal(body.error, undefined);
  assert.deepEqual(body.data.skills, [
    { name: "a", description: "d", filePath: "/x", baseDir: "/y", disableModelInvocation: false, sourceInfo: {} },
  ]);
  assert.equal(body.data.projectResourcesLoaded, true);
});
