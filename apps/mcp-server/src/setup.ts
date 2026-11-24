/**
 * First-run setup: which assistant a person builds with, the Power skill for
 * it, and the hosting account their apps publish to.
 *
 * Everything an assistant needs to know about one platform lives in one row of
 * `PLATFORMS`, so the setup pages, the skill file and the hand-off message can
 * never disagree about where a skill goes or how a client connects.
 *
 * The skill is generated from the tool registry and the server's own
 * instructions rather than kept as a hand-written file, for the same reason the
 * pricing page is: a copy would drift from what the server actually enforces.
 */
import { TOOLS } from '@power/protocol';
import { SERVER_INSTRUCTIONS } from './prompts.js';

export type PlatformId = 'claude-code' | 'claude-app' | 'cursor' | 'codex' | 'other';

/** How a client is pointed at the MCP endpoint. */
export type ConnectMethod =
  | { kind: 'command'; command: string; note: string }
  | { kind: 'link'; href: string; label: string; note: string }
  | { kind: 'steps'; steps: string[]; note: string };

export interface Platform {
  id: PlatformId;
  name: string;
  /** How the name reads mid-sentence, when it needs an article. */
  prose?: string;
  /** A two-character glyph for the choice card. Not a logo: no vendor marks here. */
  mark: string;
  blurb: string;
  /** Where the client reads personal skills from. Null when skills are uploaded instead. */
  skillsDir: string | null;
  connect(endpoint: string): ConnectMethod;
  /** A native link that opens the tool with a message typed in. Nothing is sent by itself. */
  launch?: (message: string) => string;
  /** Claude Code caps the decoded prompt; longer messages fall back to copy and paste. */
  maxMessage?: number;
  installUrl?: string;
  /** Connects through the vendor's cloud, so a loopback endpoint is out of its reach. */
  needsPublicEndpoint?: boolean;
}

export const SKILL_NAME = 'power';
export const SKILL_PATH = `/skills/${SKILL_NAME}/SKILL.md`;
export const SKILL_ZIP_PATH = `/skills/${SKILL_NAME}.zip`;

export const PLATFORMS: readonly Platform[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    mark: '>_',
    blurb: 'Anthropic’s coding agent, in the terminal or your editor',
    skillsDir: '~/.claude/skills',
    connect: (endpoint) => ({
      kind: 'command',
      command: `claude mcp add --transport http power ${endpoint}`,
      note: 'Run it once in a terminal. Claude Code opens a sign-in page the first time it uses Power.',
    }),
    launch: (message) => `claude-cli://open?q=${encodeURIComponent(message)}`,
    maxMessage: 5_000,
    installUrl: 'https://docs.claude.com/en/docs/claude-code/setup',
  },
  {
    id: 'claude-app',
    name: 'Claude app',
    prose: 'the Claude app',
    mark: '✳',
    blurb: 'Claude on the web, desktop or phone, with a custom connector',
    skillsDir: null,
    connect: (endpoint) => ({
      kind: 'steps',
      steps: [
        'Open Settings → Connectors and choose Add custom connector.',
        `Name it Power and paste ${endpoint} as the URL.`,
        'Choose Connect and sign in with this account when Claude asks.',
      ],
      note: 'Connectors are added once per Claude account and work in every chat.',
    }),
    installUrl: 'https://claude.ai/download',
    needsPublicEndpoint: true,
  },
  {
    id: 'cursor',
    name: 'Cursor',
    mark: '↗',
    blurb: 'The AI code editor',
    skillsDir: '~/.cursor/skills',
    connect: (endpoint) => ({
      kind: 'link',
      href: `cursor://anysphere.cursor-deeplink/mcp/install?name=power&config=${encodeURIComponent(
        Buffer.from(JSON.stringify({ url: endpoint })).toString('base64'),
      )}`,
      label: 'Add Power to Cursor',
      note: `Cursor asks to install the server; choose Install. Or add it under Settings → MCP with the URL ${endpoint}.`,
    }),
    launch: (message) => `cursor://anysphere.cursor-deeplink/prompt?text=${encodeURIComponent(message)}`,
    installUrl: 'https://cursor.com/download',
  },
  {
    id: 'codex',
    name: 'Codex',
    mark: '{}',
    blurb: 'OpenAI’s coding agent, in the terminal or the Codex app',
    skillsDir: '~/.agents/skills',
    connect: (endpoint) => ({
      kind: 'command',
      command: `codex mcp add power --url ${endpoint}`,
      note: 'Run it once in a terminal, then start a new Codex session so it picks the server up.',
    }),
    launch: (message) => `codex://new?prompt=${encodeURIComponent(message)}`,
    installUrl: 'https://developers.openai.com/codex',
  },
  {
    id: 'other',
    name: 'Another MCP client',
    prose: 'your MCP client',
    mark: '+',
    blurb: 'Windsurf, VS Code, Zed or anything that speaks MCP',
    skillsDir: '~/.agents/skills',
    connect: (endpoint) => ({
      kind: 'steps',
      steps: [
        'Add a remote MCP server in your client’s settings.',
        `Use Streamable HTTP and the URL ${endpoint}.`,
        'Sign in with this account when the client opens Power’s sign-in page.',
      ],
      note: 'No API key is involved: the client discovers Power’s sign-in from the endpoint itself.',
    }),
  },
];

