// Shared domain types used across services

export type PersonaRole = 'Admin' | 'Academic Affairs' | 'Teacher';

// RFC 6902 JSON Patch
export type JsonPatch = Array<{
  op: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test';
  path: string;
  value?: unknown;
  from?: string;
}>;

export interface Profile {
  id: string;
  username: string;
  role: PersonaRole;
  passwordHash: string;
  salt: string;
  failedAttempts: number;
  lockoutUntil: number | null;
  lastSignInAt: number | null;
  createdAt: number;
}

export type ProfileSummary = Pick<Profile, 'id' | 'username' | 'role' | 'lockoutUntil'>;

export interface Workspace {
  id: string;
  name: string;
  ownerProfileId: string;
  createdAt: number;
  updatedAt: number;
  version: number;
}

export type WorkspaceSummary = Pick<Workspace, 'id' | 'name' | 'ownerProfileId' | 'updatedAt'>;

export type CanvasObjectType =
  | 'rectangle'
  | 'circle'
  | 'arrow'
  | 'connector'
  | 'freehand'
  | 'sticky-note';

export interface CanvasObject {
  id: string;
  workspaceId: string;
  type: CanvasObjectType;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  color?: string;
  strokeColor?: string;
  zIndex: number;
  tags?: string[];
  version: number;
  createdAt: number;
  updatedAt: number;
  lastEditedBy: string;
}

export interface Reply {
  id: string;
  authorId: string;
  body: string;
  mentions: string[];
  createdAt: number;
}

export interface CommentThread {
  id: string;
  workspaceId: string;
  targetId: string;
  replies: Reply[];
  readBy: string[];
  createdAt: number;
  updatedAt: number;
  version: number;
}

export interface InboxItem {
  id: string;
  threadId: string;
  workspaceId: string;
  targetId: string;
  mentionedBy: string;
  body: string;
  at: number;
  read: boolean;
}

export interface ChatMessage {
  id: string;
  workspaceId: string;
  type: 'user' | 'system';
  authorId?: string;   // profile ID of the sender
  authorName?: string; // denormalised display name for the bubble header
  body: string;
  createdAt: number;
}

export interface PeerPresence {
  tabId: string;
  profileId: string;
  role: PersonaRole;
  color: string;
  status: 'online' | 'away' | 'leaving';
  lastHeartbeatAt: number;
}

export interface CursorPosition {
  tabId: string;
  x: number;
  y: number;
  color: string;
  at: number;
}

export interface ActivityEntry {
  id: string;
  tabId: string;
  profileId: string;
  action: string;
  objectId?: string;
  objectType?: string;
  at: number;
}

export interface MutualHelpPost {
  id: string;
  workspaceId: string;
  status: 'draft' | 'active' | 'expired' | 'withdrawn';
  type: 'request' | 'offer';
  category: string;
  title: string;
  description: string;
  tags: string[];
  timeWindow?: string;
  budget?: string;
  urgency: 'low' | 'medium' | 'high';
  attachmentIds: string[];
  authorId: string;
  pinned: boolean;
  expiresAt: number;
  createdAt: number;
  updatedAt: number;
  version: number;
}

export interface NewPostInput {
  workspaceId: string;
  type: 'request' | 'offer';
  category: string;
  title: string;
  description: string;
  tags: string[];
  timeWindow?: string;
  budget?: string;
  urgency: 'low' | 'medium' | 'high';
  attachmentIds?: string[];
  expiresIn?: number; // ms, default 72h
}

export interface SnapshotSummary {
  workspaceId: string;
  seq: number;
  isCheckpoint: boolean;
  createdAt: number;
}

export interface TelemetryEvent {
  id: string;
  workspaceId: string;
  type: string;
  payload: unknown;
  at: number;
  rolledUp: boolean;
}

export interface KpiSnapshot {
  notesPerMinute: number;
  avgCommentResponseMs: number;
  unresolvedRequests: number;
  activePeers: number;
  computedAt: number;
}

export interface KpiAlert {
  metric: keyof Omit<KpiSnapshot, 'computedAt'>;
  value: number;
  threshold: number;
  direction: 'above' | 'below';
  at: number;
}

export interface WarehouseDaily {
  date: string;
  workspaceId: string;
  notesCreated: number;
  commentsAdded: number;
  chatMessagesSent: number;
  mutualHelpPublished: number;
  activeProfiles: string[];
  computedAt: number;
}

// Column mapping for CSV/JSON import
export interface ColumnMapping {
  text: string;
  color?: string;
  tags?: string;
  author?: string;
}

export interface ImportRow {
  text: string;
  color?: string;
  tags?: string[];
  authorId?: string;
}

export interface ImportRowError {
  rowIndex: number;
  rawValues: Record<string, string>;
  reasons: Array<'text-missing' | 'text-too-long' | 'unknown-author' | 'invalid-color' | 'tag-not-allowed'>;
}
