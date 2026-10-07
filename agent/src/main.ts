import qrcode from "qrcode-terminal";
import {
  b64uEncode,
  constantTimeEqual,
  deriveSessionKey,
  keyId,
  open,
  pairingCode,
  pairingProof,
  randomId,
  seal,
  wsUrl,
  type Frame,
  type MacStatus,
  type MacToPhone,
  type PairingPayload,
  type PhoneToMac,
  type PushPayload,
} from "@errand/protocol";
import { readdirSync, watchFile } from "node:fs";
import { CONFIG_PATH, loadConfig, readSavedConfig, saveConfig } from "./config";
import { claimPidFile, runningAgentPid } from "./pidfile";
import { batteryStatus } from "./mac-tools";
import { confirmOwner, notifyMac, prepareOwnerAuth } from "./owner-auth";
import { ensureVapidKeys, isValidSubscription, sendPush } from "./push";
import { TaskManager } from "./tasks";

const VERSION = "0.1.0";
const PAIRING_WINDOW_MS = 10 * 60 * 1000;

const args = new Set(process.argv.slice(2));
const config = loadConfig();
ensureVapidKeys(config);
const sessionKeys = new Map<string, Uint8Array>();
const onlinePhones = new Set<string>();
let socket: WebSocket | undefined;

function log(message: string) {
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  console.log(`[${time}] ${message}`);
}

// --- Pairing --------------------------------------------------------------

function showPairingCode() {
  config.pairSecret = randomId(16);
  config.pairSecretExpiresAt = Date.now() + PAIRING_WINDOW_MS;
  saveConfig(config);
  const payload: PairingPayload = {
    v: 1,
    u: config.relayUrl,
    r: config.roomId,
    k: config.mac.publicKey,
    s: config.pairSecret,
    m: config.macName,
  };
  const link = `${config.relayUrl}/#pair=${b64uEncode(new TextEncoder().encode(JSON.stringify(payload)))}`;
  console.log("\nScan this with your iPhone camera to pair (valid for 10 minutes):\n");
  qrcode.generate(link, { small: true });
  console.log(`\nOr open this link on your phone:\n${link}\n`);
}

function keyFor(kid: string): Uint8Array | undefined {
  let key = sessionKeys.get(kid);
  if (key) return key;
  const phone = config.phones.find((p) => p.kid === kid);
  if (!phone) return undefined;
  key = deriveSessionKey(config.mac.secretKey, phone.publicKey, config.roomId);
  sessionKeys.set(kid, key);
  return key;
}

let pendingPairKid: string | undefined;

function reject(kid: string, reason: string) {
  sendFrame({ t: "reject", to: kid, reason });
}

async function handleHello(frame: Extract<Frame, { t: "hello" }>) {
  if (keyId(frame.pub) !== frame.kid) return;
  if (config.phones.some((p) => p.kid === frame.kid)) {
    onlinePhones.add(frame.kid);
    return void sendState(frame.kid);
  }

  // The phone reconnected while its owner is still deciding on the Mac.
  if (pendingPairKid === frame.kid) {
    return sendToKey(frame.kid, frame.pub, { type: "pair.pending" });
  }
  if (!frame.proof) {
    return reject(frame.kid, "This phone isn't paired with this Mac anymore. Scan a new code to pair again.");
  }
  const windowOpen = !!config.pairSecret && (config.pairSecretExpiresAt ?? 0) > Date.now();
  if (!windowOpen) {
    return reject(frame.kid, "This pairing code has expired or was already used. On your Mac, run `bun run pair` to show a new one.");
  }
  if (!constantTimeEqual(frame.proof, pairingProof(config.pairSecret!, frame.pub))) {
    return reject(frame.kid, "That pairing code didn't match.");
  }
  if (pendingPairKid) {
    return reject(frame.kid, "Another phone is already waiting for approval on this Mac.");
  }

  // Use the code up now, so a photo or copy of the QR can't be tried again.
  config.pairSecret = undefined;
  config.pairSecretExpiresAt = undefined;
  saveConfig(config);
  pendingPairKid = frame.kid;

  const code = pairingCode(config.mac.publicKey, frame.pub, config.roomId);
  sendToKey(frame.kid, frame.pub, { type: "pair.pending" });
  console.log(`\nA phone wants to pair. Check it shows the code  ${code}  then approve with Touch ID or your password.\n`);

  const approved = await confirmOwner(`let a new phone control this Mac. Only approve if the phone shows ${code}`);
  pendingPairKid = undefined;
  if (!approved) {
    log("Pairing declined on the Mac.");
    return reject(frame.kid, "Pairing was declined on the Mac. Run `bun run pair` on the Mac to try again.");
  }

  const name = frame.name?.slice(0, 60) || "iPhone";
  config.phones.push({ kid: frame.kid, publicKey: frame.pub, name, pairedAt: Date.now() });
  saveConfig(config);
  log(`Paired with ${name}.`);
  notifyMac("Errand", `${name} can now control this Mac. Run "bun run devices" to review paired phones.`);
  sendTo(frame.kid, { type: "paired", macName: config.macName });
  onlinePhones.add(frame.kid);
  void sendState(frame.kid);
}

