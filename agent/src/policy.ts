// Decides, for each tool call the agent wants to make, whether it runs on its own,
// waits for approval on the phone, or is blocked. See "Safety model" in the spec.

import { homedir } from "node:os";
import { resolve, sep } from "node:path";
import type { Approval, ApprovalKind } from "@errand/protocol";
import type { Config } from "./config";

export type Verdict =
  | { action: "allow" }
  | { action: "deny"; reason: string }
  | {
      action: "ask";
      kind: ApprovalKind;
      title: string;
      reason: string;
      preview: Approval["preview"];
      remember?: { label: string; emailRecipients: string[] };
    };

const READ_ONLY_TOOLS = new Set(["Read", "Glob", "Grep", "LS", "NotebookRead", "WebSearch", "WebFetch", "TodoWrite", "Agent", "Task"]);
const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
const SAFE_MAC_TOOLS = new Set(["mcp__mac__find_contact", "mcp__mac__open_item", "mcp__mac__mac_status"]);

const SAFE_COMMANDS = new Set([
  "ls", "pwd", "cat", "head", "tail", "wc", "echo", "grep", "rg", "which", "date", "mdfind", "mdls",
  "file", "stat", "du", "df", "sw_vers", "uname", "tree", "sort", "uniq", "cut", "jq", "basename",
  "dirname", "realpath", "whoami", "hostname", "true", "test", "diff",
]);
const SAFE_GIT = new Set(["status", "log", "diff", "show", "branch", "rev-parse", "ls-files", "blame", "add", "commit", "fetch", "remote", "stash", "tag"]);
const SAFE_SCRIPTS = /^(npm|pnpm|yarn|bun)\s+(test|run\s+(test|lint|build|typecheck|check))\b/;
const NEVER = /\bsudo\b|\bsecurity\s+(find|dump|delete)|\bcsrutil\b|\bspctl\b|\bfdesetup\b/;
const DESTRUCTIVE = /\brm\b|\bmv\b|\brmdir\b|\bgit\s+(reset|clean|checkout|restore|rebase)\b|\bchmod\b|\bchown\b|\bkill(all)?\b|\blaunchctl\b|\bdiskutil\b|-delete\b/;
const OUTBOUND = /\bgit\s+push\b|\bcurl\b|\bwget\b|\bscp\b|\brsync\b|\bssh\b|\bnpm\s+publish\b|\bgh\s+(pr|release|issue)\s+create\b/;

export function expandPath(path: string): string {
  return resolve(path.replace(/^~(?=$|\/)/, homedir()));
}

export function isInsideAllowed(path: string, config: Config): boolean {
  const target = expandPath(path);
  return config.allowedFolders.some((folder) => {
    const root = expandPath(folder);
    return target === root || target.startsWith(root + sep);
  });
}

function isSafeCommand(command: string): boolean {
  if (/[`<>]|\$\(/.test(command.replace(/2>&1|2>\/dev\/null/g, ""))) return false;
  const segments = command.split(/&&|\|\||;|\|/).map((s) => s.trim()).filter(Boolean);
  return segments.every((segment) => {
    const words = segment.split(/\s+/);
    // Skip leading env assignments like FOO=1.
    while (words.length && /^[A-Z_][A-Z0-9_]*=/.test(words[0]!)) words.shift();
    const [cmd, sub] = words;
    if (!cmd) return true;
    if (cmd === "cd") return true;
    if (cmd === "git") return !!sub && SAFE_GIT.has(sub);
    if (cmd === "find") return !/\s-(exec|execdir|delete|ok)\b/.test(segment);
    if (SAFE_SCRIPTS.test(segment)) return true;
    return SAFE_COMMANDS.has(cmd);
  });
}

function asStrings(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string" && value) return [value];
  return [];
}

export function classify(toolName: string, input: Record<string, unknown>, config: Config): Verdict {
  if (READ_ONLY_TOOLS.has(toolName)) {
    const path = (input.file_path ?? input.path ?? input.notebook_path) as string | undefined;
    if (path && !isInsideAllowed(path, config)) {
      return {
        action: "ask",
        kind: "file",
        title: "Read a file outside your allowed folders?",
        reason: "Errand only reads the folders you chose unless you say otherwise.",
        preview: { path: expandPath(path) },
      };
    }
    return { action: "allow" };
  }

  if (WRITE_TOOLS.has(toolName)) {
    const path = String(input.file_path ?? input.notebook_path ?? "");
    if (path && isInsideAllowed(path, config)) return { action: "allow" };
    return {
      action: "ask",
      kind: "file",
      title: "Change a file outside your allowed folders?",
      reason: "Errand only edits the folders you chose unless you approve it.",
      preview: { path: path ? expandPath(path) : undefined, tool: toolName },
    };
  }

  if (toolName === "Bash") {
    const command = String(input.command ?? "");
    if (NEVER.test(command)) {
      return { action: "deny", reason: "Errand never runs commands that need admin rights or touch security settings." };
    }
    if (isSafeCommand(command)) return { action: "allow" };
    const reason = DESTRUCTIVE.test(command)
      ? "This command can delete, move or overwrite things."
      : OUTBOUND.test(command)
        ? "This command sends data off your Mac."
        : "This command isn't on Errand's list of safe commands.";
    return { action: "ask", kind: "command", title: "Run this command?", reason, preview: { command } };
  }

  if (SAFE_MAC_TOOLS.has(toolName)) return { action: "allow" };

  if (toolName === "mcp__mac__send_email") {
    const to = [...asStrings(input.to), ...asStrings(input.cc)];
    const remembered = new Set(config.remembered.emailRecipients.map((r) => r.toLowerCase()));
    if (to.length > 0 && to.every((addr) => remembered.has(addr.toLowerCase()))) return { action: "allow" };
    return {
      action: "ask",
      kind: "email",
      title: "Send this email?",
      reason: "Sending email leaves your Mac, so Errand always checks with you first.",
      preview: {
        to,
        subject: String(input.subject ?? ""),
        body: String(input.body ?? ""),
        attachments: asStrings(input.attachments),
      },
      remember: { label: `Always allow emails to ${to.join(", ")}`, emailRecipients: to },
    };
  }

  return {
    action: "ask",
    kind: "other",
    title: `Allow ${toolName.replace(/^mcp__/, "").replace(/__/g, " › ")}?`,
    reason: "Errand doesn't know this action yet, so it's asking first.",
    preview: { tool: toolName, input: JSON.stringify(input, null, 2).slice(0, 2000) },
  };
}