/** The platform's name as it reads inside a sentence. */
export const inProse = (p: Platform): string => p.prose ?? p.name;

export const platformById = (id: string | null | undefined): Platform | undefined => PLATFORMS.find((p) => p.id === id);

/** A terminal one-liner that installs the skill where the platform reads it. */
export function skillInstallCommand(platform: Platform, baseUrl: string): string | null {
  if (!platform.skillsDir) return null;
  const dir = `${platform.skillsDir}/${SKILL_NAME}`;
  return `mkdir -p ${dir} && curl -fsSL "${skillUrl(baseUrl, platform)}" -o ${dir}/SKILL.md`;
}

export function skillUrl(baseUrl: string, platform: Platform): string {
  return `${baseUrl}${SKILL_PATH}?for=${platform.id}`;
}

/**
 * What the hand-off pastes into the tool: install the skill, connect, then ask
 * for the idea. Short, numbered, and with nothing secret in it, because it sits
 * in a URL and a chat box.
 */
export function handoffMessage(platform: Platform, baseUrl: string): string {
  const endpoint = `${baseUrl}/mcp`;
  const install = skillInstallCommand(platform, baseUrl);
  const connect = platform.connect(endpoint);
  const steps: string[] = [];
  if (install) {
    steps.push(`Install the Power skill by running: ${install} (replace any older copy).`);
  }
  if (connect.kind === 'command') {
    steps.push(`Connect the Power MCP server if it is not already listed: ${connect.command}`);
  } else {
    steps.push(`Make sure the Power MCP server at ${endpoint} is connected. If it is not, tell me how to add it and wait.`);
  }
  steps.push(
    `Read ${platform.skillsDir ? `${platform.skillsDir}/${SKILL_NAME}/SKILL.md` : 'the Power skill'} and follow it. When a step needs me in the browser, tell me what to open and stop.`,
  );
  return ['Set me up to build with Power.', '', ...steps.map((s, i) => `${i + 1}. ${s}`), '', 'Then ask me what I want to build.'].join('\n');
}

/** The tool's native link, when it has one and the message fits. */
export function launchLink(platform: Platform, message: string): string | null {
  if (!platform.launch) return null;
  if (platform.maxMessage && message.length > platform.maxMessage) return null;
  return platform.launch(message);
}

// ------------------------------------------------------------------- skill

/**
 * The SKILL.md for one platform.
 *
 * Frontmatter is the Agent Skills format every listed client reads: a
 * lowercase `name` and a `description` that says when to use it, kept under
 * the 1024-character limit.
 */