// --- Messaging ------------------------------------------------------------

function sendFrame(frame: Frame) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame));
}

/** For a phone that isn't trusted yet: encrypt to the key it presented. */
function sendToKey(kid: string, publicKey: string, message: MacToPhone) {
  const key = deriveSessionKey(config.mac.secretKey, publicKey, config.roomId);
  sendFrame({ t: "msg", from: config.macKid, to: kid, ...seal(key, message) });
}

function sendTo(kid: string, message: MacToPhone) {
  const key = keyFor(kid);
  if (!key) return;
  sendFrame({ t: "msg", from: config.macKid, to: kid, ...seal(key, message) });
}

function broadcast(message: MacToPhone) {
  for (const kid of onlinePhones) sendTo(kid, message);
}

async function macStatus(): Promise<MacStatus> {
  return {
    name: config.macName,
    paused: tasks.paused,
    busy: tasks.busy,
    battery: await batteryStatus(),
    allowedFolders: config.allowedFolders,
    model: config.model,
    version: VERSION,
    pushKey: config.vapid!.publicKey,
  };
}

async function sendState(kid: string) {
  const pushSubscribed = !!config.phones.find((p) => p.kid === kid)?.push;
  sendTo(kid, { type: "state", mac: await macStatus(), tasks: tasks.tasks.slice(0, 50), approvals: tasks.approvals, pushSubscribed });
}

// --- Push notifications ----------------------------------------------------

/** Notifies phones that aren't looking at the app right now (open apps get live updates instead). */
async function notifyPhones(payload: PushPayload, opts: { includeOnline?: boolean; only?: string } = {}) {
  for (const phone of [...config.phones]) {
    if (!phone.push) continue;
    if (opts.only && phone.kid !== opts.only) continue;
    if (!opts.includeOnline && onlinePhones.has(phone.kid)) continue;
    const alive = await sendPush(config, phone.push, payload);
    if (!alive) {
      phone.push = undefined;
      saveConfig(config);
      log(`Push subscription for ${phone.name} expired.`);
    }
  }
}

const notifiedTaskEnds = new Map<string, number>();

function pushFor(message: MacToPhone) {
  if (message.type === "approval") {
    const task = tasks.tasks.find((t) => t.id === message.approval.taskId);
    void notifyPhones({
      title: message.approval.title,
      body: task ? `Waiting on you · ${task.prompt.slice(0, 100)}` : message.approval.reason,
      url: `/?approval=${message.approval.id}`,
      tag: `approval-${message.approval.id}`,
    });
  } else if (message.type === "task" && ["done", "failed"].includes(message.task.status)) {
    // One notification per finish (a follow-up can finish the same task again later).
    const { task } = message;
    if (notifiedTaskEnds.get(task.id) === task.updatedAt) return;
    notifiedTaskEnds.set(task.id, task.updatedAt);
    const outcome = task.status === "done" ? task.result : task.error;
    void notifyPhones({
      title: task.status === "done" ? "Done" : "Couldn't finish",
      body: `${task.prompt.slice(0, 60)}${outcome ? ` — ${outcome.replace(/\s+/g, " ").slice(0, 120)}` : ""}`,
      url: `/?task=${task.id}`,
      tag: `task-${task.id}`,
    });
  }
}

