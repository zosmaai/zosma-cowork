import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Test wrapper that points PI_CODING_AGENT_DIR at a fresh temp dir.
 * getAgentDir() (pi-coding-agent) reads the env var at call time.
 * Usage: test("...", withAgentDir(async (dir, t) => { ... }));
 */
export function withAgentDir(run) {
  return async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "zosma-route-"));
    const prev = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = dir;
    t.after(async () => {
      if (prev === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = prev;
      await rm(dir, { recursive: true, force: true });
    });
    await run(dir, t);
  };
}
