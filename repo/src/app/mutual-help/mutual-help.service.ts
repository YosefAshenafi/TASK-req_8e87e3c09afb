import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';
import { DbService } from '../core/db.service';
import { BroadcastService } from '../core/broadcast.service';
import { TelemetryService } from '../telemetry/telemetry.service';
import { AuthService } from '../auth/auth.service';
import { AppException } from '../core/error';
import type { MutualHelpPost, NewPostInput } from '../core/types';

const DEFAULT_EXPIRY_MS = 72 * 60 * 60 * 1000; // 72 hours
const SWEEP_INTERVAL_MS = 60 * 1000;

@Injectable({ providedIn: 'root' })
export class MutualHelpService {
  private readonly _posts$ = new BehaviorSubject<MutualHelpPost[]>([]);
  private _workspaceId = '';
  private _sweepTimer: ReturnType<typeof setInterval> | null = null;

  get posts$(): Observable<MutualHelpPost[]> {
    return this._posts$.asObservable();
  }

  constructor(
    private readonly db: DbService,
    private readonly broadcast: BroadcastService,
    private readonly telemetry: TelemetryService,
    private readonly auth: AuthService,
  ) {}

  async loadForWorkspace(workspaceId: string): Promise<void> {
    this._workspaceId = workspaceId;
    await this._reload();
    this._startSweepTimer();
  }

  unload(): void {
    this._stopSweepTimer();
  }

  async createDraft(input: NewPostInput): Promise<MutualHelpPost> {
    const idb = await this.db.open();
    const now = Date.now();
    const post: MutualHelpPost = {
      id: uuidv4(),
      workspaceId: input.workspaceId,
      status: 'draft',
      type: input.type,
      category: input.category,
      title: input.title,
      description: input.description,
      tags: input.tags,
      timeWindow: input.timeWindow,
      budget: input.budget,
      urgency: input.urgency,
      attachmentIds: input.attachmentIds ?? [],
      authorId: '',
      pinned: false,
      expiresAt: now + (input.expiresIn ?? DEFAULT_EXPIRY_MS),
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    await idb.put('mutual_help', post);
    await this._reload();
    return post;
  }

  async publish(postId: string): Promise<MutualHelpPost> {
    const updated = await this._transition(postId, { status: 'active' });
    // H-05: emit telemetry for KPI aggregation
    this.telemetry.log({
      workspaceId: updated.workspaceId,
      type: 'mutual-help-published',
      payload: { profileId: this.auth.currentProfile?.id, postId },
    });
    return updated;
  }

  async edit(
    postId: string,
    patch: Partial<MutualHelpPost>,
    baseVersion: number,
  ): Promise<MutualHelpPost> {
    const idb = await this.db.open();
    const post = await idb.get('mutual_help', postId);
    if (!post) throw new AppException({ code: 'NotFound', detail: `Post ${postId} not found` });
    if (post.version !== baseVersion) {
      throw new AppException({
        code: 'VersionConflict',
        objectId: postId,
        local: post.version,
        incoming: baseVersion,
      });
    }
    return this._transition(postId, patch);
  }

  async withdraw(postId: string): Promise<void> {
    await this._transition(postId, { status: 'withdrawn' });
  }

  async pin(postId: string, pinned: boolean): Promise<void> {
    await this._transition(postId, { pinned });
  }

  async sweepExpired(): Promise<number> {
    const idb = await this.db.open();
    const all = await idb.getAllFromIndex('mutual_help', 'by_workspace', this._workspaceId);
    const now = Date.now();
    let count = 0;

    for (const post of all) {
      if (
        post.status === 'active' &&
        !post.pinned &&
        post.expiresAt <= now
      ) {
        const updated: MutualHelpPost = {
          ...post as MutualHelpPost,
          status: 'expired',
          updatedAt: now,
          version: post.version + 1,
        };
        await idb.put('mutual_help', updated);
        count++;
      }
    }

    if (count > 0) await this._reload();
    return count;
  }

  private async _transition(
    postId: string,
    patch: Partial<MutualHelpPost>,
  ): Promise<MutualHelpPost> {
    const idb = await this.db.open();
    const post = await idb.get('mutual_help', postId);
    if (!post) throw new AppException({ code: 'NotFound', detail: `Post ${postId} not found` });

    const updated: MutualHelpPost = {
      ...post as MutualHelpPost,
      ...patch,
      updatedAt: Date.now(),
      version: post.version + 1,
    };
    await idb.put('mutual_help', updated);
    await this._reload();
    return updated;
  }

  private async _reload(): Promise<void> {
    const idb = await this.db.open();
    const all = await idb.getAllFromIndex('mutual_help', 'by_workspace', this._workspaceId);
    this._posts$.next(all as MutualHelpPost[]);
  }

  private _startSweepTimer(): void {
    this._stopSweepTimer();
    this._sweepTimer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        this.sweepExpired();
      }
    }, SWEEP_INTERVAL_MS);
  }

  private _stopSweepTimer(): void {
    if (this._sweepTimer !== null) {
      clearInterval(this._sweepTimer);
      this._sweepTimer = null;
    }
  }
}
