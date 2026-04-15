import {
  Component,
  OnInit,
  OnDestroy,
  ViewChild,
  ElementRef,
  signal,
  computed,
  Input,
  Output,
  EventEmitter,
  HostListener,
  AfterViewInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Subscription } from 'rxjs';
import { CanvasService } from './canvas.service';
import { TabIdentityService } from '../core/tab-identity.service';
import { PresenceService } from '../presence/presence.service';
import { AppException } from '../core/error';
import type { CanvasObject, CanvasObjectType, CursorPosition } from '../core/types';

type Tool = CanvasObjectType | 'select' | 'erase';

interface ShapeDrag {
  startX: number; startY: number;
  currentX: number; currentY: number;
}

interface NoteDrag {
  id: string;
  origX: number; origY: number;
  mouseStartX: number; mouseStartY: number;
}

interface PanDrag {
  mouseStartX: number; mouseStartY: number;
  scrollStartX: number; scrollStartY: number;
}

interface PinchState {
  dist: number; zoom: number;
  cx: number; cy: number;
  scrollX: number; scrollY: number;
}

interface ConflictState {
  objectId: string; local: number; incoming: number; localObj: CanvasObject;
}

// ── Professional SVG icons (Lucide-style, 24×24, stroke-width 1.5) ───────────

const RAW: Record<Tool, string> = {
  // Mouse pointer (select)
  select: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
    stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
    <path d="M4 2 L4 17 L8 13 L11.5 20.5 L13.8 19.5 L10.3 12 L16.5 12 Z"/>
  </svg>`,

  // Eraser
  erase: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
    stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
    <path d="M20 20H7L3 16c-.8-.8-.8-2 0-2.8L13.2 3c.8-.8 2-.8 2.8 0l5 5c.8.8.8 2 0 2.8L13 18"/>
    <path d="M6.6 16.4 13 10"/>
  </svg>`,

  // Rectangle
  rectangle: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
    stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
    <rect x="3" y="6.5" width="18" height="11" rx="2"/>
  </svg>`,

  // Circle
  circle: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
    stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="8.5"/>
  </svg>`,

  // Arrow (diagonal, top-right head)
  arrow: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
    stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
    <line x1="5" y1="19" x2="19" y2="5"/>
    <polyline points="11,5 19,5 19,13"/>
  </svg>`,

  // Connector (dashed line with endpoints)
  connector: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
    stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
    <line x1="5" y1="19" x2="19" y2="5" stroke-dasharray="3 2"/>
    <circle cx="5" cy="19" r="1.8" fill="currentColor" stroke="none"/>
    <circle cx="19" cy="5" r="1.8" fill="currentColor" stroke="none"/>
  </svg>`,

  // Freehand — pencil
  freehand: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
    stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
    <path d="m15 5 4 4"/>
  </svg>`,

  // Sticky note
  'sticky-note': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
    stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
    <path d="M15.5 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3Z"/>
    <path d="M15 3v6h6"/>
    <line x1="7" y1="11" x2="17" y2="11"/>
    <line x1="7" y1="15" x2="13" y2="15"/>
  </svg>`,
};

// Zoom steps for button clicks
const ZOOM_BTN_STEPS = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0, 4.0];
const ZOOM_MIN = 0.1;
const ZOOM_MAX = 4.0;

// ── Component ─────────────────────────────────────────────────────────────────

