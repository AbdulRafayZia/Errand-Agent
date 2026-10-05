// Confirms that the person at the Mac approves something, using Touch ID or the
// Mac login password. Used before a new phone is trusted.

import { existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./config";

const SOURCE = join(import.meta.dir, "..", "native", "mac-auth.swift");
// Named "Errand" because macOS shows it in the prompt: "Errand is trying to …".
const BINARY = join(DATA_DIR, "bin", "Errand");
const TIMEOUT_MS = 2 * 60 * 1000;

let building: Promise<boolean> | undefined;

/** Compiles the Touch ID helper once (takes ~30s the first time); later calls are instant. */
export function prepareOwnerAuth(): Promise<boolean> {
  building ??= (async () => {
    if (existsSync(BINARY) && statSync(BINARY).mtimeMs >= statSync(SOURCE).mtimeMs) return true;
    mkdirSync(join(DATA_DIR, "bin"), { recursive: true });
    const proc = Bun.spawn(["swiftc", "-O", SOURCE, "-o", BINARY], { stdout: "ignore", stderr: "pipe" });
    const code = await proc.exited;
    return code === 0;
  })();
  return building;
}

async function runWithTimeout(cmd: string[]): Promise<{ code: number; stderr: string }> {
  const proc = Bun.spawn(cmd, { stdout: "ignore", stderr: "pipe" });
  const timer = setTimeout(() => proc.kill(), TIMEOUT_MS);
  const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
  clearTimeout(timer);
  return { code, stderr };
}

/**
 * Shows the macOS Touch ID / password prompt. `reason` completes the sentence
 * "Errand is trying to …". Resolves true only if the owner authenticated.
 */
export async function confirmOwner(reason: string): Promise<boolean> {
  if (await prepareOwnerAuth()) {
    const result = await runWithTimeout([BINARY, reason]);
    if (result.code === 0) return true;
    if (result.code === 1) return false;
    // 2 = no Touch ID and no password policy available; fall through to the password dialog.
  }
  // Fallback: the standard macOS administrator password dialog.
  const prompt = `Errand is trying to ${reason}`.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const result = await runWithTimeout([
    "osascript",
    "-e",
    `do shell script "true" with prompt "${prompt}" with administrator privileges`,
  ]);
  return result.code === 0;
}

export function notifyMac(title: string, message: string) {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  Bun.spawn(["osascript", "-e", `display notification "${esc(message)}" with title "${esc(title)}"`], {
    stdout: "ignore",
    stderr: "ignore",
  });
}
