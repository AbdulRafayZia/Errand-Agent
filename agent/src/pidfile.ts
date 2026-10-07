// Makes sure only one agent runs at a time. Two agents would share the Mac's
// identity and keep kicking each other off the relay.

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./config";

const PID_FILE = join(DATA_DIR, "agent.pid");

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** The pid of a running agent other than this process, if any. */
export function runningAgentPid(): number | undefined {
  if (!existsSync(PID_FILE)) return undefined;
  const pid = Number(readFileSync(PID_FILE, "utf8").trim());
  if (!pid || pid === process.pid || !alive(pid)) return undefined;
  return pid;
}

export function claimPidFile() {
  writeFileSync(PID_FILE, String(process.pid));
  const release = () => {
    try {
      if (readFileSync(PID_FILE, "utf8").trim() === String(process.pid)) unlinkSync(PID_FILE);
    } catch {
      // Already gone.
    }
  };
  process.on("exit", release);
}
