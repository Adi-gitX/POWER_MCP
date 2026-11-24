/**
 * "New app" — one dialog from idea to the assistant, on the MCP server's
 * pages (compiled by scripts/build-otp.mjs, mounted where a page has
 * [data-new-app]).
 *
 *   first app:     coding tool → name it → setting up → opening the tool
 *   after that:    name it (tool picked inline) → setting up → opening
 *   your own code: where it is → … the same
 *
 * Setup is real and runs on the server; this polls it. The hand-off opens the
 * tool's native link with the message typed in, watches the browser lose
 * focus as the cue that it opened, and offers recovery if it did not.
 */
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

type ToolId = "claude-code" | "cursor" | "codex" | "other";
type Tool = { id: ToolId; name: string; blurb: string; mark: string };
type Config = { csrf: string; tools: Tool[]; tool: ToolId | null; returning: boolean; powerUp: boolean };
type Stage = { id: string; title: string; state: "waiting" | "working" | "done" | "attention" | "skipped" | "failed"; detail?: string };
type Blocker = { stage: string; title: string; description: string; action?: { label: string; href: string }; canSkip: boolean };
type Handoff = {
  tool: ToolId; tool_name: string; message: string; deeplink: string | null; download_url: string | null;
  opened_hint: string; terminal: string | null; connect_first: boolean; project_url: string;
};
type Job = { id: string; name: string; stages: Stage[]; blocker: Blocker | null; failure: string | null; done: boolean; project_id: string | null; handoff: Handoff | null };
type Step = "source" | "tool" | "details" | "setup" | "launch";
type Mode = "new" | "import";

const EASE = [0.23, 1, 0.32, 1] as const;
const PICK_PAUSE_MS = 250;
const POLL_MS = 2000;
const HANDOFF_MS = 700;

const journey = (importing: boolean, returning: boolean): Step[] => [
  ...(importing ? (["source"] as const) : []),
  ...(returning ? [] : (["tool"] as const)),
  "details",
  "setup",
  "launch",
];

const toSlug = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-/, "").slice(0, 30);
const trimSlug = (s: string) => s.replace(/-+$/, "");
const NAME = /^[a-z](?:[a-z0-9]|-[a-z0-9]){0,29}$/;

async function api<T>(path: string, csrf: string, body?: unknown): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers: { accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json", "x-power-csrf": csrf }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status, data: (await res.json().catch(() => ({}))) as T };
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = Object.assign(document.createElement("textarea"), { value: text });
    ta.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

// ----------------------------------------------------------------- pieces

function Spinner({ size = 16 }: { size?: number }) {
  return <span aria-hidden className="na-spin" style={{ width: size, height: size }} />;
}

function Check() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className="na-check"><path d="M5 10.5l3.2 3L15 6.8" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
  );
}

function StageIcon({ id }: { id: string }) {
  const paths: Record<string, string> = {
    prepare: "M10 3v3M10 14v3M3 10h3M14 10h3M5 5l2 2M13 13l2 2M15 5l-2 2M7 13l-2 2",
    project: "M7 6l-4 4 4 4M13 6l4 4-4 4",
    connect: "M8 12l4-4M7.5 9.5L6 11a2.5 2.5 0 103.5 3.5l1.5-1.5M12.5 10.5L14 9a2.5 2.5 0 10-3.5-3.5L9 7",
    hosting: "M10 3a7 7 0 100 14 7 7 0 000-14zM3 10h14M10 3c2 2.2 2 11.8 0 14M10 3c-2 2.2-2 11.8 0 14",
    database: "M4 5.5C4 4.1 6.7 3 10 3s6 1.1 6 2.5S13.3 8 10 8 4 6.9 4 5.5zM4 5.5v9C4 15.9 6.7 17 10 17s6-1.1 6-2.5v-9M4 10c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5",
    finish: "M3.5 6.5h5l1.5 2h6.5v7.5h-13z",
  };
  return <svg aria-hidden viewBox="0 0 20 20" className="na-icon"><path d={paths[id] ?? paths.finish} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function Dots({ count, current }: { count: number; current: number }) {
  return (
    <div className="na-dots" aria-hidden>
      {Array.from({ length: count }, (_, i) => <span key={i} data-on={i === current || undefined} />)}
    </div>
  );
}

function Header({ id, title, description }: { id: string; title: string; description?: ReactNode }) {
  return (
    <div className="na-head">
      <h2 id={id}>{title}</h2>
      {description ? <p>{description}</p> : null}
    </div>
  );
}

function PowerUpSwitch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} className="na-powerup" data-on={on || undefined} onClick={() => onChange(!on)}>
      <span className="na-powerup-copy">
        <strong>Power Up</strong>
        <em>{on ? "Research, a plan you approve, and verification before publishing" : "Off: straight to the build. Turn on for research, a plan and verification"}</em>
      </span>
      <span className="na-switch" aria-hidden><span /></span>
    </button>
  );
}

