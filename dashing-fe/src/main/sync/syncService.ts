/**
 * Sync Service for ThreeEyedRaven
 * 
 * Handles syncing session data to a remote backend server.
 * Features:
 * - Queue-based upload with persistence
 * - Batch uploads with configurable batch size
 * - Automatic retry with exponential backoff
 * - Offline queue that survives app restarts
 * - Selective sync (user chooses which sessions to sync)
 */

import { BrowserWindow, app } from 'electron';
import { getEventStore } from '../eventStore';
import { getLicenseManager, Feature } from '../licensing';
import { Session, RecordedAction, TabError } from '../../shared/types';
import * as fs from 'fs';
import * as path from 'path';

// Sync status for a session
export type SyncStatus = 'pending' | 'syncing' | 'synced' | 'failed' | 'not_synced';

// Sync queue item
export interface SyncQueueItem {
  id: number;
  sessionId: string;
  type: 'session' | 'actions' | 'errors';
  status: SyncStatus;
  priority: number;
  createdAt: number;
  lastAttemptAt?: number;
  attemptCount: number;
  error?: string;
  payload?: unknown;
}

// Sync result from backend
export interface SyncResult {
  success: boolean;
  syncedAt?: number;
  error?: string;
  serverSessionId?: string;
}

// Session sync status summary
export interface SessionSyncStatus {
  sessionId: string;
  status: SyncStatus;
  lastSyncedAt?: number;
  pendingActions: number;
  pendingErrors: number;
  totalSynced: number;
  error?: string;
}

// Sync configuration
export interface SyncConfig {
  apiUrl: string;
  apiKey?: string;
  batchSize: number;
  maxRetries: number;
  retryDelayMs: number;
  autoSync: boolean;
  syncIntervalMs: number;
}

// Default configuration
const DEFAULT_SYNC_CONFIG: SyncConfig = {
  apiUrl: process.env.DASHING_SYNC_API_URL || 'https://api.dashing.dev/v1/sync',
  batchSize: 50,
  maxRetries: 3,
  retryDelayMs: 5000,
  autoSync: false,
  syncIntervalMs: 60000, // 1 minute
};

class SyncService {
  private config: SyncConfig;
  private isRunning = false;
  private syncInterval: NodeJS.Timeout | null = null;
  private dashboardWindow: BrowserWindow | null = null;
  private initialized = false;
  private configPath: string | null = null;
  private configLoaded = false;

  constructor(config: Partial<SyncConfig> = {}) {
    // Start with default config - will load from disk in initialize()
    this.config = { ...DEFAULT_SYNC_CONFIG, ...config };
  }

  /**
   * Get config file path (deferred until app is ready)
   */
  private getConfigPath(): string {
    if (!this.configPath) {
      this.configPath = path.join(app.getPath('userData'), 'sync-config.json');
    }
    return this.configPath;
  }

  /**
   * Load config from disk
   */
  private loadConfigFromDisk(): Partial<SyncConfig> {
    try {
      const configPath = this.getConfigPath();
      if (fs.existsSync(configPath)) {
        const data = fs.readFileSync(configPath, 'utf-8');
        const parsed = JSON.parse(data);
        console.log('[SyncService] Loaded config from disk:', configPath);
        return parsed;
      }
    } catch (error) {
      console.error('[SyncService] Failed to load config from disk:', error);
    }
    return {};
  }

  /**
   * Save config to disk
   */
  private saveConfigToDisk(): void {
    try {
      const configPath = this.getConfigPath();
      // Only save user-configurable fields (not defaults that might change)
      const configToSave = {
        apiUrl: this.config.apiUrl,
        apiKey: this.config.apiKey,
        autoSync: this.config.autoSync,
        batchSize: this.config.batchSize,
        syncIntervalMs: this.config.syncIntervalMs,
      };
      fs.writeFileSync(configPath, JSON.stringify(configToSave, null, 2), 'utf-8');
      console.log('[SyncService] Saved config to disk:', configPath);
    } catch (error) {
      console.error('[SyncService] Failed to save config to disk:', error);
    }
  }

