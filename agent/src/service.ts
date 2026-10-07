// Runs the agent as a macOS LaunchAgent: starts at login, restarts if it crashes,
// and needs no terminal. Usage: bun src/service.ts <install|uninstall|start|stop|restart|status|logs>

import { existsSync, mkdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { DATA_DIR, loadConfig } from "./config";
import { runningAgentPid } from "./pidfile";

const LABEL = "com.errand.agent";
const PLIST = join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const LOG_DIR = join(DATA_DIR, "logs");
const LOG = join(LOG_DIR, "agent.log");
const AGENT_DIR = resolve(import.meta.dir, "..");
const DOMAIN = `gui/${process.getuid!()}`;

function launchctl(...args: string[]) {
  const result = Bun.spawnSync(["launchctl", ...args], { stdout: "pipe", stderr: "pipe" });
  return { ok: result.exitCode === 0, out: `${result.stdout}${result.stderr}`.trim() };
}

function xml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function isLoaded(): boolean {
  return launchctl("print", `${DOMAIN}/${LABEL}`).ok;
}

function rotateLog() {
  if (existsSync(LOG) && statSync(LOG).size > 5 * 1024 * 1024) renameSync(LOG, `${LOG}.1`);
}

function writePlist() {
  mkdirSync(LOG_DIR, { recursive: true });
  mkdirSync(join(homedir(), "Library", "LaunchAgents"), { recursive: true });
  const bun = process.execPath;
  const path = [join(homedir(), ".bun", "bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(":");
  const env: Record<string, string> = { PATH: path, HOME: homedir() };
  if (process.env.ERRAND_HOME) env.ERRAND_HOME = process.env.ERRAND_HOME;
  const envXml = Object.entries(env)
    .map(([k, v]) => `      <key>${xml(k)}</key><string>${xml(v)}</string>`)
    .join("\n");

  writeFileSync(
    PLIST,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key><string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
      <string>${xml(bun)}</string>
      <string>${xml(join(AGENT_DIR, "src", "main.ts"))}</string>
      <string>--service</string>
    </array>
    <key>WorkingDirectory</key><string>${xml(AGENT_DIR)}</string>
    <key>EnvironmentVariables</key>
    <dict>
${envXml}
    </dict>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>ThrottleInterval</key><integer>10</integer>
    <key>ProcessType</key><string>Interactive</string>
    <key>StandardOutPath</key><string>${xml(LOG)}</string>
    <key>StandardErrorPath</key><string>${xml(LOG)}</string>
  </dict>
</plist>
`,
  );
}

function start() {
  rotateLog();
  if (isLoaded()) return launchctl("kickstart", `${DOMAIN}/${LABEL}`);
  return launchctl("bootstrap", DOMAIN, PLIST);
}

async function waitForPid(ms = 8000): Promise<number | undefined> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const pid = runningAgentPid();
    if (pid) return pid;
    await Bun.sleep(300);
  }
  return undefined;
}

async function tailLog(lines: number): Promise<string> {
  if (!existsSync(LOG)) return "(no log yet)";
  const text = await Bun.file(LOG).text();
  return text.trimEnd().split("\n").slice(-lines).join("\n");
}

const command = process.argv[2];

switch (command) {
  case "install": {
    const foreground = runningAgentPid();
    if (foreground) {
      console.log(`An Errand agent is already running in a terminal (pid ${foreground}). Stop it with Ctrl+C, then run this again.`);
      process.exit(1);
    }
    loadConfig(); // creates keys and settings on a fresh Mac
    if (isLoaded()) launchctl("bootout", `${DOMAIN}/${LABEL}`);
    writePlist();
    const result = start();
    if (!result.ok) {
      console.log(`Couldn't start the background service:\n${result.out}`);
      process.exit(1);
    }
    const pid = await waitForPid();
    console.log(pid ? `Errand is running in the background (pid ${pid}).` : "Errand was installed but hasn't started yet. Check `bun run logs`.");
    console.log("It starts automatically when you log in and restarts if it stops.");
    console.log("\nIf macOS asks whether \"bun\" may access your Documents, Desktop or Downloads, or control Mail, click Allow.");
    console.log("Pair a phone with `bun run pair`. See it work with `bun run logs`.");
    break;
  }
  case "uninstall": {
    if (isLoaded()) launchctl("bootout", `${DOMAIN}/${LABEL}`);
    if (existsSync(PLIST)) unlinkSync(PLIST);
    console.log("Errand's background service is removed. Your pairing and settings in ~/.errand are kept.");
    break;
  }
  case "start": {
    if (!existsSync(PLIST)) {
      console.log("The background service isn't installed. Run `bun run install-service` first.");
      process.exit(1);
    }
    const result = start();
    const pid = await waitForPid();
    console.log(pid ? `Errand is running (pid ${pid}).` : `Couldn't confirm it started.${result.out ? `\n${result.out}` : ""}`);
    break;
  }
  case "stop": {
    if (!isLoaded()) {
      console.log("Errand's background service isn't running.");
      break;
    }
    launchctl("bootout", `${DOMAIN}/${LABEL}`);
    console.log("Errand stopped. It starts again at your next login, or now with `bun run start`.");
    break;
  }
  case "restart": {
    rotateLog();
    if (!isLoaded()) {
      start();
    } else {
      launchctl("kickstart", "-k", `${DOMAIN}/${LABEL}`);
    }
    const pid = await waitForPid();
    console.log(pid ? `Errand restarted (pid ${pid}).` : "Restart requested. Check `bun run logs`.");
    break;
  }
  case "status": {
    const pid = runningAgentPid();
    const config = loadConfig();
    const installed = existsSync(PLIST);
    console.log(`Agent:          ${pid ? `running (pid ${pid})${isLoaded() ? " in the background" : " in a terminal"}` : "not running"}`);
    console.log(`Start at login: ${installed ? "yes" : "no (run `bun run install-service`)"}`);
    console.log(`Relay:          ${config.relayUrl}`);
    console.log(`Paired phones:  ${config.phones.length} (${config.phones.filter((p) => p.push).length} with notifications)`);
    console.log(`Model:          ${config.model}`);
    console.log(`\nLast log lines:\n${await tailLog(8)}`);
    break;
  }
  case "logs": {
    if (!existsSync(LOG)) {
      console.log("No log yet. The background service writes to ~/.errand/logs/agent.log.");
      break;
    }
    console.log(`Following ${LOG} (Ctrl+C to stop)\n`);
    const tail = Bun.spawn(["tail", "-n", "40", "-f", LOG], { stdout: "inherit", stderr: "inherit" });
    await tail.exited;
    break;
  }
  default:
    console.log("Usage: bun src/service.ts <install|uninstall|start|stop|restart|status|logs>");
    process.exit(1);
}
