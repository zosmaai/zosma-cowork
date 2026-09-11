import { homedir } from "node:os";
import { join, normalize } from "node:path";

// Local mirror of @earendil-works/pi-coding-agent getAgentDir():
// PI_CODING_AGENT_DIR env var (tilde-expanded), else ~/.pi/agent.
export function agentDir(): string {
  const envDir = process.env.PI_CODING_AGENT_DIR;
  if (envDir) {
    if (envDir === "~") return homedir();
    if (envDir.startsWith("~/")) return join(homedir(), envDir.slice(2));
    return normalize(envDir);
  }
  return join(homedir(), ".pi", "agent");
}
