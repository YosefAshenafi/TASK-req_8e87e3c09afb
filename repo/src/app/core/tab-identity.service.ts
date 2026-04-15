import { Injectable } from '@angular/core';
import { v4 as uuidv4 } from 'uuid';

const TAB_PALETTE: readonly string[] = [
  '#E53935', // red
  '#8E24AA', // purple
  '#1E88E5', // blue
  '#00ACC1', // cyan
  '#43A047', // green
  '#F4511E', // deep-orange
  '#6D4C41', // brown
  '#00897B', // teal
  '#3949AB', // indigo
  '#FFB300', // amber
  '#039BE5', // light-blue
  '#C0CA33', // lime
] as const;

/** Generates a stable per-session tab identity (UUID + colour). */
@Injectable({ providedIn: 'root' })
export class TabIdentityService {
  readonly tabId!: string;
  readonly color: string;

  constructor() {
    const id = uuidv4();
    Object.defineProperty(this, 'tabId', {
      value: id,
      writable: false,
      enumerable: true,
      configurable: false,
    });
    // Pick a colour deterministically from the tab ID to avoid clashes
    // when multiple tabs are open (colour rotates through the palette).
    const slot =
      parseInt(id.replace(/-/g, '').slice(0, 8), 16) % TAB_PALETTE.length;
    this.color = TAB_PALETTE[slot];
  }
}
