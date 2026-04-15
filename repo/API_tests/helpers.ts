/**
 * API test helpers — wire up all services in a realistic configuration
 * for full end-to-end flow tests (no mocking).
 */
import { DbService } from '../src/app/core/db.service';
import { PrefsService } from '../src/app/core/prefs.service';
import { TabIdentityService } from '../src/app/core/tab-identity.service';
import { BroadcastService } from '../src/app/core/broadcast.service';
import { AuthService } from '../src/app/auth/auth.service';
import { WorkspaceService } from '../src/app/workspace/workspace.service';
import { CanvasService } from '../src/app/canvas/canvas.service';
import { ChatService } from '../src/app/chat/chat.service';
import { CommentService } from '../src/app/comments/comment.service';
import { MutualHelpService } from '../src/app/mutual-help/mutual-help.service';
import { SnapshotService } from '../src/app/snapshot/snapshot.service';
import { TelemetryService } from '../src/app/telemetry/telemetry.service';
import { KpiService } from '../src/app/kpi/kpi.service';
import { NoteImportService } from '../src/app/import-export/note-import.service';
import type { PersonaRole } from '../src/app/core/types';

export interface FullContext {
  db: DbService;
  prefs: PrefsService;
  tab: TabIdentityService;
  broadcast: BroadcastService;
  auth: AuthService;
  workspace: WorkspaceService;
  canvas: CanvasService;
  chat: ChatService;
  comments: CommentService;
  mutualHelp: MutualHelpService;
  snapshot: SnapshotService;
  telemetry: TelemetryService;
  kpi: KpiService;
  noteImport: NoteImportService;
}

/** Create a fully wired service context for API tests. */
export function makeFullContext(): FullContext {
  const db = new DbService();
  const prefs = new PrefsService();
  const tab = new TabIdentityService();
  const broadcast = new BroadcastService(tab);
  const auth = new AuthService(db, prefs);
  const workspace = new WorkspaceService(db, prefs, broadcast, auth);
  const canvas = new CanvasService(db, broadcast, tab);
  const chat = new ChatService(db, broadcast, tab, auth);
  const comments = new CommentService(db, broadcast, tab, auth);
  const mutualHelp = new MutualHelpService(db, broadcast);
  const snapshot = new SnapshotService(db, chat);
  const telemetry = new TelemetryService(db);
  const kpi = new KpiService(db, telemetry);
  const noteImport = new NoteImportService(db, chat);

  return { db, prefs, tab, broadcast, auth, workspace, canvas, chat, comments, mutualHelp, snapshot, telemetry, kpi, noteImport };
}

/** Create a profile and return the signed-in profile. */
export async function signUp(
  auth: AuthService,
  username: string,
  password = 'password123',
  role: PersonaRole = 'Admin',
) {
  const profile = await auth.createProfile({ username, password, role });
  const result = await auth.signIn(username, password);
  if (!result.ok) throw new Error(`signUp: sign-in failed — ${result.reason}`);
  return result.profile;
}