@Component({
  selector: 'app-canvas',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <!-- ── Toolbar ── -->
    <div class="canvas-toolbar" role="toolbar" aria-label="Canvas tools">

      @for (tool of toolList; track tool.id) {
        <button
          class="tool-btn"
          [class.active]="activeTool() === tool.id"
          [attr.aria-pressed]="activeTool() === tool.id"
          [title]="tool.label"
          (click)="setTool(tool.id)"
          [innerHTML]="tool.icon"
        ></button>
      }

      <div class="toolbar-sep"></div>

      <!-- Zoom controls -->
      <button class="tool-btn icon-btn" title="Zoom out (−)" (click)="zoomOut()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
             stroke-linecap="round" xmlns="http://www.w3.org/2000/svg">
          <circle cx="11" cy="11" r="7"/>
          <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          <line x1="8" y1="11" x2="14" y2="11"/>
        </svg>
      </button>

      <button class="zoom-pct-btn" title="Reset zoom (0)" (click)="zoomReset()">{{ zoomPct() }}%</button>

      <button class="tool-btn icon-btn" title="Zoom in (+)" (click)="zoomIn()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
             stroke-linecap="round" xmlns="http://www.w3.org/2000/svg">
          <circle cx="11" cy="11" r="7"/>
          <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          <line x1="11" y1="8" x2="11" y2="14"/>
          <line x1="8" y1="11" x2="14" y2="11"/>
        </svg>
      </button>

      <div class="toolbar-sep"></div>

      <!-- Comment button — shown when a shape is selected in select mode -->
      @if (activeTool() === 'select' && selectedId()) {
        <button class="tool-btn comment-btn" title="Open comments for this shape" (click)="openComments.emit(selectedId()!)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        </button>
        <div class="toolbar-sep"></div>
      }

      <span class="tool-hint">
        @if (activeTool() === 'sticky-note') { Click canvas to place }
        @else if (activeTool() === 'select' && selectedId())  { Click 💬 to comment }
        @else if (activeTool() === 'select')  { Click shape to select }
        @else if (activeTool() === 'erase')   { Click shape to delete }
        @else if (activeTool() === 'freehand'){ Drag to draw freely }
        @else { Drag to draw · Space+drag or ⌘ scroll to pan }
      </span>
    </div>

    <!-- ── Viewport (scrollable) ── -->
    <div
      class="canvas-viewport"
      #viewport
      (mousedown)="onViewportMouseDown($event)"
      (mousemove)="onViewportMouseMove($event)"
      (mouseup)="onViewportMouseUp($event)"
      (mouseleave)="onViewportMouseLeave()"
      [style.cursor]="cursorStyle()"
    >
      <!--
        Two-layer trick for correct scrollbars at any zoom:
        • outer .canvas-scroll-area = CANVAS_W*zoom × CANVAS_H*zoom  → sets scrollable footprint
        • inner .canvas-content     = CANVAS_W × CANVAS_H, CSS-scaled → provides the visual
      -->
      <div
        class="canvas-scroll-area"
        [style.width.px]="CANVAS_W * zoom()"
        [style.height.px]="CANVAS_H * zoom()"
      >
        <div
          class="canvas-content"
          [style.width.px]="CANVAS_W"
          [style.height.px]="CANVAS_H"
          [style.transform]="'scale(' + zoom() + ')'"
        >
          <!-- Shape layer (persistent) -->
          <canvas #shapeCanvas [width]="CANVAS_W" [height]="CANVAS_H" class="layer"></canvas>

          <!-- Preview layer (drag feedback) -->
          <canvas #previewCanvas [width]="CANVAS_W" [height]="CANVAS_H" class="layer preview-layer"></canvas>

          <!-- ── Remote cursor overlay (H-06) ────────────────────────────── -->
          @for (c of remoteCursors(); track c.tabId) {
            <div
              class="remote-cursor"
              [style.left.px]="c.x"
              [style.top.px]="c.y"
              [style.color]="c.color"
              [attr.data-tab]="c.tabId"
              aria-hidden="true"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"
                   xmlns="http://www.w3.org/2000/svg">
                <path d="M3 2 L3 20 L8 15 L11 22 L13 21 L10 14 L17 14 Z"/>
              </svg>
              <span class="remote-cursor-label" [style.background]="c.color">
                {{ c.tabId.slice(0, 4) }}
              </span>
            </div>
          }

          <!-- DOM sticky-note layer -->
          @for (obj of stickyNotes(); track obj.id) {
            <div
              class="sticky-note"
              [style.left.px]="liveNoteX(obj)"
              [style.top.px]="liveNoteY(obj)"
              [style.background]="obj.color ?? '#fff9c4'"
              [class.selected]="selectedId() === obj.id"
              (mousedown)="onNoteDragStart(obj, $event)"
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
                <p class="note-text">{{ obj.text || '(empty — double-click to edit)' }}</p>
              }
            </div>
          }
        </div>
      </div>

      <!-- Conflict drawer (outside scaled wrapper — covers the full viewport) -->
      @if (conflict()) {
        <div class="conflict-drawer" role="dialog" aria-modal="true" aria-label="Edit conflict">
          <div class="conflict-card">
            <h4>Edit conflict</h4>
            <p>Another collaborator edited this object at the same time.</p>
            <div class="conflict-actions">
              <button class="btn-primary" (click)="resolveConflict('keep')">Keep mine</button>
              <button (click)="resolveConflict('accept')">Accept theirs</button>
              <button (click)="resolveConflict('dismiss')">Dismiss</button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styleUrl: './canvas.component.scss',
})
export class CanvasComponent implements OnInit, AfterViewInit, OnDestroy {
  @Input() workspaceId = '';
  @Output() openComments = new EventEmitter<string>();
  @ViewChild('shapeCanvas')   shapeCanvasRef!:   ElementRef<HTMLCanvasElement>;
  @ViewChild('previewCanvas') previewCanvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('viewport')      viewportRef!:      ElementRef<HTMLDivElement>;

