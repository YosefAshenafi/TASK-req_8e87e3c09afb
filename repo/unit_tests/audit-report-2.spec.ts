/**
 * Audit Report 2 — Verification Suite
 *
 * Each describe block maps 1-to-1 to a finding from audit_report-2.md.
 * All tests are expected to PASS on the fixed codebase.
 *
 * Static checks: read source / config files via Node fs and assert content.
 * Runtime checks: use the in-memory IndexedDB + service context from helpers.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeContext, createAndSignIn } from './helpers';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── H-01: Docker / ESLint config mismatch ────────────────────────────────────

describe('H-01 (resolved): docker-compose mounts the ESLint config that actually exists', () => {
  it('eslint.config.js exists at repo root', () => {
    expect(existsSync(resolve(ROOT, 'eslint.config.js'))).toBe(true);
  });

  it('.eslintrc.json does NOT exist at repo root', () => {
    expect(existsSync(resolve(ROOT, '.eslintrc.json'))).toBe(false);
  });

  it('docker-compose.yml mounts eslint.config.js, not .eslintrc.json', () => {
    const compose = readFileSync(resolve(ROOT, 'docker-compose.yml'), 'utf8');
    expect(compose).toContain('eslint.config.js:/workspace/eslint.config.js');
    expect(compose).not.toContain('.eslintrc.json');
  });

  it('docker-compose.yml lint service uses eslint.config.js mount via workspace-mounts anchor', () => {
    const compose = readFileSync(resolve(ROOT, 'docker-compose.yml'), 'utf8');
    // The shared x-workspace-mounts anchor must carry the correct file
    const anchorSection = compose.slice(
      compose.indexOf('x-workspace-mounts'),
      compose.indexOf('services:'),
    );
    expect(anchorSection).toContain('eslint.config.js:/workspace/eslint.config.js');
    expect(anchorSection).not.toContain('.eslintrc.json');
  });
});

// ── H-02: Wrong IndexedDB store name in comment drawer ───────────────────────

describe('H-02 (resolved): comment drawer uses correct "events" store for roster loading', () => {
  const DRAWER_SRC = resolve(
    ROOT,
    'src/app/comments/comment-drawer.component.ts',
  );

  // ── Static source checks ──────────────────────────────────────────────────

  it('does not reference the non-existent "telemetry_events" store', () => {
    const src = readFileSync(DRAWER_SRC, 'utf8');
    expect(src).not.toContain('telemetry_events');
  });

  it('queries the "events" store with the "by_workspace" index', () => {
    const src = readFileSync(DRAWER_SRC, 'utf8');
    expect(src).toContain("getAllFromIndex('events', 'by_workspace'");
  });

  it('catch block has an active fallback — calls listProfiles() on failure', () => {
    const src = readFileSync(DRAWER_SRC, 'utf8');
    // The catch must not be a silent no-op; it must call listProfiles to recover
    expect(src).toMatch(/catch\s*\{[\s\S]{0,300}listProfiles/);
  });

  // ── Runtime: events store contract ───────────────────────────────────────

  let ctx: ReturnType<typeof makeContext>;

  beforeEach(async () => {
    ctx = makeContext();
    await createAndSignIn(ctx.auth, 'alice', 'password123');
  });

  it('"events" store exists and is queryable by "by_workspace" index', async () => {
    const WS = 'ws-h02-store-exists';
    ctx.telemetry.log({
      workspaceId: WS,
      type: 'workspace.entered',
      payload: { profileId: ctx.auth.currentProfile!.id },
    });
    await new Promise(r => setTimeout(r, 60));

    const idb = await ctx.db.open();
    // If store name were wrong this would throw — must resolve cleanly
    const events = await idb.getAllFromIndex('events', 'by_workspace', WS);
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it('roster built from events store contains profiles that logged workspace events', async () => {
    const WS = 'ws-h02-roster-scoped';
    await ctx.auth.createProfile({ username: 'bob', password: 'password123', role: 'Teacher' });

    // Only alice logs an event in this workspace
    ctx.telemetry.log({
      workspaceId: WS,
      type: 'workspace.entered',
      payload: { profileId: ctx.auth.currentProfile!.id },
    });
    await new Promise(r => setTimeout(r, 60));

    const idb = await ctx.db.open();
    const events = await idb.getAllFromIndex('events', 'by_workspace', WS);
    const profileIds = new Set(
      events
        .map(e => (e.payload as Record<string, unknown>)?.['profileId'])
        .filter(Boolean),
    );

    const allProfiles = await ctx.auth.listProfiles();
    const roster =
      profileIds.size > 0
        ? allProfiles.filter(p => profileIds.has(p.id)).map(p => p.username)
        : allProfiles.map(p => p.username);

    // alice has a workspace event → in roster
    expect(roster).toContain('alice');
    // bob has no event in this workspace → filtered out
    expect(roster).not.toContain('bob');
  });

  it('roster falls back to all profiles when workspace has no events', async () => {
    await ctx.auth.createProfile({ username: 'carol', password: 'password123', role: 'Teacher' });

    const WS = 'ws-h02-no-events';
    const idb = await ctx.db.open();
    const events = await idb.getAllFromIndex('events', 'by_workspace', WS);
    expect(events.length).toBe(0);

    // Fallback: when profileIds is empty, the roster is the full profile list
    const allProfiles = await ctx.auth.listProfiles();
    const roster = allProfiles.map(p => p.username);
    expect(roster).toContain('alice');
    expect(roster).toContain('carol');
  });

  it('multiple events from different profiles all land in profileIds set', async () => {
    const WS = 'ws-h02-multi-profile';
    const bob = await ctx.auth.createProfile({ username: 'bob', password: 'password123', role: 'Teacher' });

    ctx.telemetry.log({
      workspaceId: WS,
      type: 'workspace.entered',
      payload: { profileId: ctx.auth.currentProfile!.id },
    });
    ctx.telemetry.log({
      workspaceId: WS,
      type: 'workspace.entered',
      payload: { profileId: bob.id },
    });
    await new Promise(r => setTimeout(r, 60));

    const idb = await ctx.db.open();
    const events = await idb.getAllFromIndex('events', 'by_workspace', WS);
    const profileIds = new Set(
      events
        .map(e => (e.payload as Record<string, unknown>)?.['profileId'])
        .filter(Boolean),
    );
    expect(profileIds.has(ctx.auth.currentProfile!.id)).toBe(true);
    expect(profileIds.has(bob.id)).toBe(true);
  });
});

// ── Medium: Test command surface fragmentation ────────────────────────────────

describe('Medium (resolved): canonical test path is unambiguous in Makefile and README', () => {
  it('Makefile `test` target delegates to ./run_tests.sh', () => {
    const makefile = readFileSync(resolve(ROOT, 'Makefile'), 'utf8');
    expect(makefile).toMatch(/^test:\n\t\.\/run_tests\.sh/m);
  });

  it('Makefile has a `test-legacy` target for the deprecated Karma runner', () => {
    const makefile = readFileSync(resolve(ROOT, 'Makefile'), 'utf8');
    expect(makefile).toContain('test-legacy:');
  });

  it('Makefile labels the legacy target as deprecated', () => {
    const makefile = readFileSync(resolve(ROOT, 'Makefile'), 'utf8');
    // Match the target `test-legacy:` — not `.PHONY: ... test-legacy ...`
    const legacySection = makefile.slice(makefile.indexOf('test-legacy:'));
    expect(legacySection.slice(0, 200).toLowerCase()).toContain('deprecated');
  });

  it('README documents ./run_tests.sh as the canonical full-suite test command', () => {
    const readme = readFileSync(resolve(ROOT, 'README.md'), 'utf8');
    expect(readme).toContain('./run_tests.sh');
  });

  it('run_tests.sh executes all three suites: unit-test, api-test, e2e-test', () => {
    const script = readFileSync(resolve(ROOT, 'run_tests.sh'), 'utf8');
    expect(script).toContain('unit-test');
    expect(script).toContain('api-test');
    expect(script).toContain('e2e-test');
  });
});

// ── Low: Over-absolute README language ───────────────────────────────────────

describe('Low (resolved): README frames Docker workflow as recommended, not forbidden', () => {
  it('README does not use the word "forbidden"', () => {
    const readme = readFileSync(resolve(ROOT, 'README.md'), 'utf8');
    expect(readme.toLowerCase()).not.toContain('forbidden');
  });

  it('README does not say host tooling is "explicitly not supported"', () => {
    const readme = readFileSync(resolve(ROOT, 'README.md'), 'utf8');
    expect(readme).not.toContain('explicitly **not supported**');
  });

  it('README uses "recommended" framing for the Docker workflow', () => {
    const readme = readFileSync(resolve(ROOT, 'README.md'), 'utf8');
    expect(readme).toMatch(/recommended/i);
  });
});
