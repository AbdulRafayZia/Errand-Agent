# Errand (MVP)

Control your Mac from your iPhone. You type a task on the phone; an agent on the Mac does it with Claude, and asks your phone before anything risky.

```
iPhone (web app)  ⇄  relay (Cloudflare Worker)  ⇄  Mac agent (Bun + Claude Agent SDK)
        └──────── end-to-end encrypted: X25519 + AES-256-GCM ────────┘
```

| Folder | What it is |
| --- | --- |
| `agent/` | The Mac agent. Runs tasks with the Claude Agent SDK, applies the safety policy, and talks to Mail/Contacts through AppleScript. |
| `relay/` | Cloudflare Worker + Durable Object. Routes encrypted messages between a Mac and its phones, and serves the phone web app. |
| `web/` | Phone app (Preact). Pair, Home, Task, Approval, Activity, Settings, matching the mockups. |
| `protocol/` | Shared message types and encryption, used by all three. |

## Requirements

- Bun 1.1+ and Node 22+ (Wrangler needs Node 22: `nvm use 24`)
- Claude access: the agent uses the Claude login already on this Mac, or `ANTHROPIC_API_KEY` if set (put it in `agent/.env`)

## Run it on your Wi-Fi (phone and Mac on the same network)

```bash
bun install
```

Terminal 1, the relay:

```bash
bun run relay
```

Terminal 2, the Mac agent. It prints a QR code the first time:

```bash
bun run agent
```

Scan the QR code with the iPhone camera. Safari opens the app already paired. To pair another phone, or re-pair, run `bun run pair`. Pairing codes last 10 minutes and work once.

> Safari and a home-screen web app keep separate storage on iOS. To use Errand from the home screen, add it there first, open it, then paste a fresh pairing link into the "Or paste the pairing link" field.

## How pairing is protected

1. The QR code holds a one-time secret that expires after 10 minutes and is used up by the first phone that scans it. A copy or photo of the QR is rejected after that.
2. The phone shows a 6-digit code, and the Mac asks for **Touch ID or your login password** while showing the same code. A phone is trusted only after someone at the unlocked Mac approves it. If the codes don't match, deny it: someone else scanned your QR first.
3. Both devices compute the code themselves from their encryption keys, so a tampered relay can't fake it.
4. Each new pairing shows a macOS notification.

Manage paired phones:

```bash
bun run devices
```

```bash
bun run revoke 1
```

`revoke` takes a number from `devices`, a device id, or `all`. A running agent drops the phone within a few seconds, and the phone returns to the pairing screen.

## Use it away from home

Deploy the relay to Cloudflare (free plan is fine), then point the agent at it:

```bash
bun run deploy:relay
```

```bash
ERRAND_RELAY_URL=https://errand-relay.<your-subdomain>.workers.dev bun run pair
```

## Settings (environment variables for the agent)

| Variable | Default | Meaning |
| --- | --- | --- |
| `ERRAND_RELAY_URL` | `http://<this Mac's LAN IP>:8787` | Relay to connect to |
| `ERRAND_FOLDERS` | `~/Documents:~/Desktop:~/Downloads:~/development` | Folders the agent may read and edit freely, `:`-separated |
| `ERRAND_MODEL` | `claude-opus-5-5` | Claude model |
| `ERRAND_HOME` | `~/.errand` | Where keys, paired phones and task history are stored |

## What needs approval on the phone

| Action | Behaviour |
| --- | --- |
| Read/search files in allowed folders, web search | Runs on its own |
| Edit files in allowed folders, safe commands (`ls`, `git status/commit`, `npm test` …) | Runs on its own |
| Any other shell command (`rm`, `mv`, `git push`, `curl` …) | Asks first, shows the exact command |
| Reading or writing outside allowed folders | Asks first |
| Sending email | Asks first, shows the full draft; "always allow" per recipient |
| `sudo`, keychain and system-security commands | Always blocked |

The rules live in `agent/src/policy.ts`.

## First-run macOS prompts

The first time the agent emails or looks up a contact, macOS asks on the Mac whether your terminal may control Mail/Contacts. Click Allow; this can't be done from the phone. Later: System Settings › Privacy & Security › Automation.

## Not in this MVP yet

- Push notifications (you see approvals when the app is open)
- Native SwiftUI iPhone app (needs Xcode) and Mac menu-bar app
- Accounts, billing, multiple Macs, on-screen control, scheduled tasks