export function skillMarkdown(baseUrl: string, platform: Platform): string {
  const endpoint = `${baseUrl}/mcp`;
  const connect = platform.connect(endpoint);
  const connectHow =
    connect.kind === 'command'
      ? `Run \`${connect.command}\`, then start a new session.`
      : connect.kind === 'link'
        ? `Ask the user to open ${baseUrl}/start/skill and choose “${connect.label}”, or add a remote MCP server with the URL ${endpoint}.`
        : connect.steps.map((s, i) => `${i + 1}. ${s}`).join('\n');

  const free = TOOLS.filter((t) => !t.metered);
  const metered = TOOLS.filter((t) => t.metered);
  const row = (t: (typeof TOOLS)[number]) =>
    `- \`${t.name}\`: ${t.summary}${t.destructive ? ' (destructive)' : ''}${t.async ? ' (returns a job; poll get_job)' : ''}`;

  return `---
name: ${SKILL_NAME}
description: >-
  Build, check and ship full-stack apps with the Power MCP server. Use when the
  user wants to build, change, preview or publish an app with Power, asks about
  their Power projects, Power Up, plans, gates, approvals, secrets or publishing,
  or says "build me an app". Power goes straight to a checked build by default,
  adds research, a plan and verification with Power Up, and keeps every
  approval with the user in their browser.
---

# Building with Power

Power is an MCP server at \`${endpoint}\`. You do the thinking and the writing;
Power gives you a workbench, checks the work against gates enforced in code, and
publishes it. The person you are helping confirms releases (and, with Power Up,
approves plans) themselves, in their browser at ${baseUrl}. You can never do
either on their behalf.

This copy is for **${platform.name}**.

## 1. Check the connection first

Look for Power's tools (\`get_context\`, \`list_projects\`, \`create_project\`).
If they are missing, Power is not connected yet:

${connectHow}

If a call fails with an authorization error, the client needs to sign in again;
it opens Power's sign-in page by itself. Never ask for a password or a token.

## 2. Start or resume

- Call \`list_projects\`. If the user means an existing project, use it.
- Otherwise call \`create_project\` with a short name, then follow the
  \`next_action\` in the response.
- If the user's first message names a project id, it came from Power's own
  hand-off: call \`get_context\` with that id and carry on from there.
- Power Up: pass \`power_up: true\` only when the user asks for it (research,
  a plan first, independent verification). Otherwise leave it out; their
  account setting decides, and it is off unless they turned it on.
- Unsure where a run stands? Call \`get_context\` or \`get_next_action\`. Both are free.

## 3. Follow the pipeline

${SERVER_INSTRUCTIONS}

### What waits for the user

- **The plan (Power Up runs only).** After \`request_spec_approval\`, tell them to open
  ${baseUrl}/projects/<project id> and approve the plan, then stop until they say so.
- **Publishing.** \`publish_app\` needs a confirmation on the same page. Ask for it; do not retry in a loop.
- **Anything destructive** (unpublishing, a migration that drops data) needs a typed confirmation there too.

### Secrets and hosting

- Never ask for an API key, password or token in the conversation. Call
  \`request_secret\`; it returns a link where the user pastes the value. You only
  ever see the variable name and a fingerprint.
- Apps publish to the user's own Vercel account. If \`publish_app\` says no
  hosting account is connected, send them to ${baseUrl}/start/vercel and wait.

## 4. Tools

Free (reads and housekeeping, never billed):

${free.map(row).join('\n')}

Build actions (count against the daily allowance; refusals are never billed):

${metered.map(row).join('\n')}

## Good habits

- Read before you edit: \`list_files\`, \`read_files\` and \`search_code\` are free.
- Run \`typecheck\` and \`run_tests\` until green before publishing (or, with
  Power Up, before \`submit_verification\`).
- A response with \`ok: false\` is the gate telling you what to fix. Fix exactly
  the listed failures and resubmit.
- Keep the user posted in one or two sentences and give them one next action.
`;
}

// --------------------------------------------------------------------- zip

/**
 * A one-entry ZIP holding `power/SKILL.md`, for clients that take a skill as an
 * upload. Stored rather than deflated: the file is a few kilobytes, and an
 * uncompressed archive is a format every unzipper accepts.
 */