  readonly CANVAS_W = 4000;
  readonly CANVAS_H = 3000;

  protected readonly toolList: Array<{ id: Tool; label: string; icon: SafeHtml }>;

  // ── Signals ────────────────────────────────────────────────────────────────
  protected activeTool  = signal<Tool>('select');
  protected selectedId  = signal<string | null>(null);
  protected editingId   = signal<string | null>(null);
  protected editingText = signal('');
  protected conflict    = signal<ConflictState | null>(null);
  protected zoom        = signal(1.0);
  protected zoomPct     = computed(() => Math.round(this.zoom() * 100));

  private _spaceHeld = signal(false);
  private _isPanning = signal(false);

  protected cursorStyle = computed((): string => {
    if (this._isPanning()) return 'grabbing';
    if (this._spaceHeld()) return 'grab';
    switch (this.activeTool()) {
      case 'select': return 'default';
      case 'erase':  return 'cell';
      default:       return 'crosshair';
    }
  });

  protected stickyNotes = computed(() =>
    this._allObjects().filter(o => o.type === 'sticky-note'),
  );

  /** H-06: observed remote cursors from `PresenceService.cursors$`. */
  protected remoteCursors = signal<CursorPosition[]>([]);
  private _lastCursorSent = 0;

  // ── Private state ──────────────────────────────────────────────────────────
  private _allObjects = signal<CanvasObject[]>([]);
  private _shapeDrag: ShapeDrag | null = null;
  private _noteDrag:  NoteDrag  | null = null;
  private _panDrag:   PanDrag   | null = null;
  private _pinch:     PinchState | null = null;
  private _notePosOverride = new Map<string, { x: number; y: number }>();
  private _freehandPoints: Array<[number, number]> = [];
  private _subs = new Subscription();
  private _ctx:  CanvasRenderingContext2D | null = null;
  private _pCtx: CanvasRenderingContext2D | null = null;
  private _editingOrigVersion = 0;

  // Non-passive event handlers (stored for cleanup)
  private _wheelHandler!:      EventListener;
  private _touchStartHandler!: EventListener;
  private _touchMoveHandler!:  EventListener;
  private _touchEndHandler!:   EventListener;

