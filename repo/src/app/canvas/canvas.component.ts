import {
  Component,
  OnInit,
  OnDestroy,
  ViewChild,
  ElementRef,
  signal,
  computed,
  Input,
  HostListener,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { CanvasService } from './canvas.service';
import { TabIdentityService } from '../core/tab-identity.service';
import { AppException } from '../core/error';
import type { CanvasObject, CanvasObjectType } from '../core/types';

type Tool = CanvasObjectType | 'select';

interface ConflictState {
  objectId: string;
  local: number;
  incoming: number;
  localObj: CanvasObject;
}

@Component({
  selector: 'app-canvas',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <!-- Tool toolbar -->
    <div class="canvas-toolbar" role="toolbar" aria-label="Canvas tools">
      @for (tool of toolList; track tool.id) {
        <button
          class="tool-btn"
          [class.active]="activeTool() === tool.id"
          [attr.aria-pressed]="activeTool() === tool.id"
          [title]="tool.label"
          (click)="setTool(tool.id)"
        >
          {{ tool.icon }}
        </button>
      }
    </div>

    <!-- Canvas viewport -->
    <div
      class="canvas-viewport"
      (mousedown)="onMouseDown($event)"
      (mousemove)="onMouseMove($event)"
      (mouseup)="onMouseUp($event)"
      [style.cursor]="cursorStyle()"
    >
      <!-- HTML Canvas for shapes & freehand -->
      <canvas
        #shapeCanvas
        class="shape-canvas"
        [width]="viewportWidth"
        [height]="viewportHeight"
      ></canvas>

      <!-- DOM layer for sticky notes (positioned absolutely) -->
      @for (obj of stickyNotes(); track obj.id) {
        <div
          class="sticky-note"
          [style.left.px]="obj.x"
          [style.top.px]="obj.y"
          [style.background]="obj.color ?? '#fff9c4'"
          [class.selected]="selectedId() === obj.id"
          (mousedown)="selectObject(obj, $event)"
          (dblclick)="startEditing(obj)"
        >
          @if (editingId() === obj.id) {
            <textarea
              class="note-textarea"
              [value]="editingText()"
              (input)="onNoteInput($event)"
              (blur)="commitEdit()"
              (keydown.escape)="cancelEdit()"
              maxlength="80"
              autofocus
              aria-label="Sticky note text"
            ></textarea>
            <div class="char-count" [class.at-limit]="editingText().length >= 80">
              {{ editingText().length }}/80
            </div>
          } @else {
            <p class="note-text">{{ obj.text }}</p>
          }
        </div>
      }

      <!-- Conflict Drawer -->
      @if (conflict()) {
        <div class="conflict-drawer" role="dialog" aria-modal="true" aria-label="Edit conflict">
          <div class="conflict-card">
            <h4>Edit conflict detected</h4>
            <p>Another collaborator edited this object while you were editing it.</p>
            <div class="conflict-actions">
              <button class="btn-primary" (click)="resolveConflict('keep')">Keep mine</button>
              <button (click)="resolveConflict('accept')">Accept incoming</button>
              <button (click)="resolveConflict('manual')">Merge manually</button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styleUrl: './canvas.component.scss',
})
export class CanvasComponent implements OnInit, OnDestroy {
  @Input() workspaceId = '';
  @ViewChild('shapeCanvas') shapeCanvasRef!: ElementRef<HTMLCanvasElement>;

  protected readonly toolList: Array<{ id: Tool; label: string; icon: string }> = [
    { id: 'select', label: 'Select (S)', icon: '↖' },
    { id: 'rectangle', label: 'Rectangle (R)', icon: '▭' },
    { id: 'circle', label: 'Circle (C)', icon: '○' },
    { id: 'arrow', label: 'Arrow (A)', icon: '→' },
    { id: 'connector', label: 'Connector (L)', icon: '↗' },
    { id: 'freehand', label: 'Freehand pen (P)', icon: '✏' },
    { id: 'sticky-note', label: 'Sticky Note (N)', icon: '📝' },
  ];

  protected activeTool = signal<Tool>('select');
  protected selectedId = signal<string | null>(null);
  protected editingId = signal<string | null>(null);
  protected editingText = signal('');
  protected conflict = signal<ConflictState | null>(null);

  protected stickyNotes = computed(() =>
    this._allObjects().filter(o => o.type === 'sticky-note'),
  );

  protected cursorStyle = computed(() => {
    switch (this.activeTool()) {
      case 'select': return 'default';
      case 'freehand': return 'crosshair';
      default: return 'crosshair';
    }
  });

  readonly viewportWidth = 4000;
  readonly viewportHeight = 3000;

  private _allObjects = signal<CanvasObject[]>([]);
  private _drawing = false;
  private _subs = new Subscription();
  private _ctx: CanvasRenderingContext2D | null = null;
  private _editingOrigVersion = 0;

  constructor(
    private readonly canvas: CanvasService,
    private readonly tab: TabIdentityService,
  ) {}

  async ngOnInit(): Promise<void> {
    await this.canvas.loadForWorkspace(this.workspaceId);
    this._subs.add(
      this.canvas.objects$.subscribe(objs => {
        this._allObjects.set(objs);
        this._redraw();
      }),
    );
  }

  ngOnDestroy(): void {
    this._subs.unsubscribe();
  }

  // ── Keyboard shortcuts ──────────────────────────────────────────────────

  @HostListener('document:keydown', ['$event'])
  onKeyDown(e: KeyboardEvent): void {
    if (this.editingId()) return;
    switch (e.key.toLowerCase()) {
      case 's': this.setTool('select'); break;
      case 'r': this.setTool('rectangle'); break;
      case 'c': this.setTool('circle'); break;
      case 'a': this.setTool('arrow'); break;
      case 'l': this.setTool('connector'); break;
      case 'p': this.setTool('freehand'); break;
      case 'n': this.setTool('sticky-note'); break;
    }
  }

  protected setTool(tool: Tool): void {
    this.activeTool.set(tool);
  }

  // ── Mouse events ────────────────────────────────────────────────────────

  protected async onMouseDown(e: MouseEvent): Promise<void> {
    if (this.editingId()) return;
    const tool = this.activeTool();
    if (tool === 'select') return;

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (tool === 'sticky-note') {
      await this.canvas.addObject({
        workspaceId: this.workspaceId,
        type: 'sticky-note',
        x,
        y,
        width: 160,
        height: 120,
        text: '',
        color: '#fff9c4',
        strokeColor: '#f9a825',
        zIndex: this._allObjects().length,
        createdAt: Date.now(),
      });
    } else if (tool === 'freehand') {
      this._drawing = true;
      const ctx = this._getCtx();
      if (ctx) {
        ctx.beginPath();
        ctx.moveTo(x, y);
      }
    } else {
      // Placeholder — shape drag-to-draw will complete in Phase 4 canvas renderer
    }
  }

  protected onMouseMove(e: MouseEvent): void {
    if (!this._drawing) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const ctx = this._getCtx();
    if (ctx) {
      ctx.lineTo(x, y);
      ctx.stroke();
    }
  }

  protected onMouseUp(_e: MouseEvent): void {
    this._drawing = false;
  }

  protected selectObject(obj: CanvasObject, e: MouseEvent): void {
    e.stopPropagation();
    this.selectedId.set(obj.id);
  }

  protected startEditing(obj: CanvasObject): void {
    if (obj.type !== 'sticky-note') return;
    this.editingId.set(obj.id);
    this.editingText.set(obj.text ?? '');
    this._editingOrigVersion = obj.version;
  }

  protected onNoteInput(e: Event): void {
    const val = (e.target as HTMLTextAreaElement).value;
    this.editingText.set(val.slice(0, 80));
    (e.target as HTMLTextAreaElement).value = this.editingText();
  }

  protected async commitEdit(): Promise<void> {
    const id = this.editingId();
    if (!id) return;
    try {
      await this.canvas.setNoteText(id, this.editingText(), this._editingOrigVersion);
    } catch (err) {
      if (err instanceof AppException && err.error.code === 'VersionConflict') {
        const obj = this._allObjects().find(o => o.id === id);
        if (obj) {
          this.conflict.set({
            objectId: id,
            local: err.error.local,
            incoming: err.error.incoming,
            localObj: obj,
          });
        }
      }
    }
    this.editingId.set(null);
  }

  protected cancelEdit(): void {
    this.editingId.set(null);
  }

  protected async resolveConflict(action: 'keep' | 'accept' | 'manual'): Promise<void> {
    const state = this.conflict();
    if (!state) return;

    const idb = await this.canvas['db'].open();
    const current = await idb.get('canvas_objects', state.objectId);
    if (!current) {
      this.conflict.set(null);
      return;
    }

    if (action === 'keep') {
      // Force-write local version with latest version as base
      await this.canvas.patchObject(state.objectId, { text: state.localObj.text }, current.version);
    } else if (action === 'accept') {
      // Accept incoming — local version is already in DB; nothing to do
    } else {
      // Manual merge: open both versions for editing (simplified: keep incoming in place)
    }
    this.conflict.set(null);
  }

  // ── Rendering ────────────────────────────────────────────────────────────

  private _getCtx(): CanvasRenderingContext2D | null {
    if (!this._ctx && this.shapeCanvasRef) {
      this._ctx = this.shapeCanvasRef.nativeElement.getContext('2d');
      if (this._ctx) {
        this._ctx.strokeStyle = '#333';
        this._ctx.lineWidth = 2;
        this._ctx.lineCap = 'round';
        this._ctx.lineJoin = 'round';
      }
    }
    return this._ctx;
  }

  private _redraw(): void {
    const ctx = this._getCtx();
    if (!ctx) return;
    ctx.clearRect(0, 0, this.viewportWidth, this.viewportHeight);

    // Draw non-sticky shapes
    for (const obj of this._allObjects()) {
      if (obj.type === 'sticky-note') continue;
      this._drawShape(ctx, obj);
    }
  }

  private _drawShape(ctx: CanvasRenderingContext2D, obj: CanvasObject): void {
    ctx.save();
    ctx.strokeStyle = obj.strokeColor ?? '#333';
    ctx.fillStyle = obj.color ?? 'transparent';

    switch (obj.type) {
      case 'rectangle':
        ctx.strokeRect(obj.x, obj.y, obj.width, obj.height);
        if (obj.color) ctx.fillRect(obj.x, obj.y, obj.width, obj.height);
        break;
      case 'circle': {
        const rx = obj.width / 2;
        const ry = obj.height / 2;
        ctx.beginPath();
        ctx.ellipse(obj.x + rx, obj.y + ry, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
        if (obj.color) ctx.fill();
        break;
      }
      case 'arrow':
      case 'connector': {
        ctx.beginPath();
        ctx.moveTo(obj.x, obj.y);
        ctx.lineTo(obj.x + obj.width, obj.y + obj.height);
        ctx.stroke();
        break;
      }
    }
    ctx.restore();
  }
}