// ------------------------------------------------------------------ steps

function ToolStep({ titleId, tools, toolId, onPick }: { titleId: string; tools: Tool[]; toolId: ToolId | null; onPick: (id: ToolId) => void }) {
  const main = tools.filter((t) => t.id !== "other");
  return (
    <>
      <Header id={titleId} title="Which coding tool do you use?" description="Power hands your app to it, already set up and ready to build" />
      <div className="na-options" role="radiogroup" aria-labelledby={titleId}>
        {main.map((t) => (
          <label key={t.id} className="na-option" data-on={t.id === toolId || undefined}>
            <input type="radio" name="tool" value={t.id} checked={t.id === toolId} onChange={() => onPick(t.id)} onKeyDown={(e) => { if (e.key === "Enter") onPick(t.id); }} />
            <span className="na-mark" aria-hidden>{t.mark}</span>
            <span className="na-option-body"><strong>{t.name}</strong><em>{t.blurb}</em></span>
          </label>
        ))}
      </div>
      <p className="na-quiet"><button type="button" className="na-link" onClick={() => onPick("other")}>Use another tool</button></p>
    </>
  );
}

function SourceStep({ titleId, path, onChange }: { titleId: string; path: string; onChange: (v: string) => void }) {
  return (
    <>
      <Header id={titleId} title="Where is your app?" description="Your assistant brings the code into a Power project. Nothing is uploaded from this page" />
      <label className="na-field">
        <span>Folder on this computer <b aria-hidden>*</b></span>
        <input value={path} onChange={(e) => onChange(e.target.value)} placeholder="~/code/my-app" autoFocus spellCheck={false} required />
      </label>
      <p className="na-quiet">Secrets stay where they are: .env files, node_modules and build output are skipped.</p>
    </>
  );
}

function DetailsStep({
  titleId, tool, tools, onTool, inlineTool, name, onName, description, onDescription, powerUp, onPowerUp, problem,
}: {
  titleId: string; tool: Tool | undefined; tools: Tool[]; onTool: (id: ToolId) => void; inlineTool: boolean;
  name: string; onName: (v: string) => void; description: string; onDescription: (v: string) => void;
  powerUp: boolean; onPowerUp: (v: boolean) => void; problem: string | null;
}) {
  const slug = trimSlug(name);
  return (
    <>
      <Header id={titleId} title="Name your app" description={`We’ll pass this to ${tool?.name ?? "your assistant"}`} />
      {inlineTool && (
        <div className="na-segment" role="radiogroup" aria-label="Coding tool">
          {tools.map((t) => (
            <button key={t.id} type="button" role="radio" aria-checked={t.id === tool?.id} data-on={t.id === tool?.id || undefined} onClick={() => onTool(t.id)}>
              {t.id === "other" ? "Other" : t.name}
            </button>
          ))}
        </div>
      )}
      <label className="na-field">
        <span>Name <b aria-hidden>*</b></span>
        <input
          value={name}
          onChange={(e) => onName(toSlug(e.target.value))}
          onBlur={() => onName(slug)}
          placeholder="studio-bookings"
          maxLength={30}
          autoFocus={!inlineTool}
          aria-invalid={Boolean(problem) || undefined}
          required
        />
      </label>
      <p className="na-hint" aria-live="polite">
        {problem ? <span className="na-bad">{problem}</span> : slug ? <>It will be <strong>{slug}</strong> in Power, and on Vercel when you publish</> : " "}
      </p>
      <label className="na-field">
        <span>What should it do? (optional)</span>
        <textarea value={description} onChange={(e) => onDescription(e.target.value)} rows={3} maxLength={1500} placeholder="Bookings for my yoga studio, with class schedules and Stripe checkout" />
      </label>
      <PowerUpSwitch on={powerUp} onChange={onPowerUp} />
    </>
  );
}