function handleMessage(kid: string, message: PhoneToMac) {
  switch (message.type) {
    case "sync":
      return void sendState(kid);
    case "task.create":
      if (!message.prompt?.trim()) return;
      log(`New task: ${message.prompt}`);
      return tasks.create(message.prompt.trim().slice(0, 8000));
    case "task.followup":
      return tasks.followup(message.taskId, message.prompt.trim().slice(0, 8000));
    case "task.stop":
      return tasks.stop(message.taskId);
    case "approval.respond":
      log(`Approval ${message.decision === "approve" ? "granted" : "denied"} from phone.`);
      return tasks.respond(message.approvalId, message.decision === "approve", !!message.remember);
    case "agent.pause":
      log(message.paused ? "Paused from phone." : "Resumed from phone.");
      return tasks.setPaused(message.paused);
    case "stop.all":
      log("Stop everything pressed on phone.");
      return tasks.stopAll();
    case "push.subscribe": {
      const phone = config.phones.find((p) => p.kid === kid);
      if (!phone) return;
      if (!isValidSubscription(message.subscription)) {
        return sendTo(kid, { type: "error", message: "That notification subscription isn't from a known push service." });
      }
      phone.push = { endpoint: message.subscription.endpoint, keys: message.subscription.keys };
      saveConfig(config);
      log(`Notifications turned on for ${phone.name}.`);
      return void sendState(kid);
    }
    case "push.unsubscribe": {
      const phone = config.phones.find((p) => p.kid === kid);
      if (!phone) return;
      phone.push = undefined;
      saveConfig(config);
      return void sendState(kid);
    }
    case "push.test":
      return void notifyPhones(
        { title: "Errand", body: `Notifications from ${config.macName} are working.`, url: "/", tag: "test" },
        { includeOnline: true, only: kid },
      );
  }
}

function handleFrame(raw: string) {
  if (raw === "pong") return;
  let frame: Frame;
  try {
    frame = JSON.parse(raw);
  } catch {
    return;
  }
  if (frame.t === "hello") return void handleHello(frame);
  if (frame.t === "presence") {
    if (frame.role === "phone" && frame.kid && !frame.online) onlinePhones.delete(frame.kid);
    return;
  }
  if (frame.t === "msg") {
    const key = keyFor(frame.from);
    if (!key) return;
    try {
      handleMessage(frame.from, open<PhoneToMac>(key, frame));
    } catch {
      log("Dropped a message that failed to decrypt.");
    }
  }
}

// --- Relay connection -------------------------------------------------------

let retryMs = 1000;
let pingTimer: ReturnType<typeof setInterval> | undefined;

function connect() {
  const url = wsUrl(config.relayUrl, config.roomId, "mac", config.macKid);
  const ws = new WebSocket(url);
  socket = ws;
  ws.addEventListener("open", () => {
    retryMs = 1000;
    log(`Connected to relay at ${config.relayUrl}`);
    pingTimer = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send("ping"), 25_000);
  });
  ws.addEventListener("message", (event) => handleFrame(String(event.data)));
  ws.addEventListener("close", () => {
    clearInterval(pingTimer);
    onlinePhones.clear();
    if (socket !== ws) return;
    log(`Relay connection lost. Retrying in ${Math.round(retryMs / 1000)}s…`);
    setTimeout(connect, retryMs);
    retryMs = Math.min(retryMs * 2, 30_000);
  });
  ws.addEventListener("error", () => ws.close());
}

// --- Start ----------------------------------------------------------------

const tasks = new TaskManager(
  config,
  (message) => {
    if (message.type === "task" && ["done", "failed", "stopped"].includes(message.task.status)) {
      log(`Task ${message.task.status}: ${message.task.prompt.slice(0, 60)}`);
    }
    broadcast(message);
    pushFor(message);
  },
  () => void macStatus().then((mac) => broadcast({ type: "mac", mac })),
);

// --- Paired phone management: `bun run devices`, `bun run revoke <number|id|all>` ------

