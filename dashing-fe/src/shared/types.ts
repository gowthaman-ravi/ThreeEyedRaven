/**
 * Shared types for the ThreeEyedRaven QA Testing Tool
 * Used by both main and renderer processes
 */

// ============================================
// Session Types (Multi-Window Architecture)
// ============================================

export type SessionStatus = 'recording' | 'paused' | 'ended';

export interface Session {
  id: string;
  name: string;
  description?: string;
  status: SessionStatus;
  userId: string;
  userName?: string;
  testSuite?: string;
  environment?: string;
  tags: string[];
  startedAt: number;
  endedAt?: number;
  metadata?: Record<string, unknown>;
  
  // Runtime only (not persisted, populated when needed)
  windows?: SessionWindow[];
  actionCount?: number;
  errorCount?: number;
}

export interface SessionWindow {
  id: string;
  sessionId: string;
  label: string;  // "User A", "Admin", "Main Browser"
  role?: string;  // For multi-user: "buyer", "seller", "support"
  browserWindowId?: number;  // Runtime: Electron's window ID
  createdAt: number;
  closedAt?: number;
  
  // Runtime only
  tabs?: SessionTab[];
  isActive?: boolean;
  actionCount?: number;
  errorCount?: number;
}

export interface SessionTab {
  id: string;
  windowId: string;
  sessionId: string;
  title: string;
  url: string;
  favicon?: string;
  createdAt: number;
  closedAt?: number;
  
  // Runtime only
  isActive?: boolean;
  actionCount?: number;
  errorCount?: number;
}

// ============================================
// Action/Event Types
// ============================================

export type ActionType =
  | 'click'
  | 'dblclick'
  | 'type'
  | 'scroll'
  | 'navigate'
  | 'keypress'
  | 'rightclick'
  | 'select'
  | 'drag'
  | 'hover'
  | 'focus'
  | 'blur'
  | 'submit'
  | 'change'
  | 'check'
  | 'uncheck'
  | 'mousemove'
  | 'mouseenter'
  | 'mouseleave'
  | 'dragstart'
  | 'drop'
  | 'addExpected';  // User explicitly marks element as expected assertion

export type ErrorType = 'http' | 'console' | 'network';

export interface ElementInfo {
  selector: string;
  xpath?: string;
  tagName: string;
  id?: string;
  classes: string[];
  text?: string;
  attributes: Record<string, string>;
  rect?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface RecordedAction {
  id: string;
  sessionId: string;
  windowId: string;
  windowLabel: string;
  tabId: string;
  tabUrl: string;
  tabTitle: string;
  type: ActionType;
  timestamp: number;
  element?: ElementInfo;
  data: ActionData;
  viewport: {
    width: number;
    height: number;
  };
  synced?: boolean;
}

export interface ActionData {
  // For click/rightclick
  x?: number;
  y?: number;
  button?: number;

  // For type
  value?: string;

  // For keypress
  key?: string;
  modifiers?: string[];

  // For scroll
  scrollX?: number;
  scrollY?: number;
  deltaY?: number;

  // For navigate
  url?: string;
  fromUrl?: string;

  // For select (text selection)
  selectedText?: string;

  // For drag
  startX?: number;
  startY?: number;
  endX?: number;
  endY?: number;