function SetupStep({ titleId, job, onRetry, onSkip, checking }: { titleId: string; job: Job | null; onRetry: () => void; onSkip: () => void; checking: boolean }) {
  const reduced = useReducedMotion();
  return (
    <>
      <Header id={titleId} title={`Setting up ${job?.name ?? "your app"}`} description="This can take up to a minute, so don’t close the tab" />
      <ol className="na-stages" aria-label="Setup steps">
        {(job?.stages ?? []).map((s) => {
          const attention = s.state === "attention" || s.state === "failed";
          const blocker = s.state === "attention" ? job?.blocker : null;
          return (
            <motion.li key={s.id} layout={!reduced} data-state={s.state} transition={{ duration: 0.22, ease: EASE }}>
              <span className="na-stage-mark">
                {s.state === "done" ? <Check /> : s.state === "working" ? <Spinner /> : attention ? <span className="na-notice">!</span> : <StageIcon id={s.id} />}
              </span>
              <div className="na-stage-body">
                <strong>{blocker ? blocker.title : s.state === "failed" ? "We couldn’t finish this step" : s.title}</strong>
                {s.detail && !attention ? <em>{s.detail}</em> : null}
                <AnimatePresence initial={false}>
                  {attention && (
                    <motion.div key="banner" className="na-banner" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: reduced ? 0 : 0.22, ease: EASE }}>
                      <p>{blocker ? blocker.description : job?.failure}</p>
                      <div className="na-row">
                        {blocker?.action && <a className="na-btn na-btn-primary na-btn-sm" href={blocker.action.href} target="_blank" rel="noopener">{blocker.action.label}</a>}
                        {blocker && <button type="button" className="na-btn na-btn-sm" onClick={onRetry} disabled={checking}>{checking ? "Checking…" : "Try again"}</button>}
                        {blocker?.canSkip && <button type="button" className="na-link" onClick={onSkip}>Skip for now</button>}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.li>
          );
        })}
      </ol>
    </>
  );
}

const NATIVE = /^(cursor|claude-cli|codex):/;