  /**
   * Initialize the sync service
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    // Load persisted config from disk (app is now ready)
    if (!this.configLoaded) {
      const persistedConfig = this.loadConfigFromDisk();
      this.config = { ...this.config, ...persistedConfig };
      this.configLoaded = true;
    }
    
    // Ensure sync tables exist in EventStore
    await this.ensureSyncTables();
    
    this.initialized = true;
    console.log('[SyncService] Initialized with config:', {
      apiUrl: this.config.apiUrl,
      autoSync: this.config.autoSync,
      hasApiKey: !!this.config.apiKey,
    });
  }

  /**
   * Set the dashboard window for sending status updates
   */
  setDashboardWindow(window: BrowserWindow): void {
    this.dashboardWindow = window;
  }

  /**
   * Update sync configuration
   */
  updateConfig(config: Partial<SyncConfig>): void {
    this.config = { ...this.config, ...config };
    
    // Persist to disk
    this.saveConfigToDisk();
    
    // Restart auto-sync if interval changed
    if (this.isRunning && config.syncIntervalMs) {
      this.stopAutoSync();
      this.startAutoSync();
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): SyncConfig {
    // Ensure config is loaded from disk if not already
    if (!this.configLoaded && app.isReady()) {
      const persistedConfig = this.loadConfigFromDisk();
      this.config = { ...this.config, ...persistedConfig };
      this.configLoaded = true;
    }
    return { ...this.config };
  }

  /**
   * Start automatic syncing
   */
  startAutoSync(): void {
    if (this.isRunning) return;
    
    // Check if sync is enabled in license
    const licenseManager = getLicenseManager();
    if (!licenseManager.isFeatureEnabled(Feature.CLOUD_SYNC)) {
      console.log('[SyncService] Cloud sync not enabled in license');
      return;
    }
    
    this.isRunning = true;
    console.log(`[SyncService] Starting auto-sync every ${this.config.syncIntervalMs}ms`);
    
    // Process queue immediately
    this.processQueue();
    
    // Then set interval
    this.syncInterval = setInterval(() => {
      this.processQueue();
    }, this.config.syncIntervalMs);
  }

  /**
   * Stop automatic syncing
   */
  stopAutoSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
    this.isRunning = false;
    console.log('[SyncService] Auto-sync stopped');
  }

  /**
   * Queue a session for syncing
   */
  async queueSession(sessionId: string, priority = 1): Promise<void> {
    const eventStore = getEventStore();
    
    // Add session data to queue
    await eventStore.addToSyncQueue({
      sessionId,
      type: 'session',
      status: 'pending',
      priority,
      createdAt: Date.now(),
      attemptCount: 0,
    });
    
    // Also queue actions and errors
    await eventStore.addToSyncQueue({
      sessionId,
      type: 'actions',
      status: 'pending',
      priority,
      createdAt: Date.now(),
      attemptCount: 0,
    });
    
    await eventStore.addToSyncQueue({
      sessionId,
      type: 'errors',
      status: 'pending',
      priority,
      createdAt: Date.now(),
      attemptCount: 0,
    });
    
    console.log(`[SyncService] Session ${sessionId} queued for sync`);
    this.emitStatusUpdate(sessionId);
  }

  /**
   * Remove a session from sync queue
   */
  async dequeueSession(sessionId: string): Promise<void> {
    const eventStore = getEventStore();
    await eventStore.removeFromSyncQueue(sessionId);
    console.log(`[SyncService] Session ${sessionId} removed from sync queue`);
  }