  constructor(
    private readonly canvasService: CanvasService,
    private readonly tab: TabIdentityService,
    private readonly sanitizer: DomSanitizer,
    private readonly presence: PresenceService,
  ) {
    const defs: Array<{ id: Tool; label: string }> = [
      { id: 'select',      label: 'Select (S)'      },
      { id: 'rectangle',   label: 'Rectangle (R)'   },
      { id: 'circle',      label: 'Circle (C)'      },
      { id: 'arrow',       label: 'Arrow (A)'       },
      { id: 'connector',   label: 'Connector (L)'   },
      { id: 'freehand',    label: 'Freehand (P)'    },
      { id: 'sticky-note', label: 'Sticky Note (N)' },
      { id: 'erase',       label: 'Erase (E)'       },
    ];
    this.toolList = defs.map(d => ({
      ...d,
      icon: sanitizer.bypassSecurityTrustHtml(RAW[d.id]),
    }));
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async ngOnInit(): Promise<void> {
    await this.canvasService.loadForWorkspace(this.workspaceId);
    this._subs.add(
      this.canvasService.objects$.subscribe(objs => {
        this._allObjects.set(objs);
        this._redrawShapes();
      }),
    );

    // H-06: mirror remote cursors into a signal for template rendering
    this._subs.add(
      this.presence.cursors$.subscribe(cs => this.remoteCursors.set(cs)),
    );
  }

  ngAfterViewInit(): void {
    this._ensureCtx();
    const vp = this.viewportRef.nativeElement;

    // Wheel — ctrl+wheel for zoom (must be non-passive to preventDefault)
    this._wheelHandler = (e: Event) => this._onWheel(e as WheelEvent);
    vp.addEventListener('wheel', this._wheelHandler, { passive: false });

    // Touch — pinch-to-zoom + two-finger pan
    this._touchStartHandler = (e: Event) => this._onTouchStart(e as TouchEvent);
    this._touchMoveHandler  = (e: Event) => this._onTouchMove(e as TouchEvent);
    this._touchEndHandler   = (e: Event) => this._onTouchEnd(e as TouchEvent);
    vp.addEventListener('touchstart', this._touchStartHandler, { passive: false });
    vp.addEventListener('touchmove',  this._touchMoveHandler,  { passive: false });
    vp.addEventListener('touchend',   this._touchEndHandler,   { passive: true  });
  }

  ngOnDestroy(): void {
    const vp = this.viewportRef?.nativeElement;
    if (vp) {
      vp.removeEventListener('wheel',      this._wheelHandler);
      vp.removeEventListener('touchstart', this._touchStartHandler);
      vp.removeEventListener('touchmove',  this._touchMoveHandler);
      vp.removeEventListener('touchend',   this._touchEndHandler);
    }
    this._subs.unsubscribe();
  }

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────

  @HostListener('document:keydown', ['$event'])
  onKeyDown(e: KeyboardEvent): void {
    const active = document.activeElement;
    const inInput = active?.tagName === 'INPUT' || active?.tagName === 'TEXTAREA';

    if (e.code === 'Space' && !inInput && !this.editingId()) {
      e.preventDefault();
      this._spaceHeld.set(true);
      return;
    }
    if (inInput || this.editingId()) return;

    switch (e.key.toLowerCase()) {
      case 's': this.setTool('select');      break;
      case 'r': this.setTool('rectangle');   break;
      case 'c': this.setTool('circle');      break;
      case 'a': this.setTool('arrow');       break;
      case 'l': this.setTool('connector');   break;
      case 'p': this.setTool('freehand');    break;
      case 'n': this.setTool('sticky-note'); break;
      case 'e': this.setTool('erase');       break;
      case '+': case '=': this.zoomIn();     break;
      case '-':            this.zoomOut();   break;
      case '0': this.zoomReset();            break;
    }
  }

  @HostListener('document:keyup', ['$event'])
  onKeyUp(e: KeyboardEvent): void {
    if (e.code === 'Space') {
      this._spaceHeld.set(false);
      this._panDrag = null;
      this._isPanning.set(false);
    }
  }

  protected setTool(t: Tool): void {
    this.activeTool.set(t);
    this._shapeDrag = null;
    this._clearPreview();
  }

  // ── Zoom ───────────────────────────────────────────────────────────────────

  protected zoomIn(): void {
    const z = this.zoom();
    const next = ZOOM_BTN_STEPS.find(s => s > z + 0.01) ?? ZOOM_MAX;
    this._applyZoom(next);
  }

  protected zoomOut(): void {
    const z = this.zoom();
    const prev = [...ZOOM_BTN_STEPS].reverse().find(s => s < z - 0.01) ?? ZOOM_MIN;
    this._applyZoom(prev);
  }

  protected zoomReset(): void { this._applyZoom(1.0); }

  /**
   * Apply a new zoom level, optionally zooming toward a viewport-relative focal point
   * (focusX, focusY) so the canvas point under the cursor stays fixed.
   */
  private _applyZoom(newZoom: number, focusX = 0, focusY = 0): void {
    const vp  = this.viewportRef?.nativeElement;
    const old = this.zoom();
    const z   = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, newZoom));
    if (!vp || Math.abs(z - old) < 1e-4) return;

    // Compute scroll target before the DOM updates
    const newScrollLeft = (vp.scrollLeft + focusX) * (z / old) - focusX;
    const newScrollTop  = (vp.scrollTop  + focusY) * (z / old) - focusY;

    this.zoom.set(z);