function LaunchStep({ titleId, handoff, onReady, projectId }: { titleId: string; handoff: Handoff; onReady: () => void; projectId: string }) {
  // What is known, in order of certainty: the tool's first call on the
  // project (proof), the person saying it opened, the browser losing focus
  // (only a cue, so it asks rather than claims).
  const [phase, setPhase] = useState<"idle" | "opening" | "asking" | "confirmed" | "picked">("idle");
  const [copied, setCopied] = useState<"message" | "terminal" | null>(null);
  const attempted = useRef(false);
  const hadFocus = useRef(false);
  const name = handoff.tool_name;
  const link = handoff.deeplink && NATIVE.test(handoff.deeplink) ? handoff.deeplink : null;
  // A tool that is not connected yet cannot use Power in a session it is
  // already running, so connecting first (the terminal command) leads.
  const terminalFirst = Boolean(handoff.terminal && handoff.connect_first);

  const open = useCallback(() => {
    if (!link) return;
    attempted.current = true;
    hadFocus.current = document.hasFocus();
    setPhase((p) => (p === "picked" ? p : "opening"));
    try { window.location.href = link; } catch { /* the rows below cover it */ }
  }, [link]);

  const confirm = useCallback(() => {
    setPhase((p) => (p === "picked" ? p : "confirmed"));
    onReady();
  }, [onReady]);

  useEffect(() => {
    if (!link || terminalFirst) return;
    const t = window.setTimeout(open, 1000);
    return () => window.clearTimeout(t);
  }, [link, open, terminalFirst]);

  useEffect(() => {
    const check = () => {
      if (!attempted.current) return;
      const focused = document.hasFocus();
      if (hadFocus.current && !focused) setPhase((p) => (p === "opening" ? "asking" : p));
      hadFocus.current = focused;
    };
    const timer = window.setInterval(check, 250);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const r = await fetch(`/projects/${projectId}/open/status`, { credentials: "same-origin", headers: { accept: "application/json" } });
        const s = (await r.json()) as { picked_up?: boolean };
        if (s.picked_up) { setPhase("picked"); onReady(); return; }
      } catch { /* keep polling */ }
      if (!stop) window.setTimeout(tick, POLL_MS);
    };
    const t = window.setTimeout(tick, POLL_MS);
    return () => { stop = true; window.clearTimeout(t); };
  }, [projectId, onReady]);

  const copy = async (what: "message" | "terminal") => {
    if (!(await copyText(what === "message" ? handoff.message : handoff.terminal!))) return;
    setCopied(what);
    window.setTimeout(() => setCopied(null), 3000);
    onReady();
  };

  const heading = phase === "picked" ? `${name} is building` : terminalFirst ? `Connect ${name} and start building` : link ? `Open ${name}` : `Send it to ${name}`;
  const status =
    phase === "picked"
      ? { title: `${name} picked up your app`, sub: "It made its first call on the project. Follow along in Power.", mark: "done" as const }
      : phase === "confirmed"
        ? { title: `Continue in ${name}`, sub: handoff.opened_hint, mark: "done" as const }
        : phase === "asking"
          ? { title: `Did ${name} open?`, sub: `If it did: ${handoff.opened_hint.toLowerCase()}.`, mark: "ask" as const }
          : phase === "opening"
            ? { title: `Opening ${name}…`, sub: "Look for your browser’s prompt and choose Open", mark: "spin" as const }
            : terminalFirst
              ? { title: `Waiting for ${name}`, sub: "Run the command above. This ticks off when it starts working on the project.", mark: "spin" as const }
              : { title: `Waiting for ${name}`, sub: "Copy the message and send it", mark: "spin" as const };

  return (
    <>
      <Header id={titleId} title={heading} />
      {handoff.terminal && (
        <div className={`na-fast${terminalFirst ? "" : " na-fast-quiet"}`}>
          <strong>{terminalFirst ? "Paste this into Terminal" : `Prefer the terminal? Start ${name} with the message already sent`}</strong>
          {terminalFirst && <em>It connects {name} to your Power account, then starts it with your app ready to build. Nothing else to do.</em>}
          <div className="na-fast-row"><code>{handoff.terminal.length > 90 ? handoff.terminal.slice(0, 87) + "…" : handoff.terminal}</code><button type="button" className={`na-btn na-btn-sm${terminalFirst ? " na-btn-primary" : ""}`} onClick={() => copy("terminal")}>{copied === "terminal" ? "Copied" : "Copy command"}</button></div>
        </div>
      )}
      <div className="na-card">
        <div className="na-card-head">
          <span className="na-stage-mark">{status.mark === "done" ? <Check /> : status.mark === "ask" ? <span className="na-notice">?</span> : <Spinner size={18} />}</span>
          <div><strong>{status.title}</strong><em>{status.sub}</em></div>
          {phase === "asking" && <div className="na-row"><button type="button" className="na-btn na-btn-sm na-btn-primary" onClick={confirm}>It opened</button><button type="button" className="na-btn na-btn-sm" onClick={open}>Try again</button></div>}
        </div>
        <div className="na-tray">
          {link && phase !== "picked" && <div className="na-tray-row"><span>{terminalFirst ? `${name} already connected to Power?` : `${name} didn’t open?`}</span><a className="na-link" href={link} onClick={(e) => { e.preventDefault(); open(); }}>{terminalFirst ? `Open ${name}` : "Try again"}</a></div>}
          {handoff.download_url && phase !== "picked" && <div className="na-tray-row"><span>Don’t have {name} yet?</span><a className="na-link" href={handoff.download_url} target="_blank" rel="noopener">Get {name}</a></div>}
          <div className="na-tray-row"><span>Paste the message into {name} yourself</span><button type="button" className="na-link" onClick={() => copy("message")}>{copied === "message" ? "Copied" : "Copy message"}</button></div>
          {!link && !handoff.terminal && <pre className="na-message">{handoff.message}</pre>}
        </div>
      </div>
    </>
  );
}

