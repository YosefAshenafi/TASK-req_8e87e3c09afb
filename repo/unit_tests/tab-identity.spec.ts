import { describe, it, expect } from 'vitest';
import { TabIdentityService } from '../src/app/core/tab-identity.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

describe('TabIdentityService', () => {
  it('assigns a valid UUID v4 as tabId', () => {
    const svc = new TabIdentityService();
    expect(svc.tabId).toMatch(UUID_RE);
  });

  it('assigns a hex color from the palette', () => {
    const svc = new TabIdentityService();
    expect(svc.color).toMatch(HEX_COLOR_RE);
  });

  it('each instance gets a unique tabId', () => {
    const ids = new Set(Array.from({ length: 10 }, () => new TabIdentityService().tabId));
    expect(ids.size).toBe(10);
  });

  it('color is one of the known palette entries', () => {
    const palette = [
      '#E53935', '#8E24AA', '#1E88E5', '#00ACC1',
      '#43A047', '#F4511E', '#6D4C41', '#00897B',
      '#3949AB', '#FFB300', '#039BE5', '#C0CA33',
    ];
    const svc = new TabIdentityService();
    expect(palette).toContain(svc.color);
  });

  it('tabId is immutable (readonly)', () => {
    const svc = new TabIdentityService();
    const original = svc.tabId;
    expect(Reflect.set(svc as object, 'tabId', 'changed')).toBe(false);
    expect(svc.tabId).toBe(original);
  });
});
