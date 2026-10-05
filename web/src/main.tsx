import { render } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { pairingCode, type Approval, type MacStatus, type MacToPhone, type Task } from "@errand/protocol";
import { Connection, loadPairing, pairingFromLink, savePairing, type LinkStatus, type Pairing } from "./conn";
import { Icon, type IconName } from "./icons";

type View =
  | { name: "home" }
  | { name: "task"; id: string }
  | { name: "activity" }
  | { name: "settings" };

// --- helpers -----------------------------------------------------------------

function ago(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return "now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });
}

function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function title(task: Task): string {
  const text = task.prompt.replace(/\s+/g, " ").trim();
  return text.length > 60 ? `${text.slice(0, 59)}…` : text;
}

const STATUS_TEXT: Record<Task["status"], string> = {
  queued: "Queued",
  running: "Running",
  waiting: "Waiting on you",
  done: "Done",
  failed: "Failed",
  stopped: "Stopped",
};

function statusTone(status: Task["status"]): { icon: IconName; tone: string } {
  switch (status) {
    case "done":
      return { icon: "check", tone: "good" };
    case "waiting":
      return { icon: "clock", tone: "warn" };
    case "running":
    case "queued":
      return { icon: "clock", tone: "busy" };
    case "failed":
      return { icon: "x", tone: "bad" };
    default:
      return { icon: "stop", tone: "muted" };
  }
}

function StatusDot({ status }: { status: Task["status"] }) {
  const { icon, tone } = statusTone(status);
  return (
    <span class={`dot dot-${tone}`}>
      <Icon name={icon} size={15} />
    </span>
  );
}

// --- app ---------------------------------------------------------------------

