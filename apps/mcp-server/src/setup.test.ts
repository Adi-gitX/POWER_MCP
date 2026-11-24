import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TOOLS } from '@power/protocol';
import { describe, expect, it } from 'vitest';
import type { PageContext } from './dashboard.js';
import { setupPlatformPage, setupSkillPage, setupVercelPage, skillTaken } from './setup-pages.js';
import {
  AUTOMATED,
  PLATFORMS,
  automatedHandoff,
  crc32,
  installerScript,
  handoffMessage,
  launchLink,
  looksLikeVercelToken,
  platformById,
  skillInstallCommand,
  skillMarkdown,
  skillZip,
} from './setup.js';

const BASE = 'http://localhost:4321';
const ctx: PageContext = { baseUrl: BASE, user: 'usr_ada', email: 'ada@example.com', plan: 'free', remaining: { day: 100, week: null } };
const csrf = '<input type="hidden" name="_csrf" value="x">';

describe('the skill', () => {
  for (const platform of PLATFORMS) {
    it(`is a valid skill for ${platform.name}`, () => {
      const md = skillMarkdown(BASE, platform);
      const front = /^---\n([\s\S]+?)\n---\n/.exec(md);
      expect(front).not.toBeNull();
      expect(front![1]).toMatch(/^name: power$/m);
      const description = front![1]!.split('description: >-')[1]!.replace(/\s+/g, ' ').trim();
      expect(description.length).toBeGreaterThan(40);
      expect(description.length).toBeLessThanOrEqual(1024);
      expect(md).toContain(`${BASE}/mcp`);
      expect(md).toContain(`${BASE}/start/vercel`);
    });
  }

  it('lists every tool the server has, so it cannot drift from the registry', () => {
    const md = skillMarkdown(BASE, platformById('claude-code')!);
    for (const tool of TOOLS) expect(md).toContain(`\`${tool.name}\``);
  });

  it('never tells the assistant to collect a credential in chat', () => {
    const md = skillMarkdown(BASE, platformById('cursor')!);
    expect(md).toMatch(/Never ask for an API key, password or token/);
  });
});

describe('the skill archive', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
  });

  it('unzips to power/SKILL.md with the exact contents', () => {
    const md = skillMarkdown(BASE, platformById('claude-app')!);
    const dir = mkdtempSync(join(tmpdir(), 'power-skill-'));
    writeFileSync(join(dir, 'power.zip'), skillZip(md));
    execFileSync('unzip', ['-q', 'power.zip'], { cwd: dir });
    expect(readFileSync(join(dir, 'power', 'SKILL.md'), 'utf8')).toBe(md);
  });
});

describe('platforms', () => {
  it('puts each skill where its client reads it', () => {
    expect(skillInstallCommand(platformById('claude-code')!, BASE)).toContain('~/.claude/skills/power/SKILL.md');
    expect(skillInstallCommand(platformById('cursor')!, BASE)).toContain('~/.cursor/skills/power/SKILL.md');
    expect(skillInstallCommand(platformById('codex')!, BASE)).toContain('~/.agents/skills/power/SKILL.md');
    // The Claude app takes an upload, not a folder.
    expect(skillInstallCommand(platformById('claude-app')!, BASE)).toBeNull();
  });

  it('connects each client to this server', () => {
    const endpoint = `${BASE}/mcp`;
    const claude = platformById('claude-code')!.connect(endpoint);
    expect(claude.kind === 'command' && claude.command).toBe(`claude mcp add --transport http power ${endpoint}`);
    const cursor = platformById('cursor')!.connect(endpoint);
    expect(cursor.kind).toBe('link');
    if (cursor.kind === 'link') {
      const config = new URL(cursor.href).searchParams.get('config')!;
      expect(JSON.parse(Buffer.from(config, 'base64').toString())).toEqual({ url: endpoint });
    }
  });

  it('fits the hand-off into Claude Code’s link', () => {
    const platform = platformById('claude-code')!;
    const message = handoffMessage(platform, BASE);
    expect(message.length).toBeLessThan(platform.maxMessage!);
    const link = launchLink(platform, message)!;
    expect(link.startsWith('claude-cli://open?q=')).toBe(true);
    expect(decodeURIComponent(link.split('q=')[1]!)).toBe(message);
  });

  it('only offers native links for tools that have them', () => {
    expect(launchLink(platformById('other')!, 'hi')).toBeNull();
    expect(launchLink(platformById('claude-app')!, 'hi')).toBeNull();
  });
});

describe('setup pages', () => {
  it('pre-selects the saved assistant and carries the CSRF field', () => {
    const html = setupPlatformPage(ctx, { platform: 'codex' }, { csrf });
    expect(html).toMatch(/value="codex" checked/);
    expect(html).toContain(csrf);
    expect(html).not.toContain('>Setup</a>');
  });

  it('warns that the Claude app cannot reach a loopback server', () => {
    const html = setupSkillPage(ctx, platformById('claude-app')!, { platform: 'claude-app' }, { csrf });
    expect(html).toContain('cannot reach');
    expect(html).toContain('/skills/power.zip?for=claude-app');
  });

  it('never renders a saved token, only its fingerprint', () => {
    const html = setupVercelPage(
      ctx,
      { vercel_connected_at: '2026-11-21T00:00:00Z', vercel_account: 'ada' },
      { csrf, localDeployer: true, token: { fingerprint: 'abcd1234' } },
    );
    expect(html).toContain('Connected');
    expect(html).toContain('abcd1234');
    expect(html).toContain('POWER_DEPLOYER=local');
  });

  it('escapes an account name from the hosting provider', () => {
    const html = setupVercelPage(ctx, { vercel_connected_at: 'x', vercel_account: '<img src=x>' }, { csrf, localDeployer: false, token: null });
    expect(html).not.toContain('<img src=x>');
  });
});

