// Cross-checks the Swift ErrandKit against the TypeScript protocol.
//   bun ios/scripts/interop.ts gen <vectors.json>      → keys, expected values, a message sealed by the "Mac"
//   bun ios/scripts/interop.ts verify <vectors.json> <reply.json>  → opens the message Swift sealed

import * as p from "../../protocol/src/index";

const [mode, vectorsPath, replyPath] = process.argv.slice(2);

if (mode === "gen") {
  const room = p.randomId(16);
  const mac = p.generateKeyPair();
  const phone = p.generateKeyPair();
  const pairSecret = p.randomId(16);
  const key = p.deriveSessionKey(mac.secretKey, phone.publicKey, room);
  const state: p.MacToPhone = {
    type: "state",
    mac: { name: "Test Mac", paused: false, busy: true, battery: { percent: 81, charging: true }, allowedFolders: ["/Users/x/Documents"], model: "claude-opus-5-5", version: "0.1.0", pushKey: "BPk" },
    tasks: [{ id: "t1", prompt: "Email Ahmed the invoice", followups: [], status: "waiting", createdAt: 1, updatedAt: 2, steps: [{ id: "s1", tool: "Read", title: "Read invoice.pdf", status: "done" }], filesTouched: [], costUsd: 0.05 }],
    approvals: [{ id: "appr-1", taskId: "t1", stepId: "s2", kind: "email", title: "Send this email?", reason: "Email leaves your Mac", preview: { to: ["ahmed@example.com"], subject: "Invoice", body: "Hi Ahmed ✓" }, createdAt: 3 }],
    pushSubscribed: false,
  };
  const vectors = {
    room,
    mac,
    phone,
    pairSecret,
    expected: {
      macKid: p.keyId(mac.publicKey),
      phoneKid: p.keyId(phone.publicKey),
      proof: p.pairingProof(pairSecret, phone.publicKey),
      code: p.pairingCode(mac.publicKey, phone.publicKey, room),
    },
    sealedByMac: p.seal(key, state),
  };
  await Bun.write(vectorsPath!, JSON.stringify(vectors, null, 2));
  console.log("wrote vectors");
} else if (mode === "verify") {
  const vectors = await Bun.file(vectorsPath!).json();
  const reply = await Bun.file(replyPath!).json();
  const key = p.deriveSessionKey(vectors.mac.secretKey, vectors.phone.publicKey, vectors.room);
  const message = p.open<p.PhoneToMac>(key, reply);
  const ok = message.type === "approval.respond" && message.approvalId === "appr-1" && message.decision === "approve" && message.remember === true;
  console.log(`${ok ? "PASS" : "FAIL"}  Mac (TypeScript) opens the approval Swift sealed: ${JSON.stringify(message)}`);
  process.exit(ok ? 0 : 1);
}
