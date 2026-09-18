'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowRight, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { buildScript, PLACEHOLDERS, type Step } from '@/lib/run-script';
import { cn } from '@/lib/utils';

export function RunConsole() {
  const reduced = useReducedMotion();
  const [idea, setIdea] = useState('');
  const [placeholder, setPlaceholder] = useState(PLACEHOLDERS[0]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [shown, setShown] = useState<Step[]>([]);
  const [waiting, setWaiting] = useState<Step | null>(null);
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const started = steps.length > 0;

  /* cycle the placeholder until someone types */
  useEffect(() => {
    if (started || idea) return;
    let i = 0;
    const id = setInterval(() => {
      i = (i + 1) % PLACEHOLDERS.length;
      setPlaceholder(PLACEHOLDERS[i]);
    }, 2600);
    return () => clearInterval(id);
  }, [started, idea]);

  /* play the script, stopping at every ask */
  useEffect(() => {
    if (!started) return;
    const next = steps[shown.length];
    if (!next) { setDone(true); return; }
    if (next.kind === 'ask') { setWaiting(next); return; }

    timer.current = setTimeout(() => setShown((s) => [...s, next]), reduced ? 60 : (next.ms ?? 620));
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [started, steps, shown.length, reduced]);

  /* keep the newest line in view inside the console only */
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shown.length, waiting]);

  const start = useCallback((text: string) => {
    if (timer.current) clearTimeout(timer.current);
    setShown([]); setWaiting(null); setDone(false);
    setSteps(buildScript(text));
  }, []);

  const approve = useCallback(() => {
    setShown((s) => (waiting ? [...s, waiting] : s));
    setWaiting(null);
  }, [waiting]);

  return (
    <div>
      <form
        onSubmit={(e) => { e.preventDefault(); start(idea || placeholder); }}
        className="mx-auto flex w-full max-w-[38rem] items-center gap-2 rounded-2xl border border-white/45 bg-white/30 p-2 shadow-[0_18px_50px_-28px_rgba(16,40,90,0.65)] backdrop-blur-md"
      >
        <label htmlFor="idea" className="sr-only">What do you want to build?</label>
        <input
          id="idea"
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          placeholder={placeholder}
          maxLength={120}
          className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-[1rem] text-white outline-none placeholder:text-white/80"
        />
        <Button type="submit" size="md" variant="dark" className="shrink-0 rounded-xl">
          Run it <ArrowRight />
        </Button>
      </form>

      <div className="mx-auto mt-6 w-full max-w-[52rem] overflow-hidden rounded-2xl border border-[#23242b] bg-[#101116] shadow-[0_40px_80px_-40px_rgba(25,25,29,0.55)]">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <span className="mono flex items-center gap-2 text-[0.7rem] uppercase tracking-[0.14em] text-white/40">
            <span className="flex gap-1.5">
              <i className="size-2 rounded-full bg-white/20" />
              <i className="size-2 rounded-full bg-white/20" />
              <i className="size-2 rounded-full bg-white/20" />
            </span>
            run console
          </span>
          {started && (
            <button onClick={() => start(idea || placeholder)} className="mono flex items-center gap-1.5 text-[0.7rem] text-white/40 transition-colors hover:text-white/80">
              <RotateCcw className="size-3" /> run again
            </button>
          )}
        </div>

        <div ref={bodyRef} className="mono h-[26rem] space-y-1.5 overflow-y-auto p-4 text-[0.8rem] text-white/70">
          {!started && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <p className="font-sans text-[1.05rem] font-semibold text-white">Nothing running yet.</p>
              <p className="text-[0.78rem] text-white/45">Type what you want to build, or just press Run it.</p>
            </div>
          )}

          <AnimatePresence initial={false}>
            {shown.map((s, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: reduced ? 0 : 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
              >
                <Line step={s} />
              </motion.div>
            ))}
          </AnimatePresence>

          {waiting?.kind === 'ask' && (
            <motion.div
              initial={{ opacity: 0, y: reduced ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-2 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue/40 bg-blue/10 p-3"
            >
              <span className="font-sans">
                <b className="block text-[0.95rem] font-semibold text-white">{waiting.title}</b>
                <span className="text-[0.82rem] text-white/60">{waiting.sub}</span>
              </span>
              <Button onClick={approve} size="sm" className="rounded-lg">{waiting.label}</Button>
            </motion.div>
          )}

          {done && (
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="pt-2 text-[0.74rem] text-white/40">
              Run complete. This is a simulation in your browser — the real thing runs inside your own AI.
            </motion.p>
          )}
        </div>
      </div>
    </div>
  );
}

function Line({ step }: { step: Step }) {
  if (step.kind === 'say') {
    return <p className="py-1 pl-7 font-sans text-[0.88rem] text-white/55 before:-ml-5 before:mr-2 before:text-white/25 before:content-['›']">{step.text}</p>;
  }
  if (step.kind === 'call') {
    return (
      <div className={cn('grid grid-cols-[1.1rem_minmax(0,1fr)_auto] items-baseline gap-x-2.5 rounded-lg px-2 py-1.5', step.state === 'no' && 'border border-dashed border-refuse/40')}>
        <span className={step.state === 'ok' ? 'text-[#6ee7a8]' : 'text-[#fca5a5]'}>{step.state === 'ok' ? '✓' : '×'}</span>
        <span className="break-words text-white">
          {step.tool}{step.args && <span className="ml-2 text-white/35">{step.args}</span>}
        </span>
        <span className={cn('text-[0.72rem]', step.state === 'ok' ? 'text-[#6ee7a8]' : 'text-[#fca5a5]')}>{step.status}</span>
      </div>
    );
  }
  if (step.kind === 'gate') {
    return (
      <div className="ml-7 rounded-r-lg border border-l-2 border-[#fca5a5]/30 border-l-[#fca5a5] bg-[#fca5a5]/5 px-3 py-2">
        <b className="font-semibold text-[#fecaca]">{step.rule}</b>
        <span className="text-white/55"> — {step.text}</span>
        <small className="mt-1 block text-[0.7rem] text-white/35">{step.foot}</small>
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