describe('setup progress', () => {
  it('counts the skill only for the assistant it was downloaded for', () => {
    expect(skillTaken({ platform: 'cursor', skill_downloaded_at: 'x', skill_platform: 'cursor' })).toBe(true);
    expect(skillTaken({ platform: 'codex', skill_downloaded_at: 'x', skill_platform: 'cursor' })).toBe(false);
    expect(skillTaken({ platform: 'codex' })).toBe(false);
  });

  it('reads the Claude app’s name as a sentence would', () => {
    const html = setupSkillPage(ctx, platformById('claude-app')!, { platform: 'claude-app' }, { csrf });
    expect(html).toContain('Give the Claude app the Power skill');
    expect(html).toContain('The Claude app connects from its own servers');
  });
});

describe('token shape', () => {
  it('accepts a token and refuses prose', () => {
    expect(looksLikeVercelToken('a'.repeat(24))).toBe(true);
    expect(looksLikeVercelToken('my token is here')).toBe(false);
    expect(looksLikeVercelToken('short')).toBe(false);
  });
});

describe('the installer', () => {
  const code = 'c'.repeat(43);
  for (const id of AUTOMATED) {
    it(`is valid sh for ${id}`, () => {
      const script = installerScript({ platform: platformById(id)!, baseUrl: BASE, code, account: 'ada@example.com' });
      const dir = mkdtempSync(join(tmpdir(), 'power-installer-'));
      writeFileSync(join(dir, 'setup.sh'), script);
      execFileSync('sh', ['-n', join(dir, 'setup.sh')]);
      expect(script).toContain(`/setup/$CODE/done`);
    });
  }

  it('never echoes the token it receives', () => {
    for (const id of ['claude-code', 'cursor', 'codex'] as const) {
      const script = installerScript({ platform: platformById(id)!, baseUrl: BASE, code, account: 'a' });
      expect(script).toContain('TOKEN=$(curl -fsS -X POST "$BASE/setup/$CODE/token")');
      expect(script).not.toMatch(/(say|echo|printf)[^\n]*\$TOKEN/);
    }
  });

  it('writes the token straight into each client’s config', () => {
    expect(installerScript({ platform: platformById('claude-code')!, baseUrl: BASE, code, account: 'a' })).toContain(
      'claude mcp add --scope user --transport http power',
    );
    expect(installerScript({ platform: platformById('cursor')!, baseUrl: BASE, code, account: 'a' })).toContain('.cursor/mcp.json');
    expect(installerScript({ platform: platformById('codex')!, baseUrl: BASE, code, account: 'a' })).toContain('[mcp_servers.power]');
  });

  it('fits the automated hand-off into Claude Code’s link', () => {
    const platform = platformById('claude-code')!;
    const message = automatedHandoff(platform, BASE, code);
    expect(message).toContain(`curl -fsSL ${BASE}/setup/${code} | sh`);
    expect(launchLink(platform, message)).not.toBeNull();
  });
});

describe('project hand-off', () => {
  const project = { id: 'p123', name: 'Yoga booking' };
  const claude = platformById('claude-code')!;

  it('carries the project, the request and the mode, and fits Claude Code’s link', async () => {
    const { projectHandoffMessage } = await import('./setup.js');
    const message = projectHandoffMessage({ platform: claude, baseUrl: BASE, project, mode: 'standard', idea: 'A booking page with Stripe' });
    expect(message).toContain('project_id "p123"');
    expect(message).toContain('A booking page with Stripe');
    expect(message).toContain('Power Up is off');
    expect(launchLink(claude, message)).not.toBeNull();
  });

  it('connects first, in the same message, when the assistant is not connected yet', async () => {
    const { projectHandoffMessage } = await import('./setup.js');
    const message = projectHandoffMessage({ platform: claude, baseUrl: BASE, project, mode: 'power_up', idea: 'x', installCode: 'c'.repeat(43) });
    expect(message).toMatch(/^1\. Connect to Power first by running: curl -fsSL .*\/setup\/c+ \| sh/m);
    expect(message).toContain('Power Up is on');
  });

  it('picks up where a run left off when there is no new request', async () => {
    const { projectHandoffMessage } = await import('./setup.js');
    const message = projectHandoffMessage({ platform: claude, baseUrl: BASE, project, mode: 'standard', progress: { phase: 'Building', next: 'run_tests' } });
    expect(message).toContain('where it left off (it is at: Building; next: run_tests)');
  });

  it('submits through the CLIs that take an opening prompt, safely quoted', async () => {
    const { terminalStart } = await import('./setup.js');
    expect(terminalStart(claude, "it's done")).toBe(`claude 'it'\\''s done'`);
    expect(terminalStart(platformById('codex')!, 'go')).toBe(`codex 'go'`);
    expect(terminalStart(platformById('cursor')!, 'go')).toBeNull();
  });

  it('names a project from the request', async () => {
    const { nameFromIdea } = await import('./setup.js');
    expect(nameFromIdea('Build a booking page for my yoga studio with Stripe')).toBe('Booking page for my yoga studio');
    expect(nameFromIdea('make me an invoice tracker using Postgres')).toBe('Invoice tracker');
  });
});
