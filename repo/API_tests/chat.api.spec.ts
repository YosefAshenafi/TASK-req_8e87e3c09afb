/**
 * CHAT API TESTS
 * Real end-to-end tests of the chat messaging service.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { makeFullContext, signUp } from './helpers';
import type { FullContext } from './helpers';

const WS = 'ws-chat-api';

describe('Chat API — full lifecycle', () => {
  let ctx: FullContext;

  beforeEach(async () => {
    ctx = makeFullContext();
    await signUp(ctx.auth, 'alice');
    await ctx.chat.loadForWorkspace(WS);
  });

  it('send and retrieve user messages', async () => {
    const m1 = await ctx.chat.send('Hello everyone!');
    const m2 = await ctx.chat.send('How are you?');

    expect(m1.type).toBe('user');
    expect(m1.body).toBe('Hello everyone!');
    expect(m2.type).toBe('user');

    const messages = await firstValueFrom(ctx.chat.messages$);
    expect(messages).toHaveLength(2);
  });

  it('user messages carry author info from signed-in profile', async () => {
    const msg = await ctx.chat.send('Test message');
    expect(msg.authorId).toBe(ctx.auth.currentProfile?.id);
    expect(msg.authorName).toBe('alice');
  });

  it('system messages have no author', async () => {
    const msg = await ctx.chat.postSystem('Workspace created');
    expect(msg.type).toBe('system');
    expect(msg.authorId).toBeUndefined();
    expect(msg.authorName).toBeUndefined();
  });

  it('messages persist across service instances', async () => {
    await ctx.chat.send('Persistent message');

    const ctx2 = makeFullContext();
    await ctx2.chat.loadForWorkspace(WS);
    const messages = await firstValueFrom(ctx2.chat.messages$);
    expect(messages).toHaveLength(1);
    expect(messages[0].body).toBe('Persistent message');
  });

  it('search finds matching messages case-insensitively', async () => {
    await ctx.chat.send('Hello World');
    await ctx.chat.send('Goodbye World');
    await ctx.chat.send('Completely different topic');

    const results = await ctx.chat.search('world');
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results.every(m => m.body.toLowerCase().includes('world'))).toBe(true);
  });

  it('search returns empty for no matches', async () => {
    await ctx.chat.send('Hello World');
    const results = await ctx.chat.search('zzz-not-found');
    expect(results).toEqual([]);
  });

  it('search returns empty for empty query', async () => {
    await ctx.chat.send('Some message');
    expect(await ctx.chat.search('')).toEqual([]);
    expect(await ctx.chat.search('   ')).toEqual([]);
  });

  it('rolling window trims to 500 messages', async () => {
    for (let i = 0; i < 502; i++) {
      await ctx.chat.send(`Message ${i}`);
    }
    const messages = await firstValueFrom(ctx.chat.messages$);
    expect(messages).toHaveLength(500);
    // Most recent message should be in window
    expect(messages.some(m => m.body === 'Message 501')).toBe(true);
    // Oldest should have been evicted
    expect(messages.some(m => m.body === 'Message 0')).toBe(false);
  });

  it('mixes user and system messages in chronological order', async () => {
    await ctx.chat.send('User says hello');
    await ctx.chat.postSystem('System: workspace loaded');
    await ctx.chat.send('User replies');

    const messages = await firstValueFrom(ctx.chat.messages$);
    expect(messages).toHaveLength(3);
    expect(messages[0].type).toBe('user');
    expect(messages[1].type).toBe('system');
    expect(messages[2].type).toBe('user');
  });

  it('each message has unique id', async () => {
    const m1 = await ctx.chat.send('First');
    const m2 = await ctx.chat.send('Second');
    expect(m1.id).not.toBe(m2.id);
  });

  it('messages are workspace-scoped', async () => {
    await ctx.chat.send('In WS');

    const ctx2 = makeFullContext();
    await ctx2.chat.loadForWorkspace('other-ws');
    const messages = await firstValueFrom(ctx2.chat.messages$);
    expect(messages).toHaveLength(0);
  });
});
