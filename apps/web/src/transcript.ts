/**
 * The committed eval transcripts under docs/evals, parsed at build time.
 * Shared by the proof page and the home page's proof teaser, so both show the
 * same computed numbers and neither can say anything a run did not do.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface Call { phase: string; tool: string; ok: boolean | null; reason: string | undefined; says: string }
export interface Transcript { calls: Call[]; finals: Record<string, string>; refusals: Call[] }

let cached: Transcript | null = null;

export function loadTranscript(): Transcript {
  if (cached) return cached;
  const dir = fileURLToPath(new URL('../../../docs/evals/', import.meta.url));
  const calls: Call[] = [];
  const finals: Record<string, string> = {};
  for (const phase of ['1', '2', '3']) {
    let lines: string[];
    try {
      lines = readFileSync(`${dir}phase-${phase}.jsonl`, 'utf8').split('\n');
    } catch {
      continue;
    }
    const pending = new Map<string, string>();
    let lastText = '';
    for (const line of lines) {
      let e: any;
      try { e = JSON.parse(line); } catch { continue; }
      if (e.type === 'assistant') {
        for (const c of e.message?.content ?? []) {
          if (c.type === 'text' && c.text?.trim()) lastText = c.text.trim();
          if (c.type === 'tool_use' && String(c.name).startsWith('mcp__power__')) pending.set(c.id, String(c.name).replace('mcp__power__', ''));
        }
      }
      if (e.type === 'user') {
        for (const c of e.message?.content ?? []) {
          if (c.type === 'tool_result' && pending.has(c.tool_use_id)) {
            const tool = pending.get(c.tool_use_id)!;
            pending.delete(c.tool_use_id);
            const t = typeof c.content === 'string' ? c.content : (c.content ?? []).map((x: any) => x.text ?? '').join('');
            let ok: boolean | null = null, reason: string | undefined;
            try { const env = JSON.parse(t); ok = env.ok ?? null; reason = env.reason; } catch {}
            calls.push({ phase, tool, ok, reason, says: lastText });
            lastText = '';
          }
        }
      }
      if (e.type === 'result' && e.result) finals[phase] = String(e.result);
    }
  }
  cached = { calls, finals, refusals: calls.filter((c) => c.ok === false) };
  return cached;
}
