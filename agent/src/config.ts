import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir, networkInterfaces } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { generateKeyPair, keyId, randomId, type KeyPair, type PushSubscriptionJSON } from "@errand/protocol";

export const DATA_DIR = process.env.ERRAND_HOME ?? join(homedir(), ".errand");
export const CONFIG_PATH = join(DATA_DIR, "config.json");

/** The config as currently saved on disk, to pick up changes made from another terminal. */
export function readSavedConfig(): Config | undefined {
  try {
    const saved = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Config;
    saved.phones ??= [];
    return saved;
  } catch {
    return undefined;
  }
}

export interface PairedPhone {
  kid: string;
  publicKey: string;
  name: string;
  pairedAt: number;
  push?: PushSubscriptionJSON;
}

export interface Config {
  relayUrl: string;
  roomId: string;
  mac: KeyPair;
  macKid: string;
  macName: string;
  /** Valid only while a pairing QR code is on screen. */
  pairSecret?: string;
  pairSecretExpiresAt?: number;
  phones: PairedPhone[];
  allowedFolders: string[];
  model: string;
  keepAwake: boolean;
  remembered: { emailRecipients: string[] };
  /** Keys this Mac signs web push requests with. */
  vapid?: { publicKey: string; privateKey: string };
}

function macName(): string {
  try {
    return execFileSync("scutil", ["--get", "ComputerName"], { encoding: "utf8" }).trim();
  } catch {
    return "My Mac";
  }
}

function lanAddress(): string {
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    if (!name.startsWith("en")) continue;
    const v4 = addrs?.find((a) => a.family === "IPv4" && !a.internal);
    if (v4) return v4.address;
  }
  return "127.0.0.1";
}

function defaultFolders(): string[] {
  const home = homedir();
  return [join(home, "Documents"), join(home, "Desktop"), join(home, "Downloads"), join(home, "development")].filter(
    (dir) => existsSync(dir),
  );
}

export function loadConfig(): Config {
  mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  let config: Config;
  if (existsSync(CONFIG_PATH)) {
    config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } else {
    const mac = generateKeyPair();
    config = {
      relayUrl: "",
      roomId: randomId(16),
      mac,
      macKid: keyId(mac.publicKey),
      macName: macName(),
      phones: [],
      allowedFolders: defaultFolders(),
      model: "claude-opus-5-5",
      keepAwake: true,
      remembered: { emailRecipients: [] },
    };
  }
  // The environment wins so the same install can point at a local or deployed relay.
  config.relayUrl = process.env.ERRAND_RELAY_URL ?? (config.relayUrl || `http://${lanAddress()}:8787`);
  if (process.env.ERRAND_MODEL) config.model = process.env.ERRAND_MODEL;
  if (process.env.ERRAND_FOLDERS) config.allowedFolders = process.env.ERRAND_FOLDERS.split(":").filter(Boolean);
  saveConfig(config);
  return config;
}

export function saveConfig(config: Config) {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
  chmodSync(CONFIG_PATH, 0o600);
}
