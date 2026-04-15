/**
 * Pure KPI computation utilities — shared between aggregator.worker.ts
 * and unit tests (which cannot import the webworker file directly).
 * No browser-specific or webworker-specific APIs are used here.
 */

/** Lightweight event tuple stored in the worker ring buffer. */
export interface KpiBufferEntry {
  type: string;
  at: number;
  profileId?: string;
  threadId?: string;
}

/**
 * Compute the average comment response time in milliseconds.
 *
 * Algorithm: for every 'comment-created' event that has a threadId, find the
 * first later 'comment-reply' event with the same threadId.  The response time
 * is the delta between those two timestamps.  Returns 0 when no valid pairs
 * exist.
 */
export function computeAvgCommentResponseMs(buffer: KpiBufferEntry[]): number {
  const created = buffer.filter(e => e.type === 'comment-created' && e.threadId);
  const replied  = buffer.filter(e => e.type === 'comment-reply'  && e.threadId);

  const deltas: number[] = [];
  for (const c of created) {
    const reply = replied.find(r => r.threadId === c.threadId && r.at > c.at);
    if (reply) deltas.push(reply.at - c.at);
  }

  if (deltas.length === 0) return 0;
  return deltas.reduce((a, b) => a + b, 0) / deltas.length;
}

/**
 * Count unresolved mutual-help requests from an ordered event sequence.
 * 'mutual-help-published' increments the running count;
 * 'mutual-help-resolved' decrements it (floor at 0).
 */
export function computeUnresolvedFromEvents(events: { type: string }[]): number {
  let count = 0;
  for (const e of events) {
    if (e.type === 'mutual-help-published') count++;
    else if (e.type === 'mutual-help-resolved') count--;
  }
  return Math.max(0, count);
}
