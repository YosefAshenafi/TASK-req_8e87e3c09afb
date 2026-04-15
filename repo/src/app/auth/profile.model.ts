import type { Profile, ProfileSummary } from '../core/types';

export type { Profile, ProfileSummary };

export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000;
export const MAX_FAILED_ATTEMPTS = 3;
