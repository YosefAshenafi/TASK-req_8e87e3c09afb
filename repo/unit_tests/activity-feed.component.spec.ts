/**
 * ActivityFeedComponent — deep behavioural unit tests.
 *
 * Covers:
 *   • recentActivity() cap of 50 entries
 *   • timeLabel() ranges: just now / Nm ago / Nh ago (Date.now mocked)
 *   • dotColor() deterministic palette selection
 *   • openObject emits objectOpened with the right payload for clickable entries
 *   • openObject is a no-op (no emit) when entry.objectId is missing
 *   • closed EventEmitter propagates
 *
 * Uses runInInjectionContext to satisfy the `inject(PresenceService)` field
 * initialiser without bringing in Angular TestBed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { ActivityFeedComponent } from '../src/app/presence/activity-feed.component';
import { PresenceService } from '../src/app/presence/presence.service';
import type { ActivityEntry } from '../src/app/core/types';

const NOW = 1_700_000_000_000;

function makeEntry(p: Partial<ActivityEntry>): ActivityEntry {
  return {
    id: p.id ?? 'e-' + Math.random().toString(36).slice(2, 8),
    tabId: p.tabId ?? 'tab-1',
    profileId: p.profileId ?? 'alice',
    action: p.action ?? 'edited a note',
    objectId: p.objectId,
    objectType: p.objectType,
    at: p.at ?? NOW - 1000,
  };
}

function makeFeed(initial: ActivityEntry[] = []) {
  const activity$ = new BehaviorSubject<ActivityEntry[]>(initial);
  const presence = { activity$ } as unknown as PresenceService;
  const injector = Injector.create({
    providers: [{ provide: PresenceService, useValue: presence }],
  });
  let component!: ActivityFeedComponent;
  runInInjectionContext(injector, () => {
    component = new ActivityFeedComponent();
  });
  return { component: component as ActivityFeedComponent & Record<string, any>, activity$ };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => vi.useRealTimers());

describe('ActivityFeedComponent — recentActivity()', () => {
  it('returns an empty list when no activity has been published', () => {
    const { component } = makeFeed([]);
    const c = component as any;
    expect(c.recentActivity()).toEqual([]);
  });

  it('mirrors the stream when fewer than 50 entries are present', () => {
    const entries = Array.from({ length: 5 }, (_, i) => makeEntry({ id: `e${i}` }));
    const { component } = makeFeed(entries);
    expect((component as any).recentActivity().length).toBe(5);
  });

  it('caps the list at 50 entries (slice(0, 50))', () => {
    const entries = Array.from({ length: 70 }, (_, i) => makeEntry({ id: `e${i}` }));
    const { component } = makeFeed(entries);
    const shown = (component as any).recentActivity();
    expect(shown.length).toBe(50);
    expect(shown[0].id).toBe('e0');
    expect(shown[49].id).toBe('e49');
  });

  it('reacts to new emissions on the presence stream (signal-backed)', () => {
    const { component, activity$ } = makeFeed([]);
    const c = component as any;
    activity$.next([makeEntry({ id: 'new1' })]);
    expect(c.recentActivity().length).toBe(1);
    expect(c.recentActivity()[0].id).toBe('new1');
  });
});

describe('ActivityFeedComponent — timeLabel()', () => {
  it('returns "just now" for timestamps within the last minute', () => {
    const { component } = makeFeed([]);
    const c = component as any;
    expect(c.timeLabel(NOW - 30_000)).toBe('just now');
    expect(c.timeLabel(NOW - 59_999)).toBe('just now');
  });

  it('returns "<N>m ago" between 1 and 59 minutes', () => {
    const { component } = makeFeed([]);
    const c = component as any;
    expect(c.timeLabel(NOW - 1 * 60_000)).toBe('1m ago');
    expect(c.timeLabel(NOW - 45 * 60_000)).toBe('45m ago');
  });

  it('returns "<N>h ago" for >= 60 minutes old', () => {
    const { component } = makeFeed([]);
    const c = component as any;
    expect(c.timeLabel(NOW - 2 * 3600_000)).toBe('2h ago');
  });
});

describe('ActivityFeedComponent — dotColor()', () => {
  it('is deterministic for a given profileId', () => {
    const { component } = makeFeed([]);
    const c = component as any;
    const a = c.dotColor('alice');
    const b = c.dotColor('alice');
    expect(a).toBe(b);
    expect(a).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('produces different colors for different profiles (not all one bucket)', () => {
    const { component } = makeFeed([]);
    const c = component as any;
    const colors = new Set(
      ['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7', 'u8'].map(id => c.dotColor(id)),
    );
    // The palette has 6 entries; 8 profileIds should span > 1 bucket.
    expect(colors.size).toBeGreaterThan(1);
  });
});

describe('ActivityFeedComponent — openObject', () => {
  it('emits objectOpened with objectId + objectType when both are present', () => {
    const { component } = makeFeed([]);
    const c = component as any;
    const captured: Array<{ objectId: string; objectType?: string }> = [];
    component.objectOpened.subscribe(v => captured.push(v));
    c.openObject(makeEntry({ objectId: 'obj-1', objectType: 'note' }));
    expect(captured).toEqual([{ objectId: 'obj-1', objectType: 'note' }]);
  });

  it('does NOT emit when entry has no objectId', () => {
    const { component } = makeFeed([]);
    const c = component as any;
    let fired = 0;
    component.objectOpened.subscribe(() => fired++);
    c.openObject(makeEntry({ objectId: undefined, objectType: 'note' }));
    expect(fired).toBe(0);
  });

  it('omits objectType when the entry has no type', () => {
    const { component } = makeFeed([]);
    const c = component as any;
    const captured: Array<{ objectId: string; objectType?: string }> = [];
    component.objectOpened.subscribe(v => captured.push(v));
    c.openObject(makeEntry({ objectId: 'obj-2' }));
    expect(captured[0].objectId).toBe('obj-2');
    expect(captured[0].objectType).toBeUndefined();
  });
});

describe('ActivityFeedComponent — closed emitter', () => {
  it('propagates each emission to each subscriber', () => {
    const { component } = makeFeed([]);
    let a = 0, b = 0;
    component.closed.subscribe(() => a++);
    component.closed.subscribe(() => b++);
    component.closed.emit();
    component.closed.emit();
    expect(a).toBe(2);
    expect(b).toBe(2);
  });
});