    // Apply scroll after Angular re-renders the scroll-area at the new size
    requestAnimationFrame(() => {
      if (vp) {
        vp.scrollLeft = Math.max(0, newScrollLeft);
        vp.scrollTop  = Math.max(0, newScrollTop);
      }
    });
  }

  // ── Wheel (trackpad pinch-to-zoom + two-finger scroll) ────────────────────

  private _onWheel(e: WheelEvent): void {
    if (!e.ctrlKey) return; // plain scroll → let browser handle native pan
    e.preventDefault();

    const vp   = this.viewportRef.nativeElement;
    const rect = vp.getBoundingClientRect();
    const fx   = e.clientX - rect.left;
    const fy   = e.clientY - rect.top;

    // macOS trackpad sends small deltaY values; mouse wheel sends ±100/120
    const raw    = e.deltaY;
    const factor = Math.exp(-raw * (Math.abs(raw) < 20 ? 0.01 : 0.003));
    this._applyZoom(this.zoom() * factor, fx, fy);
  }

  // ── Touch (pinch-to-zoom + two-finger drag) ────────────────────────────────

  private _onTouchStart(e: TouchEvent): void {
    if (e.touches.length !== 2) return;
    e.preventDefault();
    const t0 = e.touches[0], t1 = e.touches[1];
    const vp  = this.viewportRef.nativeElement;
    const rect = vp.getBoundingClientRect();
    this._pinch = {
      dist:    Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY),
      zoom:    this.zoom(),
      cx:      (t0.clientX + t1.clientX) / 2 - rect.left,
      cy:      (t0.clientY + t1.clientY) / 2 - rect.top,
      scrollX: vp.scrollLeft,
      scrollY: vp.scrollTop,
    };
  }

  private _onTouchMove(e: TouchEvent): void {
    if (e.touches.length !== 2 || !this._pinch) return;
    e.preventDefault();

    const t0  = e.touches[0], t1 = e.touches[1];
    const vp  = this.viewportRef.nativeElement;
    const rect = vp.getBoundingClientRect();

    const newDist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
    const newCx   = (t0.clientX + t1.clientX) / 2 - rect.left;
    const newCy   = (t0.clientY + t1.clientY) / 2 - rect.top;

    const ratio   = newDist / this._pinch.dist;
    const newZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, this._pinch.zoom * ratio));
    const zRatio  = newZoom / this._pinch.zoom;

    // Zoom toward pinch center + follow finger pan
    const newScrollLeft = (this._pinch.scrollX + this._pinch.cx) * zRatio - newCx;
    const newScrollTop  = (this._pinch.scrollY + this._pinch.cy) * zRatio - newCy;

    this.zoom.set(newZoom);
    requestAnimationFrame(() => {
      vp.scrollLeft = Math.max(0, newScrollLeft);
      vp.scrollTop  = Math.max(0, newScrollTop);
    });
  }

  private _onTouchEnd(e: TouchEvent): void {
    if (e.touches.length < 2) this._pinch = null;
  }

  // ── Viewport mouse events ──────────────────────────────────────────────────

  protected async onViewportMouseDown(e: MouseEvent): Promise<void> {
    if (this.editingId()) return;

    // ── Middle mouse or Space+left → pan ──
    if (e.button === 1 || (e.button === 0 && this._spaceHeld())) {
      e.preventDefault();
      const vp = this.viewportRef.nativeElement;
      this._panDrag = {
        mouseStartX: e.clientX, mouseStartY: e.clientY,
        scrollStartX: vp.scrollLeft, scrollStartY: vp.scrollTop,
      };
      this._isPanning.set(true);
      return;
    }
    if (e.button !== 0) return;

    const tool = this.activeTool();
    if (tool === 'select') return;

    const { x, y } = this._canvasCoords(e);

    // ── Erase ──
    if (tool === 'erase') {
      const hit = this._hitTest(x, y);
      if (hit) await this.canvasService.deleteObject(hit.id, hit.version);
      return;
    }

    // ── Sticky note ──
    if (tool === 'sticky-note') {
      await this.canvasService.addObject({
        workspaceId: this.workspaceId,
        type: 'sticky-note', x, y,
        width: 160, height: 120,
        text: '', color: '#fff9c4', strokeColor: '#f9a825',
        zIndex: this._allObjects().length, createdAt: Date.now(),
      });
      return;
    }

    // ── Shape drag start ──
    this._shapeDrag = { startX: x, startY: y, currentX: x, currentY: y };

    if (tool === 'freehand') {
      this._freehandPoints = [[x, y]];
      const ctx = this._ensureCtx();
      if (ctx) {
        ctx.setLineDash([]); ctx.strokeStyle = '#333';
        ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y);
      }
    }
  }

  protected onViewportMouseMove(e: MouseEvent): void {
    // ── H-06: broadcast cursor position (canvas coords) to peer tabs ──
    // Local 40 ms cap ≈ 25 Hz; BroadcastService adds its own 50 ms throttle.
    const now = Date.now();
    if (now - this._lastCursorSent >= 40) {
      this._lastCursorSent = now;
      const { x: cx, y: cy } = this._canvasCoords(e);
      this.presence.broadcastCursor(cx, cy);
    }

    // ── Pan ──
    if (this._panDrag) {
      const vp = this.viewportRef.nativeElement;
      vp.scrollLeft = this._panDrag.scrollStartX - (e.clientX - this._panDrag.mouseStartX);
      vp.scrollTop  = this._panDrag.scrollStartY - (e.clientY - this._panDrag.mouseStartY);
      return;
    }

    // ── Note drag ──
    if (this._noteDrag) {
      const dx = (e.clientX - this._noteDrag.mouseStartX) / this.zoom();
      const dy = (e.clientY - this._noteDrag.mouseStartY) / this.zoom();
      this._notePosOverride.set(this._noteDrag.id, {
        x: Math.max(0, this._noteDrag.origX + dx),
        y: Math.max(0, this._noteDrag.origY + dy),
      });
      this._allObjects.set([...this._allObjects()]); // trigger re-render
      return;
    }

    if (!this._shapeDrag) return;
    const { x, y } = this._canvasCoords(e);
    this._shapeDrag.currentX = x; this._shapeDrag.currentY = y;

    if (this.activeTool() === 'freehand') {
      this._freehandPoints.push([x, y]);
      const ctx = this._ensureCtx();
      if (ctx) { ctx.lineTo(x, y); ctx.stroke(); }
    } else {
      this._drawPreview(this.activeTool(), this._shapeDrag);
    }
  }

  protected async onViewportMouseUp(e: MouseEvent): Promise<void> {
    // ── End pan ──
    if (this._panDrag) {
      this._panDrag = null;
      this._isPanning.set(false);
      return;
    }

    // ── Commit note drag ──
    if (this._noteDrag) {
      const pos = this._notePosOverride.get(this._noteDrag.id);
      if (pos) {
        const obj = this._allObjects().find(o => o.id === this._noteDrag!.id);
        if (obj) await this.canvasService.patchObject(obj.id, { x: pos.x, y: pos.y }, obj.version);
      }
      this._notePosOverride.delete(this._noteDrag.id);
      this._noteDrag = null;
      return;
    }

    if (!this._shapeDrag) return;
    const { x, y }   = this._canvasCoords(e);
    const drag        = { ...this._shapeDrag, currentX: x, currentY: y };
    this._shapeDrag   = null;
    this._clearPreview();

    const tool = this.activeTool();
    if (tool === 'select' || tool === 'sticky-note' || tool === 'erase') return;

    // ── Commit freehand ──
    if (tool === 'freehand') {
      if (this._freehandPoints.length > 1) {
        const xs = this._freehandPoints.map(p => p[0]);
        const ys = this._freehandPoints.map(p => p[1]);
        const bx = Math.min(...xs), by = Math.min(...ys);
        await this.canvasService.addObject({
          workspaceId: this.workspaceId,
          type: 'freehand', x: bx, y: by,
          width:  Math.max(...xs) - bx || 1,
          height: Math.max(...ys) - by || 1,
          text:   JSON.stringify(this._freehandPoints),
          color: '#333', strokeColor: '#333',
          zIndex: this._allObjects().length, createdAt: Date.now(),
        });
      }
      this._freehandPoints = [];
      return;
    }

    // ── Commit shape ──
    const rawW = drag.currentX - drag.startX;
    const rawH = drag.currentY - drag.startY;

    if (Math.abs(rawW) < 8 && Math.abs(rawH) < 8) {
      // Tiny click → default size centred on click
      await this._placeShape(tool, drag.startX - 60, drag.startY - 30, 120, 60);
    } else {
      await this._placeShape(
        tool,
        rawW >= 0 ? drag.startX : drag.currentX,
        rawH >= 0 ? drag.startY : drag.currentY,
        Math.abs(rawW), Math.abs(rawH),
      );
    }
  }

  protected onViewportMouseLeave(): void {
    if (this._noteDrag) {
      // Cancel note drag, revert position
      this._notePosOverride.delete(this._noteDrag.id);
      this._noteDrag = null;
      this._allObjects.set([...this._allObjects()]);
      return;
    }
    if (this._panDrag) {
      this._panDrag = null; this._isPanning.set(false);
      return;
    }
    if (this._shapeDrag && this.activeTool() !== 'freehand') {
      this._shapeDrag = null; this._clearPreview();
    }
  }

  // ── Sticky-note interaction ────────────────────────────────────────────────

  protected onNoteDragStart(obj: CanvasObject, e: MouseEvent): void {
    e.stopPropagation();
    if (this.editingId() === obj.id) return;
    if (this.activeTool() === 'erase') {
      this.canvasService.deleteObject(obj.id, obj.version);
      return;
    }
    this.selectedId.set(obj.id);
    this._noteDrag = {
      id: obj.id,
      origX: obj.x, origY: obj.y,
      mouseStartX: e.clientX, mouseStartY: e.clientY,
    };
  }

  protected startEditing(obj: CanvasObject): void {
    if (obj.type !== 'sticky-note') return;
    this._noteDrag = null;
    this.editingId.set(obj.id);
    this.editingText.set(obj.text ?? '');
    this._editingOrigVersion = obj.version;
  }

  protected onNoteInput(e: Event): void {
    const el  = e.target as HTMLTextAreaElement;
    const val = el.value.slice(0, 80);
    this.editingText.set(val); el.value = val;
  }

  protected async commitEdit(): Promise<void> {
    const id = this.editingId();
    if (!id) return;
    try {
      await this.canvasService.setNoteText(id, this.editingText(), this._editingOrigVersion);
    } catch (err) {
      if (err instanceof AppException && err.error.code === 'VersionConflict') {
        const obj = this._allObjects().find(o => o.id === id);
        if (obj) this.conflict.set({ objectId: id, local: err.error.local, incoming: err.error.incoming, localObj: obj });
      }
    }
    this.editingId.set(null);
  }

  protected cancelEdit(): void { this.editingId.set(null); }

  protected async resolveConflict(action: 'keep' | 'accept' | 'dismiss'): Promise<void> {
    const s = this.conflict();
    if (!s) return;
    if (action === 'keep') {
      try { await this.canvasService.patchObject(s.objectId, { text: s.localObj.text }, s.incoming); }
      catch { /* ignore secondary conflict */ }
    }
    this.conflict.set(null);
  }

  protected liveNoteX(obj: CanvasObject): number { return this._notePosOverride.get(obj.id)?.x ?? obj.x; }
  protected liveNoteY(obj: CanvasObject): number { return this._notePosOverride.get(obj.id)?.y ?? obj.y; }

  // ── Private helpers ────────────────────────────────────────────────────────

  /** Viewport-relative mouse → canvas coordinates (accounts for scroll + zoom). */
  private _canvasCoords(e: MouseEvent): { x: number; y: number } {
    const vp = this.viewportRef?.nativeElement;
    if (!vp) return { x: e.clientX, y: e.clientY };
    const r = vp.getBoundingClientRect();
    const z = this.zoom();
    return { x: (e.clientX - r.left + vp.scrollLeft) / z, y: (e.clientY - r.top + vp.scrollTop) / z };
  }

  /** Bounding-box hit test — returns topmost (highest zIndex) shape at (x, y). */
  private _hitTest(x: number, y: number): CanvasObject | null {
    return [...this._allObjects()]
      .sort((a, b) => b.zIndex - a.zIndex)
      .find(o => x >= o.x && x <= o.x + o.width && y >= o.y && y <= o.y + o.height)
      ?? null;
  }

  private async _placeShape(type: CanvasObjectType, x: number, y: number, w: number, h: number): Promise<void> {
    const palette: Record<string, { fill: string; stroke: string }> = {
      rectangle: { fill: 'rgba(30,136,229,0.10)', stroke: '#1e88e5' },
      circle:    { fill: 'rgba(67,160,71,0.10)',  stroke: '#43a047' },
      arrow:     { fill: 'transparent',            stroke: '#e53935' },
      connector: { fill: 'transparent',            stroke: '#8e24aa' },
    };
    const c = palette[type] ?? { fill: 'transparent', stroke: '#555' };
    await this.canvasService.addObject({
      workspaceId: this.workspaceId, type, x, y, width: w, height: h,
      color: c.fill, strokeColor: c.stroke,
      zIndex: this._allObjects().length, createdAt: Date.now(),
    });
  }

  // ── Canvas rendering ───────────────────────────────────────────────────────

  private _ensureCtx(): CanvasRenderingContext2D | null {
    if (!this._ctx && this.shapeCanvasRef) {
      this._ctx = this.shapeCanvasRef.nativeElement.getContext('2d');
      if (this._ctx) { this._ctx.lineWidth = 2; this._ctx.lineCap = 'round'; this._ctx.lineJoin = 'round'; }
    }
    if (!this._pCtx && this.previewCanvasRef) {
      this._pCtx = this.previewCanvasRef.nativeElement.getContext('2d');
      if (this._pCtx) { this._pCtx.lineWidth = 2; this._pCtx.lineCap = 'round'; this._pCtx.setLineDash([6, 3]); }
    }
    return this._ctx;
  }

  private _clearPreview(): void {
    this._pCtx?.clearRect(0, 0, this.CANVAS_W, this.CANVAS_H);
  }

  private _drawPreview(tool: Tool, d: ShapeDrag): void {
    const ctx = this._pCtx; if (!ctx) return;
    ctx.clearRect(0, 0, this.CANVAS_W, this.CANVAS_H);

    const x = Math.min(d.startX, d.currentX), w = Math.abs(d.currentX - d.startX);
    const y = Math.min(d.startY, d.currentY), h = Math.abs(d.currentY - d.startY);
    const colors: Record<string, string> = { rectangle: '#1e88e5', circle: '#43a047', arrow: '#e53935', connector: '#8e24aa' };
    ctx.strokeStyle = colors[tool as string] ?? '#555';
    ctx.fillStyle   = 'rgba(100,160,255,0.05)';

    ctx.beginPath();
    switch (tool) {
      case 'rectangle':
        ctx.rect(x, y, w, h); ctx.fill(); ctx.stroke(); break;
      case 'circle':
        ctx.ellipse(x + w / 2, y + h / 2, Math.max(w / 2, 1), Math.max(h / 2, 1), 0, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke(); break;
      case 'arrow': {
        ctx.moveTo(d.startX, d.startY); ctx.lineTo(d.currentX, d.currentY); ctx.stroke();
        const ang = Math.atan2(d.currentY - d.startY, d.currentX - d.startX), L = 14;
        ctx.beginPath();
        ctx.moveTo(d.currentX, d.currentY);
        ctx.lineTo(d.currentX - L * Math.cos(ang - 0.4), d.currentY - L * Math.sin(ang - 0.4));
        ctx.moveTo(d.currentX, d.currentY);
        ctx.lineTo(d.currentX - L * Math.cos(ang + 0.4), d.currentY - L * Math.sin(ang + 0.4));
        ctx.stroke(); break;
      }
      case 'connector':
        ctx.moveTo(d.startX, d.startY); ctx.lineTo(d.currentX, d.currentY); ctx.stroke(); break;
    }
  }

  private _redrawShapes(): void {
    const ctx = this._ensureCtx(); if (!ctx) return;
    ctx.clearRect(0, 0, this.CANVAS_W, this.CANVAS_H);
    ctx.setLineDash([]);
    const sel = this.selectedId();
    for (const obj of this._allObjects()) {
      if (obj.type === 'sticky-note') continue;
      this._drawShape(ctx, obj);
      if (obj.id === sel) {
        ctx.save();
        ctx.strokeStyle = '#1e88e5'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 3]);
        ctx.strokeRect(obj.x - 4, obj.y - 4, obj.width + 8, obj.height + 8);
        ctx.restore();
      }
    }
  }

  private _drawShape(ctx: CanvasRenderingContext2D, obj: CanvasObject): void {
    ctx.save();
    ctx.strokeStyle = obj.strokeColor ?? '#555';
    ctx.fillStyle   = obj.color ?? 'transparent';
    ctx.lineWidth   = 2; ctx.setLineDash([]);
    const { x, y, width: w, height: h } = obj;

    switch (obj.type) {
      case 'rectangle':
        ctx.beginPath(); ctx.rect(x, y, w, h);
        if (obj.color && obj.color !== 'transparent') ctx.fill();
        ctx.stroke(); break;
      case 'circle':
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + h / 2, Math.max(w / 2, 1), Math.max(h / 2, 1), 0, 0, Math.PI * 2);
        if (obj.color && obj.color !== 'transparent') ctx.fill();
        ctx.stroke(); break;
      case 'arrow': {
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y + h); ctx.stroke();
        const ang = Math.atan2(h, w), L = 14;
        ctx.beginPath();
        ctx.moveTo(x + w, y + h);
        ctx.lineTo(x + w - L * Math.cos(ang - 0.4), y + h - L * Math.sin(ang - 0.4));
        ctx.moveTo(x + w, y + h);
        ctx.lineTo(x + w - L * Math.cos(ang + 0.4), y + h - L * Math.sin(ang + 0.4));
        ctx.stroke(); break;
      }
      case 'connector':
        ctx.setLineDash([6, 4]);
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y + h); ctx.stroke(); break;
      case 'freehand': {
        let pts: Array<[number, number]> = [];
        try { pts = JSON.parse(obj.text ?? '[]'); } catch { break; }
        if (pts.length < 2) break;
        ctx.strokeStyle = obj.strokeColor ?? '#333';
        ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
        for (const [px, py] of pts.slice(1)) ctx.lineTo(px, py);
        ctx.stroke(); break;
      }
    }
    ctx.restore();
  }
}
