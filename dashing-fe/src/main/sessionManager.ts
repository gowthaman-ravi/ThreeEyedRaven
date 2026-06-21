/**
 * SessionManager - Manages the lifecycle of testing sessions
 * Handles session creation, window management, and state tracking
 */

import { BrowserWindow, ipcMain } from 'electron';
import { EventEmitter } from 'events';
import {
  Session,
  SessionWindow,
  SessionTab,
  SessionStatus,
  SessionEvent,
  CreateSessionRequest,
  AddWindowRequest,
  DEFAULT_SESSION_WINDOW_CONFIG,
} from '../shared/types';
import { getEventStore } from './eventStore';
import { getSyncService } from './sync/syncService';
import { getLicenseManager, Feature } from './licensing';

// Declare webpack constants for session window
declare const SESSION_WINDOW_WEBPACK_ENTRY: string;
declare const SESSION_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

// Session rule types
interface SessionRule {
  id: string;
  event: 'session_start' | 'window_open';
  enabled: boolean;
  windowCount?: number;
  windowUrls?: string[];
  defaultUrl?: string;
}

interface SessionRulesSettings {
  sessionStartRule?: SessionRule;
  windowOpenRule?: SessionRule;
}

export class SessionManager extends EventEmitter {
  // Active sessions (runtime state)
  private activeSessions: Map<string, Session> = new Map();
  
  // Map session window IDs to Electron BrowserWindow instances
  private windowMap: Map<string, BrowserWindow> = new Map();
  
  // Map Electron window IDs to session window IDs
  private electronWindowToSession: Map<number, { sessionId: string; windowId: string }> = new Map();
  
  // Dashboard window reference
  private dashboardWindow: BrowserWindow | null = null;
  
  // Counter for generating unique IDs
  private idCounter = 0;

  constructor() {
    super();
    this.setupIpcHandlers();
  }

  // ============================================
  // Dashboard Management
  // ============================================

  setDashboardWindow(window: BrowserWindow): void {
    this.dashboardWindow = window;
  }

  getDashboardWindow(): BrowserWindow | null {
    return this.dashboardWindow;
  }

  // ============================================
  // Session Lifecycle
  // ============================================

  async createSession(request: CreateSessionRequest): Promise<Session> {
    const session: Session = {
      id: this.generateId('session'),
      name: request.name,
      description: request.description,
      status: 'recording',
      userId: request.userId,
      userName: request.userName,
      testSuite: request.testSuite,
      environment: request.environment,
      tags: request.tags || [],
      startedAt: Date.now(),
      metadata: request.metadata,
      windows: [],
      actionCount: 0,
      errorCount: 0,
    };

    // Store in database
    const eventStore = getEventStore();
    await eventStore.createSession(session);

    // Add to active sessions
    this.activeSessions.set(session.id, session);

    // Emit event
    this.emitSessionEvent({ type: 'session-created', session });

    console.log(`[SessionManager] Session created: ${session.id} - ${session.name}`);
    
    // Apply session start rules (auto-launch windows)
    await this.applySessionStartRule(session.id);
    
    return session;
  }
  
  private async applySessionStartRule(sessionId: string): Promise<void> {
    const rule = this.sessionRules.sessionStartRule;
    if (!rule || !rule.enabled) {
      return;
    }
    
    const windowCount = rule.windowCount || 1;
    const windowUrls = rule.windowUrls || [];
    
    console.log(`[SessionManager] Applying session start rule: launching ${windowCount} window(s)`);
    
    for (let i = 0; i < windowCount; i++) {
      const url = windowUrls[i] || '';
      await this.addWindow({
        sessionId,
        label: `Window ${i + 1}`,
        role: 'main',
      }, true, url); // isAutoLaunched = true
    }
  }