  /**
   * Sync a specific session immediately
   */
  async syncSession(sessionId: string): Promise<SyncResult> {
    // Check license
    const licenseManager = getLicenseManager();
    if (!licenseManager.isFeatureEnabled(Feature.CLOUD_SYNC)) {
      return { success: false, error: 'Cloud sync not enabled in your license' };
    }
    
    try {
      // Queue and process immediately
      await this.queueSession(sessionId, 10); // High priority
      return await this.processSingleSession(sessionId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Get sync status for a session
   */
  async getSessionSyncStatus(sessionId: string): Promise<SessionSyncStatus> {
    const eventStore = getEventStore();
    const queueItems = await eventStore.getSyncQueueForSession(sessionId);
    
    let status: SyncStatus = 'not_synced';
    let lastSyncedAt: number | undefined;
    let pendingActions = 0;
    let pendingErrors = 0;
    let error: string | undefined;
    
    for (const item of queueItems) {
      if (item.type === 'session') {
        status = item.status as SyncStatus;
        lastSyncedAt = item.lastAttemptAt;
        error = item.error;
      } else if (item.type === 'actions' && item.status === 'pending') {
        pendingActions++;
      } else if (item.type === 'errors' && item.status === 'pending') {
        pendingErrors++;
      }
    }
    
    const syncStats = await eventStore.getSyncStats(sessionId);
    
    return {
      sessionId,
      status,
      lastSyncedAt,
      pendingActions,
      pendingErrors,
      totalSynced: syncStats.totalSynced,
      error,
    };
  }

  /**
   * Get all pending sync items
   */
  async getPendingQueue(): Promise<SyncQueueItem[]> {
    const eventStore = getEventStore();
    const items = await eventStore.getPendingSyncItems();
    return items.map(item => ({
      ...item,
      status: item.status as SyncStatus,
    }));
  }

  /**
   * Retry failed sync items
   */
  async retryFailed(): Promise<void> {
    const eventStore = getEventStore();
    await eventStore.resetFailedSyncItems();
    await this.processQueue();
  }

  /**
   * Process the sync queue
   */
  private async processQueue(): Promise<void> {
    const eventStore = getEventStore();
    const pendingItems = await eventStore.getPendingSyncItems(this.config.batchSize);
    
    if (pendingItems.length === 0) {
      return;
    }
    
    console.log(`[SyncService] Processing ${pendingItems.length} sync items`);
    
    // Group by session for batch processing
    const sessionGroups = new Map<string, string[]>();
    for (const item of pendingItems) {
      const group = sessionGroups.get(item.sessionId) || [];
      group.push(item.type);
      sessionGroups.set(item.sessionId, group);
    }
    
    // Process each session
    for (const [sessionId] of sessionGroups) {
      await this.processSingleSession(sessionId);
    }
  }

  /**
   * Process a single session's sync
   */
  private async processSingleSession(sessionId: string): Promise<SyncResult> {
    const eventStore = getEventStore();
    
    try {
      // Mark items as syncing
      await eventStore.updateSyncStatus(sessionId, 'syncing');
      this.emitStatusUpdate(sessionId);
      
      // Get session data
      const session = await eventStore.getSession(sessionId);
      if (!session) {
        throw new Error('Session not found');
      }
      
      // Get actions, errors, and test cases
      const actions = await eventStore.getActionsBySession(sessionId, 10000);
      const errors = await eventStore.getErrorsBySession(sessionId, 1000);
      const testCases = await eventStore.getTestCases(sessionId);
      
      // Prepare payload
      const payload = {
        session,
        actions,
        errors,
        testCases,
        syncedAt: Date.now(),
        clientVersion: process.env.npm_package_version || '1.0.0',
      };
      
      // Send to backend
      const result = await this.sendToBackend(payload);
      
      if (result.success) {
        await eventStore.updateSyncStatus(sessionId, 'synced', result.syncedAt);
        console.log(`[SyncService] Session ${sessionId} synced successfully`);
      } else {
        await eventStore.updateSyncStatus(sessionId, 'failed', undefined, result.error);
        console.error(`[SyncService] Session ${sessionId} sync failed: ${result.error}`);
      }
      
      this.emitStatusUpdate(sessionId);
      return result;
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await eventStore.updateSyncStatus(sessionId, 'failed', undefined, errorMessage);
      this.emitStatusUpdate(sessionId);
      
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Send data to backend with retry
   */
  private async sendToBackend(payload: { 
    session: Session; 
    actions: RecordedAction[]; 
    errors: TabError[];
    testCases?: Array<{
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
    }>;
  }, attempt = 1): Promise<SyncResult> {
    try {
      const baseUrl = this.config.apiUrl.replace(/\/$/, ''); // Remove trailing slash
      const headers = {
        'Content-Type': 'application/json',
        'X-API-Key': this.config.apiKey || '',
      };

      console.log(`[SyncService] Syncing to ${baseUrl} with API key: ${this.config.apiKey ? '***' : 'none'}`);

      // Step 1: Sync session metadata
      const sessionPayload = {
        id: payload.session.id,
        name: payload.session.name,
        status: payload.session.status?.toUpperCase() || 'ACTIVE',
        startTime: payload.session.startedAt, // Use startedAt from Session type
        endTime: payload.session.endedAt, // Use endedAt from Session type
        metadata: payload.session.metadata || {},
        windows: payload.session.windows?.map(w => ({
          id: w.id,
          label: w.label || `Window ${w.id.slice(0, 8)}`,
          status: w.closedAt ? 'CLOSED' : 'OPEN', // Derive status from closedAt
          createdAt: w.createdAt || Date.now(),
          closedAt: w.closedAt,
        })) || [],
      };

      console.log(`[SyncService] Syncing session: ${payload.session.id}`);
      const sessionResponse = await fetch(`${baseUrl}/sessions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(sessionPayload),
      });

      if (!sessionResponse.ok) {
        const errorData = await sessionResponse.json().catch(() => ({}));
        throw new Error(errorData.message || errorData.error || `HTTP ${sessionResponse.status}`);
      }

      // Step 2: Sync actions (if any)
      if (payload.actions && payload.actions.length > 0) {
        console.log(`[SyncService] Syncing ${payload.actions.length} actions`);
        const actionsPayload = payload.actions.map(a => ({
          id: a.id || `action-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          windowId: a.windowId,
          windowLabel: a.windowLabel,
          tabId: a.tabId,
          tabUrl: a.tabUrl,
          tabTitle: a.tabTitle,
          actionType: a.type,
          timestamp: a.timestamp,
          elementSelector: a.element?.selector, // Access via element property
          elementXpath: a.element?.xpath, // Access via element property
          elementTag: a.element?.tagName, // Access via element property
          payload: a.data || {},
        }));

        const actionsResponse = await fetch(`${baseUrl}/sessions/${payload.session.id}/actions`, {
          method: 'POST',
          headers,
          body: JSON.stringify(actionsPayload),
        });

        if (!actionsResponse.ok) {
          console.warn(`[SyncService] Failed to sync actions: ${actionsResponse.status}`);
        }
      }

      // Step 3: Sync errors (if any)
      if (payload.errors && payload.errors.length > 0) {
        console.log(`[SyncService] Syncing ${payload.errors.length} errors`);
        const errorsPayload = payload.errors.map(e => ({
          id: e.id || `error-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          windowId: e.windowId,
          windowLabel: e.windowLabel,
          tabId: e.tabId,
          errorType: e.type,
          message: e.message,
          source: e.source,
          stackTrace: e.stackTrace, // Use correct property name
          timestamp: e.timestamp,
          statusCode: e.statusCode,
          method: e.method,
          resourceType: e.resourceType,
        }));

        const errorsResponse = await fetch(`${baseUrl}/sessions/${payload.session.id}/errors`, {
          method: 'POST',
          headers,
          body: JSON.stringify(errorsPayload),
        });

        if (!errorsResponse.ok) {
          console.warn(`[SyncService] Failed to sync errors: ${errorsResponse.status}`);
        }
      }

      // Step 4: Sync test cases (if any)
      if (payload.testCases && payload.testCases.length > 0) {
        console.log(`[SyncService] Syncing ${payload.testCases.length} test cases`);
        const testCasesPayload = payload.testCases.map(tc => ({
          id: tc.id,
          fieldId: tc.fieldId || undefined,
          fieldName: tc.fieldName || 'Unknown Field',
          fieldSelector: tc.fieldSelector || undefined,
          category: tc.category ? tc.category.toUpperCase() : undefined,
          name: tc.name || 'Unnamed Test',
          description: tc.description || undefined,
          testValue: tc.testValue || undefined,
          expectedResult: tc.expectedResult || undefined,
          priority: (tc.priority || 'medium').toUpperCase(),
          status: (tc.status || 'pending').toUpperCase(),
          notes: tc.notes || undefined,
          playwrightCode: tc.playwrightCode || undefined,
          prerequisiteSteps: tc.prerequisiteSteps || undefined,
          testActionStep: tc.testActionStep || undefined,
          source: (tc.source || 'auto').toUpperCase(),
          steps: tc.steps || undefined,
          createdAt: tc.createdAt,
          updatedAt: tc.updatedAt,
        }));

        const testCasesResponse = await fetch(`${baseUrl}/sessions/${payload.session.id}/test-cases`, {
          method: 'POST',
          headers,
          body: JSON.stringify(testCasesPayload),
        });

        if (!testCasesResponse.ok) {
          const errorBody = await testCasesResponse.json().catch(() => ({}));
          console.warn(`[SyncService] Failed to sync test cases: ${testCasesResponse.status}`, errorBody);
        } else {
          console.log(`[SyncService] Test cases synced successfully`);
        }
      }

      return {
        success: true,
        syncedAt: Date.now(),
        serverSessionId: payload.session.id,
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[SyncService] Sync error:`, errorMessage);

      // Retry with exponential backoff
      if (attempt < this.config.maxRetries) {
        const delay = this.config.retryDelayMs * Math.pow(2, attempt - 1);
        console.log(`[SyncService] Retry ${attempt}/${this.config.maxRetries} in ${delay}ms`);
        await this.sleep(delay);
        return this.sendToBackend(payload, attempt + 1);
      }

      return { success: false, error: errorMessage };
    }
  }

  /**
   * Emit sync status update to dashboard
   */
  private emitStatusUpdate(sessionId: string): void {
    if (this.dashboardWindow && !this.dashboardWindow.isDestroyed()) {
      this.getSessionSyncStatus(sessionId).then(status => {
        this.dashboardWindow!.webContents.send('sync-status-update', status);
      });
    }
  }

  /**
   * Ensure sync tables exist in database
   */
  private async ensureSyncTables(): Promise<void> {
    const eventStore = getEventStore();
    await eventStore.ensureSyncTables();
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Cleanup on shutdown
   */
  async shutdown(): Promise<void> {
    this.stopAutoSync();
    console.log('[SyncService] Shutdown complete');
  }
}

// Singleton instance
let syncServiceInstance: SyncService | null = null;

/**
 * Get or create the SyncService singleton
 */
export function getSyncService(): SyncService {
  if (!syncServiceInstance) {
    syncServiceInstance = new SyncService();
  }
  return syncServiceInstance;
}

/**
 * Initialize the sync service
 */
export async function initializeSyncService(): Promise<SyncService> {
  const service = getSyncService();
  await service.initialize();
  return service;
}

/**
 * Cleanup sync service
 */
export async function cleanupSyncService(): Promise<void> {
  if (syncServiceInstance) {
    await syncServiceInstance.shutdown();
    syncServiceInstance = null;
  }
}

export { SyncService };