if (args.has("--devices") || args.has("--revoke")) {
  const argv = process.argv.slice(2);
  if (args.has("--revoke")) {
    const target = argv[argv.indexOf("--revoke") + 1];
    const before = config.phones.length;
    if (target === "all") config.phones = [];
    else if (target && /^\d+$/.test(target)) config.phones.splice(Number(target) - 1, 1);
    else if (target) config.phones = config.phones.filter((p) => p.kid !== target);
    if (!target || config.phones.length === before) {
      console.log("Nothing removed. Use a number from `bun run devices`, a device id, or `all`.");
    } else {
      saveConfig(config);
      console.log(`Removed ${before - config.phones.length} phone(s). A running agent drops them within seconds.`);
    }
  }
  console.log(config.phones.length ? "\nPaired phones:" : "\nNo paired phones.");
  config.phones.forEach((p, i) =>
    console.log(`  ${i + 1}. ${p.name}  ·  id ${p.kid}  ·  paired ${new Date(p.pairedAt).toLocaleString()}`),
  );
  process.exit(0);
}

// --- One agent at a time ------------------------------------------------------

const otherAgent = runningAgentPid();
if (otherAgent) {
  if (args.has("--pair")) {
    // Hand the pairing to the agent that's already running (usually the background service):
    // write a fresh code to the config, which it picks up within a couple of seconds.
    showPairingCode();
    console.log("Errand is already running, so it will handle this pairing.");
    console.log("When the phone scans the code, approve it with Touch ID on this Mac.");
    process.exit(0);
  }
  console.log(`Errand is already running (pid ${otherAgent}). See it with \`bun run status\` or \`bun run logs\`.`);
  console.log("To run it in this terminal instead, stop the background one first: `bun run stop`.");
  process.exit(1);
}
claimPidFile();

// Pick up changes made from another terminal while the agent runs: revoked phones
// and new pairing codes from `bun run pair`.
watchFile(CONFIG_PATH, { interval: 2000 }, () => {
  const saved = readSavedConfig();
  if (!saved) return;
  if (saved.pairSecret && saved.pairSecret !== config.pairSecret) {
    config.pairSecret = saved.pairSecret;
    config.pairSecretExpiresAt = saved.pairSecretExpiresAt;
    log("A new pairing code is ready. Waiting for a phone to scan it.");
  }
  const savedKids = new Set(saved.phones.map((p) => p.kid));
  for (const phone of [...config.phones]) {
    if (savedKids.has(phone.kid)) continue;
    config.phones = config.phones.filter((p) => p.kid !== phone.kid);
    sessionKeys.delete(phone.kid);
    onlinePhones.delete(phone.kid);
    reject(phone.kid, "This phone was removed from the Mac. Scan a new code to pair again.");
    log(`Removed ${phone.name}.`);
  }
});

// Build the Touch ID helper ahead of time so the first pairing doesn't wait for it.
void prepareOwnerAuth();

if (config.keepAwake) {
  // Stop the Mac sleeping while it's plugged in (-s applies on AC power only), so a
  // Mac on battery still sleeps normally. Exits with this process.
  Bun.spawn(["caffeinate", "-s", "-w", String(process.pid)], { stdout: "ignore", stderr: "ignore" });
}

const asService = args.has("--service");
console.log(`Errand ${VERSION} on "${config.macName}" · model ${config.model}${asService ? " · background service" : ""}`);
console.log(`Allowed folders: ${config.allowedFolders.join(", ") || "(none)"}`);

if (asService) {
  // macOS asks once per folder whether the agent may use Documents, Desktop and Downloads.
  // Ask now, right after install while someone is at the Mac, not mid-task later.
  for (const folder of config.allowedFolders) {
    try {
      readdirSync(folder);
    } catch {
      log(`Can't read ${folder} yet. If macOS asked for access, click Allow.`);
    }
  }
  if (config.phones.length === 0) log("No phones paired yet. Run `bun run pair` in a terminal to show a pairing code.");
} else if (args.has("--pair") || config.phones.length === 0) {
  showPairingCode();
} else {
  console.log(`Paired phones: ${config.phones.map((p) => p.name).join(", ")}. Run \`bun run pair\` to add another.`);
}

connect();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    log("Shutting down.");
    tasks.stopAll();
    socket?.close();
    setTimeout(() => process.exit(0), 300);
  });
}
