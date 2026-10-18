'use client';

/**
 * The build bench — Power's workspace, inspired by the desktop-agent genre
 * but built around this product's own pipeline: every session runs the
 * spec → gate → build → verify → receipt pipeline live in the center stage,
 * with the run log, produced files, and verification state inspectable in
 * the right rail. Nothing here clones another product's copy or layout;
 * the grammar (rail, sessions, composer, panels) is the genre's, the
 * behavior is Power's.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'motion/react';
import {
  Home, PanelsTopLeft, BookOpen, CreditCard, Bot, PanelLeft, PanelRight,
  SquarePen, Hourglass, BadgeCheck, ArrowUp, Plus, ChevronDown, X,
  Globe, FolderClosed, SquareTerminal, GitBranch, Search, ListChecks,
  FileCode2, ShieldCheck, CircleCheck, CircleX,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { SITE } from '@/lib/site';
import { buildScript, PLACEHOLDERS, type Step } from '@/lib/run-script';
import { Button } from '@/components/ui/button';

type Session = {
  id: number;
  title: string;
  idea: string;
  script: Step[];
  shown: Step[];
  waiting: Step | null;
  done: boolean;
};

const RAIL = [
  { icon: Home, label: 'Site home', href: '/' },
  { icon: PanelsTopLeft, label: 'Build bench', href: '/app/', active: true },
  { icon: BookOpen, label: 'Docs', href: '/docs/' },
  { icon: CreditCard, label: 'Pricing', href: '/pricing/' },
  { icon: Bot, label: 'Tools', href: '/docs/tools/' },
];

const MODES = [
  { name: 'Careful', pace: 1.5, hint: 'Full gates, slow narration' },
  { name: 'Balanced', pace: 1, hint: 'Gates on, normal pace' },
  { name: 'Fast', pace: 0.45, hint: 'Gates on, brisk playback' },
] as const;

type Panel = 'run' | 'files' | 'verify';
const PANELS: { id: Panel; label: string; icon: typeof Globe }[] = [
  { id: 'run', label: 'Run', icon: ListChecks },
  { id: 'files', label: 'Files', icon: FileCode2 },
  { id: 'verify', label: 'Verify', icon: ShieldCheck },
];

function slugify(text: string): string {
  return text.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 42) || 'untitled-build';
}

export function Workspace() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [idea, setIdea] = useState('');
  const [placeholder, setPlaceholder] = useState(PLACEHOLDERS[0]);
  const [mode, setMode] = useState<(typeof MODES)[number]>(MODES[1]);
  const [modeOpen, setModeOpen] = useState(false);
  const [panel, setPanel] = useState<Panel>('run');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [notice, setNotice] = useState(true);
  const threadRef = useRef<HTMLDivElement>(null);

  const active = sessions.find((s) => s.id === activeId) ?? null;
  const verified = sessions.filter((s) => s.done).length;

  /* On narrow screens both rails start collapsed so the composer keeps
     usable width; each stays one tap away in the tab bar. */
  useEffect(() => {
    if (window.innerWidth < 1100) setSidebarOpen(false);
    if (window.innerWidth < 900) setRightOpen(false);
  }, []);

  /* Cycle the composer placeholder until the first session exists. */
  useEffect(() => {
    if (sessions.length > 0) return;
    let i = 0;
    const id = setInterval(() => {
      i = (i + 1) % PLACEHOLDERS.length;
      setPlaceholder(PLACEHOLDERS[i]);
    }, 2600);
    return () => clearInterval(id);
  }, [sessions.length]);

  /* Play the active session's script, pausing at every approval gate. */
  useEffect(() => {
    if (!active || active.done || active.waiting) return;
    const next = active.script[active.shown.length];
    if (!next) {
      setSessions((prev) => prev.map((s) => (s.id === active.id ? { ...s, done: true } : s)));
      return;
    }
    if (next.kind === 'ask') {
      setSessions((prev) => prev.map((s) => (s.id === active.id ? { ...s, waiting: next } : s)));
      return;
    }
    const id = setTimeout(() => {
      setSessions((prev) =>
        prev.map((s) => (s.id === active.id ? { ...s, shown: [...s.shown, next] } : s)),
      );
    }, (next.ms ?? 620) * mode.pace);
    return () => clearTimeout(id);
  }, [active, mode.pace]);

  /* Keep the newest line in view. */
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [active?.shown.length, active?.waiting, activeId]);

  function send() {
    const text = idea.trim() || placeholder;
    const id = Date.now();
    const session: Session = {
      id,
      title: slugify(text),
      idea: text,
      script: buildScript(text),
      shown: [],
      waiting: null,
      done: false,
    };
    setSessions((prev) => [...prev, session]);
    setActiveId(id);
    setIdea('');
    setPanel('run');
  }

  function approve() {
    if (!active?.waiting) return;
    const step = active.waiting;
    setSessions((prev) =>
      prev.map((s) => (s.id === active.id ? { ...s, shown: [...s.shown, step], waiting: null } : s)),
    );
  }

  function newSession() {
    setActiveId(null);
    setIdea('');
  }

  return (
    <div className="fixed inset-0 z-50 flex overflow-hidden bg-paper text-ink">
      {/* wallpaper stage */}
      <div aria-hidden className="absolute inset-0">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: 'url(/wallpapers/misty-teal.jpg)' }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-black/30 to-black/60" />
      </div>

      {/* icon rail */}
      <nav aria-label="Primary" className="relative z-10 flex w-16 shrink-0 flex-col items-center gap-1.5 py-4">
        {RAIL.map(({ icon: Icon, label, href, active: on }) => (
          <Link
            key={label}
            href={href}
            aria-label={label}
            aria-current={on ? 'page' : undefined}
            className={cn(
              'flex size-11 items-center justify-center rounded-2xl transition-colors',
              on ? 'bg-white/12 text-bright' : 'text-bright/55 hover:bg-white/8 hover:text-bright',
            )}
          >
            <Icon className="size-5" strokeWidth={1.8} />
          </Link>
        ))}
        <div className="mt-auto flex size-9 items-center justify-center rounded-full bg-white/12 text-[0.72rem] font-bold text-bright">
          A
        </div>
      </nav>

      {/* sessions sidebar */}
      <aside
        className={cn(
          'relative z-10 flex shrink-0 flex-col border-r border-white/8 bg-black/25 backdrop-blur-xl transition-[width,opacity] duration-300 max-md:absolute max-md:z-20 max-md:h-full max-md:shadow-2xl',
          sidebarOpen ? 'w-72 opacity-100' : 'w-0 overflow-hidden opacity-0',
        )}
      >
        <div className="flex items-center justify-between px-5 pb-3 pt-5">
          <Link href="/" className="serif text-[1.35rem] font-semibold tracking-tight text-bright">
            {SITE.name}
          </Link>
          <span className="rounded-full bg-accent/90 px-2 py-0.5 text-[0.68rem] font-bold text-accent-ink">
            bench
          </span>
        </div>

        <div className="space-y-0.5 px-3">
          <SidebarRow icon={SquarePen} label="New session" onClick={newSession} />
          <SidebarRow icon={Hourglass} label="Sessions today" badge={String(sessions.length)} />
          <SidebarRow icon={BadgeCheck} label="Verified" badge={String(verified)} />
        </div>

        <div className="mt-6 px-5">
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-bright/45">Sessions</p>
        </div>
        <div className="mt-1.5 max-h-64 space-y-0.5 overflow-y-auto px-3">
          {sessions.length === 0 && (
            <p className="px-3 py-2 text-[0.86rem] text-bright/50">
              Nothing running yet. Describe a build below and watch the gates work.
            </p>
          )}
          {sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveId(s.id)}
              className={cn(
                'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[0.92rem] transition-colors',
                s.id === activeId ? 'bg-white/12 text-bright' : 'text-bright/75 hover:bg-white/8 hover:text-bright',
              )}
            >
              <SquarePen className="size-4.5 shrink-0" strokeWidth={1.8} />
              <span className="min-w-0 flex-1 truncate">{s.title}</span>
              {s.done && <CircleCheck className="size-4 shrink-0 text-accent" />}
            </button>
          ))}
        </div>

        <div className="mt-auto border-t border-white/8 px-5 py-4">
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-bright/45">Power</p>
          <div className="mt-2.5 space-y-0.5">
            <SidebarRow icon={BookOpen} label="How gates work" href="/docs/" />
            <SidebarRow icon={SquareTerminal} label="Connect your AI" href="/docs/quickstart/" />
            <SidebarRow icon={ArrowUp} label="Upgrade" href="/pricing/" />
          </div>
        </div>
      </aside>

      {/* main column */}
      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        {/* tab bar */}
        <div className="flex h-12 shrink-0 items-center gap-2 px-3 pt-2">
          <button
            aria-label="Toggle sessions"
            onClick={() => setSidebarOpen((v) => !v)}
            className="rounded-lg p-2 text-bright/60 transition-colors hover:bg-white/8 hover:text-bright"
          >
            <PanelLeft className="size-4.5" />
          </button>
          <button
            aria-label="Toggle panels"
            onClick={() => setRightOpen((v) => !v)}
            className="rounded-lg p-2 text-bright/60 transition-colors hover:bg-white/8 hover:text-bright"
          >
            <PanelRight className="size-4.5" />
          </button>
          <div className="flex h-9 min-w-0 max-w-64 items-center gap-2 overflow-hidden rounded-xl border border-white/10 bg-black/30 px-3.5 text-[0.86rem] text-bright/90 backdrop-blur-md">
            <span className="truncate">{active ? active.title : 'New session'}</span>
            {active && (
              <button aria-label="Close session view" onClick={newSession} className="shrink-0">
                <X className="size-3.5 text-bright/40 hover:text-bright" />
              </button>
            )}
          </div>
          <div className="ml-auto flex items-center gap-2">
            {notice && (
              <span className="hidden h-9 items-center rounded-xl border border-white/10 bg-black/30 px-3.5 text-[0.8rem] text-bright/70 backdrop-blur-md md:flex">
                Gates check every step before you see it.
                <Link href="/docs/" className="ml-1.5 text-bright underline underline-offset-2">How</Link>
                <button aria-label="Dismiss" onClick={() => setNotice(false)} className="ml-2">
                  <X className="size-3.5 text-bright/40 hover:text-bright" />
                </button>
              </span>
            )}
            <button aria-label="New session" onClick={newSession} className="rounded-lg p-2 text-bright/60 hover:bg-white/8 hover:text-bright">
              <Plus className="size-4.5" />
            </button>
          </div>
        </div>

        {/* center stage */}
        {!active ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 pb-24">
            <svg viewBox="0 0 96 96" aria-hidden className="mb-8 h-40 w-40 text-bright/[0.07]">
              <path fill="currentColor" d="M20 12h56v16H40v12h28v16H40v28H20z" />
            </svg>
            <p className="mb-6 max-w-md text-center text-[0.95rem] text-bright/60">
              Describe what to build. The bench plans it, gates each step, and hands you a verification
              receipt — nothing ships unchecked.
            </p>
            <Composer
              idea={idea}
              setIdea={setIdea}
              placeholder={placeholder}
              mode={mode}
              setMode={setMode}
              modeOpen={modeOpen}
              setModeOpen={setModeOpen}
              send={send}
            />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col px-6 pb-4">
            <div ref={threadRef} className="mono min-h-0 flex-1 space-y-1.5 overflow-y-auto py-4 text-[0.8rem] text-white/70">
              <p className="mb-3 rounded-xl border border-white/10 bg-black/35 px-4 py-3 font-sans text-[0.95rem] text-bright backdrop-blur-md">
                <span className="text-bright/50">Build: </span>{active.idea}
              </p>
              <AnimatePresence initial={false}>
                {active.shown.map((s, i) => (
                  <motion.div
                    key={`${active.id}-${i}`}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                  >
                    <StepLine step={s} />
                  </motion.div>
                ))}
              </AnimatePresence>
              {active.waiting?.kind === 'ask' && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-2 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent/40 bg-accent/10 p-3"
                >
                  <span className="font-sans">
                    <b className="block text-[0.95rem] font-semibold text-white">{active.waiting.title}</b>
                    <span className="text-[0.82rem] text-white/60">{active.waiting.sub}</span>
                  </span>
                  <Button onClick={approve} size="sm" className="rounded-lg">{active.waiting.label}</Button>
                </motion.div>
              )}
              {active.done && (
                <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="pt-2 text-[0.74rem] text-white/40">
                  Run complete. This is the bench narrating the pipeline — connect your AI and the same
                  gates run for real.
                </motion.p>
              )}
            </div>
            <div className="mx-auto w-full max-w-2xl pt-2">
              <Composer
                idea={idea}
                setIdea={setIdea}
                placeholder="Describe the next build…"
                mode={mode}
                setMode={setMode}
                modeOpen={modeOpen}
                setModeOpen={setModeOpen}
                send={send}
                compact
              />
            </div>
          </div>
        )}
      </div>

      {/* right rail */}
      <aside
        className={cn(
          'relative z-10 flex shrink-0 flex-col border-l border-white/8 bg-black/25 backdrop-blur-xl transition-[width,opacity] duration-300 max-md:absolute max-md:right-0 max-md:z-20 max-md:h-full max-md:shadow-2xl',
          rightOpen ? 'w-64 opacity-100' : 'w-0 overflow-hidden opacity-0',
        )}
      >
        <div className="flex gap-1 p-3">
          {PANELS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setPanel(id)}
              className={cn(
                'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[0.8rem] transition-colors',
                panel === id ? 'bg-white/12 text-bright' : 'text-bright/55 hover:bg-white/8 hover:text-bright',
              )}
            >
              <Icon className="size-3.5" strokeWidth={2} />
              {label}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
          {!active ? (
            <RailEmpty />
          ) : panel === 'run' ? (
            <RailRun session={active} />
          ) : panel === 'files' ? (
            <RailFiles session={active} />
          ) : (
            <RailVerify session={active} />
          )}
        </div>
        <div className="hidden gap-1 border-t border-white/8 p-3 lg:flex">
          {[
            { icon: Globe, label: 'Preview' },
            { icon: FolderClosed, label: 'Project' },
            { icon: SquareTerminal, label: 'MCP' },
            { icon: GitBranch, label: 'Diff' },
          ].map(({ icon: Icon, label }) => (
            <span
              key={label}
              className="flex flex-1 flex-col items-center gap-1 rounded-lg py-2 text-[0.68rem] text-bright/45"
            >
              <Icon className="size-4" strokeWidth={1.8} />
              {label}
            </span>
          ))}
        </div>
      </aside>
    </div>
  );
}

