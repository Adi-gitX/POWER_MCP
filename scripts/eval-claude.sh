#!/usr/bin/env bash
# Put a real Claude against the server and watch what it does with `ok: false`.
#
# The whole enforcement model rests on one assumption: a client model that
# receives a structured refusal reads next_action and complies, rather than
# reporting "the tool is broken" and stopping. e2e.ts cannot test that — it
# plays the model's part deterministically. This can.
#
# Usage:  CLAUDE_MODEL=claude-sonnet-4-5-20250929 scripts/eval-claude.sh [out-dir]
# Needs:  `claude` on PATH and a logged-in Claude Code. CLAUDE_MODEL is optional;
#         set it when the installed CLI rejects its default model.
#
# Output: <out>/phase-{1,2,3}.jsonl (full stream-json transcripts),
#         <out>/summary.txt (tool calls, refusals, and how the model reacted).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/.power-local/eval-$(date +%Y%m%d-%H%M%S)}"
PORT="${PORT:-4398}"
MODEL_ARGS=(); [ -n "${CLAUDE_MODEL:-}" ] && MODEL_ARGS=(--model "$CLAUDE_MODEL")
BASE="http://localhost:$PORT"
mkdir -p "$OUT/data"

# ---- server
(cd "$ROOT/apps/mcp-server" && PORT="$PORT" POWER_LOCAL_ROOT="$OUT/data" pnpm exec tsx src/index.ts >"$OUT/server.log" 2>&1) &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null; pkill -P $SERVER_PID 2>/dev/null || true' EXIT
for _ in $(seq 1 120); do curl -sf "$BASE/health" >/dev/null 2>&1 && break; sleep 0.25; done
curl -sf "$BASE/health" >/dev/null || { echo "server did not start"; cat "$OUT/server.log"; exit 1; }

cat >"$OUT/mcp.json" <<JSON
{ "mcpServers": { "power": { "type": "http", "url": "$BASE/mcp" } } }
JSON

run_claude() { # phase prompt [extra args...]
  local phase="$1" prompt="$2"; shift 2
  echo "── phase $phase"
  claude -p "$prompt" \
    --mcp-config "$OUT/mcp.json" --strict-mcp-config \
    --allowedTools "mcp__power__*" \
    --output-format stream-json --verbose \
    --max-turns 60 "${MODEL_ARGS[@]}" "$@" >"$OUT/phase-$phase.jsonl" 2>"$OUT/phase-$phase.err" || true
  # The final assistant text, for a human reading the log.
  python3 - "$OUT/phase-$phase.jsonl" <<'PY'
import json,sys
last=None
for line in open(sys.argv[1]):
    try: e=json.loads(line)
    except Exception: continue
    if e.get('type')=='result': last=e.get('result')
print('   result:', (last or '')[:400].replace('\n',' '))
PY
}

session_id() { python3 -c "
import json,sys
for line in open(sys.argv[1]):
    try: e=json.loads(line)
    except Exception: continue
    if e.get('type')=='system' and e.get('subtype')=='init': print(e['session_id']); break
" "$1"; }

project_id() { curl -s "$BASE/" | grep -o 'projects/[a-z0-9]*' | head -1 | cut -d/ -f2; }

# ---- phase 1: plan. The model should hit wrong_phase if it tries to write
#      early, hit the spec gate at least once, and stop at the approval.
run_claude 1 "Use the power MCP server. Create a project called 'Tip splitter' — a small TypeScript module that splits a restaurant bill with a tip among N people. Write the plan (SPEC.md) and submit it to Power. When Power says the plan needs my approval, tell me the URL and stop. Do not write any code yet."
SID="$(session_id "$OUT/phase-1.jsonl")"
PID="$(project_id)"
echo "   project=$PID session=$SID"
[ -n "$PID" ] || { echo "no project was created"; exit 1; }

# ---- the human approves
curl -s -o /dev/null -w "   approve-spec → %{http_code}\n" -X POST "$BASE/projects/$PID/approve-spec"

# ---- phase 2: build and verify. The model must run tests until green, get
#      bounced into verification, and stop at the publish confirmation.
run_claude 2 "I approved the plan in the browser. Continue with Power: build it, run the tests until they are green, then verify it against the plan and submit the verification. When Power says publishing needs my confirmation, tell me and stop." --resume "$SID"

# ---- the human confirms
curl -s -o /dev/null -w "   confirm-publish → %{http_code}\n" -X POST "$BASE/projects/$PID/confirm-publish"

# ---- phase 3: ship
run_claude 3 "I confirmed the publish in the browser. Publish it with Power and tell me the version." --resume "$SID"

# ---- summary: every tool call, every refusal, and the call that followed it.
python3 - "$OUT" <<'PY' | tee "$OUT/summary.txt"
import json,sys,glob,collections
out=sys.argv[1]
calls=[];
for f in sorted(glob.glob(f"{out}/phase-*.jsonl")):
    phase=f.rsplit('-',1)[1].split('.')[0]
    pending={}
    for line in open(f):
        try: e=json.loads(line)
        except Exception: continue
        if e.get('type')=='assistant':
            for c in e['message'].get('content',[]):
                if c.get('type')=='tool_use' and c['name'].startswith('mcp__power__'):
                    pending[c['id']]=(phase,c['name'].replace('mcp__power__',''))
        if e.get('type')=='user':
            for c in e['message'].get('content',[]):
                if c.get('type')=='tool_result' and c.get('tool_use_id') in pending:
                    ph,name=pending.pop(c['tool_use_id'])
                    body=c.get('content')
                    text=body if isinstance(body,str) else ''.join(x.get('text','') for x in body or [])
                    try: env=json.loads(text)
                    except Exception: env={}
                    calls.append((ph,name,env.get('ok'),env.get('reason'),c.get('is_error',False)))
print(f"{len(calls)} Power tool calls\n")
refusals=[i for i,c in enumerate(calls) if c[2] is False]
errors=[c for c in calls if c[4]]
print("phase  tool                      ok     reason")
for ph,name,ok,reason,err in calls:
    print(f"  {ph}    {name:<24} {str(ok):<6} {reason or ''}{'  [isError]' if err else ''}")
print(f"\nrefusals: {len(refusals)}   protocol errors: {len(errors)}")
print("\nWhat the model did after each refusal:")
for i in refusals:
    ph,name,ok,reason,_=calls[i]
    nxt=calls[i+1][1] if i+1<len(calls) else '(stopped)'
    print(f"  {name} → {reason:<22} then called: {nxt}")
gave_up=[i for i in refusals if i+1>=len(calls) or calls[i+1][0]!=calls[i][0]]
print(f"\nrefusals after which the model made no further call in that phase: {len(gave_up)}")
by=collections.Counter(c[1] for c in calls)
print("\nmost used:", ', '.join(f"{k}×{v}" for k,v in by.most_common(8)))
PY
echo
echo "transcripts: $OUT"
