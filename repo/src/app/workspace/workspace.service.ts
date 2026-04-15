import { Injectable, OnDestroy, Optional } from '@angular/core';
import { BehaviorSubject, Observable, Subscription } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';
import { DbService } from '../core/db.service';
import { PrefsService } from '../core/prefs.service';
import { BroadcastService } from '../core/broadcast.service';
import { AuthService } from '../auth/auth.service';
import { ChatService } from '../chat/chat.service';
import { AppException } from '../core/error';
import type { Workspace, WorkspaceSummary } from '../core/types';

@Injectable({ providedIn: 'root' })
export class WorkspaceService implements OnDestroy {
  private readonly _active$ = new BehaviorSubject<Workspace | null>(null);
  private _subs = new Subscription();

  constructor(
    private readonly db: DbService,
    private readonly prefs: PrefsService,
    private readonly broadcast: BroadcastService,
    private readonly auth: AuthService,
    // ChatService is optional so unit tests that omit it keep working.
    @Optional() private readonly chat: ChatService | null = null,
  ) {}

  get active$(): Observable<Workspace | null> {
    return this._active$.asObservable();
  }

  get active(): Workspace | null {
    return this._active$.value;
  }

  async list(): Promise<WorkspaceSummary[]> {
    const idb = await this.db.open();
    const all = await idb.getAll('workspaces');
    return all.map(w => ({ id: w.id, name: w.name, ownerProfileId: w.ownerProfileId, updatedAt: w.updatedAt }));
  }

  async create(name: string): Promise<Workspace> {
    const profile = this.auth.currentProfile;
    if (!profile) throw new AppException({ code: 'NotFound', detail: 'No signed-in profile' });

    const idb = await this.db.open();
    const now = Date.now();
    const workspace: Workspace = {
      id: uuidv4(),
      name,
      ownerProfileId: profile.id,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    await idb.put('workspaces', workspace);
    await this.chat?.postSystem(`Workspace "${workspace.name}" was created.`);
    return workspace;
  }

  async open(id: string): Promise<void> {
    const idb = await this.db.open();
    const workspace = await idb.get('workspaces', id);
    if (!workspace) throw new AppException({ code: 'NotFound', detail: `Workspace ${id} not found` });

    this._active$.next(workspace);
    this.prefs.set('lastOpenedWorkspaceId', id);
    this.broadcast.openForWorkspace(id);
  }

  async rename(id: string, name: string): Promise<void> {
    const idb = await this.db.open();
    const workspace = await idb.get('workspaces', id);
    if (!workspace) throw new AppException({ code: 'NotFound', detail: `Workspace ${id} not found` });

    const updated: Workspace = { ...workspace, name, updatedAt: Date.now(), version: workspace.version + 1 };
    await idb.put('workspaces', updated);
    if (this._active$.value?.id === id) this._active$.next(updated);
  }

  async delete(id: string): Promise<void> {
    const idb = await this.db.open();
    await idb.delete('workspaces', id);
    if (this._active$.value?.id === id) {
      this._active$.next(null);
      this.broadcast.close();
    }
  }

  ngOnDestroy(): void {
    this._subs.unsubscribe();
  }
}