function Composer({
  idea, setIdea, placeholder, mode, setMode, modeOpen, setModeOpen, send, compact,
}: {
  idea: string;
  setIdea: (v: string) => void;
  placeholder: string;
  mode: (typeof MODES)[number];
  setMode: (m: (typeof MODES)[number]) => void;
  modeOpen: boolean;
  setModeOpen: (v: boolean | ((p: boolean) => boolean)) => void;
  send: () => void;
  compact?: boolean;
}) {
  return (
    <div className="w-full rounded-2xl border border-white/12 bg-black/45 p-3 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.8)] backdrop-blur-xl">
      <textarea
        value={idea}
        onChange={(e) => setIdea(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
        }}
        rows={compact ? 2 : 3}
        placeholder={`Ask ${SITE.name}… Use / for commands — e.g. ${placeholder}`}
        aria-label="Describe what to build"
        className="w-full resize-none bg-transparent px-2 py-1.5 text-[1rem] text-bright outline-none placeholder:text-bright/45"
      />
      <div className="mt-1 flex items-center justify-between">
        <div className="relative">
          <button
            onClick={() => setModeOpen((v) => !v)}
            aria-haspopup="listbox"
            aria-expanded={modeOpen}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[0.88rem] text-bright/75 transition-colors hover:bg-white/8 hover:text-bright"
          >
            {mode.name}
            <ChevronDown className="size-3.5 text-bright/50" />
          </button>
          {modeOpen && (
            <div role="listbox" className="absolute bottom-11 left-0 w-60 overflow-hidden rounded-xl border border-white/12 bg-[#1d1d19]/95 shadow-2xl backdrop-blur-xl">
              {MODES.map((m) => (
                <button
                  key={m.name}
                  role="option"
                  aria-selected={m.name === mode.name}
                  onClick={() => { setMode(m); setModeOpen(false); }}
                  className={cn(
                    'block w-full px-4 py-2.5 text-left transition-colors hover:bg-white/8',
                    m.name === mode.name ? 'text-accent' : 'text-bright/75',
                  )}
                >
                  <span className="block text-[0.88rem]">{m.name}</span>
                  <span className="block text-[0.72rem] text-bright/45">{m.hint}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="mono hidden text-[0.68rem] text-bright/35 sm:block">⏎ send · ⇧⏎ newline</span>
          <Button size="sm" className="rounded-lg px-4" aria-label="Start the build" onClick={send}>
            Build <ArrowUp className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function StepLine({ step }: { step: Step }) {
  if (step.kind === 'say') {
    return <p className="py-1 pl-7 font-sans text-[0.88rem] text-white/55 before:-ml-5 before:mr-2 before:text-white/25 before:content-['›']">{step.text}</p>;
  }
  if (step.kind === 'call') {
    const ok = step.state === 'ok';
    return (
      <div className={cn('grid grid-cols-[1.1rem_minmax(0,1fr)_auto] items-baseline gap-x-2.5 rounded-lg px-2 py-1.5', !ok && 'border border-dashed border-refuse/40')}>
        {ok ? <CircleCheck className="size-3.5 self-center text-[#6ee7a8]" /> : <CircleX className="size-3.5 self-center text-[#fca5a5]" />}
        <span className="break-words text-white">
          {step.tool}{step.args && <span className="ml-2 text-white/35">{step.args}</span>}
        </span>
        <span className={cn('text-[0.72rem]', ok ? 'text-[#6ee7a8]' : 'text-[#fca5a5]')}>{step.status}</span>
      </div>
    );
  }
  if (step.kind === 'gate') {
    return (
      <div className="ml-7 rounded-r-lg border border-l-2 border-[#fca5a5]/30 border-l-[#fca5a5] bg-[#fca5a5]/5 px-3 py-2 font-sans">
        <b className="font-semibold text-[#fecaca]">{step.rule}</b>
        <span className="text-[0.85rem] text-white/55"> — {step.text}</span>
        <small className="mono mt-1 block text-[0.7rem] text-white/35">{step.foot}</small>
      </div>
    );
  }
  if (step.kind === 'files') {
    return (
      <div className="ml-7 grid gap-1">
        {step.items.map((f) => (
          <div key={f} className="flex items-baseline gap-2.5 text-white/60">
            <span className="text-[#6ee7a8]">✓</span><span>write_file</span><span className="text-white/35">{f}</span>
          </div>
        ))}
      </div>
    );
  }
  if (step.kind === 'tests') {
    return (
      <div className="ml-7 flex flex-wrap gap-1.5 py-1">
        {Array.from({ length: step.total }, (_, i) => (
          <motion.i
            key={i}
            initial={{ opacity: 0, scale: 0.4 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.05 }}
            className="size-2.5 rounded-full bg-[#6ee7a8]"
          />
        ))}
      </div>
    );
  }
  if (step.kind === 'receipt') {
    return (
      <div className="mt-2 rounded-xl border border-[#6ee7a8]/30 bg-[#6ee7a8]/5 p-3 font-sans">
        <b className="text-[0.95rem] font-semibold text-white">Verification receipt · v1 live</b>
        <p className="mt-1 text-[0.82rem] text-white/55">13 build actions · 1 refusal (unbilled) · git tag v1 · rollback ready</p>
      </div>
    );
  }
  return null;
}

function RailEmpty() {
  return (
    <div className="pt-8 text-center">
      <Search className="mx-auto size-6 text-bright/25" />
      <p className="mt-3 text-[0.85rem] text-bright/55">Start a session and this rail fills with its run log, files, and verification state.</p>
      <p className="mono mt-2 text-[0.7rem] text-bright/35">run · files · verify</p>
    </div>
  );
}

function RailRun({ session }: { session: Session }) {
  const calls = session.shown.filter((s) => s.kind === 'call');
  if (calls.length === 0) {
    return <p className="pt-8 text-center text-[0.85rem] text-bright/55">Planning… tool calls land here as they run.</p>;
  }
  return (
    <ul className="mono space-y-1 pt-2 text-[0.74rem]">
      {calls.map((s, i) => (
        s.kind === 'call' && (
          <li key={i} className="flex items-center gap-2 rounded-lg bg-white/[0.04] px-2.5 py-1.5">
            <span className={s.state === 'ok' ? 'text-[#6ee7a8]' : 'text-[#fca5a5]'}>
              {s.state === 'ok' ? '✓' : '×'}
            </span>
            <span className="min-w-0 flex-1 truncate text-white/75">{s.tool}</span>
            <span className={s.state === 'ok' ? 'text-white/35' : 'text-[#fca5a5]/80'}>
              {s.state === 'ok' ? 'ok' : 'held'}
            </span>
          </li>
        )
      ))}
    </ul>
  );
}

function RailFiles({ session }: { session: Session }) {
  const files = session.shown.flatMap((s) => (s.kind === 'files' ? s.items : []));
  if (files.length === 0) {
    return <p className="pt-8 text-center text-[0.85rem] text-bright/55">No files yet — they appear here the moment the bench writes them.</p>;
  }
  return (
    <ul className="mono space-y-1 pt-2 text-[0.78rem]">
      {files.map((f) => (
        <li key={f} className="flex items-center gap-2.5 rounded-lg bg-white/[0.04] px-2.5 py-1.5 text-white/75">
          <FileCode2 className="size-3.5 shrink-0 text-accent" />
          <span className="min-w-0 flex-1 truncate">{f}</span>
        </li>
      ))}
    </ul>
  );
}

function RailVerify({ session }: { session: Session }) {
  const gates = session.shown.filter((s) => s.kind === 'gate').length;
  const testTotals = session.shown.filter((s) => s.kind === 'tests');
  const tests = testTotals.reduce((n, s) => n + (s.kind === 'tests' ? s.total : 0), 0);
  const receipt = session.shown.some((s) => s.kind === 'receipt');
  const rows: [string, string][] = [
    ['Gates tripped', String(gates)],
    ['Tests green', tests > 0 ? `${tests}/${tests}` : '—'],
    ['Refusals billed', '0'],
    ['Receipt', receipt ? 'issued' : session.done ? 'pending' : 'running'],
  ];
  return (
    <div className="pt-2">
      <ul className="space-y-1">
        {rows.map(([k, v]) => (
          <li key={k} className="flex items-center justify-between rounded-lg bg-white/[0.04] px-3 py-2 text-[0.82rem]">
            <span className="text-bright/60">{k}</span>
            <span className={cn('font-semibold', receipt && k === 'Receipt' ? 'text-accent' : 'text-bright')}>{v}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[0.76rem] leading-relaxed text-bright/45">
        Verification re-exercises every requirement by interaction — it never just re-reads the code.
      </p>
      {!session.done && (
        <Link href="/proof/" className="mt-3 flex items-center gap-1.5 text-[0.82rem] text-accent hover:underline">
          <ShieldCheck className="size-3.5" /> See what a receipt proves
        </Link>
      )}
    </div>
  );
}

function SidebarRow({
  icon: Icon, label, badge, href, onClick,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  badge?: string;
  href?: string;
  onClick?: () => void;
}) {
  const inner = (
    <>
      <Icon className="size-4.5 shrink-0" strokeWidth={1.8} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge && (
        <span className="rounded-full bg-accent/90 px-2 py-0.5 text-[0.68rem] font-bold text-accent-ink">
          {badge}
        </span>
      )}
    </>
  );
  const cls =
    'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[0.92rem] text-bright/75 transition-colors hover:bg-white/8 hover:text-bright';
  if (href) return <Link href={href} className={cls}>{inner}</Link>;
  return <button onClick={onClick} className={cls}>{inner}</button>;
}