  // For addExpected (user-marked assertions)
  assertionType?: 'visible' | 'hidden' | 'hasText' | 'hasValue' | 'enabled' | 'disabled' | 'checked';
  expectedText?: string;
  expectedValue?: string;
}

// ============================================
// Error Types
// ============================================

export interface TabError {
  id: string;
  sessionId: string;
  windowId?: string;
  windowLabel?: string;
  tabId: string;
  type: ErrorType;
  message: string;
  source: string;
  timestamp: number;
  statusCode?: number;
  method?: string;
  resourceType?: string;
  stackTrace?: string;
  synced?: boolean;
}

// ============================================
// IPC Event Types
// ============================================

// Session Management
export interface CreateSessionRequest {
  name: string;
  description?: string;
  userId: string;
  userName?: string;
  testSuite?: string;
  environment?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface AddWindowRequest {
  sessionId: string;
  label: string;
  role?: string;
}

export interface AddTabRequest {
  sessionId: string;
  windowId: string;
  url?: string;
}

export interface UpdateSessionStatusRequest {
  sessionId: string;
  status: SessionStatus;
}

// Action/Error Storage
export interface StoreActionRequest {
  action: RecordedAction;
}

export interface StoreErrorRequest {
  error: TabError;
}

export interface GetActionsRequest {
  sessionId?: string;
  windowId?: string;
  tabId?: string;
  limit?: number;
  offset?: number;
  type?: ActionType;
}

export interface GetActionsResponse {
  actions: RecordedAction[];
  total: number;
  hasMore: boolean;
}

export interface GetSessionsRequest {
  status?: SessionStatus;
  userId?: string;
  limit?: number;
  offset?: number;
}

export interface GetSessionsResponse {
  sessions: Session[];
  total: number;
  hasMore: boolean;
}

// Sync Status
export interface SyncStatus {
  pendingActions: number;
  pendingErrors: number;
  lastSyncAt?: number;
  isOnline: boolean;
}

// ============================================
// Session Manager Events (for real-time updates)
// ============================================

export type SessionEvent = 
  | { type: 'session-created'; session: Session }
  | { type: 'session-updated'; session: Session }
  | { type: 'session-ended'; sessionId: string }
  | { type: 'session-synced'; sessionId: string }
  | { type: 'session-sync-failed'; sessionId: string; error: string }
  | { type: 'window-added'; sessionId: string; window: SessionWindow }
  | { type: 'window-closed'; sessionId: string; windowId: string }
  | { type: 'window-focused'; sessionId: string; windowId: string }
  | { type: 'tab-added'; sessionId: string; windowId: string; tab: SessionTab }
  | { type: 'tab-closed'; sessionId: string; windowId: string; tabId: string }
  | { type: 'tab-updated'; sessionId: string; windowId: string; tab: SessionTab }
  | { type: 'action-recorded'; sessionId: string; actionCount: number }
  | { type: 'error-recorded'; sessionId: string; errorCount: number }
  | { type: 'error-captured'; sessionId: string; errorCount: number };

// ============================================
// Database Row Types (for SQLite)
// ============================================

export interface SessionRow {
  id: string;
  name: string;
  description: string | null;
  status: string;
  user_id: string;
  user_name: string | null;
  test_suite: string | null;
  environment: string | null;
  tags: string | null;  // JSON array
  started_at: number;
  ended_at: number | null;
  metadata: string | null;  // JSON object
}

export interface SessionWindowRow {
  id: string;
  session_id: string;
  label: string;
  role: string | null;
  browser_window_id: number | null;
  created_at: number;
  closed_at: number | null;
}

export interface SessionTabRow {
  id: string;
  window_id: string;
  session_id: string;
  title: string | null;
  url: string | null;
  favicon: string | null;
  created_at: number;
  closed_at: number | null;
}

export interface ActionRow {
  id: number;
  action_id: string;
  session_id: string;
  window_id: string;
  window_label: string | null;
  tab_id: string;
  tab_url: string | null;
  tab_title: string | null;
  action_type: string;
  timestamp: number;
  element_selector: string | null;
  element_xpath: string | null;
  element_tag: string | null;
  payload: string;
  synced: number;
  created_at: number;
}

export interface ErrorRow {
  id: number;
  error_id: string;
  session_id: string;
  window_id: string | null;
  window_label: string | null;
  tab_id: string;
  error_type: string;
  message: string;
  source: string | null;
  stack_trace: string | null;
  timestamp: number;
  status_code: number | null;
  method: string | null;
  resource_type: string | null;
  synced: number;
  created_at: number;
}

// ============================================
// Configuration Types
// ============================================

export interface EventStoreConfig {
  dbPath: string;
  flushIntervalMs: number;
  batchSize: number;
  maxRetries: number;
  cleanupAgeMs: number;
}

export const DEFAULT_EVENT_STORE_CONFIG: EventStoreConfig = {
  dbPath: 'dashing-events.db',
  flushIntervalMs: 5000, // Flush to DB every 5 seconds
  batchSize: 50, // Or when 50 events accumulate
  maxRetries: 3, // Max sync retries
  cleanupAgeMs: 7 * 24 * 60 * 60 * 1000, // Clean up synced events older than 7 days
};

// ============================================
// Window Configuration
// ============================================

export interface DashboardWindowConfig {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
}

export interface SessionWindowConfig {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  label: string;
}

export const DEFAULT_DASHBOARD_CONFIG: DashboardWindowConfig = {
  width: 1280,
  height: 900,
  minWidth: 900,
  minHeight: 700,
};

export const DEFAULT_SESSION_WINDOW_CONFIG: SessionWindowConfig = {
  width: 1400,
  height: 900,
  minWidth: 800,
  minHeight: 600,
  label: 'Main Browser',
};
