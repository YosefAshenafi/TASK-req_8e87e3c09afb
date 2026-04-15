import { Component, OnInit, signal, inject } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WorkspaceService } from './workspace.service';
import { AuthService } from '../auth/auth.service';
import { PersonaService } from '../auth/persona.service';
import { PrefsService } from '../core/prefs.service';
import type { WorkspaceSummary } from '../core/types';

@Component({
  selector: 'app-workspaces-list',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="workspaces-page">
      <header class="page-header">
        <h1>Workspaces</h1>
        <span class="user-chip">{{ auth.currentProfile?.username }}</span>
      </header>

      <div class="create-row">
        <input
          [(ngModel)]="newName"
          placeholder="New workspace name"
          (keydown.enter)="createWorkspace()"
          aria-label="New workspace name"
        />
        <button class="btn-primary" (click)="createWorkspace()" [disabled]="!newName.trim()">
          Create
        </button>
      </div>

      <ul class="workspace-list" role="list">
        @for (ws of workspaces(); track ws.id) {
          <li class="workspace-card">
            <button class="ws-name" (click)="openWorkspace(ws.id)">
              {{ ws.name }}
              <span class="ws-date">{{ ws.updatedAt | date:'mediumDate' }}</span>
            </button>
            <div class="ws-actions">
              <button class="icon-btn" aria-label="Rename" (click)="startRename(ws)">✏</button>
              @if (canDelete()) {
                <button class="icon-btn danger" aria-label="Delete" (click)="deleteWorkspace(ws.id)">🗑</button>
              }
            </div>
          </li>
        }
        @empty {
          <li class="empty-state">No workspaces yet. Create one above.</li>
        }
      </ul>

      @if (renaming()) {
        <div class="rename-modal" role="dialog" aria-modal="true" aria-label="Rename workspace">
          <div class="rename-card">
            <h3>Rename workspace</h3>
            <input [(ngModel)]="renameValue" (keydown.enter)="confirmRename()" autofocus />
            <div class="rename-actions">
              <button class="btn-primary" (click)="confirmRename()">Save</button>
              <button (click)="renaming.set(null)">Cancel</button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styleUrl: './workspaces-list.component.scss',
})
export class WorkspacesListComponent implements OnInit {
  protected workspaces = signal<WorkspaceSummary[]>([]);
  protected newName = '';
  protected renaming = signal<WorkspaceSummary | null>(null);
  protected renameValue = '';

  private readonly persona = inject(PersonaService);
  private readonly prefs = inject(PrefsService);

  // H-01: persona-gated delete control
  protected canDelete = (): boolean => this.persona.hasCap('delete-workspace');

  constructor(
    protected readonly auth: AuthService,
    private readonly ws: WorkspaceService,
    private readonly router: Router,
  ) {}

  async ngOnInit(): Promise<void> {
    const list = await this.ws.list();
    this.workspaces.set(list);

    // Medium: restore the last-opened workspace when the list first loads.
    const lastId = this.prefs.get('lastOpenedWorkspaceId');
    if (lastId && list.some(w => w.id === lastId)) {
      this.router.navigate(['/w', lastId]);
    }
  }

  async createWorkspace(): Promise<void> {
    const name = this.newName.trim();
    if (!name) return;
    await this.ws.create(name);
    this.newName = '';
    this.workspaces.set(await this.ws.list());
  }

  async openWorkspace(id: string): Promise<void> {
    await this.ws.open(id);
    this.router.navigate(['/w', id]);
  }

  protected startRename(ws: WorkspaceSummary): void {
    this.renameValue = ws.name;
    this.renaming.set(ws);
  }

  async confirmRename(): Promise<void> {
    const ws = this.renaming();
    if (!ws) return;
    await this.ws.rename(ws.id, this.renameValue.trim() || ws.name);
    this.renaming.set(null);
    this.workspaces.set(await this.ws.list());
  }

  async deleteWorkspace(id: string): Promise<void> {
    // H-01: defensive capability check — template already hides the button, but the method
    // may be invoked programmatically (e.g. tests) and must remain gated.
    if (!this.canDelete()) return;
    if (!confirm('Delete this workspace? All data will be removed.')) return;
    await this.ws.delete(id);
    this.workspaces.set(await this.ws.list());
  }
}
