/**
 * Shared test helpers — instantiate services without Angular DI.
 * Services are plain classes; @Injectable() only adds metadata, not runtime behaviour.
 */
import { DbService } from '../src/app/core/db.service';
import { PrefsService } from '../src/app/core/prefs.service';
import { TabIdentityService } from '../src/app/core/tab-identity.service';
import { BroadcastService } from '../src/app/core/broadcast.service';
import { AuthService } from '../src/app/auth/auth.service';
import { ChatService } from '../src/app/chat/chat.service';
import { TelemetryService } from '../src/app/telemetry/telemetry.service';
import type { PersonaRole } from '../src/app/core/types';

export interface ServiceContext {
  db: DbService;
  prefs: PrefsService;
  tab: TabIdentityService;
  broadcast: BroadcastService;
  auth: AuthService;
  chat: ChatService;
  telemetry: TelemetryService;
}

/** Create a full service context with all core dependencies wired together. */
export function makeContext(): ServiceContext {
  const db = new DbService();
  const prefs = new PrefsService();
  const tab = new TabIdentityService();
  const broadcast = new BroadcastService(tab);
  const auth = new AuthService(db, prefs);
  const telemetry = new TelemetryService(db);
  const chat = new ChatService(db, broadcast, tab, auth, telemetry);
  return { db, prefs, tab, broadcast, auth, chat, telemetry };
}

/** Create a profile and sign in; returns the signed-in profile. */
export async function createAndSignIn(
  auth: AuthService,
  username = 'alice',
  password = 'password123',
  role: PersonaRole = 'Admin',
) {
  await auth.createProfile({ username, password, role });
  const result = await auth.signIn(username, password);
  if (!result.ok) throw new Error(`Sign-in failed: ${result.reason}`);
  return result.profile;
}