// ----------------------------------------------------------------- dialog

function NewAppDialog({ config, mode, onClose }: { config: Config; mode: Mode; onClose: () => void }) {
  const reduced = useReducedMotion();
  const titleId = useId();
  const importing = mode === "import";
  const steps = journey(importing, config.returning);
  const [step, setStep] = useState<Step>(steps[0]!);
  const [dir, setDir] = useState(1);
  const [toolId, setToolId] = useState<ToolId | null>(config.returning ? (config.tool ?? "claude-code") : config.tool);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [path, setPath] = useState("");
  const [powerUp, setPowerUp] = useState(config.powerUp);
  const [problem, setProblem] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [checking, setChecking] = useState(false);
  const [launchReady, setLaunchReady] = useState(false);
  const tool = config.tools.find((t) => t.id === toolId);
  const index = steps.indexOf(step);

  const go = (next: Step, d = 1) => { setDir(d); setStep(next); };

  // Poll the setup job while it runs, and move on by itself once it is done.
  useEffect(() => {
    if (step !== "setup" || !job || job.done || job.failure) return;
    const t = window.setTimeout(async () => {
      const r = await api<Job>(`/api/apps/jobs/${job.id}`, config.csrf);
      if (r.ok) setJob(r.data);
    }, POLL_MS / (job.stages.some((s) => s.state === "attention") ? 1 : 2.5));
    return () => window.clearTimeout(t);
  }, [step, job, config.csrf]);
  useEffect(() => {
    if (step !== "setup" || !job?.done || !job.handoff) return;
    const t = window.setTimeout(() => go("launch"), HANDOFF_MS);
    return () => window.clearTimeout(t);
  }, [step, job]);

  // Escape closes only before setup starts: after that there is a project, and the way out is "Go to".
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape" && (step === "tool" || step === "details" || step === "source")) onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [step, onClose]);

  const create = async () => {
    const slug = trimSlug(name);
    if (!NAME.test(slug)) { setProblem("Use lowercase letters, numbers and single hyphens, starting with a letter."); return; }
    setSubmitting(true);
    setProblem(null);
    const r = await api<Job & { message?: string }>("/api/apps", config.csrf, {
      tool: toolId, name: slug, description, power_up: powerUp, ...(importing ? { import_path: path } : {}),
    });
    setSubmitting(false);
    if (!r.ok) { setProblem(r.data.message ?? "Something went wrong. Try again."); return; }
    setJob({ ...r.data, handoff: null });
    go("setup");
  };

  const action = async (what: "retry" | "skip") => {
    if (!job) return;
    setChecking(true);
    const r = await api<Job>(`/api/apps/jobs/${job.id}/${what}`, config.csrf, {});
    if (what === "retry") await new Promise((res) => setTimeout(res, 600));
    setChecking(false);
    if (r.ok) setJob(r.data);
  };

  const canContinue =
    step === "source" ? path.trim().length > 1 : step === "tool" ? Boolean(toolId) : step === "details" ? Boolean(trimSlug(name)) && Boolean(toolId) && !submitting : step === "launch" ? launchReady : false;

  const next = () => {
    if (!canContinue) return;
    if (step === "source") go(steps[index + 1]!);
    else if (step === "tool") go("details");
    else if (step === "details") void create();
    else if (step === "launch" && job?.handoff) window.location.href = job.handoff.project_url;
  };

  const variants = {
    enter: (d: number) => ({ opacity: 0, x: reduced ? 0 : d * 24 }),
    center: { opacity: 1, x: 0 },
    exit: (d: number) => ({ opacity: 0, x: reduced ? 0 : d * -24 }),
  };
  const before = step === "source" || step === "tool" || step === "details";

  return (
    <motion.div className="na-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} onMouseDown={(e) => { if (e.target === e.currentTarget && before) onClose(); }}>
      <motion.form
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="na-sheet"
        initial={{ opacity: 0, y: reduced ? 0 : 12, scale: reduced ? 1 : 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: reduced ? 0 : 8 }}
        transition={{ duration: 0.26, ease: EASE }}
        onSubmit={(e) => { e.preventDefault(); next(); }}
      >
        <div className="na-body">
          <AnimatePresence mode="wait" custom={dir} initial={false}>
            <motion.div key={step} custom={dir} variants={variants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.22, ease: EASE }}>
              {step === "source" && <SourceStep titleId={titleId} path={path} onChange={setPath} />}
              {step === "tool" && (
                <ToolStep titleId={titleId} tools={config.tools} toolId={toolId} onPick={(id) => { setToolId(id); window.setTimeout(() => go("details"), PICK_PAUSE_MS); }} />
              )}
              {step === "details" && (
                <DetailsStep
                  titleId={titleId} tool={tool} tools={config.tools} onTool={setToolId} inlineTool={config.returning}
                  name={name} onName={(v) => { setName(v); setProblem(null); }} description={description} onDescription={setDescription}
                  powerUp={powerUp} onPowerUp={setPowerUp} problem={problem}
                />
              )}
              {step === "setup" && <SetupStep titleId={titleId} job={job} onRetry={() => void action("retry")} onSkip={() => void action("skip")} checking={checking} />}
              {step === "launch" && job?.handoff && job.project_id && (
                <LaunchStep titleId={titleId} handoff={job.handoff} projectId={job.project_id} onReady={() => setLaunchReady(true)} />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
        <div className="na-foot">
          <Dots count={steps.length} current={index} />
          <div className="na-row">
            {before && <button type="button" className="na-btn" onClick={onClose}>Cancel</button>}
            {before && step !== steps[0] && <button type="button" className="na-btn" onClick={() => go(steps[index - 1]!, -1)}>Back</button>}
            {step !== "tool" && step !== "setup" && (
              <button type="submit" className="na-btn na-btn-primary" disabled={!canContinue}>
                {step === "launch" ? `Go to ${job?.name ?? "your app"}` : step === "details" ? (submitting ? "Creating…" : "Create app") : "Continue"}
              </button>
            )}
          </div>
        </div>
      </motion.form>
    </motion.div>
  );
}

function Root({ config }: { config: Config }) {
  const [mode, setMode] = useState<Mode | null>(null);
  useEffect(() => {
    const open = (e: Event) => {
      const target = (e.target as HTMLElement).closest<HTMLElement>("[data-new-app]");
      if (!target) return;
      e.preventDefault();
      setMode(target.dataset.newApp === "import" ? "import" : "new");
    };
    document.addEventListener("click", open);
    // A link elsewhere can open it straight away: /?new=1
    const q = new URLSearchParams(location.search).get("new");
    if (q) setMode(q === "import" ? "import" : "new");
    return () => document.removeEventListener("click", open);
  }, []);
  useEffect(() => {
    document.documentElement.style.overflow = mode ? "hidden" : "";
  }, [mode]);
  return <AnimatePresence>{mode && <NewAppDialog key={mode} config={config} mode={mode} onClose={() => setMode(null)} />}</AnimatePresence>;
}

function mount() {
  const raw = document.getElementById("new-app-config")?.textContent;
  if (!raw) return;
  // Its own top-level layer, so no stacking context on the page can sit above it.
  const slot = document.createElement("div");
  slot.className = "na-layer";
  document.body.appendChild(slot);
  createRoot(slot).render(<Root config={JSON.parse(raw) as Config} />);
  document.documentElement.classList.add("new-app-ready");
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true });
else mount();
