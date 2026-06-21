/**
 * EventStore - SQL.js-based local storage for actions and errors
 * Uses sql.js (pure JavaScript SQLite) to avoid native module compatibility issues
 * Handles batching, persistence, and sync status tracking
 */

import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import type { Database as SqlJsDatabase, SqlJsStatic } from 'sql.js';
import {
  RecordedAction,
  TabError,
  Session,
  SessionWindow,
  SessionTab,
  SessionStatus,
  EventStoreConfig,
  DEFAULT_EVENT_STORE_CONFIG,
  GetActionsRequest,
  GetActionsResponse,
  GetSessionsRequest,
  GetSessionsResponse,
} from '../shared/types';

// AI Generation Job type
export interface AIGenerationJob {
  id: string;
  sessionId: string;
  sessionName: string;
  type: 'test-cases' | 'code-new' | 'code-optimize';
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  providerId: string;
  model: string;
  options: {
    framework?: string;
    language?: string;
    selectedActionIds: string[];
    existingCode?: string;
  };
  result: unknown | null;
  error: string | null;
  debugFilePath: string | null;
  promptFilePath: string | null;
  actionsFilePath: string | null;
  tokensUsed: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  progress: number;
  totalBatches: number;
  completedBatches: number;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
}

export class EventStore {
  private db: SqlJsDatabase | null = null;
  private config: EventStoreConfig;
  private dbPath: string;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  
  // Batch buffers
  private pendingActions: RecordedAction[] = [];
  private pendingErrors: TabError[] = [];
  
  // Flush timer
  private flushInterval: NodeJS.Timeout | null = null;
  private saveInterval: NodeJS.Timeout | null = null;
  
  // Current session
  private currentSession: Session | null = null;

  constructor(config: Partial<EventStoreConfig> = {}) {
    this.config = { ...DEFAULT_EVENT_STORE_CONFIG, ...config };
    
    // Get the user data path for the database
    const userDataPath = app.getPath('userData');
    this.dbPath = path.join(userDataPath, this.config.dbPath);
    
    console.log(`[EventStore] Database path: ${this.dbPath}`);
    
    // Initialize asynchronously
    this.initPromise = this.initialize();
  }

  private async initialize(): Promise<void> {
    try {
      // Load sql.js dynamically (it's externalized in webpack)
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const initSqlJs = require('sql.js');
      
      // Determine the WASM file path
      // In development: node_modules/sql.js/dist/sql-wasm.wasm
      // In production: should be bundled with the app
      const wasmPath = app.isPackaged
        ? path.join(process.resourcesPath, 'sql-wasm.wasm')
        : path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
      
      console.log(`[EventStore] WASM path: ${wasmPath}`);
      
      // Check if WASM file exists, if not use the default locator
      let SQL: SqlJsStatic;
      if (fs.existsSync(wasmPath)) {
        const wasmBinary = fs.readFileSync(wasmPath);
        SQL = await initSqlJs({ wasmBinary });
      } else {
        // Fallback: let sql.js find the WASM file itself
        console.log(`[EventStore] WASM file not found at ${wasmPath}, using default locator`);
        SQL = await initSqlJs({
          locateFile: (file: string) => {
            // Try multiple paths
            const paths = [
              path.join(__dirname, file),
              path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', file),
              path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', file),
            ];
            for (const p of paths) {
              if (fs.existsSync(p)) {
                console.log(`[EventStore] Found WASM at: ${p}`);
                return p;
              }
            }
            console.log(`[EventStore] Could not find ${file}, using default`);
            return `https://sql.js.org/dist/${file}`;
          },
        });
      }

      // Try to load existing database or create new one
      if (fs.existsSync(this.dbPath)) {
        const fileBuffer = fs.readFileSync(this.dbPath);
        this.db = new SQL.Database(fileBuffer);
        console.log(`[EventStore] Loaded existing database from: ${this.dbPath}`);
      } else {
        this.db = new SQL.Database();
        console.log(`[EventStore] Created new database`);
      }

      this.initSchema();
      this.startTimers();
      this.initialized = true;
      console.log(`[EventStore] Initialization complete`);
    } catch (error) {
      console.error(`[EventStore] Failed to initialize:`, error);
      // Log more details for debugging
      if (error instanceof Error) {
        console.error(`[EventStore] Error details: ${error.message}`);
        console.error(`[EventStore] Stack: ${error.stack}`);
      }
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized && this.initPromise) {
      await this.initPromise;
    }
  }

  private initSchema(): void {
    if (!this.db) return;

    // Check schema version and migrate if necessary
    const CURRENT_SCHEMA_VERSION = 9; // Increment when schema changes (v9: added input_tokens and output_tokens to ai_generation_jobs)
    
    // Create schema_version table if not exists
    this.db.run(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY
      );
    `);
    
    // Get current version
    const versionResult = this.db.exec(`SELECT version FROM schema_version LIMIT 1`);
    const currentVersion = versionResult.length > 0 && versionResult[0].values.length > 0
      ? versionResult[0].values[0][0] as number
      : 0;
    
    if (currentVersion < CURRENT_SCHEMA_VERSION) {
      console.log(`[EventStore] Migrating schema from v${currentVersion} to v${CURRENT_SCHEMA_VERSION}`);
      
      // Drop old tables (for development - in production, you'd migrate data)
      this.db.run(`DROP TABLE IF EXISTS test_cases;`);
      this.db.run(`DROP TABLE IF EXISTS sync_queue;`);
      this.db.run(`DROP TABLE IF EXISTS actions;`);
      this.db.run(`DROP TABLE IF EXISTS errors;`);
      this.db.run(`DROP TABLE IF EXISTS sessions;`);
      this.db.run(`DROP TABLE IF EXISTS session_windows;`);
      this.db.run(`DROP TABLE IF EXISTS session_tabs;`);
      this.db.run(`DROP TABLE IF EXISTS ai_generation_jobs;`);
      
      // Update version
      this.db.run(`DELETE FROM schema_version;`);
      this.db.run(`INSERT INTO schema_version (version) VALUES (?);`, [CURRENT_SCHEMA_VERSION]);
      
      console.log(`[EventStore] Schema migration complete`);
    }

    // Create sessions table (multi-window architecture)
    this.db.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        status TEXT CHECK(status IN ('recording', 'paused', 'ended')) DEFAULT 'recording',
        user_id TEXT NOT NULL,
        user_name TEXT,
        test_suite TEXT,
        environment TEXT,
        tags TEXT,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        metadata TEXT
      );
    `);