export function skillZip(markdown: string): Buffer {
  const name = Buffer.from(`${SKILL_NAME}/SKILL.md`, 'utf8');
  const data = Buffer.from(markdown, 'utf8');
  const crc = crc32(data);
  // 2026-01-01 00:00 in MS-DOS format; a fixed stamp keeps the archive reproducible.
  const dosTime = 0;
  const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(0x0800, 6); // UTF-8 names
  local.writeUInt16LE(0, 8); // stored
  local.writeUInt16LE(dosTime, 10);
  local.writeUInt16LE(dosDate, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4); // made by
  central.writeUInt16LE(20, 6); // needed
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt16LE(dosTime, 12);
  central.writeUInt16LE(dosDate, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt16LE(0, 30); // extra
  central.writeUInt16LE(0, 32); // comment
  central.writeUInt16LE(0, 34); // disk
  central.writeUInt16LE(0, 36); // internal attrs
  central.writeUInt32LE(0, 38); // external attrs
  central.writeUInt32LE(0, 42); // offset of local header

  const centralOffset = local.length + name.length + data.length;
  const centralSize = central.length + name.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([local, name, data, central, name, end]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// ------------------------------------------------------------- the journey

export type SetupStep = 'platform' | 'skill' | 'vercel';

export const SETUP_STEPS: ReadonlyArray<{ key: SetupStep; label: string; path: string }> = [
  { key: 'platform', label: 'Assistant', path: '/start' },
  { key: 'skill', label: 'Skill', path: '/start/skill' },
  { key: 'vercel', label: 'Vercel', path: '/start/vercel' },
];

/** A Vercel access token: one run of URL-safe characters, nothing that could be a sentence. */
export function looksLikeVercelToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{16,200}$/.test(value);
}

/** Vercel team ids are `team_…`; a slug is accepted too and resolved by the API. */
export function looksLikeTeam(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,100}$/.test(value);
}

// --------------------------------------------------------------- automation

/** How long a setup command works for. Long enough to approve a terminal prompt, short enough to be worthless once leaked. */
export const SETUP_CODE_TTL_MS = 15 * 60 * 1000;

/** Assistants whose MCP config Power can write itself, so setup is one command. */
export const AUTOMATED: ReadonlySet<PlatformId> = new Set(['claude-code', 'cursor', 'codex', 'other']);
/** …of those, the ones whose config also carries the account, so no sign-in is needed afterwards. */
export const CONNECTS_ITSELF: ReadonlySet<PlatformId> = new Set(['claude-code', 'cursor', 'codex']);

export const setupScriptUrl = (baseUrl: string, code: string): string => `${baseUrl}/setup/${code}`;

/** The one line a person (or their assistant) runs. */
export const setupCommand = (baseUrl: string, code: string): string => `curl -fsSL ${setupScriptUrl(baseUrl, code)} | sh`;

/**
 * The hand-off for an automated platform: run the installer, restart once,
 * then follow the skill. The code in it is single-use and expires, and the
 * script never prints the token it receives, so nothing secret reaches chat.
 */
export function automatedHandoff(platform: Platform, baseUrl: string, code: string): string {
  const restart = CONNECTS_ITSELF.has(platform.id)
    ? `When it finishes, tell me to restart ${platform.name} once so it loads Power.`
    : 'When it finishes, tell me what it printed.';
  return [
    'Set me up to build with Power.',
    '',
    `1. Run this command. It installs the Power skill and connects ${platform.name} to my Power account. It prints status lines only, never a token:`,
    `   ${setupCommand(baseUrl, code)}`,
    `2. ${restart}`,
    `3. Then read ${platform.skillsDir}/${SKILL_NAME}/SKILL.md, follow it, and ask me what I want to build.`,
  ].join('\n');
}

const shq = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

/**
 * The installer, generated per account and per assistant.
 *
 * POSIX sh with no dependencies beyond curl, plus node or python3 where a JSON
 * or TOML file has to be merged rather than overwritten. Every existing config
 * is backed up before it is touched, and a file that will not parse is left
 * alone rather than replaced.
 */
export function installerScript(input: { platform: Platform; baseUrl: string; code: string; account: string }): string {
  const { platform, baseUrl, code, account } = input;
  const endpoint = `${baseUrl}/mcp`;
  const skillDir = `${platform.skillsDir!.replace(/^~/, '$HOME')}/${SKILL_NAME}`;

  const head = `#!/bin/sh
# Power setup for ${platform.name}, account ${account}.
# Generated for one use. The code in it expires ${Math.round(SETUP_CODE_TTL_MS / 60000)} minutes after the page was opened.
set -eu
BASE=${shq(baseUrl)}
CODE=${shq(code)}
SKILL_DIR="${skillDir}"
say() { printf '%s\\n' "$*"; }
fail() { say "Power setup: $*"; exit 1; }
command -v curl >/dev/null 2>&1 || fail "curl is required."
backup() { [ -f "$1" ] && cp "$1" "$1.power-backup-$(date +%Y%m%d%H%M%S)" || true; }
`;

  const needTool: Partial<Record<PlatformId, string>> = {
    'claude-code': `command -v claude >/dev/null 2>&1 || fail "Claude Code is not installed. Install it from ${platform.installUrl}, then run this again."\n`,
    codex: `command -v codex >/dev/null 2>&1 || [ -d "$HOME/.codex" ] || fail "Codex is not installed. Install it from ${platform.installUrl}, then run this again."\n`,
    cursor: `[ -d "$HOME/.cursor" ] || [ -d "/Applications/Cursor.app" ] || command -v cursor >/dev/null 2>&1 || fail "Cursor is not installed. Install it from ${platform.installUrl}, then run this again."\n`,
  };

  const skill = `mkdir -p "$SKILL_DIR"
curl -fsSL "$BASE/skills/power/SKILL.md?for=${platform.id}" -o "$SKILL_DIR/SKILL.md.tmp"
head -1 "$SKILL_DIR/SKILL.md.tmp" | grep -q '^---$' || { rm -f "$SKILL_DIR/SKILL.md.tmp"; fail "the skill download was not a skill file."; }
mv "$SKILL_DIR/SKILL.md.tmp" "$SKILL_DIR/SKILL.md"
say "✓ Power skill installed at $SKILL_DIR/SKILL.md"
`;

  const token = `TOKEN=$(curl -fsS -X POST "$BASE/setup/$CODE/token") || fail "this setup command has expired or was already used. Open $BASE/start/skill for a new one."
case "$TOKEN" in pwr_*) ;; *) fail "Power did not return a connection token.";; esac
`;

  // Merging needs a real parser; node ships with most editors' toolchains and
  // python3 with macOS's command line tools, so one of them is nearly always there.
  const runner = `run_merge() {
  if command -v node >/dev/null 2>&1; then node -e "$1"
  elif command -v python3 >/dev/null 2>&1; then python3 -c "$2"
  else fail "node or python3 is needed to update $3 safely."; fi
}
`;

  const connect: Record<PlatformId, string> = {
    'claude-code': `claude mcp remove --scope user power >/dev/null 2>&1 || true
claude mcp add --scope user --transport http power ${shq(endpoint)} --header "Authorization: Bearer $TOKEN" >/dev/null
say "✓ Claude Code connected to Power as ${account}"
`,
    cursor: `${runner}CONFIG="$HOME/.cursor/mcp.json"
mkdir -p "$HOME/.cursor"
backup "$CONFIG"
export POWER_TOKEN="$TOKEN" POWER_URL=${shq(endpoint)} POWER_CONFIG="$CONFIG"
run_merge '
const fs = require("fs"); const p = process.env.POWER_CONFIG; let c = {};
if (fs.existsSync(p)) { try { c = JSON.parse(fs.readFileSync(p, "utf8") || "{}"); } catch { console.error("not valid JSON, left unchanged: " + p); process.exit(2); } }
c.mcpServers = c.mcpServers || {};
c.mcpServers.power = { url: process.env.POWER_URL, headers: { Authorization: "Bearer " + process.env.POWER_TOKEN } };
fs.writeFileSync(p, JSON.stringify(c, null, 2) + "\\n", { mode: 0o600 });
' '
import json, os, sys
p = os.environ["POWER_CONFIG"]; c = {}
if os.path.exists(p):
    try:
        raw = open(p).read().strip(); c = json.loads(raw) if raw else {}
    except Exception:
        sys.exit("not valid JSON, left unchanged: " + p)
c.setdefault("mcpServers", {})["power"] = {"url": os.environ["POWER_URL"], "headers": {"Authorization": "Bearer " + os.environ["POWER_TOKEN"]}}
fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600); os.write(fd, (json.dumps(c, indent=2) + "\\n").encode()); os.close(fd)
' "$CONFIG" || fail "could not update $CONFIG, so it was left as it was. Fix or move it, then get a new command at $BASE/start/skill."
unset POWER_TOKEN
# It holds a credential now, whatever its mode was before.
chmod 600 "$CONFIG"
say "✓ Cursor connected to Power as ${account} (in $CONFIG)"
`,
    codex: `${runner}CONFIG="$HOME/.codex/config.toml"
mkdir -p "$HOME/.codex"
backup "$CONFIG"
export POWER_TOKEN="$TOKEN" POWER_URL=${shq(endpoint)} POWER_CONFIG="$CONFIG"
run_merge '
const fs = require("fs"); const p = process.env.POWER_CONFIG;
const lines = fs.existsSync(p) ? fs.readFileSync(p, "utf8").split("\\n") : [];
const out = []; let skip = false;
for (const line of lines) { const h = line.match(/^\\s*\\[([^\\]]+)\\]/); if (h) skip = h[1].trim() === "mcp_servers.power" || h[1].trim().startsWith("mcp_servers.power."); if (!skip) out.push(line); }
while (out.length && out[out.length - 1].trim() === "") out.pop();
out.push("", "[mcp_servers.power]", "url = " + JSON.stringify(process.env.POWER_URL), "http_headers = { \\"Authorization\\" = " + JSON.stringify("Bearer " + process.env.POWER_TOKEN) + " }", "");
fs.writeFileSync(p, out.join("\\n").replace(/^\\n+/, ""), { mode: 0o600 });
' '
import json, os, re
p = os.environ["POWER_CONFIG"]
lines = open(p).read().split("\\n") if os.path.exists(p) else []
out = []; skip = False
for line in lines:
    m = re.match(r"^\\s*\\[([^\\]]+)\\]", line)
    if m:
        name = m.group(1).strip(); skip = name == "mcp_servers.power" or name.startswith("mcp_servers.power.")
    if not skip: out.append(line)
while out and not out[-1].strip(): out.pop()
out += ["", "[mcp_servers.power]", "url = " + json.dumps(os.environ["POWER_URL"]), "http_headers = { \\"Authorization\\" = " + json.dumps("Bearer " + os.environ["POWER_TOKEN"]) + " }", ""]
fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600); os.write(fd, "\\n".join(out).lstrip("\\n").encode()); os.close(fd)
' "$CONFIG" || fail "could not update $CONFIG, so it was left as it was. Fix or move it, then get a new command at $BASE/start/skill."
unset POWER_TOKEN
# It holds a credential now, whatever its mode was before.
chmod 600 "$CONFIG"
say "✓ Codex connected to Power as ${account} (in $CONFIG)"
`,
    other: `say "  Add a remote MCP server in your client with the URL ${endpoint}; it signs in to ${account} through Power's own sign-in page."
`,
    'claude-app': '',
  };

  const report = `curl -fsS -X POST "$BASE/setup/$CODE/done" -d "platform=${platform.id}" >/dev/null 2>&1 || true
say "Done. Back in your browser, Power has picked this up."
`;

  const exchange = CONNECTS_ITSELF.has(platform.id) ? token : '';
  return head + (needTool[platform.id] ?? '') + skill + exchange + connect[platform.id] + report;
}

// ------------------------------------------------------------ project hand-off

/** How a project is handed to the assistant: the context it needs and nothing secret. */
export interface ProjectHandoff {
  platform: Platform;
  baseUrl: string;
  project: { id: string; name: string };
  mode: 'standard' | 'power_up';
  /** What the person wants, in their words. Present when the project was just started. */
  idea?: string;
  /** Where the run is, for a project already under way. */
  progress?: { phase: string; next?: string | null };
  /** A setup code when this assistant is not connected yet, so one message does both. */
  installCode?: string | null;
  /** Bringing in an app that already exists on this computer. */
  importPath?: string | null;
}

const IDEA_LIMIT = 1500;

/**
 * The message the assistant receives. Everything it needs to start without
 * asking: which project, what to build, which mode, and how to connect first
 * if it is not connected. Kept well under Claude Code's 5,000-character link.
 */
export function projectHandoffMessage(h: ProjectHandoff): string {
  const lines: string[] = [];
  const steps: string[] = [];
  if (h.installCode) {
    steps.push(`Connect to Power first by running: ${setupCommand(h.baseUrl, h.installCode)} (it installs the Power skill and connects this tool to my account; it prints status lines only). If Power's tools are not available afterwards, tell me to restart ${h.platform.name} and continue from step 2.`);
  }
  steps.push(`Call get_context with project_id "${h.project.id}" to load the project and its next action.`);
  steps.push(
    h.mode === 'power_up'
      ? 'Power Up is on: research first (submit_research), then the plan I approve in my browser, then build and verification.'
      : 'Power Up is off: go straight to the build, get run_tests green, then publish_app. I confirm in my browser before it goes live.',
  );
  steps.push('Follow the Power skill and the next_action in every response. When something needs me in the browser, tell me what to open and wait.');

  if (h.importPath) {
    steps.splice(h.installCode ? 2 : 1, 0, `Bring my existing app into this project. It is at: ${h.importPath.slice(0, 300)}. Read it, then write its files into the Power project with write_file, skipping node_modules, .git, build output and any .env or other secret files. Keep its structure.`);
    lines.push(`Bring my app into Power, as the project "${h.project.name}".`, '');
    if (h.idea) lines.push(h.idea.trim().slice(0, IDEA_LIMIT), '');
  } else if (h.idea !== undefined) {
    lines.push(
      `Build this with Power, in my project "${h.project.name}":`,
      '',
      h.idea.trim() ? h.idea.trim().slice(0, IDEA_LIMIT) : 'I have an idea. Ask me what I want to build.',
      '',
    );
  } else {
    lines.push(
      `Pick up my Power project "${h.project.name}" where it left off${h.progress ? ` (it is at: ${h.progress.phase}${h.progress.next ? `; next: ${h.progress.next}` : ''})` : ''}.`,
      '',
    );
  }
  lines.push(...steps.map((s, i) => `${i + 1}. ${s}`));
  return lines.join('\n');
}

/**
 * A terminal command that starts the assistant with the message already sent,
 * for the CLIs that take an opening prompt as an argument. The deep links can
 * only type the message in; these submit it.
 */
/** What is left to do once the tool is open, in its own terms. */
export function openedHint(platform: Platform): string {
  switch (platform.id) {
    case 'cursor':
      return 'Choose Create chat, then press Enter in Cursor';
    case 'claude-code':
      return 'Press Enter in the terminal to send the message';
    case 'codex':
      return 'Press Enter in Codex to send the message';
    default:
      return 'Paste the message into your assistant and send it';
  }
}

export function terminalStart(platform: Platform, message: string): string | null {
  if (platform.id === 'claude-code') return `claude ${shq(message)}`;
  if (platform.id === 'codex') return `codex ${shq(message)}`;
  return null;
}

/** A short project name from what the person typed, when they gave none. */
export function nameFromIdea(idea: string): string {
  const words = idea.replace(/[^\p{L}\p{N}\s'-]/gu, ' ').split(/\s+/).filter(Boolean);
  // "Build me a booking page for my yoga studio with Stripe" -> "Booking page for my yoga studio"
  while (words.length && /^(build|make|create|write|i|we|want|need|please|me|us|a|an|the|to)$/i.test(words[0]!)) words.shift();
  const stop = words.findIndex((w, i) => i > 1 && /^(with|that|which|using|and|so|where|including)$/i.test(w));
  const name = words.slice(0, stop === -1 ? 6 : Math.min(stop, 6)).join(' ');
  return (name.charAt(0).toUpperCase() + name.slice(1)).slice(0, 60) || 'New app';
}
