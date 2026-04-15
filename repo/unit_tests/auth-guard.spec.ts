/**
 * AUTH GUARD UNIT TESTS
 *
 * Two-pronged approach (no TestBed required):
 *
 * 1. Static / structural — verify app.routes.ts wires authGuard to every
 *    protected route and leaves public routes unguarded.
 *
 * 2. Reactive-logic simulation — exercise the exact RxJS pipeline that
 *    authGuard runs (currentProfile$.pipe(take(1), map(p => p ? true : redirect)))
 *    using real AuthService instances, confirming the guard's allow / redirect
 *    decision for both authenticated and unauthenticated callers.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { firstValueFrom } from 'rxjs';
import { map, take } from 'rxjs/operators';
import { makeContext, createAndSignIn } from './helpers';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── Static: route configuration ───────────────────────────────────────────────

describe('authGuard — route configuration (static)', () => {
  const src = readFileSync(resolve(ROOT, 'src/app/app.routes.ts'), 'utf8');

  it('imports authGuard from the correct module', () => {
    expect(src).toContain("import { authGuard } from './auth/auth.guard'");
  });

  it('/persona route has canActivate: [authGuard]', () => {
    const idx = src.indexOf("path: 'persona'");
    expect(idx).toBeGreaterThan(-1);
    const slice = src.slice(idx, idx + 200);
    expect(slice).toContain('canActivate');
    expect(slice).toContain('authGuard');
  });

  it('/workspaces route has canActivate: [authGuard]', () => {
    const idx = src.indexOf("path: 'workspaces'");
    expect(idx).toBeGreaterThan(-1);
    const slice = src.slice(idx, idx + 200);
    expect(slice).toContain('canActivate');
    expect(slice).toContain('authGuard');
  });

  it('/w/:id route has canActivate: [authGuard]', () => {
    const idx = src.indexOf("path: 'w/:id'");
    expect(idx).toBeGreaterThan(-1);
    const slice = src.slice(idx, idx + 200);
    expect(slice).toContain('canActivate');
    expect(slice).toContain('authGuard');
  });

  it('/reporting route has canActivate: [authGuard]', () => {
    const idx = src.indexOf("path: 'reporting'");
    expect(idx).toBeGreaterThan(-1);
    const slice = src.slice(idx, idx + 200);
    expect(slice).toContain('canActivate');
    expect(slice).toContain('authGuard');
  });

  it('/profiles route has NO canActivate (public)', () => {
    const idx = src.indexOf("path: 'profiles'");
    expect(idx).toBeGreaterThan(-1);
    // Grab the route object up to the next path declaration
    const nextPath = src.indexOf("path: 'profiles/new'");
    const slice = src.slice(idx, nextPath > idx ? nextPath : idx + 300);
    expect(slice).not.toContain('canActivate');
  });

  it('/profiles/new route has NO canActivate (public)', () => {
    const idx = src.indexOf("path: 'profiles/new'");
    expect(idx).toBeGreaterThan(-1);
    const nextPath = src.indexOf("path: 'sign-in");
    const slice = src.slice(idx, nextPath > idx ? nextPath : idx + 300);
    expect(slice).not.toContain('canActivate');
  });

  it('/sign-in/:profileId route has NO canActivate (public)', () => {
    const idx = src.indexOf("path: 'sign-in/:profileId'");
    expect(idx).toBeGreaterThan(-1);
    const nextPath = src.indexOf("path: 'persona'");
    const slice = src.slice(idx, nextPath > idx ? nextPath : idx + 300);
    expect(slice).not.toContain('canActivate');
  });
});

// ── Guard source code verification ────────────────────────────────────────────

describe('authGuard — implementation verification (static)', () => {
  const guardSrc = readFileSync(resolve(ROOT, 'src/app/auth/auth.guard.ts'), 'utf8');

  it('reads currentProfile$ from AuthService', () => {
    expect(guardSrc).toContain('currentProfile$');
  });

  it('redirects to /profiles when no profile is present', () => {
    expect(guardSrc).toContain("'/profiles'");
  });

  it('uses take(1) to avoid subscription leaks', () => {
    expect(guardSrc).toContain('take(1)');
  });

  it('returns true for an authenticated profile', () => {
    expect(guardSrc).toContain('return true');
  });
});

// ── Reactive logic simulation ─────────────────────────────────────────────────

describe('authGuard — reactive logic (via AuthService.currentProfile$)', () => {
  it('unauthenticated: currentProfile$ emits null → guard would redirect', async () => {
    const { auth } = makeContext();

    const wouldAllow = await firstValueFrom(
      auth.currentProfile$.pipe(
        take(1),
        map(p => p !== null),
      ),
    );

    expect(wouldAllow).toBe(false);
  });

  it('authenticated: currentProfile$ emits profile → guard would allow', async () => {
    const { auth } = makeContext();
    await createAndSignIn(auth);

    const wouldAllow = await firstValueFrom(
      auth.currentProfile$.pipe(
        take(1),
        map(p => p !== null),
      ),
    );

    expect(wouldAllow).toBe(true);
  });

  it('after sign-out: currentProfile$ emits null → guard would redirect', async () => {
    const { auth } = makeContext();
    await createAndSignIn(auth);
    await auth.signOut();

    const wouldAllow = await firstValueFrom(
      auth.currentProfile$.pipe(
        take(1),
        map(p => p !== null),
      ),
    );

    expect(wouldAllow).toBe(false);
  });

  it('guard allows each role: Admin', async () => {
    const { auth } = makeContext();
    await auth.createProfile({ username: 'admin', password: 'password123', role: 'Admin' });
    await auth.signIn('admin', 'password123');

    const wouldAllow = await firstValueFrom(
      auth.currentProfile$.pipe(take(1), map(p => p !== null)),
    );
    expect(wouldAllow).toBe(true);
  });

  it('guard allows each role: Teacher', async () => {
    const { auth } = makeContext();
    await auth.createProfile({ username: 'teacher', password: 'password123', role: 'Teacher' });
    await auth.signIn('teacher', 'password123');

    const wouldAllow = await firstValueFrom(
      auth.currentProfile$.pipe(take(1), map(p => p !== null)),
    );
    expect(wouldAllow).toBe(true);
  });

  it('guard allows each role: Academic Affairs', async () => {
    const { auth } = makeContext();
    await auth.createProfile({ username: 'academic', password: 'password123', role: 'Academic Affairs' });
    await auth.signIn('academic', 'password123');

    const wouldAllow = await firstValueFrom(
      auth.currentProfile$.pipe(take(1), map(p => p !== null)),
    );
    expect(wouldAllow).toBe(true);
  });
});