    // Create session_windows table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS session_windows (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        label TEXT NOT NULL,
        role TEXT,
        browser_window_id INTEGER,
        created_at INTEGER NOT NULL,
        closed_at INTEGER,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
    `);

    // Create session_tabs table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS session_tabs (
        id TEXT PRIMARY KEY,
        window_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        title TEXT,
        url TEXT,
        favicon TEXT,
        created_at INTEGER NOT NULL,
        closed_at INTEGER,
        FOREIGN KEY (window_id) REFERENCES session_windows(id) ON DELETE CASCADE,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
    `);

    // Create actions table (with window context)
    this.db.run(`
      CREATE TABLE IF NOT EXISTS actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action_id TEXT NOT NULL UNIQUE,
        session_id TEXT NOT NULL,
        window_id TEXT NOT NULL,
        window_label TEXT,
        tab_id TEXT NOT NULL,
        tab_url TEXT,
        tab_title TEXT,
        action_type TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        element_selector TEXT,
        element_xpath TEXT,
        element_tag TEXT,
        payload TEXT NOT NULL,
        synced INTEGER DEFAULT 0,
        created_at INTEGER,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
        FOREIGN KEY (window_id) REFERENCES session_windows(id) ON DELETE CASCADE
      );
    `);

    // Create indexes for actions
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_actions_sync ON actions(synced, created_at);`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_actions_session ON actions(session_id, timestamp);`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_actions_window ON actions(window_id, timestamp);`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_actions_tab ON actions(tab_id, timestamp);`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_actions_type ON actions(action_type);`);

    // Create errors table (with window context)
    this.db.run(`
      CREATE TABLE IF NOT EXISTS errors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        error_id TEXT NOT NULL UNIQUE,
        session_id TEXT NOT NULL,
        window_id TEXT,
        window_label TEXT,
        tab_id TEXT NOT NULL,
        error_type TEXT NOT NULL,
        message TEXT NOT NULL,
        source TEXT,
        stack_trace TEXT,
        timestamp INTEGER NOT NULL,
        status_code INTEGER,
        method TEXT,
        resource_type TEXT,
        synced INTEGER DEFAULT 0,
        created_at INTEGER,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
    `);

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_errors_sync ON errors(synced, created_at);`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_errors_session ON errors(session_id, timestamp);`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_errors_tab ON errors(tab_id, timestamp);`);

    // Create indexes for windows and tabs
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_windows_session ON session_windows(session_id);`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_tabs_window ON session_tabs(window_id);`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_tabs_session ON session_tabs(session_id);`);

    // Create sync_queue table for tracking sync operations
    this.db.run(`
      CREATE TABLE IF NOT EXISTS sync_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        type TEXT CHECK(type IN ('session', 'actions', 'errors')) NOT NULL,
        status TEXT CHECK(status IN ('pending', 'syncing', 'synced', 'failed', 'not_synced')) DEFAULT 'pending',
        priority INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL,
        last_attempt_at INTEGER,
        attempt_count INTEGER DEFAULT 0,
        error TEXT,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
    `);

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_sync_queue_session ON sync_queue(session_id);`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status, priority DESC, created_at);`);

    // Create test_cases table for generated test cases
    this.db.run(`
      CREATE TABLE IF NOT EXISTS test_cases (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        field_id TEXT,
        field_name TEXT,
        field_selector TEXT,
        category TEXT CHECK(category IN ('boundary', 'negative', 'security', 'format', 'required', 'accessibility')),
        name TEXT NOT NULL,
        description TEXT,
        test_value TEXT,
        expected_result TEXT,
        priority TEXT CHECK(priority IN ('critical', 'high', 'medium', 'low')) DEFAULT 'medium',
        status TEXT CHECK(status IN ('pending', 'passed', 'failed', 'skipped')) DEFAULT 'pending',
        notes TEXT,
        playwright_code TEXT,
        prerequisite_steps TEXT,
        test_action_step TEXT,
        source TEXT CHECK(source IN ('auto', 'manual', 'ai')) DEFAULT 'auto',
        steps TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        synced INTEGER DEFAULT 0,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
    `);

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_test_cases_session ON test_cases(session_id);`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_test_cases_status ON test_cases(status);`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_test_cases_priority ON test_cases(priority);`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_test_cases_category ON test_cases(category);`);
    
    // Migration: Add source column to existing test_cases tables (must run before creating source index)
    this.migrateTestCasesSource();
    
    // Create index on source after migration ensures column exists
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_test_cases_source ON test_cases(source);`);

    // Create ai_generation_jobs table for tracking background AI generation
    this.db.run(`
      CREATE TABLE IF NOT EXISTS ai_generation_jobs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        session_name TEXT,
        type TEXT CHECK(type IN ('test-cases', 'code-new', 'code-optimize')) NOT NULL,
        status TEXT CHECK(status IN ('pending', 'in_progress', 'completed', 'failed', 'cancelled')) DEFAULT 'pending',
        provider_id TEXT,
        model TEXT,
        options TEXT,
        result TEXT,
        error TEXT,
        debug_file_path TEXT,
        prompt_file_path TEXT,
        actions_file_path TEXT,
        tokens_used INTEGER,
        input_tokens INTEGER,
        output_tokens INTEGER,
        progress INTEGER DEFAULT 0,
        total_batches INTEGER DEFAULT 1,
        completed_batches INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
    `);

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_ai_jobs_session ON ai_generation_jobs(session_id);`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_ai_jobs_status ON ai_generation_jobs(status);`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_ai_jobs_created ON ai_generation_jobs(created_at DESC);`);

    console.log('[EventStore] Schema initialized (multi-window architecture + sync + test cases + ai jobs)');
  }

  private migrateTestCasesSource(): void {
    if (!this.db) return;
    
    try {
      // Check if 'source' column exists
      const tableInfo = this.db.exec(`PRAGMA table_info(test_cases)`);
      if (tableInfo.length === 0) {
        console.log('[EventStore] Migration: test_cases table not found, skipping migration');
        return;
      }
      
      const columns = tableInfo[0].values.map(row => row[1] as string);
      console.log('[EventStore] Current test_cases columns:', columns.join(', '));
      
      let migrated = false;
      
      // Add 'source' column if it doesn't exist (without CHECK constraint for ALTER TABLE compatibility)
      if (!columns.includes('source')) {
        console.log('[EventStore] Migration: Adding source column...');
        this.db.run(`ALTER TABLE test_cases ADD COLUMN source TEXT DEFAULT 'auto'`);
        console.log('[EventStore] Migration: Added source column to test_cases table');
        migrated = true;
      }
      
      // Add 'steps' column if it doesn't exist
      if (!columns.includes('steps')) {
        console.log('[EventStore] Migration: Adding steps column...');
        this.db.run(`ALTER TABLE test_cases ADD COLUMN steps TEXT`);
        console.log('[EventStore] Migration: Added steps column to test_cases table');
        migrated = true;
      }
      
      // Save to disk if we made changes
      if (migrated) {
        this.saveToDisk();
        console.log('[EventStore] Migration: Changes saved to disk');
      }
    } catch (error) {
      console.error('[EventStore] Migration error:', error);
    }
  }

  private startTimers(): void {
    // Flush to database every flushIntervalMs
    this.flushInterval = setInterval(() => {
      this.flush();
    }, this.config.flushIntervalMs);

    // Save database to disk every 30 seconds
    this.saveInterval = setInterval(() => {
      this.saveToDisk();
    }, 30000);
  }

  private saveToDisk(): void {
    if (!this.db) return;
    
    try {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      
      // Ensure directory exists
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      fs.writeFileSync(this.dbPath, buffer);
    } catch (error) {
      console.error('[EventStore] Failed to save database:', error);
    }
  }

  // ============================================
  // Session Management (Multi-Window Architecture)
  // ============================================

  async createSession(session: Session): Promise<void> {
    await this.ensureInitialized();
    
    if (this.db) {
      this.db.run(
        `INSERT OR REPLACE INTO sessions 
         (id, name, description, status, user_id, user_name, test_suite, environment, tags, started_at, ended_at, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          session.id,
          session.name,
          session.description || null,
          session.status,
          session.userId,
          session.userName || null,
          session.testSuite || null,
          session.environment || null,
          session.tags ? JSON.stringify(session.tags) : null,
          session.startedAt,
          session.endedAt || null,
          session.metadata ? JSON.stringify(session.metadata) : null,
        ]
      );
    }

    this.currentSession = session;
    console.log(`[EventStore] Session created: ${session.id} - ${session.name}`);
  }

  async updateSessionStatus(sessionId: string, status: SessionStatus, endedAt?: number): Promise<void> {
    await this.ensureInitialized();
    
    if (this.db) {
      if (status === 'ended' && endedAt) {
        this.db.run(`UPDATE sessions SET status = ?, ended_at = ? WHERE id = ?`, [status, endedAt, sessionId]);
      } else {
        this.db.run(`UPDATE sessions SET status = ? WHERE id = ?`, [status, sessionId]);
      }
    }
    
    if (this.currentSession?.id === sessionId) {
      this.currentSession.status = status;
      if (endedAt) this.currentSession.endedAt = endedAt;
    }
    
    console.log(`[EventStore] Session ${sessionId} status updated to: ${status}`);
  }

  getCurrentSession(): Session | null {
    return this.currentSession;
  }

  async getSession(sessionId: string): Promise<Session | null> {
    await this.ensureInitialized();
    
    if (!this.db) return null;
    
    const result = this.db.exec(`SELECT * FROM sessions WHERE id = ?`, [sessionId]);
    if (result.length === 0 || result[0].values.length === 0) return null;
    
    const row = result[0].values[0];
    const columns = result[0].columns;
    const rowObj: Record<string, unknown> = {};
    columns.forEach((col: string, idx: number) => {
      rowObj[col] = row[idx];
    });
    
    return {
      id: rowObj.id as string,
      name: rowObj.name as string,
      description: rowObj.description as string || undefined,
      status: rowObj.status as SessionStatus,
      userId: rowObj.user_id as string,
      userName: rowObj.user_name as string || undefined,
      testSuite: rowObj.test_suite as string || undefined,
      environment: rowObj.environment as string || undefined,
      tags: rowObj.tags ? JSON.parse(rowObj.tags as string) : [],
      startedAt: rowObj.started_at as number,
      endedAt: rowObj.ended_at as number || undefined,
      metadata: rowObj.metadata ? JSON.parse(rowObj.metadata as string) : undefined,
    };
  }

  async getSessions(request: GetSessionsRequest): Promise<GetSessionsResponse> {
    await this.ensureInitialized();
    
    if (!this.db) {
      return { sessions: [], total: 0, hasMore: false };
    }

    const { status, userId, limit = 50, offset = 0 } = request;
    
    let whereClause = '1=1';
    const params: (string | number)[] = [];
    
    if (status) {
      whereClause += ' AND status = ?';
      params.push(status);
    }
    
    if (userId) {
      whereClause += ' AND user_id = ?';
      params.push(userId);
    }

    // Get total count
    const countResult = this.db.exec(`SELECT COUNT(*) as count FROM sessions WHERE ${whereClause}`, params);
    const total = countResult.length > 0 && countResult[0].values.length > 0 
      ? countResult[0].values[0][0] as number 
      : 0;

    // Get sessions
    const result = this.db.exec(
      `SELECT * FROM sessions WHERE ${whereClause} ORDER BY started_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const sessions: Session[] = [];
    if (result.length > 0) {
      const columns = result[0].columns;
      for (const row of result[0].values) {
        const rowObj: Record<string, unknown> = {};
        columns.forEach((col: string, idx: number) => {
          rowObj[col] = row[idx];
        });
        
        sessions.push({
          id: rowObj.id as string,
          name: rowObj.name as string,
          description: rowObj.description as string || undefined,
          status: rowObj.status as SessionStatus,
          userId: rowObj.user_id as string,
          userName: rowObj.user_name as string || undefined,
          testSuite: rowObj.test_suite as string || undefined,
          environment: rowObj.environment as string || undefined,
          tags: rowObj.tags ? JSON.parse(rowObj.tags as string) : [],
          startedAt: rowObj.started_at as number,
          endedAt: rowObj.ended_at as number || undefined,
          metadata: rowObj.metadata ? JSON.parse(rowObj.metadata as string) : undefined,
        });
      }
    }

    return {
      sessions,
      total,
      hasMore: offset + sessions.length < total,
    };
  }

  // ============================================
  // Session Window Management
  // ============================================

  async createSessionWindow(window: SessionWindow): Promise<void> {
    await this.ensureInitialized();
    
    if (this.db) {
      this.db.run(
        `INSERT INTO session_windows (id, session_id, label, role, browser_window_id, created_at, closed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          window.id,
          window.sessionId,
          window.label,
          window.role || null,
          window.browserWindowId || null,
          window.createdAt,
          window.closedAt || null,
        ]
      );
    }
    
    console.log(`[EventStore] Session window created: ${window.id} (${window.label})`);
  }

  async updateSessionWindowBrowserId(windowId: string, browserWindowId: number): Promise<void> {
    await this.ensureInitialized();
    
    if (this.db) {
      this.db.run(`UPDATE session_windows SET browser_window_id = ? WHERE id = ?`, [browserWindowId, windowId]);
    }
  }

  async closeSessionWindow(windowId: string): Promise<void> {
    await this.ensureInitialized();
    
    if (this.db) {
      this.db.run(`UPDATE session_windows SET closed_at = ? WHERE id = ?`, [Date.now(), windowId]);
    }
    
    console.log(`[EventStore] Session window closed: ${windowId}`);
  }

  async getSessionWindows(sessionId: string): Promise<SessionWindow[]> {
    await this.ensureInitialized();
    
    if (!this.db) return [];

    const result = this.db.exec(
      `SELECT * FROM session_windows WHERE session_id = ? ORDER BY created_at`,
      [sessionId]
    );

    const windows: SessionWindow[] = [];
    if (result.length > 0) {
      const columns = result[0].columns;
      for (const row of result[0].values) {
        const rowObj: Record<string, unknown> = {};
        columns.forEach((col: string, idx: number) => {
          rowObj[col] = row[idx];
        });
        
        windows.push({
          id: rowObj.id as string,
          sessionId: rowObj.session_id as string,
          label: rowObj.label as string,
          role: rowObj.role as string || undefined,
          browserWindowId: rowObj.browser_window_id as number || undefined,
          createdAt: rowObj.created_at as number,
          closedAt: rowObj.closed_at as number || undefined,
        });
      }
    }

    return windows;
  }

  // ============================================
  // Session Tab Management
  // ============================================

  async createSessionTab(tab: SessionTab): Promise<void> {
    await this.ensureInitialized();
    
    if (this.db) {
      this.db.run(
        `INSERT INTO session_tabs (id, window_id, session_id, title, url, favicon, created_at, closed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          tab.id,
          tab.windowId,
          tab.sessionId,
          tab.title || null,
          tab.url || null,
          tab.favicon || null,
          tab.createdAt,
          tab.closedAt || null,
        ]
      );
    }
    
    console.log(`[EventStore] Session tab created: ${tab.id}`);
  }

  async updateSessionTab(tabId: string, updates: Partial<SessionTab>): Promise<void> {
    await this.ensureInitialized();
    
    if (!this.db) return;

    const setClauses: string[] = [];
    const params: (string | number | null)[] = [];

    if (updates.title !== undefined) {
      setClauses.push('title = ?');
      params.push(updates.title);
    }
    if (updates.url !== undefined) {
      setClauses.push('url = ?');
      params.push(updates.url);
    }
    if (updates.favicon !== undefined) {
      setClauses.push('favicon = ?');
      params.push(updates.favicon || null);
    }

    if (setClauses.length > 0) {
      params.push(tabId);
      this.db.run(`UPDATE session_tabs SET ${setClauses.join(', ')} WHERE id = ?`, params);
    }
  }

  async closeSessionTab(tabId: string): Promise<void> {
    await this.ensureInitialized();
    
    if (this.db) {
      this.db.run(`UPDATE session_tabs SET closed_at = ? WHERE id = ?`, [Date.now(), tabId]);
    }
    
    console.log(`[EventStore] Session tab closed: ${tabId}`);
  }

  async getSessionTabs(windowId: string): Promise<SessionTab[]> {
    await this.ensureInitialized();
    
    if (!this.db) return [];

    const result = this.db.exec(
      `SELECT * FROM session_tabs WHERE window_id = ? ORDER BY created_at`,
      [windowId]
    );

    const tabs: SessionTab[] = [];
    if (result.length > 0) {
      const columns = result[0].columns;
      for (const row of result[0].values) {
        const rowObj: Record<string, unknown> = {};
        columns.forEach((col: string, idx: number) => {
          rowObj[col] = row[idx];
        });
        
        tabs.push({
          id: rowObj.id as string,
          windowId: rowObj.window_id as string,
          sessionId: rowObj.session_id as string,
          title: rowObj.title as string || '',
          url: rowObj.url as string || '',
          favicon: rowObj.favicon as string || undefined,
          createdAt: rowObj.created_at as number,
          closedAt: rowObj.closed_at as number || undefined,
        });
      }
    }

    return tabs;
  }

  // ============================================
  // Action Storage
  // ============================================

  addAction(action: RecordedAction): void {
    // Ensure session ID is set
    if (!action.sessionId && this.currentSession) {
      action.sessionId = this.currentSession.id;
    }
    
    // Validate required fields
    if (!action.windowId) {
      console.warn('[EventStore] Action missing windowId, skipping:', action.type, action.tabId);
      return;
    }

    // When addExpected arrives, remove the preceding rightclick on the same
    // element in the same tab/window (the rightclick was only used to open the
    // context menu for adding the assertion and isn't a real test action).
    if (action.type === 'addExpected' && action.element?.selector) {
      const cutoff = action.timestamp - 2000;
      const beforeCount = this.pendingActions.length;
      this.pendingActions = this.pendingActions.filter(pending => {
        if (pending.type !== 'rightclick') return true;
        if (pending.windowId !== action.windowId) return true;
        if (pending.tabId !== action.tabId) return true;
        if (pending.element?.selector !== action.element?.selector) return true;
        if (pending.timestamp < cutoff) return true;
        return false;
      });
      const removed = beforeCount - this.pendingActions.length;
      if (removed > 0) {
        console.log(`[EventStore] Removed ${removed} rightclick(s) preceding addExpected on ${action.element.selector}`);
      }
    }
    
    this.pendingActions.push(action);
    
    // Flush immediately if batch is full
    if (this.pendingActions.length >= this.config.batchSize) {
      this.flush();
    }
  }

  addActions(actions: RecordedAction[]): void {
    for (const action of actions) {
      this.addAction(action);
    }
  }

  async getActions(request: GetActionsRequest): Promise<GetActionsResponse> {
    await this.ensureInitialized();
    
    const { tabId, sessionId, limit = 100, offset = 0, type } = request;
    
    if (!this.db) {
      return { actions: [], total: 0, hasMore: false };
    }
    
    let whereClause = '1=1';
    const params: (string | number)[] = [];
    
    if (tabId) {
      whereClause += ' AND tab_id = ?';
      params.push(tabId);
    }
    
    if (sessionId) {
      whereClause += ' AND session_id = ?';
      params.push(sessionId);
    }
    
    if (type) {
      whereClause += ' AND action_type = ?';
      params.push(type);
    }
    
    // Get total count
    const countResult = this.db.exec(`SELECT COUNT(*) as count FROM actions WHERE ${whereClause}`, params);
    const total = countResult.length > 0 && countResult[0].values.length > 0 
      ? countResult[0].values[0][0] as number 
      : 0;
    
    // Get actions
    const result = this.db.exec(
      `SELECT payload FROM actions WHERE ${whereClause} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    
    const actions: RecordedAction[] = [];
    if (result.length > 0) {
      for (const row of result[0].values) {
        try {
          actions.push(JSON.parse(row[0] as string) as RecordedAction);
        } catch (e) {
          // Skip invalid JSON
        }
      }
    }
    
    return {
      actions,
      total,
      hasMore: offset + actions.length < total,
    };
  }

  async getActionsByTab(tabId: string, limit = 100): Promise<RecordedAction[]> {
    await this.ensureInitialized();
    
    if (!this.db) return [];
    
    const result = this.db.exec(
      `SELECT payload FROM actions WHERE tab_id = ? ORDER BY timestamp DESC LIMIT ?`,
      [tabId, limit]
    );
    
    const actions: RecordedAction[] = [];
    if (result.length > 0) {
      for (const row of result[0].values) {
        try {
          actions.push(JSON.parse(row[0] as string) as RecordedAction);
        } catch (e) {
          // Skip invalid JSON
        }
      }
    }
    
    return actions;
  }

  async getActionCount(tabId?: string): Promise<number> {
    await this.ensureInitialized();
    
    if (!this.db) return 0;
    
    let query = `SELECT COUNT(*) as count FROM actions`;
    const params: string[] = [];
    
    if (tabId) {
      query += ` WHERE tab_id = ?`;
      params.push(tabId);
    }
    
    const result = this.db.exec(query, params);
    return result.length > 0 && result[0].values.length > 0 
      ? result[0].values[0][0] as number 
      : 0;
  }

  clearActions(tabId?: string): void {
    if (!this.db) return;
    
    if (tabId) {
      this.db.run(`DELETE FROM actions WHERE tab_id = ?`, [tabId]);
    } else {
      this.db.run(`DELETE FROM actions`);
    }
  }

  // ============================================
  // Error Storage
  // ============================================

  addError(error: TabError): void {
    if (!error.sessionId && this.currentSession) {
      error.sessionId = this.currentSession.id;
    }
    
    this.pendingErrors.push(error);
    
    if (this.pendingErrors.length >= this.config.batchSize) {
      this.flush();
    }
  }

  async getErrors(tabId?: string, limit = 100): Promise<TabError[]> {
    await this.ensureInitialized();
    
    if (!this.db) return [];
    
    let query = `SELECT * FROM errors ORDER BY timestamp DESC LIMIT ?`;
    const params: (string | number)[] = [limit];
    
    if (tabId) {
      query = `SELECT * FROM errors WHERE tab_id = ? ORDER BY timestamp DESC LIMIT ?`;
      params.unshift(tabId);
    }
    
    const result = this.db.exec(query, params);
    
    const errors: TabError[] = [];
    if (result.length > 0) {
      const columns = result[0].columns;
      for (const row of result[0].values) {
        const rowObj: Record<string, unknown> = {};
        columns.forEach((col: string, idx: number) => {
          rowObj[col] = row[idx];
        });
        
        errors.push({
          id: rowObj.error_id as string,
          sessionId: rowObj.session_id as string || undefined,
          tabId: rowObj.tab_id as string,
          type: rowObj.error_type as TabError['type'],
          message: rowObj.message as string,
          source: rowObj.source as string,
          timestamp: rowObj.timestamp as number,
          statusCode: rowObj.status_code as number || undefined,
          method: rowObj.method as string || undefined,
          resourceType: rowObj.resource_type as string || undefined,
          synced: rowObj.synced === 1,
        });
      }
    }
    
    return errors;
  }

  clearErrors(tabId?: string): void {
    if (!this.db) return;
    
    if (tabId) {
      this.db.run(`DELETE FROM errors WHERE tab_id = ?`, [tabId]);
    } else {
      this.db.run(`DELETE FROM errors`);
    }
  }

  // ============================================
  // Sync Operations
  // ============================================

  async getUnsyncedActions(limit = 500): Promise<RecordedAction[]> {
    await this.ensureInitialized();
    
    if (!this.db) return [];
    
    const result = this.db.exec(
      `SELECT payload FROM actions WHERE synced = 0 ORDER BY timestamp LIMIT ?`,
      [limit]
    );
    
    const actions: RecordedAction[] = [];
    if (result.length > 0) {
      for (const row of result[0].values) {
        try {
          actions.push(JSON.parse(row[0] as string) as RecordedAction);
        } catch (e) {
          // Skip invalid JSON
        }
      }
    }
    
    return actions;
  }

  markActionsSynced(actionIds: string[]): void {
    if (!this.db || actionIds.length === 0) return;
    
    const placeholders = actionIds.map(() => '?').join(',');
    this.db.run(`UPDATE actions SET synced = 1 WHERE action_id IN (${placeholders})`, actionIds);
  }

  markErrorsSynced(errorIds: string[]): void {
    if (!this.db || errorIds.length === 0) return;
    
    const placeholders = errorIds.map(() => '?').join(',');
    this.db.run(`UPDATE errors SET synced = 1 WHERE error_id IN (${placeholders})`, errorIds);
  }

  getSyncStatus(): { pendingActions: number; pendingErrors: number } {
    if (!this.db) {
      return { pendingActions: 0, pendingErrors: 0 };
    }
    
    const actionsResult = this.db.exec(`SELECT COUNT(*) as count FROM actions WHERE synced = 0`);
    const errorsResult = this.db.exec(`SELECT COUNT(*) as count FROM errors WHERE synced = 0`);
    
    return {
      pendingActions: actionsResult.length > 0 && actionsResult[0].values.length > 0 
        ? actionsResult[0].values[0][0] as number 
        : 0,
      pendingErrors: errorsResult.length > 0 && errorsResult[0].values.length > 0 
        ? errorsResult[0].values[0][0] as number 
        : 0,
    };
  }

  // ============================================
  // Session Stats & Queries
  // ============================================

  async getErrorsBySession(sessionId: string, limit = 100): Promise<TabError[]> {
    await this.ensureInitialized();
    
    if (!this.db) return [];
    
    const result = this.db.exec(
      `SELECT * FROM errors WHERE session_id = ? ORDER BY timestamp DESC LIMIT ?`,
      [sessionId, limit]
    );
    
    const errors: TabError[] = [];
    if (result.length > 0) {
      for (const row of result[0].values) {
        const rowObj: Record<string, unknown> = {};
        result[0].columns.forEach((col, idx) => {
          rowObj[col] = row[idx];
        });
        
        errors.push({
          id: rowObj.error_id as string,
          tabId: rowObj.tab_id as string,
          sessionId: rowObj.session_id as string,
          windowId: rowObj.window_id as string || undefined,
          windowLabel: rowObj.window_label as string || undefined,
          type: rowObj.error_type as 'network' | 'console',
          message: rowObj.message as string,
          source: rowObj.source as string || undefined,
          stackTrace: rowObj.stack_trace as string || undefined,
          timestamp: rowObj.timestamp as number,
          statusCode: rowObj.status_code as number || undefined,
          method: rowObj.method as string || undefined,
          resourceType: rowObj.resource_type as string || undefined,
          synced: rowObj.synced === 1,
        });
      }
    }
    
    return errors;
  }

  async getActionCountBySession(sessionId: string): Promise<number> {
    await this.ensureInitialized();
    
    if (!this.db) return 0;
    
    const result = this.db.exec(
      `SELECT COUNT(*) as count FROM actions WHERE session_id = ?`,
      [sessionId]
    );
    
    if (result.length > 0 && result[0].values.length > 0) {
      return result[0].values[0][0] as number;
    }
    
    return 0;
  }

  async getActionsBySession(sessionId: string, limit = 200): Promise<RecordedAction[]> {
    await this.ensureInitialized();
    
    if (!this.db) return [];
    
    const result = this.db.exec(
      `SELECT payload FROM actions WHERE session_id = ? ORDER BY timestamp DESC LIMIT ?`,
      [sessionId, limit]
    );
    
    const actions: RecordedAction[] = [];
    if (result.length > 0) {
      for (const row of result[0].values) {
        try {
          const action = JSON.parse(row[0] as string) as RecordedAction;
          actions.push(action);
        } catch (e) {
          // Skip invalid JSON
        }
      }
    }
    
    return actions;
  }

  /**
   * Fetch all actions for a session in batches, ordered chronologically.
   * Used by AI generation where we need the full action set without truncation.
   */
  async getAllActionsBySession(sessionId: string, batchSize = 500): Promise<RecordedAction[]> {
    await this.ensureInitialized();
    
    if (!this.db) return [];

    const allActions: RecordedAction[] = [];
    let offset = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const result = this.db.exec(
        `SELECT payload FROM actions WHERE session_id = ? ORDER BY timestamp ASC LIMIT ? OFFSET ?`,
        [sessionId, batchSize, offset]
      );

      if (result.length === 0 || result[0].values.length === 0) break;

      for (const row of result[0].values) {
        try {
          const action = JSON.parse(row[0] as string) as RecordedAction;
          allActions.push(action);
        } catch {
          // Skip invalid JSON
        }
      }

      if (result[0].values.length < batchSize) break;
      offset += batchSize;
    }

    console.log(`[EventStore] Fetched ${allActions.length} actions for session ${sessionId} in ${Math.ceil((offset + batchSize) / batchSize)} batch(es)`);
    return allActions;
  }

  async getErrorCountBySession(sessionId: string): Promise<number> {
    await this.ensureInitialized();
    
    if (!this.db) return 0;
    
    const result = this.db.exec(
      `SELECT COUNT(*) as count FROM errors WHERE session_id = ?`,
      [sessionId]
    );
    
    if (result.length > 0 && result[0].values.length > 0) {
      return result[0].values[0][0] as number;
    }
    
    return 0;
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.ensureInitialized();
    
    if (!this.db) return;
    
    // Delete in order: test_cases, actions, errors, tabs, windows, session
    this.db.run(`DELETE FROM test_cases WHERE session_id = ?`, [sessionId]);
    this.db.run(`DELETE FROM actions WHERE session_id = ?`, [sessionId]);
    this.db.run(`DELETE FROM errors WHERE session_id = ?`, [sessionId]);
    this.db.run(`DELETE FROM session_tabs WHERE session_id = ?`, [sessionId]);
    this.db.run(`DELETE FROM session_windows WHERE session_id = ?`, [sessionId]);
    this.db.run(`DELETE FROM sessions WHERE id = ?`, [sessionId]);
    
    console.log(`[EventStore] Deleted session ${sessionId}`);
    
    // Save changes
    this.saveToDisk();
  }

  // ============================================
  // Test Case Management
  // ============================================

  async addTestCase(testCase: {
    id: string;
    sessionId: string;
    fieldId?: string;
    fieldName?: string;
    fieldSelector?: string;
    category?: string;
    name: string;
    description?: string;
    testValue?: string;
    expectedResult: string;
    priority: string;
    status: string;
    notes?: string;
    playwrightCode?: string;
    prerequisiteSteps?: unknown[];
    testActionStep?: unknown;
    source?: 'auto' | 'manual' | 'ai';
    steps?: string;
    createdAt: number;
    updatedAt: number;
  }): Promise<void> {
    await this.ensureInitialized();
    if (!this.db) return;

    // Serialize steps to JSON
    const prerequisiteStepsJson = testCase.prerequisiteSteps 
      ? JSON.stringify(testCase.prerequisiteSteps) 
      : null;
    const testActionStepJson = testCase.testActionStep 
      ? JSON.stringify(testCase.testActionStep) 
      : null;

    this.db.run(
      `INSERT OR REPLACE INTO test_cases 
       (id, session_id, field_id, field_name, field_selector, category, name, description, test_value, expected_result, priority, status, notes, playwright_code, prerequisite_steps, test_action_step, source, steps, created_at, updated_at, synced)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        testCase.id,
        testCase.sessionId,
        testCase.fieldId || null,
        testCase.fieldName || null,
        testCase.fieldSelector || null,
        testCase.category || null,
        testCase.name,
        testCase.description || null,
        testCase.testValue || null,
        testCase.expectedResult,
        testCase.priority,
        testCase.status,
        testCase.notes || null,
        testCase.playwrightCode || null,
        prerequisiteStepsJson,
        testActionStepJson,
        testCase.source || 'auto',
        testCase.steps || null,
        testCase.createdAt,
        testCase.updatedAt,
      ]
    );
  }

  async getTestCases(sessionId: string): Promise<Array<{
    id: string;
    sessionId: string;
    fieldId?: string;
    fieldName?: string;
    fieldSelector?: string;
    category?: string;
    name: string;
    description?: string;
    testValue?: string;
    expectedResult: string;
    priority: string;
    status: string;
    notes?: string;
    playwrightCode?: string;
    prerequisiteSteps?: unknown[];
    testActionStep?: unknown;
    source: 'auto' | 'manual' | 'ai';
    steps?: string;
    createdAt: number;
    updatedAt: number;
  }>> {
    await this.ensureInitialized();
    if (!this.db) return [];

    const result = this.db.exec(
      `SELECT * FROM test_cases WHERE session_id = ? ORDER BY 
        CASE priority 
          WHEN 'critical' THEN 1 
          WHEN 'high' THEN 2 
          WHEN 'medium' THEN 3 
          WHEN 'low' THEN 4 
        END,
        created_at ASC`,
      [sessionId]
    );

    if (result.length === 0) return [];

    const columns = result[0].columns;
    return result[0].values.map(row => {
      const rowObj: Record<string, unknown> = {};
      columns.forEach((col, idx) => {
        rowObj[col] = row[idx];
      });

      // Parse JSON fields
      let prerequisiteSteps: unknown[] | undefined;
      let testActionStep: unknown | undefined;
      
      try {
        if (rowObj.prerequisite_steps && typeof rowObj.prerequisite_steps === 'string') {
          prerequisiteSteps = JSON.parse(rowObj.prerequisite_steps);
        }
        if (rowObj.test_action_step && typeof rowObj.test_action_step === 'string') {
          testActionStep = JSON.parse(rowObj.test_action_step);
        }
      } catch {
        // Ignore JSON parse errors
      }

      return {
        id: rowObj.id as string,
        sessionId: rowObj.session_id as string,
        fieldId: rowObj.field_id as string | undefined,
        fieldName: rowObj.field_name as string | undefined,
        fieldSelector: rowObj.field_selector as string | undefined,
        category: rowObj.category as string | undefined,
        name: rowObj.name as string,
        description: rowObj.description as string | undefined,
        testValue: rowObj.test_value as string | undefined,
        expectedResult: rowObj.expected_result as string,
        priority: rowObj.priority as string,
        status: rowObj.status as string,
        notes: rowObj.notes as string | undefined,
        playwrightCode: rowObj.playwright_code as string | undefined,
        prerequisiteSteps,
        testActionStep,
        source: (rowObj.source as 'auto' | 'manual' | 'ai') || 'auto',
        steps: rowObj.steps as string | undefined,
        createdAt: rowObj.created_at as number,
        updatedAt: rowObj.updated_at as number,
      };
    });
  }

  async updateTestCaseStatus(
    testCaseId: string, 
    status: string, 
    notes?: string
  ): Promise<boolean> {
    await this.ensureInitialized();
    if (!this.db) return false;

    try {
      if (notes !== undefined) {
        this.db.run(
          `UPDATE test_cases SET status = ?, notes = ?, updated_at = ?, synced = 0 WHERE id = ?`,
          [status, notes, Date.now(), testCaseId]
        );
      } else {
        this.db.run(
          `UPDATE test_cases SET status = ?, updated_at = ?, synced = 0 WHERE id = ?`,
          [status, Date.now(), testCaseId]
        );
      }
      this.saveToDisk();
      return true;
    } catch (error) {
      console.error('[EventStore] Failed to update test case status:', error);
      return false;
    }
  }

  async updateTestCase(
    testCaseId: string,
    updates: {
      name?: string;
      description?: string;
      steps?: string;
      expectedResult?: string;
      priority?: string;
      status?: string;
      notes?: string;
    }
  ): Promise<boolean> {
    await this.ensureInitialized();
    if (!this.db) return false;

    try {
      const setClauses: string[] = [];
      const values: (string | number | null)[] = [];

      if (updates.name !== undefined) {
        setClauses.push('name = ?');
        values.push(updates.name);
      }
      if (updates.description !== undefined) {
        setClauses.push('description = ?');
        values.push(updates.description);
      }
      if (updates.steps !== undefined) {
        setClauses.push('steps = ?');
        values.push(updates.steps);
      }
      if (updates.expectedResult !== undefined) {
        setClauses.push('expected_result = ?');
        values.push(updates.expectedResult);
      }
      if (updates.priority !== undefined) {
        setClauses.push('priority = ?');
        values.push(updates.priority);
      }
      if (updates.status !== undefined) {
        setClauses.push('status = ?');
        values.push(updates.status);
      }
      if (updates.notes !== undefined) {
        setClauses.push('notes = ?');
        values.push(updates.notes);
      }

      if (setClauses.length === 0) return true;

      setClauses.push('updated_at = ?');
      values.push(Date.now());
      setClauses.push('synced = 0');
      values.push(testCaseId);

      this.db.run(
        `UPDATE test_cases SET ${setClauses.join(', ')} WHERE id = ?`,
        values
      );
      this.saveToDisk();
      return true;
    } catch (error) {
      console.error('[EventStore] Failed to update test case:', error);
      return false;
    }
  }

  async deleteTestCase(testCaseId: string): Promise<boolean> {
    await this.ensureInitialized();
    if (!this.db) return false;

    try {
      this.db.run(`DELETE FROM test_cases WHERE id = ?`, [testCaseId]);
      this.saveToDisk();
      console.log(`[EventStore] Deleted test case ${testCaseId}`);
      return true;
    } catch (error) {
      console.error('[EventStore] Failed to delete test case:', error);
      return false;
    }
  }

  async getTestCaseStats(sessionId: string): Promise<{
    total: number;
    pending: number;
    passed: number;
    failed: number;
    skipped: number;
    byCritical: number;
    byHigh: number;
    byMedium: number;
    byLow: number;
  }> {
    await this.ensureInitialized();
    if (!this.db) return { 
      total: 0, pending: 0, passed: 0, failed: 0, skipped: 0,
      byCritical: 0, byHigh: 0, byMedium: 0, byLow: 0 
    };

    const totalResult = this.db.exec(
      `SELECT COUNT(*) FROM test_cases WHERE session_id = ?`, [sessionId]
    );
    const pendingResult = this.db.exec(
      `SELECT COUNT(*) FROM test_cases WHERE session_id = ? AND status = 'pending'`, [sessionId]
    );
    const passedResult = this.db.exec(
      `SELECT COUNT(*) FROM test_cases WHERE session_id = ? AND status = 'passed'`, [sessionId]
    );
    const failedResult = this.db.exec(
      `SELECT COUNT(*) FROM test_cases WHERE session_id = ? AND status = 'failed'`, [sessionId]
    );
    const skippedResult = this.db.exec(
      `SELECT COUNT(*) FROM test_cases WHERE session_id = ? AND status = 'skipped'`, [sessionId]
    );
    const criticalResult = this.db.exec(
      `SELECT COUNT(*) FROM test_cases WHERE session_id = ? AND priority = 'critical'`, [sessionId]
    );
    const highResult = this.db.exec(
      `SELECT COUNT(*) FROM test_cases WHERE session_id = ? AND priority = 'high'`, [sessionId]
    );
    const mediumResult = this.db.exec(
      `SELECT COUNT(*) FROM test_cases WHERE session_id = ? AND priority = 'medium'`, [sessionId]
    );
    const lowResult = this.db.exec(
      `SELECT COUNT(*) FROM test_cases WHERE session_id = ? AND priority = 'low'`, [sessionId]
    );

    return {
      total: totalResult[0]?.values[0]?.[0] as number || 0,
      pending: pendingResult[0]?.values[0]?.[0] as number || 0,
      passed: passedResult[0]?.values[0]?.[0] as number || 0,
      failed: failedResult[0]?.values[0]?.[0] as number || 0,
      skipped: skippedResult[0]?.values[0]?.[0] as number || 0,
      byCritical: criticalResult[0]?.values[0]?.[0] as number || 0,
      byHigh: highResult[0]?.values[0]?.[0] as number || 0,
      byMedium: mediumResult[0]?.values[0]?.[0] as number || 0,
      byLow: lowResult[0]?.values[0]?.[0] as number || 0,
    };
  }

  async deleteTestCases(sessionId: string): Promise<void> {
    await this.ensureInitialized();
    if (!this.db) return;

    this.db.run(`DELETE FROM test_cases WHERE session_id = ?`, [sessionId]);
    this.saveToDisk();
    console.log(`[EventStore] Deleted test cases for session ${sessionId}`);
  }

  async hasTestCases(sessionId: string): Promise<boolean> {
    await this.ensureInitialized();
    if (!this.db) return false;

    const result = this.db.exec(
      `SELECT COUNT(*) FROM test_cases WHERE session_id = ?`, [sessionId]
    );
    return (result[0]?.values[0]?.[0] as number || 0) > 0;
  }

  // ============================================
  // Maintenance
  // ============================================

  cleanup(): void {
    if (!this.db) return;
    
    const cutoffTime = Date.now() - this.config.cleanupAgeMs;
    
    this.db.run(`DELETE FROM actions WHERE synced = 1 AND created_at < ?`, [cutoffTime]);
    this.db.run(`DELETE FROM errors WHERE synced = 1 AND created_at < ?`, [cutoffTime]);
    
    console.log(`[EventStore] Cleanup complete`);
  }

  flush(): void {
    if (!this.db) return;
    
    // Flush pending actions
    if (this.pendingActions.length > 0) {
      const actions = this.pendingActions;
      this.pendingActions = [];
      
      for (const action of actions) {
        try {
          this.db.run(
            `INSERT OR REPLACE INTO actions 
             (action_id, session_id, window_id, window_label, tab_id, tab_url, tab_title, action_type, timestamp, element_selector, element_xpath, element_tag, payload, synced, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
            [
              action.id,
              action.sessionId || '',
              action.windowId || '',
              action.windowLabel || '',
              action.tabId,
              action.tabUrl || '',
              action.tabTitle || '',
              action.type,
              action.timestamp,
              action.element?.selector || null,
              action.element?.xpath || null,
              action.element?.tagName || null,
              JSON.stringify(action),
              Date.now(),
            ]
          );
        } catch (error) {
          console.error('[EventStore] Failed to insert action:', error);
        }
      }
      
      console.log(`[EventStore] Flushed ${actions.length} actions to database`);
    }
    
    // Flush pending errors
    if (this.pendingErrors.length > 0) {
      const errors = this.pendingErrors;
      this.pendingErrors = [];
      
      for (const error of errors) {
        try {
          this.db.run(
            `INSERT OR REPLACE INTO errors 
             (error_id, session_id, window_id, window_label, tab_id, error_type, message, source, stack_trace, timestamp, status_code, method, resource_type, synced, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
            [
              error.id,
              error.sessionId || '',
              error.windowId || null,
              error.windowLabel || null,
              error.tabId,
              error.type,
              error.message,
              error.source,
              error.stackTrace || null,
              error.timestamp,
              error.statusCode || null,
              error.method || null,
              error.resourceType || null,
              Date.now(),
            ]
          );
        } catch (err) {
          console.error('[EventStore] Failed to insert error:', err);
        }
      }
      
      console.log(`[EventStore] Flushed ${errors.length} errors to database`);
    }
  }

  // ============================================
  // Helpers
  // ============================================

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  // ============================================
  // Lifecycle
  // ============================================

  // ============================================
  // Sync Queue Methods
  // ============================================

  /**
   * Ensure sync tables exist (called by SyncService)
   */
  async ensureSyncTables(): Promise<void> {
    await this.ensureInitialized();
    // Tables are created in initSchema, this is just a verification
    console.log('[EventStore] Sync tables verified');
  }

  /**
   * Add an item to the sync queue
   */
  async addToSyncQueue(item: {
    sessionId: string;
    type: 'session' | 'actions' | 'errors';
    status: string;
    priority: number;
    createdAt: number;
    attemptCount: number;
  }): Promise<void> {
    await this.ensureInitialized();
    if (!this.db) return;

    // Check if already in queue
    const existing = this.db.exec(
      `SELECT id FROM sync_queue WHERE session_id = ? AND type = ?`,
      [item.sessionId, item.type]
    );

    if (existing.length > 0 && existing[0].values.length > 0) {
      // Update existing
      this.db.run(
        `UPDATE sync_queue SET status = ?, priority = ?, attempt_count = ? WHERE session_id = ? AND type = ?`,
        [item.status, item.priority, item.attemptCount, item.sessionId, item.type]
      );
    } else {
      // Insert new
      this.db.run(
        `INSERT INTO sync_queue (session_id, type, status, priority, created_at, attempt_count) VALUES (?, ?, ?, ?, ?, ?)`,
        [item.sessionId, item.type, item.status, item.priority, item.createdAt, item.attemptCount]
      );
    }

    this.saveToDisk();
  }

  /**
   * Remove a session from the sync queue
   */
  async removeFromSyncQueue(sessionId: string): Promise<void> {
    await this.ensureInitialized();
    if (!this.db) return;

    this.db.run(`DELETE FROM sync_queue WHERE session_id = ?`, [sessionId]);
    this.saveToDisk();
  }

  /**
   * Get sync queue items for a session
   */
  async getSyncQueueForSession(sessionId: string): Promise<Array<{
    id: number;
    sessionId: string;
    type: 'session' | 'actions' | 'errors';
    status: string;
    priority: number;
    createdAt: number;
    lastAttemptAt?: number;
    attemptCount: number;
    error?: string;
  }>> {
    await this.ensureInitialized();
    if (!this.db) return [];

    const result = this.db.exec(
      `SELECT id, session_id, type, status, priority, created_at, last_attempt_at, attempt_count, error 
       FROM sync_queue WHERE session_id = ?`,
      [sessionId]
    );

    if (result.length === 0) return [];

    return result[0].values.map(row => ({
      id: row[0] as number,
      sessionId: row[1] as string,
      type: row[2] as 'session' | 'actions' | 'errors',
      status: row[3] as string,
      priority: row[4] as number,
      createdAt: row[5] as number,
      lastAttemptAt: row[6] as number | undefined,
      attemptCount: row[7] as number,
      error: row[8] as string | undefined,
    }));
  }

  /**
   * Get pending sync items
   */
  async getPendingSyncItems(limit = 50): Promise<Array<{
    id: number;
    sessionId: string;
    type: 'session' | 'actions' | 'errors';
    status: string;
    priority: number;
    createdAt: number;
    attemptCount: number;
  }>> {
    await this.ensureInitialized();
    if (!this.db) return [];

    const result = this.db.exec(
      `SELECT id, session_id, type, status, priority, created_at, attempt_count 
       FROM sync_queue 
       WHERE status = 'pending' 
       ORDER BY priority DESC, created_at ASC 
       LIMIT ?`,
      [limit]
    );

    if (result.length === 0) return [];

    return result[0].values.map(row => ({
      id: row[0] as number,
      sessionId: row[1] as string,
      type: row[2] as 'session' | 'actions' | 'errors',
      status: row[3] as string,
      priority: row[4] as number,
      createdAt: row[5] as number,
      attemptCount: row[6] as number,
    }));
  }

  /**
   * Update sync status for a session
   */
  async updateSyncStatus(
    sessionId: string, 
    status: string, 
    syncedAt?: number,
    error?: string
  ): Promise<void> {
    await this.ensureInitialized();
    if (!this.db) return;

    this.db.run(
      `UPDATE sync_queue 
       SET status = ?, last_attempt_at = ?, attempt_count = attempt_count + 1, error = ?
       WHERE session_id = ?`,
      [status, syncedAt || Date.now(), error || null, sessionId]
    );

    // If synced, also mark actions and errors as synced
    if (status === 'synced') {
      this.db.run(`UPDATE actions SET synced = 1 WHERE session_id = ?`, [sessionId]);
      this.db.run(`UPDATE errors SET synced = 1 WHERE session_id = ?`, [sessionId]);
    }

    this.saveToDisk();
  }

  /**
   * Reset failed sync items to pending
   */
  async resetFailedSyncItems(): Promise<void> {
    await this.ensureInitialized();
    if (!this.db) return;

    this.db.run(`UPDATE sync_queue SET status = 'pending', error = NULL WHERE status = 'failed'`);
    this.saveToDisk();
  }

  /**
   * Get sync stats for a session
   */
  async getSyncStats(sessionId: string): Promise<{
    totalSynced: number;
    pendingActions: number;
    pendingErrors: number;
  }> {
    await this.ensureInitialized();
    if (!this.db) return { totalSynced: 0, pendingActions: 0, pendingErrors: 0 };

    // Count synced items
    const syncedActions = this.db.exec(
      `SELECT COUNT(*) FROM actions WHERE session_id = ? AND synced = 1`,
      [sessionId]
    );
    const syncedErrors = this.db.exec(
      `SELECT COUNT(*) FROM errors WHERE session_id = ? AND synced = 1`,
      [sessionId]
    );

    // Count unsynced items
    const unsyncedActions = this.db.exec(
      `SELECT COUNT(*) FROM actions WHERE session_id = ? AND synced = 0`,
      [sessionId]
    );
    const unsyncedErrors = this.db.exec(
      `SELECT COUNT(*) FROM errors WHERE session_id = ? AND synced = 0`,
      [sessionId]
    );

    return {
      totalSynced: 
        (syncedActions[0]?.values[0]?.[0] as number || 0) + 
        (syncedErrors[0]?.values[0]?.[0] as number || 0),
      pendingActions: unsyncedActions[0]?.values[0]?.[0] as number || 0,
      pendingErrors: unsyncedErrors[0]?.values[0]?.[0] as number || 0,
    };
  }

  // ============================================
  // AI Generation Jobs CRUD
  // ============================================

  /**
   * Create a new AI generation job
   */
  async createAIJob(job: {
    id: string;
    sessionId: string;
    sessionName: string;
    type: 'test-cases' | 'code-new' | 'code-optimize';
    providerId: string;
    model: string;
    options: {
      framework?: string;
      language?: string;
      selectedActionIds: string[];
      existingCode?: string;
    };
  }): Promise<void> {
    await this.ensureInitialized();
    if (!this.db) return;

    this.db.run(
      `INSERT INTO ai_generation_jobs 
       (id, session_id, session_name, type, status, provider_id, model, options, created_at)
       VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
      [
        job.id,
        job.sessionId,
        job.sessionName,
        job.type,
        job.providerId,
        job.model,
        JSON.stringify(job.options),
        Date.now(),
      ]
    );

    this.saveToDisk();
  }

  /**
   * Get a single AI job by ID
   */
  async getAIJob(jobId: string): Promise<AIGenerationJob | null> {
    await this.ensureInitialized();
    if (!this.db) return null;

    const result = this.db.exec(
      `SELECT id, session_id, session_name, type, status, provider_id, model, options, 
              result, error, debug_file_path, prompt_file_path, actions_file_path,
              tokens_used, input_tokens, output_tokens, progress, total_batches, completed_batches,
              created_at, started_at, completed_at
       FROM ai_generation_jobs WHERE id = ?`,
      [jobId]
    );

    if (result.length === 0 || result[0].values.length === 0) return null;

    return this.mapAIJobRow(result[0].values[0]);
  }

  /**
   * Get AI jobs with optional filtering
   */
  async getAIJobs(filters?: {
    sessionId?: string;
    status?: ('pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled')[];
    limit?: number;
  }): Promise<AIGenerationJob[]> {
    await this.ensureInitialized();
    if (!this.db) return [];

    let query = `
      SELECT id, session_id, session_name, type, status, provider_id, model, options, 
             result, error, debug_file_path, prompt_file_path, actions_file_path,
             tokens_used, input_tokens, output_tokens, progress, total_batches, completed_batches,
             created_at, started_at, completed_at
      FROM ai_generation_jobs WHERE 1=1
    `;
    const params: (string | number)[] = [];

    if (filters?.sessionId) {
      query += ` AND session_id = ?`;
      params.push(filters.sessionId);
    }

    if (filters?.status && filters.status.length > 0) {
      query += ` AND status IN (${filters.status.map(() => '?').join(',')})`;
      params.push(...filters.status);
    }

    query += ` ORDER BY created_at DESC`;

    if (filters?.limit) {
      query += ` LIMIT ?`;
      params.push(filters.limit);
    }

    const result = this.db.exec(query, params);
    if (result.length === 0) return [];

    return result[0].values.map(row => this.mapAIJobRow(row));
  }

  /**
   * Get pending or in-progress jobs (for resume on startup)
   */
  async getResumableAIJobs(): Promise<AIGenerationJob[]> {
    return this.getAIJobs({ status: ['pending', 'in_progress'] });
  }

  /**
   * Update AI job status
   */
  async updateAIJobStatus(
    jobId: string,
    status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled',
    data?: {
      result?: string;
      error?: string;
      debugFilePath?: string;
      promptFilePath?: string;
      actionsFilePath?: string;
      tokensUsed?: number;
      inputTokens?: number;
      outputTokens?: number;
    }
  ): Promise<void> {
    await this.ensureInitialized();
    if (!this.db) return;

    const updates: string[] = ['status = ?'];
    const params: (string | number | null)[] = [status];

    if (status === 'in_progress') {
      updates.push('started_at = ?');
      params.push(Date.now());
    }

    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      updates.push('completed_at = ?');
      params.push(Date.now());
    }

    if (data?.result !== undefined) {
      updates.push('result = ?');
      params.push(data.result);
    }

    if (data?.error !== undefined) {
      updates.push('error = ?');
      params.push(data.error);
    }

    if (data?.debugFilePath !== undefined) {
      updates.push('debug_file_path = ?');
      params.push(data.debugFilePath);
    }

    if (data?.promptFilePath !== undefined) {
      updates.push('prompt_file_path = ?');
      params.push(data.promptFilePath);
    }

    if (data?.actionsFilePath !== undefined) {
      updates.push('actions_file_path = ?');
      params.push(data.actionsFilePath);
    }

    if (data?.tokensUsed !== undefined) {
      updates.push('tokens_used = ?');
      params.push(data.tokensUsed);
    }

    if (data?.inputTokens !== undefined) {
      updates.push('input_tokens = ?');
      params.push(data.inputTokens);
    }

    if (data?.outputTokens !== undefined) {
      updates.push('output_tokens = ?');
      params.push(data.outputTokens);
    }

    params.push(jobId);

    this.db.run(
      `UPDATE ai_generation_jobs SET ${updates.join(', ')} WHERE id = ?`,
      params
    );

    this.saveToDisk();
  }

  /**
   * Update AI job progress (for batch processing)
   */
  async updateAIJobProgress(
    jobId: string,
    progress: {
      completedBatches: number;
      totalBatches: number;
      progress: number;
    }
  ): Promise<void> {
    await this.ensureInitialized();
    if (!this.db) return;

    this.db.run(
      `UPDATE ai_generation_jobs 
       SET completed_batches = ?, total_batches = ?, progress = ?
       WHERE id = ?`,
      [progress.completedBatches, progress.totalBatches, progress.progress, jobId]
    );

    this.saveToDisk();
  }

  /**
   * Delete an AI job
   */
  async deleteAIJob(jobId: string): Promise<void> {
    await this.ensureInitialized();
    if (!this.db) return;

    this.db.run(`DELETE FROM ai_generation_jobs WHERE id = ?`, [jobId]);
    this.saveToDisk();
  }

  /**
   * Reset a job for retry (failed or cancelled -> pending)
   */
  async retryAIJob(jobId: string, updates?: {
    providerId?: string;
    model?: string;
  }): Promise<void> {
    await this.ensureInitialized();
    if (!this.db) return;

    const updateParts = [
      'status = ?',
      'error = NULL',
      'result = NULL',
      'progress = 0',
      'completed_batches = 0',
      'started_at = NULL',
      'completed_at = NULL',
    ];
    const params: (string | number | null)[] = ['pending'];

    if (updates?.providerId) {
      updateParts.push('provider_id = ?');
      params.push(updates.providerId);
    }

    if (updates?.model) {
      updateParts.push('model = ?');
      params.push(updates.model);
    }

    params.push(jobId);

    this.db.run(
      `UPDATE ai_generation_jobs SET ${updateParts.join(', ')} WHERE id = ?`,
      params
    );

    this.saveToDisk();
  }

  /**
   * Map database row to AIGenerationJob object
   */
  private mapAIJobRow(row: unknown[]): AIGenerationJob {
    return {
      id: row[0] as string,
      sessionId: row[1] as string,
      sessionName: row[2] as string,
      type: row[3] as 'test-cases' | 'code-new' | 'code-optimize',
      status: row[4] as 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled',
      providerId: row[5] as string,
      model: row[6] as string,
      options: row[7] ? JSON.parse(row[7] as string) : {},
      result: row[8] ? JSON.parse(row[8] as string) : null,
      error: row[9] as string | null,
      debugFilePath: row[10] as string | null,
      promptFilePath: row[11] as string | null,
      actionsFilePath: row[12] as string | null,
      tokensUsed: row[13] as number | null,
      inputTokens: row[14] as number | null,
      outputTokens: row[15] as number | null,
      progress: row[16] as number,
      totalBatches: row[17] as number,
      completedBatches: row[18] as number,
      createdAt: row[19] as number,
      startedAt: row[20] as number | null,
      completedAt: row[21] as number | null,
    };
  }

  close(): void {
    // Flush any pending data
    this.flush();
    
    // Save to disk
    this.saveToDisk();
    
    // Stop timers
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
      this.saveInterval = null;
    }
    
    // Close database
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    
    console.log('[EventStore] Database closed');
  }
}

// Singleton instance
let eventStoreInstance: EventStore | null = null;

export function getEventStore(): EventStore {
  if (!eventStoreInstance) {
    eventStoreInstance = new EventStore();
  }
  return eventStoreInstance;
}

export function closeEventStore(): void {
  if (eventStoreInstance) {
    eventStoreInstance.close();
    eventStoreInstance = null;
  }
}