  async updateSessionStatus(sessionId: string, status: SessionStatus): Promise<Session | null> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      console.warn(`[SessionManager] Session not found: ${sessionId}`);
      return null;
    }

    session.status = status;
    if (status === 'ended') {
      session.endedAt = Date.now();
    }

    // Update in database
    const eventStore = getEventStore();
    await eventStore.updateSessionStatus(sessionId, status, session.endedAt);

    // Emit event
    this.emitSessionEvent({ type: 'session-updated', session });

    console.log(`[SessionManager] Session ${sessionId} status updated to: ${status}`);
    return session;
  }

  async endSession(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    // Close all windows for this session
    const windows = session.windows || [];
    for (const window of windows) {
      await this.closeWindow(sessionId, window.id);
    }

    // Update status
    await this.updateSessionStatus(sessionId, 'ended');

    // Remove from active sessions
    this.activeSessions.delete(sessionId);

    // Emit event
    this.emitSessionEvent({ type: 'session-ended', sessionId });

    console.log(`[SessionManager] Session ended: ${sessionId}`);

    // Auto-sync if enabled and licensed
    this.triggerAutoSync(sessionId);
  }

  /**
   * Trigger auto-sync for a completed session
   */
  private async triggerAutoSync(sessionId: string): Promise<void> {
    try {
      const licenseManager = getLicenseManager();
      if (!licenseManager.isFeatureEnabled(Feature.CLOUD_SYNC)) {
        console.log(`[SessionManager] Auto-sync skipped: Cloud sync not licensed`);
        return;
      }

      const syncService = getSyncService();
      const config = syncService.getConfig();

      if (!config.autoSync || !config.apiUrl) {
        console.log(`[SessionManager] Auto-sync skipped: Not configured`);
        return;
      }

      console.log(`[SessionManager] Auto-syncing session: ${sessionId}`);
      const result = await syncService.syncSession(sessionId);

      if (result.success) {
        console.log(`[SessionManager] Auto-sync completed for session: ${sessionId}`);
        this.emitSessionEvent({ type: 'session-synced', sessionId });
      } else {
        console.warn(`[SessionManager] Auto-sync failed for session ${sessionId}: ${result.error}`);
        this.emitSessionEvent({ type: 'session-sync-failed', sessionId, error: result.error || 'Unknown error' });
      }
    } catch (error) {
      console.error(`[SessionManager] Auto-sync error:`, error);
      this.emitSessionEvent({ type: 'session-sync-failed', sessionId, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  getActiveSessions(): Session[] {
    return Array.from(this.activeSessions.values());
  }

  async getSession(sessionId: string): Promise<Session | null> {
    // First check active sessions
    const activeSession = this.activeSessions.get(sessionId);
    if (activeSession) return activeSession;
    
    // Fall back to event store for ended/historical sessions
    const eventStore = getEventStore();
    if (!eventStore) {
      console.warn('[SessionManager] EventStore not initialized, cannot look up historical session');
      return null;
    }
    return eventStore.getSession(sessionId);
  }

  // ============================================
  // Window Management
  // ============================================

  // Configurable limits
  private maxWindowsPerSession = 3;
  
  // Session rules
  private sessionRules: SessionRulesSettings = {};
  
  setMaxWindowsPerSession(limit: number): void {
    this.maxWindowsPerSession = limit;
  }
  
  getMaxWindowsPerSession(): number {
    return this.maxWindowsPerSession;
  }
  
  setSessionRules(rules: SessionRulesSettings): void {
    this.sessionRules = rules;
    console.log('[SessionManager] Session rules updated:', rules);
  }
  
  getSessionRules(): SessionRulesSettings {
    return this.sessionRules;
  }

  async addWindow(request: AddWindowRequest, isAutoLaunched = false, initialUrl?: string): Promise<SessionWindow | null> {
    const session = this.activeSessions.get(request.sessionId);
    if (!session) {
      console.warn(`[SessionManager] Cannot add window - session not found: ${request.sessionId}`);
      return null;
    }

    // Check window limit
    const currentWindowCount = session.windows?.length || 0;
    if (currentWindowCount >= this.maxWindowsPerSession) {
      console.warn(`[SessionManager] Window limit reached: ${currentWindowCount}/${this.maxWindowsPerSession}`);
      return null;
    }

    // Determine the URL to use for this window
    let urlToLoad = initialUrl;
    
    // If not auto-launched (i.e., manually launched), apply window open rule
    if (!isAutoLaunched) {
      const windowRule = this.sessionRules.windowOpenRule;
      if (windowRule && windowRule.enabled && windowRule.defaultUrl) {
        urlToLoad = windowRule.defaultUrl;
        console.log(`[SessionManager] Applying window open rule: ${urlToLoad}`);
      }
    }

    const sessionWindow: SessionWindow = {
      id: this.generateId('window'),
      sessionId: request.sessionId,
      label: request.label,
      role: request.role,
      createdAt: Date.now(),
      tabs: [],
      isActive: true,
      actionCount: 0,
    };

    // Store in database
    const eventStore = getEventStore();
    await eventStore.createSessionWindow(sessionWindow);

    // Create Electron BrowserWindow (but don't load URL yet)
    const browserWindow = this.createBrowserWindow(sessionWindow, false);
    sessionWindow.browserWindowId = browserWindow.id;

    // Update database with browser window ID
    await eventStore.updateSessionWindowBrowserId(sessionWindow.id, browserWindow.id);

    // Track the mapping BEFORE loading URL (so getContext works)
    this.windowMap.set(sessionWindow.id, browserWindow);
    this.electronWindowToSession.set(browserWindow.id, {
      sessionId: request.sessionId,
      windowId: sessionWindow.id,
    });

    // Now load the URL (include initialUrl if provided)
    const baseUrl = SESSION_WINDOW_WEBPACK_ENTRY;
    const separator = baseUrl.includes('?') ? '&' : '?';
    let sessionWindowUrl = `${baseUrl}${separator}sessionId=${sessionWindow.sessionId}&windowId=${sessionWindow.id}&label=${encodeURIComponent(sessionWindow.label)}`;
    
    // Add initialUrl parameter if we have a URL to load
    if (urlToLoad) {
      sessionWindowUrl += `&initialUrl=${encodeURIComponent(urlToLoad)}`;
    }
    
    browserWindow.loadURL(sessionWindowUrl);

    // Add to session
    if (!session.windows) session.windows = [];
    session.windows.push(sessionWindow);

    // Emit event
    this.emitSessionEvent({ type: 'window-added', sessionId: request.sessionId, window: sessionWindow });

    console.log(`[SessionManager] Window added: ${sessionWindow.id} (${sessionWindow.label}) to session ${request.sessionId}${urlToLoad ? ` with URL: ${urlToLoad}` : ''}`);
    return sessionWindow;
  }

  async closeWindow(sessionId: string, windowId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    const browserWindow = this.windowMap.get(windowId);
    if (browserWindow && !browserWindow.isDestroyed()) {
      browserWindow.close();
    }

    // Update database
    const eventStore = getEventStore();
    await eventStore.closeSessionWindow(windowId);

    // Remove from tracking
    this.windowMap.delete(windowId);
    if (browserWindow) {
      this.electronWindowToSession.delete(browserWindow.id);
    }

    // Remove from session
    if (session.windows) {
      session.windows = session.windows.filter(w => w.id !== windowId);
    }

    // Emit event
    this.emitSessionEvent({ type: 'window-closed', sessionId, windowId });

    console.log(`[SessionManager] Window closed: ${windowId}`);
  }

  getWindowByElectronId(electronWindowId: number): { sessionId: string; windowId: string } | undefined {
    return this.electronWindowToSession.get(electronWindowId);
  }

  getBrowserWindow(windowId: string): BrowserWindow | undefined {
    return this.windowMap.get(windowId);
  }

  // ============================================
  // Tab Management
  // ============================================

  async addTab(sessionId: string, windowId: string, url?: string): Promise<SessionTab | null> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return null;

    const sessionWindow = session.windows?.find(w => w.id === windowId);
    if (!sessionWindow) return null;

    const tab: SessionTab = {
      id: this.generateId('tab'),
      windowId,
      sessionId,
      title: 'New Tab',
      url: url || '',
      createdAt: Date.now(),
      isActive: true,
      actionCount: 0,
      errorCount: 0,
    };

    // Store in database
    const eventStore = getEventStore();
    await eventStore.createSessionTab(tab);

    // Add to window
    if (!sessionWindow.tabs) sessionWindow.tabs = [];
    sessionWindow.tabs.push(tab);

    // Emit event
    this.emitSessionEvent({ type: 'tab-added', sessionId, windowId, tab });

    return tab;
  }

  async updateTab(sessionId: string, windowId: string, tabId: string, updates: Partial<SessionTab>): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    const sessionWindow = session.windows?.find(w => w.id === windowId);
    if (!sessionWindow) return;

    const tab = sessionWindow.tabs?.find(t => t.id === tabId);
    if (!tab) return;

    // Update tab
    Object.assign(tab, updates);

    // Update in database
    const eventStore = getEventStore();
    await eventStore.updateSessionTab(tabId, updates);

    // Emit event
    this.emitSessionEvent({ type: 'tab-updated', sessionId, windowId, tab });
  }

  async closeTab(sessionId: string, windowId: string, tabId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    const sessionWindow = session.windows?.find(w => w.id === windowId);
    if (!sessionWindow) return;

    // Update in database
    const eventStore = getEventStore();
    await eventStore.closeSessionTab(tabId);

    // Remove from window
    if (sessionWindow.tabs) {
      sessionWindow.tabs = sessionWindow.tabs.filter(t => t.id !== tabId);
    }

    // Emit event
    this.emitSessionEvent({ type: 'tab-closed', sessionId, windowId, tabId });
  }

  // ============================================
  // Action Recording
  // ============================================

  async recordAction(sessionId: string, windowId: string, tabId: string, actionData: unknown): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session || session.status !== 'recording') return;

    const sessionWindow = session.windows?.find(w => w.id === windowId);
    if (!sessionWindow) return;

    // Increment counts
    session.actionCount = (session.actionCount || 0) + 1;
    sessionWindow.actionCount = (sessionWindow.actionCount || 0) + 1;

    const tab = sessionWindow.tabs?.find(t => t.id === tabId);
    if (tab) {
      tab.actionCount = (tab.actionCount || 0) + 1;
    }

    // Emit event for dashboard update
    this.emitSessionEvent({ 
      type: 'action-recorded', 
      sessionId, 
      actionCount: session.actionCount 
    });
  }

  async recordError(sessionId: string, windowId: string, tabId: string, errorData: unknown): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    const sessionWindow = session.windows?.find(w => w.id === windowId);
    
    // Increment counts
    session.errorCount = (session.errorCount || 0) + 1;
    if (sessionWindow) {
      sessionWindow.errorCount = (sessionWindow.errorCount || 0) + 1;
    }

    // Emit event for dashboard update
    this.emitSessionEvent({ 
      type: 'error-recorded', 
      sessionId, 
      errorCount: session.errorCount 
    });
  }

  // ============================================
  // Private Helpers
  // ============================================

  private createBrowserWindow(sessionWindow: SessionWindow, loadUrl = true): BrowserWindow {
    const config = DEFAULT_SESSION_WINDOW_CONFIG;
    
    // Get session name for window title
    const session = this.activeSessions.get(sessionWindow.sessionId);
    const sessionName = session?.name || 'Session';
    
    const browserWindow = new BrowserWindow({
      width: config.width,
      height: config.height,
      minWidth: config.minWidth,
      minHeight: config.minHeight,
      title: `${sessionName} - ${sessionWindow.label}`,
      backgroundColor: '#0a0a0f',
      webPreferences: {
        preload: SESSION_WINDOW_PRELOAD_WEBPACK_ENTRY,
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: true,
      },
    });

    // Only load URL if requested (allows mapping to be set first)
    if (loadUrl) {
      const baseUrl = SESSION_WINDOW_WEBPACK_ENTRY;
      const separator = baseUrl.includes('?') ? '&' : '?';
      const sessionWindowUrl = `${baseUrl}${separator}sessionId=${sessionWindow.sessionId}&windowId=${sessionWindow.id}&label=${encodeURIComponent(sessionWindow.label)}`;
      browserWindow.loadURL(sessionWindowUrl);
    }

    // Handle window close
    browserWindow.on('closed', () => {
      this.handleWindowClosed(sessionWindow.sessionId, sessionWindow.id);
    });

    // Handle window focus
    browserWindow.on('focus', () => {
      this.emitSessionEvent({ 
        type: 'window-focused', 
        sessionId: sessionWindow.sessionId, 
        windowId: sessionWindow.id 
      });
    });

    return browserWindow;
  }

  private handleWindowClosed(sessionId: string, windowId: string): void {
    // Remove from tracking
    this.windowMap.delete(windowId);
    
    const session = this.activeSessions.get(sessionId);
    if (session && session.windows) {
      const window = session.windows.find(w => w.id === windowId);
      if (window && window.browserWindowId) {
        this.electronWindowToSession.delete(window.browserWindowId);
      }
      session.windows = session.windows.filter(w => w.id !== windowId);
      
      // If no more windows, check if we should end the session
      if (session.windows.length === 0 && session.status === 'recording') {
        console.log(`[SessionManager] All windows closed for session ${sessionId}`);
        // Don't auto-end - let user decide
      }
    }

    // Emit event
    this.emitSessionEvent({ type: 'window-closed', sessionId, windowId });
  }

  private generateId(prefix: string): string {
    this.idCounter++;
    return `${prefix}-${Date.now()}-${this.idCounter}`;
  }

  private emitSessionEvent(event: SessionEvent): void {
    this.emit('session-event', event);
    
    // Also send to dashboard if available
    if (this.dashboardWindow && !this.dashboardWindow.isDestroyed()) {
      this.dashboardWindow.webContents.send('session-event', event);
    }
  }

  // ============================================
  // IPC Handlers
  // ============================================

  private setupIpcHandlers(): void {
    // Create session
    ipcMain.handle('session-create', async (_event, request: CreateSessionRequest) => {
      return this.createSession(request);
    });

    // Get active sessions
    ipcMain.handle('session-get-active', () => {
      return this.getActiveSessions();
    });

    // Get single session
    ipcMain.handle('session-get', async (_event, sessionId: string) => {
      return this.getSession(sessionId);
    });

    // Update session status
    ipcMain.handle('session-update-status', async (_event, sessionId: string, status: SessionStatus) => {
      return this.updateSessionStatus(sessionId, status);
    });

    // End session
    ipcMain.handle('session-end', async (_event, sessionId: string) => {
      await this.endSession(sessionId);
      return { success: true };
    });

    // Add window to session
    ipcMain.handle('session-add-window', async (_event, request: AddWindowRequest) => {
      return this.addWindow(request);
    });

    // Close window
    ipcMain.handle('session-close-window', async (_event, sessionId: string, windowId: string) => {
      await this.closeWindow(sessionId, windowId);
      return { success: true };
    });

    // Add tab
    ipcMain.handle('session-add-tab', async (_event, sessionId: string, windowId: string, url?: string) => {
      return this.addTab(sessionId, windowId, url);
    });

    // Update tab
    ipcMain.handle('session-update-tab', async (_event, sessionId: string, windowId: string, tabId: string, updates: Partial<SessionTab>) => {
      await this.updateTab(sessionId, windowId, tabId, updates);
      return { success: true };
    });

    // Close tab
    ipcMain.handle('session-close-tab', async (_event, sessionId: string, windowId: string, tabId: string) => {
      await this.closeTab(sessionId, windowId, tabId);
      return { success: true };
    });

    // Get session context for a window (called by session window renderer)
    ipcMain.handle('session-get-context', (_event) => {
      const webContents = _event.sender;
      const browserWindow = BrowserWindow.fromWebContents(webContents);
      if (!browserWindow) {
        console.log('[SessionManager] session-get-context: No browserWindow');
        return null;
      }

      const context = this.electronWindowToSession.get(browserWindow.id);
      if (!context) {
        console.log(`[SessionManager] session-get-context: No context for browserWindow ${browserWindow.id}`);
        return null;
      }

      const session = this.activeSessions.get(context.sessionId);
      if (!session) {
        console.log(`[SessionManager] session-get-context: No session for ${context.sessionId}`);
        return null;
      }

      const window = session.windows?.find(w => w.id === context.windowId);
      
      // Return in the format expected by the renderer
      return {
        sessionId: context.sessionId,
        sessionName: session.name,
        windowId: context.windowId,
        windowLabel: window?.label || 'Unknown',
      };
    });

    // Settings handlers
    ipcMain.handle('settings-set-max-windows', (_event, limit: number) => {
      this.setMaxWindowsPerSession(limit);
      return { success: true };
    });

    ipcMain.handle('settings-get-max-windows', () => {
      return this.getMaxWindowsPerSession();
    });
    
    ipcMain.handle('settings-set-session-rules', (_event, rules: SessionRulesSettings) => {
      this.setSessionRules(rules);
      return { success: true };
    });
    
    ipcMain.handle('settings-get-session-rules', () => {
      return this.getSessionRules();
    });
  }

  // ============================================
  // Cleanup
  // ============================================

  async cleanup(): Promise<void> {
    // End all active sessions
    for (const sessionId of this.activeSessions.keys()) {
      await this.endSession(sessionId);
    }

    // Clear all mappings
    this.windowMap.clear();
    this.electronWindowToSession.clear();
    this.activeSessions.clear();
  }
}

// Singleton instance
let sessionManagerInstance: SessionManager | null = null;

export function getSessionManager(): SessionManager {
  if (!sessionManagerInstance) {
    sessionManagerInstance = new SessionManager();
  }
  return sessionManagerInstance;
}

export function cleanupSessionManager(): void {
  if (sessionManagerInstance) {
    sessionManagerInstance.cleanup();
    sessionManagerInstance = null;
  }
}