function App() {
  const [pairing, setPairing] = useState<Pairing | null>(() => {
    if (location.hash.startsWith("#pair=")) {
      const fresh = pairingFromLink(location.hash);
      history.replaceState(null, "", location.pathname);
      if (fresh) {
        savePairing(fresh);
        return fresh;
      }
    }
    return loadPairing();
  });
  const [link, setLink] = useState<LinkStatus>("connecting");
  const [reason, setReason] = useState<string>();
  const [paired, setPaired] = useState(() => !!pairing?.paired);
  const [awaitingMac, setAwaitingMac] = useState(false);
  useEffect(() => {
    setPaired(!!pairing?.paired);
    setAwaitingMac(false);
  }, [pairing]);
  const [mac, setMac] = useState<MacStatus>();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [view, setView] = useState<View>({ name: "home" });
  const [approvalOpen, setApprovalOpen] = useState<string>();
  const [toast, setToast] = useState<string>();
  const conn = useRef<Connection>();

  // A pairing link opened while the app is already loaded only changes the hash.
  useEffect(() => {
    const onHash = () => {
      if (!location.hash.startsWith("#pair=")) return;
      const fresh = pairingFromLink(location.hash);
      history.replaceState(null, "", location.pathname);
      if (!fresh) return;
      conn.current?.stop();
      savePairing(fresh);
      setLink("connecting");
      setPairing(fresh);
    };
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (!pairing) return;
    const c = new Connection(
      pairing,
      (message: MacToPhone) => {
        switch (message.type) {
          case "pair.pending":
            setAwaitingMac(true);
            break;
          case "paired":
            setPaired(true);
            break;
          case "state":
            setPaired(true);
            setMac(message.mac);
            setTasks(message.tasks);
            setApprovals(message.approvals);
            break;
          case "mac":
            setMac(message.mac);
            break;
          case "task":
            setTasks((list) => {
              const rest = list.filter((t) => t.id !== message.task.id);
              return [message.task, ...rest].sort((a, b) => b.createdAt - a.createdAt);
            });
            break;
          case "approval":
            setApprovals((list) => [...list.filter((a) => a.id !== message.approval.id), message.approval]);
            if (navigator.vibrate) navigator.vibrate(80);
            break;
          case "approval.resolved":
            setApprovals((list) => list.filter((a) => a.id !== message.approvalId));
            setApprovalOpen((open) => (open === message.approvalId ? undefined : open));
            break;
          case "error":
            setToast(message.message);
            break;
        }
      },
      (status, why) => {
        if (status === "rejected") {
          // Declined, expired or revoked: forget this pairing so a fresh QR is needed.
          savePairing(null);
          setReason(why);
          setPairing(null);
          return;
        }
        setLink(status);
      },
    );
    conn.current = c;
    c.start();
    return () => c.stop();
  }, [pairing]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(undefined), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const send: Connection["send"] = (message) => {
    const ok = conn.current?.send(message) ?? false;
    if (!ok) setToast("Not connected to your Mac right now.");
    return ok;
  };

  if (!pairing) {
    return (
      <PairScreen
        error={reason}
        onPair={(p) => {
          savePairing(p);
          setReason(undefined);
          setLink("connecting");
          setPairing(p);
        }}
      />
    );
  }

  if (!paired) {
    return (
      <PairConfirm
        code={pairingCode(pairing.macPublicKey, pairing.phone.publicKey, pairing.roomId)}
        macName={pairing.macName}
        awaitingMac={awaitingMac}
        link={link}
        onCancel={() => {
          conn.current?.stop();
          savePairing(null);
          setPairing(null);
        }}
      />
    );
  }

  const approval = approvals.find((a) => a.id === approvalOpen);

  return (
    <div class="app">
      {view.name === "home" && (
        <Home
          mac={mac}
          link={link}
          macName={pairing.macName}
          tasks={tasks}
          approvals={approvals}
          onOpenTask={(id) => setView({ name: "task", id })}
          onReview={setApprovalOpen}
          onSeeAll={() => setView({ name: "activity" })}
          send={send}
        />
      )}
      {view.name === "task" && (
        <TaskScreen
          task={tasks.find((t) => t.id === view.id)}
          approvals={approvals}
          onBack={() => setView({ name: "home" })}
          onReview={setApprovalOpen}
          send={send}
        />
      )}
      {view.name === "activity" && <Activity tasks={tasks} onOpenTask={(id) => setView({ name: "task", id })} />}
      {view.name === "settings" && (
        <Settings
          mac={mac}
          macName={pairing.macName}
          send={send}
          onUnpair={() => {
            conn.current?.stop();
            savePairing(null);
            setPairing(null);
            setMac(undefined);
            setTasks([]);
            setApprovals([]);
          }}
        />
      )}
      {view.name !== "task" && <TabBar view={view.name} onChange={(name) => setView({ name } as View)} />}
      {approval && (
        <ApprovalSheet
          approval={approval}
          onClose={() => setApprovalOpen(undefined)}
          onDecide={(decision, remember) => {
            if (send({ type: "approval.respond", approvalId: approval.id, decision, remember })) setApprovalOpen(undefined);
          }}
        />
      )}
      {toast && (
        <div class="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

// --- screens -------------------------------------------------------------------

function PairScreen({ error, onPair }: { error?: string; onPair: (p: Pairing) => void }) {
  const [text, setText] = useState("");
  const [bad, setBad] = useState(false);
  return (
    <div class="screen pair">
      <Brand />
      <h1>Pair your Mac</h1>
      <p class="muted">
        On your Mac, run <code>bun run pair</code> in the Errand agent folder. Then scan the QR code with your iPhone camera.
      </p>
      {error && <div class="banner banner-bad">{error}</div>}
      <ol class="steps-list">
        <li><span>1</span>Start the Errand agent on your Mac</li>
        <li><span>2</span>Scan the QR code it shows</li>
        <li><span>3</span>This page opens already paired</li>
      </ol>
      <form
        class="stack"
        onSubmit={(e) => {
          e.preventDefault();
          const p = pairingFromLink(text);
          if (p) onPair(p);
          else setBad(true);
        }}
      >
        <label for="link" class="label">Or paste the pairing link</label>
        <input id="link" class="field" value={text} onInput={(e) => { setText(e.currentTarget.value); setBad(false); }} placeholder="http://…/#pair=…" autocomplete="off" />
        {bad && <span class="error-text">That doesn't look like a pairing link.</span>}
        <button class="btn btn-secondary" type="submit" disabled={!text.trim()}>Pair</button>
      </form>
      <div class="note">
        <Icon name="lock" style={{ color: "var(--green)" }} />
        <span>Your phone and Mac create a private key together. The relay passes messages along but can't read your tasks.</span>
      </div>
    </div>
  );
}

function PairConfirm(props: { code: string; macName: string; awaitingMac: boolean; link: LinkStatus; onCancel: () => void }) {
  const status = props.awaitingMac
    ? `Waiting for you to approve on ${props.macName}…`
    : props.link === "mac-offline"
      ? "Your Mac isn't connected. Make sure the Errand agent is running."
      : "Contacting your Mac…";
  return (
    <div class="screen pair">
      <Brand />
      <h1>Confirm on your Mac</h1>
      <p class="muted">
        Your Mac is asking for Touch ID or your password. Approve only if it shows this same code.
      </p>
      <div class="code-box" aria-label={`Pairing code ${props.code}`}>{props.code}</div>
      <div class="sub" role="status"><span class={`pip ${props.awaitingMac ? "pip-wait" : ""}`} />{status}</div>
      <div class="note">
        <Icon name="lock" style={{ color: "var(--green)" }} />
        <span>A photo of the QR code isn't enough to pair. Every new phone has to be approved by someone at your unlocked Mac.</span>
      </div>
      <button class="btn btn-secondary" onClick={props.onCancel}>Cancel</button>
    </div>
  );
}

function Brand() {
  return (
    <div class="brand">
      <div class="logo">E</div>
      <span>Errand</span>
    </div>
  );
}

const QUICK_ACTIONS: { icon: IconName; label: string; prompt: string }[] = [
  { icon: "mail", label: "Email a file", prompt: "Email [person] the file [name] and say " },
  { icon: "terminal", label: "Project task", prompt: "In the [project] folder, " },
  { icon: "search", label: "Find a file", prompt: "Find the file " },
  { icon: "lines", label: "Summarise inbox", prompt: "Summarise the unread emails in my Mail inbox from today." },
];

function Home(props: {
  mac?: MacStatus;
  link: LinkStatus;
  macName: string;
  tasks: Task[];
  approvals: Approval[];
  onOpenTask: (id: string) => void;
  onReview: (id: string) => void;
  onSeeAll: () => void;
  send: Connection["send"];
}) {
  const { mac, link, tasks, approvals } = props;
  const [prompt, setPrompt] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const online = link === "online";
  const running = tasks.filter((t) => ["running", "waiting", "queued"].includes(t.status)).length;
  const today = tasks.filter((t) => t.status === "done" && new Date(t.createdAt).toDateString() === new Date().toDateString()).length;

  const submit = () => {
    const text = prompt.trim();
    if (!text) return;
    if (props.send({ type: "task.create", prompt: text })) setPrompt("");
  };

  const statusLine = online
    ? mac?.paused
      ? "Online · Paused"
      : `Online · ${mac?.busy ? "Working" : "Idle"}${mac?.battery ? (mac.battery.charging ? " · On power" : " · On battery") : ""}`
    : link === "mac-offline"
      ? "Mac is offline or asleep"
      : "Connecting…";

  return (
    <>
      <header class="topbar">
        <Brand />
      </header>
      <main class="screen-body">
        <section class="card mac-card" aria-label="Your Mac">
          <div class="row">
            <div class={`mac-icon ${online ? "" : "mac-icon-off"}`}><Icon name="laptop" size={24} /></div>
            <div class="grow">
              <div class="strong">{mac?.name ?? props.macName}</div>
              <div class="sub"><span class={`pip ${online ? "pip-on" : ""}`} />{statusLine}</div>
            </div>
            <button
              class="icon-btn"
              aria-label={mac?.paused ? "Resume agent" : "Pause agent"}
              disabled={!online}
              onClick={() => props.send({ type: "agent.pause", paused: !mac?.paused })}
            >
              <Icon name={mac?.paused ? "play" : "pause"} />
            </button>
          </div>
          <div class="stats">
            <div><span>Battery</span><b>{mac?.battery ? `${mac.battery.percent}%` : "—"}</b></div>
            <div><span>Running</span><b>{running} {running === 1 ? "task" : "tasks"}</b></div>
            <div><span>Today</span><b>{today} done</b></div>
          </div>
        </section>

        {approvals.map((a) => (
          <section class="card waiting" aria-label="Waiting on you" key={a.id}>
            <Icon name="clock" size={22} style={{ color: "var(--amber-ink)" }} />
            <div class="grow">
              <div class="eyebrow">Waiting on you</div>
              <div class="strong">{a.title}</div>
              <div class="sub-amber">{tasks.find((t) => t.id === a.taskId) ? title(tasks.find((t) => t.id === a.taskId)!) : a.reason}</div>
            </div>
            <button class="pill-btn" onClick={() => props.onReview(a.id)}>Review</button>
          </section>
        ))}

        <section class="stack-sm" aria-label="Quick actions">
          <h2>Quick actions</h2>
          <div class="grid2">
            {QUICK_ACTIONS.map((q) => (
              <button
                class="quick"
                key={q.label}
                onClick={() => {
                  setPrompt(q.prompt);
                  requestAnimationFrame(() => input.current?.focus());
                }}
              >
                <Icon name={q.icon} />
                {q.label}
              </button>
            ))}
          </div>
        </section>

        <section class="stack-sm" aria-label="Recent tasks">
          <div class="row-between">
            <h2>Recent</h2>
            {tasks.length > 3 && <button class="link-btn" onClick={props.onSeeAll}>See all</button>}
          </div>
          {tasks.length === 0 ? (
            <p class="empty">No tasks yet. Tell your Mac what to do below.</p>
          ) : (
            <div class="card list">
              {tasks.slice(0, 3).map((t) => (
                <TaskRow task={t} key={t.id} onOpen={() => props.onOpenTask(t.id)} />
              ))}
            </div>
          )}
        </section>
      </main>

      <form
        class="composer"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label for="prompt" class="sr-only">Tell your Mac what to do</label>
        <div class="composer-field">
          <textarea
            id="prompt"
            ref={input}
            rows={1}
            value={prompt}
            placeholder="Tell your Mac what to do…"
            onInput={(e) => setPrompt(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <MicButton onText={(t) => setPrompt((p) => (p ? `${p} ${t}` : t))} />
        </div>
        <button class="send" type="submit" aria-label="Send task" disabled={!prompt.trim() || !online}>
          <Icon name="send" />
        </button>
      </form>
    </>
  );
}

function MicButton({ onText }: { onText: (text: string) => void }) {
  const Recognition = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
  const [listening, setListening] = useState(false);
  if (!Recognition) return null;
  return (
    <button
      type="button"
      class={`mic ${listening ? "mic-on" : ""}`}
      aria-label={listening ? "Stop listening" : "Speak a task"}
      onClick={() => {
        const rec = new Recognition();
        rec.lang = navigator.language;
        rec.interimResults = false;
        rec.onresult = (e: any) => onText(e.results[0][0].transcript);
        rec.onend = () => setListening(false);
        rec.onerror = () => setListening(false);
        setListening(true);
        rec.start();
      }}
    >
      <Icon name="mic" />
    </button>
  );
}

function TaskRow({ task, onOpen }: { task: Task; onOpen: () => void }) {
  const steps = task.steps.length;
  const meta =
    task.status === "done" || task.status === "failed" || task.status === "stopped"
      ? `${STATUS_TEXT[task.status]} · ${ago(task.updatedAt)}`
      : `${STATUS_TEXT[task.status]}${steps ? ` · ${steps} step${steps === 1 ? "" : "s"}` : ""}`;
  return (
    <button class="task-row" onClick={onOpen}>
      <StatusDot status={task.status} />
      <span class="grow col">
        <span class="row-title">{title(task)}</span>
        <span class="row-meta">{meta}</span>
      </span>
      <Icon name="chevronRight" size={18} style={{ color: "var(--faint)" }} />
    </button>
  );
}

function TaskScreen(props: {
  task?: Task;
  approvals: Approval[];
  onBack: () => void;
  onReview: (id: string) => void;
  send: Connection["send"];
}) {
  const { task } = props;
  const [followup, setFollowup] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => bottom.current?.scrollIntoView({ block: "end" }), [task?.steps.length, task?.status]);

  if (!task) {
    return (
      <div class="screen">
        <button class="back" onClick={props.onBack} aria-label="Back"><Icon name="chevronLeft" size={22} /></button>
        <p class="empty">This task isn't available.</p>
      </div>
    );
  }
  const active = ["running", "waiting", "queued"].includes(task.status);
  const elapsed = Math.max(0, Math.round(((active ? Date.now() : task.updatedAt) - task.createdAt) / 1000));
  const pending = props.approvals.filter((a) => a.taskId === task.id);

  return (
    <>
      <header class="task-head">
        <button class="back" onClick={props.onBack} aria-label="Back"><Icon name="chevronLeft" size={22} /></button>
        <div class="grow col">
          <div class="strong">{title(task)}</div>
          <div class={`sub tone-${statusTone(task.status).tone}`}>
            {STATUS_TEXT[task.status]} · {elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`}
            {task.costUsd ? ` · $${task.costUsd.toFixed(2)}` : ""}
          </div>
        </div>
      </header>
      <main class="screen-body">
        <div class="bubble">{task.prompt}</div>
        {task.followups.map((f, i) => <div class="bubble" key={i}>{f}</div>)}

        {task.steps.length > 0 && (
          <section class="card steps" aria-label="Steps">
            {task.steps.map((step) => {
              const waiting = pending.find((a) => a.stepId === step.id);
              if (waiting) {
                return (
                  <div class="step step-waiting" key={step.id}>
                    <span class="dot dot-warn-solid"><Icon name="clock" size={14} /></span>
                    <div class="grow col"><span class="step-title">{step.title}</span><span class="step-sub">Needs your approval</span></div>
                    <button class="pill-btn" onClick={() => props.onReview(waiting.id)}>Review</button>
                  </div>
                );
              }
              const tone = step.status === "done" ? "good" : step.status === "running" ? "busy" : step.status === "waiting" ? "warn" : "bad";
              const icon: IconName = step.status === "done" ? "check" : step.status === "running" || step.status === "waiting" ? "clock" : "x";
              return (
                <div class="step" key={step.id}>
                  <span class={`dot dot-${tone}`}><Icon name={icon} size={14} /></span>
                  <div class="grow col">
                    <span class="step-title">{step.title}</span>
                    {step.status === "denied" && <span class="step-sub">You denied this</span>}
                    {step.detail && step.status !== "denied" && <span class="step-sub mono">{step.detail}</span>}
                  </div>
                </div>
              );
            })}
          </section>
        )}

        {active && task.note && <div class="card note-card"><span class="eyebrow-muted">Latest from your Mac</span>{task.note}</div>}
        {task.result && <div class="card result"><span class="eyebrow-good">Result</span><div class="pre">{task.result}</div></div>}
        {task.error && <div class="card result result-bad"><span class="eyebrow-bad">{STATUS_TEXT[task.status]}</span><div class="pre">{task.error}</div></div>}

        {task.filesTouched.length > 0 && (
          <section class="stack-sm" aria-label="Files touched">
            <h3>Files touched</h3>
            {task.filesTouched.map((f) => (
              <div class="file" key={f}><Icon name="file" size={18} /><span class="mono grow">{f.split("/").slice(-2).join("/")}</span></div>
            ))}
          </section>
        )}
        <div ref={bottom} />
      </main>
      <form
        class="task-foot"
        onSubmit={(e) => {
          e.preventDefault();
          const text = followup.trim();
          if (text && props.send({ type: "task.followup", taskId: task.id, prompt: text })) setFollowup("");
        }}
      >
        <label for="followup" class="sr-only">Add an instruction</label>
        <input
          id="followup"
          class="field grow"
          value={followup}
          onInput={(e) => setFollowup(e.currentTarget.value)}
          placeholder={active ? "Wait for it to finish…" : "Add an instruction…"}
          disabled={active}
        />
        {active ? (
          <button type="button" class="btn-stop" onClick={() => props.send({ type: "task.stop", taskId: task.id })}>
            <Icon name="stop" size={16} />Stop
          </button>
        ) : (
          <button type="submit" class="send" aria-label="Send instruction" disabled={!followup.trim()}><Icon name="send" /></button>
        )}
      </form>
    </>
  );
}

function ApprovalSheet(props: { approval: Approval; onClose: () => void; onDecide: (d: "approve" | "deny", remember: boolean) => void }) {
  const { approval: a } = props;
  const [remember, setRemember] = useState(false);
  return (
    <div class="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
        <div class="grabber" />
        <span class="badge-warn">Needs your approval</span>
        <h1 id="sheet-title">{a.title}</h1>
        <p class="muted">{a.reason}</p>

        {a.kind === "email" ? (
          <section class="card email" aria-label="Email preview">
            <div class="email-row"><span>To</span><b>{a.preview.to?.join(", ")}</b></div>
            <div class="email-row"><span>Subject</span><b>{a.preview.subject}</b></div>
            <div class="email-body">{a.preview.body}</div>
            {a.preview.attachments?.map((f) => (
              <div class="attach" key={f}><Icon name="clip" size={18} /><span class="mono grow">{f.split("/").pop()}</span></div>
            ))}
          </section>
        ) : (
          <section class="card code-card">
            {a.preview.command && <pre class="code">{a.preview.command}</pre>}
            {a.preview.path && <div class="mono">{a.preview.path}</div>}
            {a.preview.input && <pre class="code">{a.preview.input}</pre>}
          </section>
        )}

        {a.rememberLabel && (
          <label class="check">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.currentTarget.checked)} />
            {a.rememberLabel}
          </label>
        )}

        <div class="sheet-actions">
          <button class="btn btn-primary" onClick={() => props.onDecide("approve", remember)}>
            <Icon name="check" size={18} />Approve
          </button>
          <button class="btn btn-danger" onClick={() => props.onDecide("deny", false)}>Deny</button>
        </div>
      </div>
    </div>
  );
}

function Activity({ tasks, onOpenTask }: { tasks: Task[]; onOpenTask: (id: string) => void }) {
  const [filter, setFilter] = useState<"all" | "waiting" | "done" | "stopped">("all");
  const filtered = tasks.filter((t) =>
    filter === "all" ? true : filter === "waiting" ? ["waiting", "running", "queued"].includes(t.status) : filter === "done" ? t.status === "done" : ["stopped", "failed"].includes(t.status),
  );
  const groups = useMemo(() => {
    const out: { label: string; tasks: Task[] }[] = [];
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    for (const t of filtered) {
      const d = new Date(t.createdAt).toDateString();
      const label = d === today ? "Today" : d === yesterday ? "Yesterday" : "Earlier";
      const group = out.find((g) => g.label === label) ?? (out.push({ label, tasks: [] }), out[out.length - 1]!);
      group.tasks.push(t);
    }
    return out;
  }, [filtered]);
  const waitingCount = tasks.filter((t) => t.status === "waiting").length;

  return (
    <>
      <header class="page-head">
        <h1>Activity</h1>
        <div class="chips" role="group" aria-label="Filter">
          {(["all", "waiting", "done", "stopped"] as const).map((f) => (
            <button key={f} class={`chip ${filter === f ? "chip-on" : ""}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f === "all" ? "All" : f === "waiting" ? `Active${waitingCount ? ` · ${waitingCount}` : ""}` : f === "done" ? "Done" : "Stopped"}
            </button>
          ))}
        </div>
      </header>
      <main class="screen-body">
        {groups.length === 0 && <p class="empty">Nothing here yet.</p>}
        {groups.map((g) => (
          <section class="stack-sm" key={g.label}>
            <h3>{g.label}</h3>
            <div class="card list">
              {g.tasks.map((t) => (
                <button class="task-row" key={t.id} onClick={() => onOpenTask(t.id)}>
                  <StatusDot status={t.status} />
                  <span class="grow col">
                    <span class="row-title">{title(t)}</span>
                    <span class="row-meta">{STATUS_TEXT[t.status]} · {t.steps.length} step{t.steps.length === 1 ? "" : "s"}</span>
                  </span>
                  <span class="row-meta">{clock(t.createdAt)}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </main>
    </>
  );
}

function Settings(props: { mac?: MacStatus; macName: string; send: Connection["send"]; onUnpair: () => void }) {
  const { mac } = props;
  return (
    <>
      <header class="page-head"><h1>Settings</h1></header>
      <main class="screen-body">
        <h3>This Mac</h3>
        <div class="card list">
          <div class="set-row"><span class="grow">Name</span><span class="muted">{mac?.name ?? props.macName}</span></div>
          <div class="set-row">
            <span class="grow">Pause agent</span>
            <button
              role="switch"
              aria-checked={!!mac?.paused}
              aria-label="Pause agent"
              class={`switch ${mac?.paused ? "switch-on" : ""}`}
              disabled={!mac}
              onClick={() => props.send({ type: "agent.pause", paused: !mac?.paused })}
            ><span /></button>
          </div>
          <div class="set-row"><span class="grow">Model</span><span class="muted mono">{mac?.model ?? "—"}</span></div>
          <div class="set-row"><span class="grow">Agent version</span><span class="muted">{mac?.version ?? "—"}</span></div>
        </div>

        <h3>Allowed folders</h3>
        <div class="card list">
          {(mac?.allowedFolders ?? []).map((f) => (
            <div class="set-row" key={f}><Icon name="folder" size={18} style={{ color: "var(--ink-2)" }} /><span class="mono">{f.replace(/^\/Users\/[^/]+/, "~")}</span></div>
          ))}
          {!mac?.allowedFolders?.length && <div class="set-row muted">Connect to your Mac to see its folders.</div>}
        </div>
        <p class="hint">Change folders on the Mac with ERRAND_FOLDERS. Errand asks before sending email, running unknown commands, or touching files outside these folders.</p>

        <button class="btn btn-stop-all" disabled={!mac} onClick={() => props.send({ type: "stop.all" })}>
          <Icon name="stop" size={18} />Stop everything
        </button>
        <button
          class="btn btn-secondary"
          onClick={() => {
            if (confirm("Unpair this phone? You'll need to scan a new code from your Mac.")) props.onUnpair();
          }}
        >
          Unpair this phone
        </button>
      </main>
    </>
  );
}

function TabBar({ view, onChange }: { view: string; onChange: (name: "home" | "activity" | "settings") => void }) {
  const tabs = [
    { name: "home", label: "Home", icon: "home" },
    { name: "activity", label: "Activity", icon: "activity" },
    { name: "settings", label: "Settings", icon: "settings" },
  ] as const;
  return (
    <nav class="tabbar" aria-label="Main">
      {tabs.map((t) => (
        <button key={t.name} class={`tab ${view === t.name ? "tab-on" : ""}`} aria-current={view === t.name ? "page" : undefined} onClick={() => onChange(t.name)}>
          <Icon name={t.icon} size={22} />
          {t.label}
        </button>
      ))}
    </nav>
  );
}

render(<App />, document.getElementById("app")!);
