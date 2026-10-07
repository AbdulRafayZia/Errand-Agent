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

> On your home Wi-Fi the app runs in Safari over http, so the in-app scanner and notifications are unavailable. Use the online relay below for those.

## Run it in the background (recommended)

Install Errand as a background service once. It then starts when you log in, restarts itself if it stops, and needs no terminal window:

```bash
bun run install-service
```

| Command | What it does |
| --- | --- |
| `bun run status` | Is it running, which relay, how many phones, latest log lines |
| `bun run logs` | Follow the live log (Ctrl+C to stop watching; the agent keeps running) |
| `bun run pair` | Show a pairing code; the background agent handles the pairing |
| `bun run restart` | Restart it, e.g. after updating the code |
| `bun run stop` / `bun run start` | Stop or start it until the next login |
| `bun run uninstall-service` | Remove the background service (keeps your pairing and settings) |

Only one agent runs at a time. While the service runs, `bun run agent` refuses to start a second one.

Right after installing, macOS may ask whether **bun** may access your Documents, Desktop and Downloads folders and control Mail. Click Allow. These prompts appear once, and only when someone is at the Mac to click them.

### Keep the Mac reachable

- While Errand runs, it keeps the Mac from sleeping **when it's plugged in**. On battery the Mac sleeps as usual.
- A MacBook with its lid closed sleeps regardless, unless it's plugged in and connected to an external display. Leave the lid open when you're away.
- In System Settings › Battery › Options, turn on "Prevent automatic sleeping on power adapter when the display is off".
- After a restart, the service starts once you log in. With FileVault on, someone must log in after each restart.

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

## Use it away from home, with notifications

The online relay gives the phone app an `https://` address, which iPhone needs for Home Screen apps and push notifications.

1. Log in to Cloudflare once (free plan is fine), then deploy:

   ```bash
   cd relay && npx wrangler login
   ```

   ```bash
   bun run deploy:relay
   ```

2. Point the agent at the deployed relay and show a new pairing code. The address is saved, so later `bun run agent` keeps using it:

   ```bash
   ERRAND_RELAY_URL=https://errand-relay.<your-subdomain>.workers.dev bun run pair
   ```

3. On the iPhone, open that `https://` address in Safari, tap Share › **Add to Home Screen**, and open Errand from the Home Screen.
4. Tap **Scan QR code** in the app, scan the code on the Mac, and approve with Touch ID.
5. In the app, open Settings and turn on **Notifications**, then tap "Send a test notification".

Notifications are sent by your Mac straight to Apple's push service and are encrypted to your phone, so neither the relay nor Apple can read them. The Mac only sends one when the app isn't open; an open app gets live updates instead.

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

- Native SwiftUI iPhone app (needs Xcode) and Mac menu-bar app
- Accounts, billing, multiple Macs, on-screen control, scheduled tasks
