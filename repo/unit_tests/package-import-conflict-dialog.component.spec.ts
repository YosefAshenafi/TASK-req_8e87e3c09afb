/**
 * PackageImportConflictDialogComponent — unit tests.
 * Tests the dialog's public interface: existingName input and the decide output
 * EventEmitter for all three conflict choices (overwrite / copy / cancel).
 * No Angular TestBed — the component has no logic methods; tests interact
 * directly with its Input/Output API, which is the contract the parent template
 * and WorkspaceLayoutComponent.resolveConflict() depend on.
 */
import { describe, it, expect } from 'vitest';
import { PackageImportConflictDialogComponent } from '../src/app/import-export/package-import-conflict-dialog.component';
import type { ConflictChoice } from '../src/app/import-export/package.service';

function make() {
  return new PackageImportConflictDialogComponent();
}

describe('PackageImportConflictDialogComponent — Input: existingName', () => {
  it('defaults existingName to an empty string', () => {
    const c = make();
    expect(c.existingName).toBe('');
  });

  it('accepts any string for existingName', () => {
    const c = make();
    c.existingName = 'My Workspace';
    expect(c.existingName).toBe('My Workspace');
  });

  it('accepts a workspace name with special characters', () => {
    const c = make();
    c.existingName = 'Prject: Alpha (v2) — final';
    expect(c.existingName).toBe('Prject: Alpha (v2) — final');
  });
});

describe('PackageImportConflictDialogComponent — Output: decide EventEmitter', () => {
  it('decide is an EventEmitter (can be subscribed to)', () => {
    const c = make();
    const received: ConflictChoice[] = [];
    c.decide.subscribe((v: ConflictChoice) => received.push(v));
    c.decide.emit('overwrite');
    expect(received).toEqual(['overwrite']);
  });

  it('emitting "overwrite" propagates the correct ConflictChoice', () => {
    const c = make();
    const received: ConflictChoice[] = [];
    c.decide.subscribe((v: ConflictChoice) => received.push(v));
    c.decide.emit('overwrite');
    expect(received[0]).toBe('overwrite');
  });

  it('emitting "copy" propagates the correct ConflictChoice', () => {
    const c = make();
    const received: ConflictChoice[] = [];
    c.decide.subscribe((v: ConflictChoice) => received.push(v));
    c.decide.emit('copy');
    expect(received[0]).toBe('copy');
  });

  it('emitting "cancel" propagates the correct ConflictChoice', () => {
    const c = make();
    const received: ConflictChoice[] = [];
    c.decide.subscribe((v: ConflictChoice) => received.push(v));
    c.decide.emit('cancel');
    expect(received[0]).toBe('cancel');
  });

  it('each emission is delivered independently in order', () => {
    const c = make();
    const received: ConflictChoice[] = [];
    c.decide.subscribe((v: ConflictChoice) => received.push(v));

    c.decide.emit('overwrite');
    c.decide.emit('copy');
    c.decide.emit('cancel');

    expect(received).toEqual(['overwrite', 'copy', 'cancel']);
  });

  it('multiple subscribers each receive every emission', () => {
    const c = make();
    const sub1: ConflictChoice[] = [];
    const sub2: ConflictChoice[] = [];

    c.decide.subscribe((v: ConflictChoice) => sub1.push(v));
    c.decide.subscribe((v: ConflictChoice) => sub2.push(v));

    c.decide.emit('copy');

    expect(sub1).toEqual(['copy']);
    expect(sub2).toEqual(['copy']);
  });
});

describe('PackageImportConflictDialogComponent — integration with parent resolveConflict', () => {
  /**
   * WorkspaceLayoutComponent.resolveConflict(choice) is called when the
   * (decide) output fires. This test verifies the full handshake: dialog emits
   * a choice → parent resolve callback is invoked with that choice.
   */
  it('resolve callback is called with "overwrite" when dialog emits overwrite', () => {
    const c = make();
    let resolvedWith: ConflictChoice | null = null;

    // Simulate parent wiring: subscribe to decide → call resolve
    const resolve = (choice: ConflictChoice) => { resolvedWith = choice; };
    c.decide.subscribe((choice: ConflictChoice) => resolve(choice));

    c.decide.emit('overwrite');
    expect(resolvedWith).toBe('overwrite');
  });

  it('resolve callback is called with "copy" when dialog emits copy', () => {
    const c = make();
    let resolvedWith: ConflictChoice | null = null;
    c.decide.subscribe((choice: ConflictChoice) => { resolvedWith = choice; });
    c.decide.emit('copy');
    expect(resolvedWith).toBe('copy');
  });

  it('resolve callback is called with "cancel" when dialog emits cancel', () => {
    const c = make();
    let resolvedWith: ConflictChoice | null = null;
    c.decide.subscribe((choice: ConflictChoice) => { resolvedWith = choice; });
    c.decide.emit('cancel');
    expect(resolvedWith).toBe('cancel');
  });

  it('existingName set before emit is preserved when handler fires', () => {
    const c = make();
    c.existingName = 'Conflict Workspace';

    let capturedName = '';
    c.decide.subscribe(() => { capturedName = c.existingName; });
    c.decide.emit('overwrite');

    expect(capturedName).toBe('Conflict Workspace');
  });
});
