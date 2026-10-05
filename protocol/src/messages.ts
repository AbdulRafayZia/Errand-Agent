import type { Sealed } from "./crypto";

// ---------------------------------------------------------------------------
// Relay frames: what travels over the WebSocket. The relay reads only `t`,
// `to` and `from`; app messages are inside `Sealed` and it cannot read them.
// ---------------------------------------------------------------------------

export type Role = "mac" | "phone";

/** Phone -> Mac, plaintext. Sent on every connect so the Mac can bind the phone's key. */
export interface HelloFrame {
  t: "hello";
  kid: string;
  pub: string;
  /** HMAC of the phone's public key with the pairing secret; required the first time. */
  proof?: string;
  name?: string;
}

export interface EncryptedFrame extends Sealed {
  t: "msg";
  /** Sender's key id. */
  from: string;
  /** Recipient phone key id (Mac -> phone only). Omitted when sent to the Mac. */
  to?: string;
}

/** Relay -> clients: who else is connected to the room. */
export interface PresenceFrame {
  t: "presence";
  role: Role;
  kid?: string;
  online: boolean;
}

export interface RejectFrame {
  t: "reject";
  to: string;
  reason: string;
}

export type Frame = HelloFrame | EncryptedFrame | PresenceFrame | RejectFrame;

// ---------------------------------------------------------------------------
// App messages (always encrypted)
// ---------------------------------------------------------------------------

export type TaskStatus = "queued" | "running" | "waiting" | "done" | "failed" | "stopped";
export type StepStatus = "running" | "done" | "error" | "waiting" | "denied";

export interface Step {
  id: string;
  tool: string;
  title: string;
  detail?: string;
  status: StepStatus;
}

export interface Task {
  id: string;
  prompt: string;
  followups: string[];
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
  steps: Step[];
  /** Latest text the agent wrote while working. */
  note?: string;
  result?: string;
  error?: string;
  costUsd?: number;
  filesTouched: string[];
}

export type ApprovalKind = "email" | "command" | "file" | "other";

export interface Approval {
  id: string;
  taskId: string;
  stepId: string;
  kind: ApprovalKind;
  title: string;
  /** Why the agent is asking, in plain words. */
  reason: string;
  preview: {
    to?: string[];
    subject?: string;
    body?: string;
    attachments?: string[];
    command?: string;
    path?: string;
    tool?: string;
    input?: string;
  };
  /** Label for an "always allow" checkbox, when the decision can be remembered. */
  rememberLabel?: string;
  createdAt: number;
}

export interface MacStatus {
  name: string;
  paused: boolean;
  busy: boolean;
  battery?: { percent: number; charging: boolean };
  allowedFolders: string[];
  model: string;
  version: string;
}

export type PhoneToMac =
  | { type: "sync" }
  | { type: "task.create"; prompt: string }
  | { type: "task.followup"; taskId: string; prompt: string }
  | { type: "task.stop"; taskId: string }
  | { type: "approval.respond"; approvalId: string; decision: "approve" | "deny"; remember?: boolean }
  | { type: "agent.pause"; paused: boolean }
  | { type: "stop.all" };

export type MacToPhone =
  /** The Mac is waiting for its owner to approve this phone with Touch ID or the login password. */
  | { type: "pair.pending" }
  | { type: "paired"; macName: string }
  | { type: "state"; mac: MacStatus; tasks: Task[]; approvals: Approval[] }
  | { type: "task"; task: Task }
  | { type: "approval"; approval: Approval }
  | { type: "approval.resolved"; approvalId: string }
  | { type: "mac"; mac: MacStatus }
  | { type: "error"; message: string };

// ---------------------------------------------------------------------------
// Pairing payload, carried in the QR code's URL fragment (never sent to a server).
// ---------------------------------------------------------------------------

export interface PairingPayload {
  v: 1;
  /** Relay base URL, e.g. https://errand-relay.example.workers.dev */
  u: string;
  /** Room id. */
  r: string;
  /** Mac public key. */
  k: string;
  /** One-time pairing secret. */
  s: string;
  /** Mac display name. */
  m: string;
}
