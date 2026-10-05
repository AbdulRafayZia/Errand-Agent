// Tools that let the agent use Mac apps: Mail, Contacts, Finder/open, and status.
// Exposed to the agent as an in-process MCP server named "mac".

import { existsSync } from "node:fs";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { expandPath } from "./policy";

interface RunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

async function run(cmd: string[], stdin?: string, timeoutMs = 30_000): Promise<RunResult> {
  const proc = Bun.spawn(cmd, { stdin: stdin === undefined ? "ignore" : "pipe", stdout: "pipe", stderr: "pipe" });
  if (stdin !== undefined && proc.stdin) {
    proc.stdin.write(stdin);
    proc.stdin.end();
  }
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);
  return { ok: code === 0, stdout: stdout.trim(), stderr: stderr.trim() };
}

function appleString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function text(message: string, isError = false) {
  return { content: [{ type: "text" as const, text: message }], isError };
}

function automationHint(stderr: string): string {
  return /not authorized|-1743|not allowed/i.test(stderr)
    ? " macOS blocked this. On the Mac, open System Settings › Privacy & Security › Automation and allow the app running Errand to control Mail and Contacts."
    : "";
}

export async function batteryStatus(): Promise<{ percent: number; charging: boolean } | undefined> {
  const result = await run(["pmset", "-g", "batt"]);
  const match = result.stdout.match(/(\d+)%;\s*([a-z ]+);/i);
  if (!match) return undefined;
  return { percent: Number(match[1]), charging: !/discharging/i.test(match[2]!) };
}

export const macTools = createSdkMcpServer({
  name: "mac",
  version: "0.1.0",
  instructions:
    "Tools for using the user's Mac apps. Look up a person with find_contact before emailing them by name. " +
    "send_email always shows the user a preview on their phone first.",
  tools: [
    tool(
      "send_email",
      "Send an email from the Mail app on this Mac. The user approves it on their phone before it is sent.",
      {
        to: z.array(z.string()).min(1).describe("Recipient email addresses"),
        cc: z.array(z.string()).optional(),
        subject: z.string(),
        body: z.string().describe("Plain-text body"),
        attachments: z.array(z.string()).optional().describe("Absolute paths of files to attach"),
      },
      async ({ to, cc, subject, body, attachments }) => {
        const files = (attachments ?? []).map(expandPath);
        const missing = files.filter((file) => !existsSync(file));
        if (missing.length) return text(`These attachments don't exist: ${missing.join(", ")}`, true);

        // With no account, Mail accepts `send` without error and silently drops the message.
        const accounts = await run(["osascript", "-e", 'tell application "Mail" to count (every account whose enabled is true)']);
        if (!accounts.ok) return text(`Couldn't check Mail's accounts: ${accounts.stderr}${automationHint(accounts.stderr)}`, true);
        if (Number(accounts.stdout) === 0) {
          return text(
            "NOT SENT: the Mail app on this Mac has no email account set up, so it cannot send anything. " +
              "Tell the user to open Mail on the Mac and add their email account (Mail › Settings › Accounts), then try again.",
            true,
          );
        }

        const lines = [
          'tell application "Mail"',
          `  set m to make new outgoing message with properties {subject:${appleString(subject)}, content:${appleString(body)}, visible:false}`,
          "  tell m",
          ...to.map((addr) => `    make new to recipient at end of to recipients with properties {address:${appleString(addr)}}`),
          ...(cc ?? []).map((addr) => `    make new cc recipient at end of cc recipients with properties {address:${appleString(addr)}}`),
          ...files.map((file) => `    make new attachment with properties {file name:(POSIX file ${appleString(file)})} at after the last paragraph`),
          "  end tell",
          // Mail needs a moment to load attachments before sending.
          files.length ? "  delay 2" : "",
          "  send m",
          "end tell",
        ];
        const result = await run(["osascript", "-"], lines.join("\n"), 60_000);
        if (!result.ok) return text(`Mail could not send the email: ${result.stderr}${automationHint(result.stderr)}`, true);

        // `send` only queues the message. Give Mail a moment, then check it actually left the Outbox.
        const outboxCheck = `tell application "Mail" to count (every message of outbox whose subject is ${appleString(subject)})`;
        let stuck = 0;
        for (let attempt = 0; attempt < 6; attempt++) {
          await Bun.sleep(2500);
          stuck = Number((await run(["osascript", "-e", outboxCheck])).stdout) || 0;
          if (stuck === 0) break;
        }
        const what = `"${subject}" to ${to.join(", ")}${files.length ? ` with ${files.length} attachment(s)` : ""}`;
        if (stuck > 0) {
          return text(
            `NOT CONFIRMED: Mail queued ${what}, but it is still in the Outbox after 15 seconds. ` +
              "It may be offline, the attachment may be too large for the mail server, or the account may need attention in Mail.",
            true,
          );
        }
        return text(`Sent ${what}.`);
      },
    ),
    tool(
      "find_contact",
      "Search the Contacts app by name. Returns matching people with their email addresses and phone numbers.",
      { name: z.string().describe("Full or partial name") },
      async ({ name }) => {
        const script = [
          'tell application "Contacts"',
          '  set out to ""',
          `  repeat with p in (every person whose name contains ${appleString(name)})`,
          '    set out to out & name of p & " | emails: "',
          "    repeat with e in emails of p",
          '      set out to out & value of e & " "',
          "    end repeat",
          '    set out to out & "| phones: "',
          "    repeat with ph in phones of p",
          '      set out to out & value of ph & " "',
          "    end repeat",
          "    set out to out & linefeed",
          "  end repeat",
          "  return out",
          "end tell",
        ].join("\n");
        const result = await run(["osascript", "-"], script);
        if (!result.ok) return text(`Contacts lookup failed: ${result.stderr}${automationHint(result.stderr)}`, true);
        return text(result.stdout || `No contact matches "${name}".`);
      },
    ),
    tool(
      "open_item",
      "Open a file, folder or URL on the Mac, or launch an app by name.",
      {
        target: z.string().optional().describe("File path, folder path or URL"),
        app: z.string().optional().describe('App name, e.g. "Figma" or "Visual Studio Code"'),
      },
      async ({ target, app }) => {
        if (!target && !app) return text("Give a target, an app, or both.", true);
        const args = ["open"];
        if (app) args.push("-a", app);
        if (target) args.push(/^[a-z]+:\/\//i.test(target) ? target : expandPath(target));
        const result = await run(args);
        if (!result.ok) return text(`Couldn't open it: ${result.stderr}`, true);
        return text(`Opened ${[app, target].filter(Boolean).join(" › ")}.`);
      },
    ),
    tool("mac_status", "Battery level, power source and uptime of this Mac.", {}, async () => {
      const [batt, uptime] = await Promise.all([run(["pmset", "-g", "batt"]), run(["uptime"])]);
      return text(`${batt.stdout}\n${uptime.stdout}`);
    }),
  ],
});
