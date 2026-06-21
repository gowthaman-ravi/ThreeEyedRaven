/**
 * Dashing - QA Testing Tool
 * Main Process Entry Point
 * 
 * Architecture: Dashboard Window + Session Windows
 */

import { app, BrowserWindow, ipcMain, session, dialog, shell } from 'electron';
import contextMenu from 'electron-context-menu';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { getEventStore, closeEventStore, AIGenerationJob } from './main/eventStore';
import { getAIJobProcessor, CreateJobOptions } from './main/ai/aiJobProcessor';
import { getSessionManager, cleanupSessionManager } from './main/sessionManager';
import { 
  getLicenseManager, 
  initializeLicenseManager,
  Feature,
  LicenseTier,
  TIER_FEATURES,
  TIER_LIMITS,
  FEATURE_INFO,
  getMinimumTierForFeature,
} from './main/licensing';
import {
  getSyncService,
  initializeSyncService,
  cleanupSyncService,
  SyncConfig,
} from './main/sync';
import {
  getPlaywrightGenerator,
  GenerateRequest,
} from './main/codegen';
import {
  RecordedAction,
  TabError,
  GetActionsRequest,
  AddWindowRequest,
  DEFAULT_DASHBOARD_CONFIG,
} from './shared/types';

// Increase max listeners to prevent warnings with multiple webviews
EventEmitter.defaultMaxListeners = 50;

// Webpack entry point constants
declare const DASHBOARD_WINDOW_WEBPACK_ENTRY: string;
declare const DASHBOARD_WINDOW_PRELOAD_WEBPACK_ENTRY: string;
declare const SESSION_WINDOW_WEBPACK_ENTRY: string;
declare const SESSION_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

// Initialize context menu with Chrome-like options
contextMenu({
  showSaveImageAs: true,
  showSaveImage: true,
  showCopyImage: true,
  showCopyImageAddress: true,
  showSaveLinkAs: true,
  showInspectElement: true,
  showLookUpSelection: true,
  showSearchWithGoogle: true,
  showSelectAll: true,
  showCopyLink: true,
  prepend: (defaultActions, parameters, browserWindow) => [
    {
      label: 'Open Link in New Tab',
      visible: parameters.linkURL.length > 0,
      click: () => {
        if (browserWindow && 'webContents' in browserWindow) {
          (browserWindow as BrowserWindow).webContents.send('open-in-new-tab', parameters.linkURL);
        }
      },
    },
    {
      type: 'separator',
      visible: parameters.linkURL.length > 0,
    },
  ],
  append: () => [
    { type: 'separator' },
    {
      label: 'Reload',
      click: (menuItem, browserWindow) => {
        if (browserWindow && 'webContents' in browserWindow) {
          (browserWindow as BrowserWindow).webContents.reload();
        }
      },
    },
  ],
});

let dashboardWindow: BrowserWindow | null = null;

// ============================================
// Dashboard Window
// ============================================

const createDashboardWindow = (): void => {
  const config = DEFAULT_DASHBOARD_CONFIG;
  
  dashboardWindow = new BrowserWindow({
    width: config.width,
    height: config.height,
    minWidth: config.minWidth,
    minHeight: config.minHeight,
    title: 'Dashing - QA Testing Dashboard',
    backgroundColor: '#0a0a0f',
    webPreferences: {
      preload: DASHBOARD_WINDOW_PRELOAD_WEBPACK_ENTRY,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  dashboardWindow.loadURL(DASHBOARD_WINDOW_WEBPACK_ENTRY);
  
  // Register with SessionManager
  const sessionManager = getSessionManager();
  sessionManager.setDashboardWindow(dashboardWindow);
  
  dashboardWindow.on('closed', () => {
    dashboardWindow = null;
  });
};

// ============================================
// Session Window Creation (called by SessionManager)
// ============================================

const createSessionWindow = (sessionId: string, windowId: string, label: string): BrowserWindow => {
  const browserWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: `Dashing - ${label}`,
    backgroundColor: '#0a0a0f',
    webPreferences: {
      preload: SESSION_WINDOW_PRELOAD_WEBPACK_ENTRY,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });

  // Load session window with context parameters
  const sessionUrl = `${SESSION_WINDOW_WEBPACK_ENTRY}?sessionId=${sessionId}&windowId=${windowId}&label=${encodeURIComponent(label)}`;
  browserWindow.loadURL(sessionUrl);

  return browserWindow;
};

// Export for SessionManager to use
export { createSessionWindow };

// ============================================
// Window Control IPC Handlers
// ============================================

ipcMain.on('window-minimize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  win?.minimize();
});

ipcMain.on('window-maximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win?.isMaximized()) {
    win.unmaximize();
  } else {
    win?.maximize();
  }
});

ipcMain.on('window-close', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  win?.close();
});

// ============================================
// Session Management IPC Handlers (for dashboard)
// ============================================

// Session history
ipcMain.handle('session-get-history', async (_event, limit = 50, offset = 0) => {
  const eventStore = getEventStore();
  return eventStore.getSessions({ status: 'ended', limit, offset });
});

// Focus window
ipcMain.handle('session-focus-window', (_event, windowId: string) => {
  const sessionManager = getSessionManager();
  const browserWindow = sessionManager.getBrowserWindow(windowId);
  if (browserWindow && !browserWindow.isDestroyed()) {
    browserWindow.focus();
  }
});

// Add window from session window (prompt for label)
ipcMain.handle('session-add-window-from-session', async (event) => {
  const browserWindow = BrowserWindow.fromWebContents(event.sender);
  if (!browserWindow) return;

  const sessionManager = getSessionManager();
  const context = sessionManager.getWindowByElectronId(browserWindow.id);
  if (!context) return;

  const session = await sessionManager.getSession(context.sessionId);
  if (!session) return;

  const currentWindowCount = session.windows?.length || 0;
  const maxWindows = sessionManager.getMaxWindowsPerSession();
  
  // Check window limit before showing dialog
  if (currentWindowCount >= maxWindows) {
    await dialog.showMessageBox(browserWindow, {
      type: 'warning',
      buttons: ['OK'],
      title: 'Window Limit Reached',
      message: `Maximum of ${maxWindows} windows per session allowed.`,
      detail: 'You can change this limit in Settings on the dashboard.',
    });
    return;
  }

  const windowNumber = currentWindowCount + 1;
  
  const result = await dialog.showMessageBox(browserWindow, {
    type: 'question',
    buttons: ['Cancel', 'Add Window'],
    defaultId: 1,
    title: 'Add New Window',
    message: 'Add a new browser window to this session?',
    detail: `This will create a new window for testing multi-user flows or parallel workflows.`,
    checkboxLabel: 'I understand',
  });

  if (result.response === 1) {
    const request: AddWindowRequest = {
      sessionId: context.sessionId,
      label: `Window ${windowNumber}`,
    };
    await sessionManager.addWindow(request);
  }
});

// Session export
ipcMain.handle('session-export', async (_event, sessionId: string) => {
  const eventStore = getEventStore();
  
  // Get session data
  const session = await eventStore.getSession(sessionId);
  if (!session) {
    return { success: false, error: 'Session not found' };
  }

  // Get actions
  const actionsResponse = await eventStore.getActions({ sessionId, limit: 10000 });
  
  // Get errors
  const errors = await eventStore.getErrors(undefined, 1000);
  const sessionErrors = errors.filter(e => e.sessionId === sessionId);

  const exportData = {
    session,
    actions: actionsResponse.actions,
    errors: sessionErrors,
    exportedAt: new Date().toISOString(),
    version: '1.0',
  };

  // Show save dialog
  const result = await dialog.showSaveDialog({
    title: 'Export Session',
    defaultPath: `dashing-session-${session.name.replace(/\s+/g, '-').toLowerCase()}-${Date.now()}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });

  if (result.filePath) {
    fs.writeFileSync(result.filePath, JSON.stringify(exportData, null, 2));
    return { success: true, path: result.filePath };
  }

  return { success: false, error: 'Export cancelled' };
});

// Session errors
ipcMain.handle('session-get-errors', async (_event, sessionId: string, limit = 100) => {
  const eventStore = getEventStore();
  const errors = await eventStore.getErrorsBySession(sessionId, limit);
  return errors;
});

// Session stats (action and error counts)
ipcMain.handle('session-get-stats', async (_event, sessionId: string) => {
  const eventStore = getEventStore();
  const actionCount = await eventStore.getActionCountBySession(sessionId);
  const errorCount = await eventStore.getErrorCountBySession(sessionId);
  return { actionCount, errorCount };
});

// Session actions
ipcMain.handle('session-get-actions', async (_event, sessionId: string, limit = 200) => {
  const eventStore = getEventStore();
  const actions = await eventStore.getActionsBySession(sessionId, limit);
  return actions;
});

// Delete session
ipcMain.handle('session-delete', async (_event, sessionId: string) => {
  const eventStore = getEventStore();
  await eventStore.deleteSession(sessionId);
  return { success: true };
});

// ============================================
// EventStore IPC Handlers
// ============================================

// Action storage
ipcMain.handle('store-action', (_event, action: RecordedAction) => {
  const eventStore = getEventStore();
  eventStore.addAction(action);
  
  // Notify SessionManager for real-time updates
  const sessionManager = getSessionManager();
  sessionManager.recordAction(action.sessionId, action.windowId, action.tabId, action);
  
  return { success: true };
});

ipcMain.handle('store-actions', (_event, actions: RecordedAction[]) => {
  const eventStore = getEventStore();
  for (const action of actions) {
    eventStore.addAction(action);
  }
  return { success: true };
});

ipcMain.handle('get-actions', async (_event, request: GetActionsRequest) => {
  const eventStore = getEventStore();
  return eventStore.getActions(request);
});

ipcMain.handle('get-actions-by-tab', async (_event, tabId: string, limit?: number) => {
  const eventStore = getEventStore();
  return eventStore.getActionsByTab(tabId, limit);
});

ipcMain.handle('get-action-count', async (_event, tabId?: string) => {
  const eventStore = getEventStore();
  return eventStore.getActionCount(tabId);
});

ipcMain.handle('clear-actions', (_event, tabId?: string) => {
  const eventStore = getEventStore();
  eventStore.clearActions(tabId);
  return { success: true };
});

// Error storage
ipcMain.handle('store-error', (_event, error: TabError) => {
  const eventStore = getEventStore();
  eventStore.addError(error);
  
  // Notify SessionManager for real-time updates
  if (error.sessionId && error.windowId && error.tabId) {
    const sessionManager = getSessionManager();
    sessionManager.recordError(error.sessionId, error.windowId, error.tabId, error);
  }
  
  return { success: true };
});

ipcMain.handle('get-errors', async (_event, tabId?: string, limit?: number) => {
  const eventStore = getEventStore();
  return eventStore.getErrors(tabId, limit);
});

ipcMain.handle('clear-errors', (_event, tabId?: string) => {
  const eventStore = getEventStore();
  eventStore.clearErrors(tabId);
  return { success: true };
});

// Sync status
ipcMain.handle('get-sync-status', () => {
  const eventStore = getEventStore();
  return eventStore.getSyncStatus();
});

// Manual flush
ipcMain.handle('flush-events', () => {
  const eventStore = getEventStore();
  eventStore.flush();
  return { success: true };
});

// ============================================
// Local Tab Management (within session window)
// ============================================

ipcMain.handle('session-add-tab-local', async (event, url?: string) => {
  const browserWindow = BrowserWindow.fromWebContents(event.sender);
  if (!browserWindow) return null;

  const sessionManager = getSessionManager();
  const context = sessionManager.getWindowByElectronId(browserWindow.id);
  if (!context) return null;

  return sessionManager.addTab(context.sessionId, context.windowId, url);
});

ipcMain.handle('session-update-tab-local', async (event, tabId: string, updates: unknown) => {
  const browserWindow = BrowserWindow.fromWebContents(event.sender);
  if (!browserWindow) return;

  const sessionManager = getSessionManager();
  const context = sessionManager.getWindowByElectronId(browserWindow.id);
  if (!context) return;

  await sessionManager.updateTab(context.sessionId, context.windowId, tabId, updates as Record<string, unknown>);
});

ipcMain.handle('session-close-tab-local', async (event, tabId: string) => {
  const browserWindow = BrowserWindow.fromWebContents(event.sender);
  if (!browserWindow) return;

  const sessionManager = getSessionManager();
  const context = sessionManager.getWindowByElectronId(browserWindow.id);
  if (!context) return;

  await sessionManager.closeTab(context.sessionId, context.windowId, tabId);
});

// Note: 'session-get-context' is registered in SessionManager

// ============================================
// Licensing IPC Handlers
// ============================================

// Get current license status
ipcMain.handle('license-get-status', async () => {
  const licenseManager = getLicenseManager();
  return licenseManager.getStatus();
});

// Validate and activate a license key
ipcMain.handle('license-activate', async (_event, licenseKey: string) => {
  const licenseManager = getLicenseManager();
  return licenseManager.validateLicenseKey(licenseKey);
});

// Deactivate current license
ipcMain.handle('license-deactivate', async () => {
  const licenseManager = getLicenseManager();
  licenseManager.deactivateLicense();
  return { success: true };
});

// Check if a specific feature is enabled
ipcMain.handle('license-is-feature-enabled', async (_event, feature: Feature) => {
  const licenseManager = getLicenseManager();
  return licenseManager.isFeatureEnabled(feature);
});

// Get current tier
ipcMain.handle('license-get-tier', async () => {
  const licenseManager = getLicenseManager();
  return licenseManager.getCurrentTier();
});

// Get current limits
ipcMain.handle('license-get-limits', async () => {
  const licenseManager = getLicenseManager();
  return licenseManager.getCurrentLimits();
});

// Get all features with their availability status
ipcMain.handle('license-get-all-features', async () => {
  const licenseManager = getLicenseManager();
  const currentTier = licenseManager.getCurrentTier();
  
  const features = Object.values(Feature).map(feature => ({
    id: feature,
    ...FEATURE_INFO[feature],
    enabled: licenseManager.isFeatureEnabled(feature),
    currentTier,
    requiredTier: getMinimumTierForFeature(feature),
  }));
  
  return features;
});

// Get tier information
ipcMain.handle('license-get-tiers', async () => {
  return {
    tiers: ['free', 'pro', 'enterprise'] as LicenseTier[],
    features: TIER_FEATURES,
    limits: TIER_LIMITS,
  };
});

// ============================================
// Sync IPC Handlers
// ============================================

// Queue a session for sync
ipcMain.handle('sync-queue-session', async (_event, sessionId: string) => {
  const syncService = getSyncService();
  await syncService.queueSession(sessionId);
  return { success: true };
});

// Sync a session immediately
ipcMain.handle('sync-session', async (_event, sessionId: string) => {
  const syncService = getSyncService();
  return syncService.syncSession(sessionId);
});

// Get sync status for a session
ipcMain.handle('sync-get-status', async (_event, sessionId: string) => {
  const syncService = getSyncService();
  return syncService.getSessionSyncStatus(sessionId);
});

// Get pending sync queue
ipcMain.handle('sync-get-pending', async () => {
  const syncService = getSyncService();
  return syncService.getPendingQueue();
});

// Retry failed sync items
ipcMain.handle('sync-retry-failed', async () => {
  const syncService = getSyncService();
  await syncService.retryFailed();
  return { success: true };
});

// Start auto-sync
ipcMain.handle('sync-start-auto', async () => {
  const syncService = getSyncService();
  syncService.startAutoSync();
  return { success: true };
});

// Stop auto-sync
ipcMain.handle('sync-stop-auto', async () => {
  const syncService = getSyncService();
  syncService.stopAutoSync();
  return { success: true };
});

// Get sync configuration
ipcMain.handle('sync-get-config', async () => {
  const syncService = getSyncService();
  return syncService.getConfig();
});

// Update sync configuration
ipcMain.handle('sync-update-config', async (_event, config: Partial<SyncConfig>) => {
  const syncService = getSyncService();
  syncService.updateConfig(config);
  return { success: true };
});

// Remove session from sync queue
ipcMain.handle('sync-dequeue-session', async (_event, sessionId: string) => {
  const syncService = getSyncService();
  await syncService.dequeueSession(sessionId);
  return { success: true };
});

// ============================================
// Code Generation IPC Handlers
// ============================================

// Preview code generation (detect pages)
ipcMain.handle('codegen-preview', async (_event, sessionId: string) => {
  const generator = getPlaywrightGenerator();
  return generator.preview(sessionId);
});

// Generate Playwright code
ipcMain.handle('codegen-generate', async (_event, request: GenerateRequest) => {
  const generator = getPlaywrightGenerator();
  return generator.generate(request);
});

// List generated projects
ipcMain.handle('codegen-list', async () => {
  const generator = getPlaywrightGenerator();
  return generator.listProjects();
});

// Delete generated project
ipcMain.handle('codegen-delete', async (_event, projectPath: string) => {
  const generator = getPlaywrightGenerator();
  const success = await generator.deleteProject(projectPath);
  return { success };
});

// Open generated folder in file explorer
ipcMain.handle('codegen-open-folder', async (_event, projectPath: string) => {
  await shell.openPath(projectPath);
  return { success: true };
});

// Get base output directory
ipcMain.handle('codegen-get-output-dir', async () => {
  const generator = getPlaywrightGenerator();
  return generator.getOutputDir();
});

// ============================================
// Test Case Generation IPC Handlers
// ============================================

import { getTestCaseGenerator } from './main/testgen';

// Generate test cases for a session
ipcMain.handle('testgen-generate', async (_event, sessionId: string) => {
  const licenseManager = getLicenseManager();
  if (!licenseManager.isFeatureEnabled(Feature.TEST_CASE_GENERATION)) {
    return { success: false, error: 'Test case generation requires a Pro or Enterprise license.' };
  }
  
  const generator = getTestCaseGenerator();
  return generator.generateForSession(sessionId);
});

// Get test cases for a session
ipcMain.handle('testgen-get-cases', async (_event, sessionId: string) => {
  const generator = getTestCaseGenerator();
  return generator.getTestCases(sessionId);
});

// Update test case status
ipcMain.handle('testgen-update-status', async (_event, testCaseId: string, status: string, notes?: string) => {
  const generator = getTestCaseGenerator();
  const success = await generator.updateTestCaseStatus(testCaseId, status as 'pending' | 'passed' | 'failed' | 'skipped', notes);
  return { success };
});

// Get test case stats for a session
ipcMain.handle('testgen-get-stats', async (_event, sessionId: string) => {
  const eventStore = getEventStore();
  return eventStore.getTestCaseStats(sessionId);
});

// Check if session has test cases
ipcMain.handle('testgen-has-cases', async (_event, sessionId: string) => {
  const eventStore = getEventStore();
  return eventStore.hasTestCases(sessionId);
});

// Export test cases as Markdown
ipcMain.handle('testgen-export-markdown', async (_event, sessionId: string, sessionName: string) => {
  const generator = getTestCaseGenerator();
  const testCases = await generator.getTestCases(sessionId);
  const markdown = generator.exportAsMarkdown(testCases, sessionName);
  
  // Show save dialog
  const result = await dialog.showSaveDialog({
    title: 'Export Test Cases as Markdown',
    defaultPath: `test-cases-${sessionName.replace(/\s+/g, '-').toLowerCase()}.md`,
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  });
  
  if (result.filePath) {
    fs.writeFileSync(result.filePath, markdown);
    return { success: true, path: result.filePath };
  }
  
  return { success: false, error: 'Export cancelled' };
});

// Export test cases as Playwright
ipcMain.handle('testgen-export-playwright', async (_event, sessionId: string, sessionName: string) => {
  const generator = getTestCaseGenerator();
  const testCases = await generator.getTestCases(sessionId);
  const playwright = generator.exportAsPlaywright(testCases, sessionName);
  
  // Show save dialog
  const result = await dialog.showSaveDialog({
    title: 'Export Test Cases as Playwright',
    defaultPath: `test-cases-${sessionName.replace(/\s+/g, '-').toLowerCase()}.spec.ts`,
    filters: [{ name: 'TypeScript', extensions: ['ts'] }],
  });
  
  if (result.filePath) {
    fs.writeFileSync(result.filePath, playwright);
    return { success: true, path: result.filePath };
  }
  
  return { success: false, error: 'Export cancelled' };
});

// Export test cases as CSV
ipcMain.handle('testgen-export-csv', async (_event, sessionId: string, sessionName: string) => {
  const generator = getTestCaseGenerator();
  const testCases = await generator.getTestCases(sessionId);
  const csv = generator.exportAsCsv(testCases);
  
  // Show save dialog
  const result = await dialog.showSaveDialog({
    title: 'Export Test Cases as CSV',
    defaultPath: `test-cases-${sessionName.replace(/\s+/g, '-').toLowerCase()}.csv`,
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  });
  
  if (result.filePath) {
    fs.writeFileSync(result.filePath, csv);
    return { success: true, path: result.filePath };
  }
  
  return { success: false, error: 'Export cancelled' };
});

// Export test cases as Excel (XLSX)
ipcMain.handle('testgen-export-excel', async (_event, sessionId: string, sessionName: string) => {
  const generator = getTestCaseGenerator();
  const testCases = await generator.getTestCases(sessionId);
  const excelBuffer = await generator.exportAsExcel(testCases, sessionName);
  
  // Show save dialog
  const result = await dialog.showSaveDialog({
    title: 'Export Test Cases as Excel',
    defaultPath: `test-cases-${sessionName.replace(/\s+/g, '-').toLowerCase()}.xlsx`,
    filters: [{ name: 'Excel', extensions: ['xlsx'] }],
  });
  
  if (result.filePath) {
    fs.writeFileSync(result.filePath, Buffer.from(excelBuffer));
    return { success: true, path: result.filePath };
  }
  
  return { success: false, error: 'Export cancelled' };
});

// Delete test cases for a session
ipcMain.handle('testgen-delete', async (_event, sessionId: string) => {
  const eventStore = getEventStore();
  await eventStore.deleteTestCases(sessionId);
  return { success: true };
});

// ============================================
// TC Checklist IPC Handlers
// ============================================

ipcMain.handle('checklist-get-items', async (_event, sessionId: string) => {
  const eventStore = getEventStore();
  const testCases = await eventStore.getTestCases(sessionId);
  
  // Filter to only manual test cases and map to checklist format
  return testCases
    .filter(tc => tc.source === 'manual')
    .map(tc => ({
      id: tc.id,
      sessionId: tc.sessionId,
      source: tc.source,
      name: tc.name,
      description: tc.description,
      steps: tc.steps,
      expectedResult: tc.expectedResult,
      priority: tc.priority as 'critical' | 'high' | 'medium' | 'low',
      status: tc.status as 'pending' | 'passed' | 'failed' | 'skipped',
      createdAt: tc.createdAt,
      updatedAt: tc.updatedAt,
    }));
});

ipcMain.handle('checklist-add-item', async (_event, item: {
  sessionId: string;
  source: 'manual' | 'auto';
  name: string;
  description?: string;
  steps?: string;
  expectedResult: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  status: 'pending' | 'passed' | 'failed' | 'skipped';
}) => {
  const eventStore = getEventStore();
  const id = `tc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const now = Date.now();
  
  await eventStore.addTestCase({
    id,
    sessionId: item.sessionId,
    name: item.name,
    description: item.description,
    steps: item.steps,
    expectedResult: item.expectedResult,
    priority: item.priority,
    status: item.status,
    source: item.source,
    createdAt: now,
    updatedAt: now,
  });
  
  return {
    id,
    sessionId: item.sessionId,
    source: item.source,
    name: item.name,
    description: item.description,
    steps: item.steps,
    expectedResult: item.expectedResult,
    priority: item.priority,
    status: item.status,
    createdAt: now,
    updatedAt: now,
  };
});

ipcMain.handle('checklist-update-item', async (_event, id: string, updates: {
  name?: string;
  description?: string;
  steps?: string;
  expectedResult?: string;
  priority?: string;
  status?: string;
}) => {
  const eventStore = getEventStore();
  return eventStore.updateTestCase(id, updates);
});

ipcMain.handle('checklist-delete-item', async (_event, id: string) => {
  const eventStore = getEventStore();
  return eventStore.deleteTestCase(id);
});

// ============================================
// AI Integration IPC Handlers
// ============================================

import { getAIService, AIProviderId, AIProviderConfig, AIIntegrationSettings } from './main/ai/aiService';

// Get AI settings
ipcMain.handle('ai-get-settings', async () => {
  const aiService = getAIService();
  return aiService.getSettings();
});

// Update AI settings
ipcMain.handle('ai-update-settings', async (_event, settings: Partial<AIIntegrationSettings>) => {
  const aiService = getAIService();
  aiService.updateSettings(settings);
  return { success: true };
});

// Get specific provider
ipcMain.handle('ai-get-provider', async (_event, providerId: AIProviderId) => {
  const aiService = getAIService();
  return aiService.getProvider(providerId) || null;
});

// Update provider configuration
ipcMain.handle('ai-update-provider', async (_event, providerId: AIProviderId, updates: Partial<AIProviderConfig>) => {
  const aiService = getAIService();
  aiService.updateProvider(providerId, updates);
  return { success: true };
});

// Remove provider
ipcMain.handle('ai-remove-provider', async (_event, providerId: AIProviderId) => {
  const aiService = getAIService();
  aiService.removeProvider(providerId);
  return { success: true };
});

// Validate API key
ipcMain.handle('ai-validate-key', async (_event, providerId: AIProviderId, apiKey: string) => {
  const aiService = getAIService();
  return aiService.validateApiKey(providerId, apiKey);
});

// Store API key (encrypted)
ipcMain.handle('ai-store-key', async (_event, providerId: AIProviderId, apiKey: string) => {
  const aiService = getAIService();
  const success = aiService.storeApiKey(providerId, apiKey);
  return { success };
});

// Check if provider has stored key
ipcMain.handle('ai-has-key', async (_event, providerId: AIProviderId) => {
  const aiService = getAIService();
  return aiService.hasApiKey(providerId);
});

// Get available models for a provider
ipcMain.handle('ai-get-models', async (_event, providerId: AIProviderId, forceRefresh = false) => {
  const aiService = getAIService();
  return aiService.getAvailableModels(providerId, forceRefresh);
});

// Reorder providers
ipcMain.handle('ai-reorder-providers', async (_event, orderedIds: AIProviderId[]) => {
  const aiService = getAIService();
  aiService.reorderProviders(orderedIds);
  return { success: true };
});

// ============================================
// AI Generation Handlers
// ============================================

import { getAIGenerator, AIGenerationOptions, AITestCaseResult } from './main/ai/aiGenerator';

// Check if AI is enabled (any provider configured and enabled)
ipcMain.handle('ai-check-enabled', async () => {
  const aiService = getAIService();
  return aiService.getActiveProvider() !== null;
});

// Generate test cases using AI
ipcMain.handle('ai-generate-test-cases', async (_event, options: AIGenerationOptions) => {
  const generator = getAIGenerator();
  return generator.generateTestCases(options);
});

// Generate code using AI
ipcMain.handle('ai-generate-code', async (_event, options: AIGenerationOptions) => {
  const generator = getAIGenerator();
  if (options.type === 'code-optimize') {
    return generator.optimizeCode(options);
  }
  return generator.generateCode(options);
});

// Move AI-generated test cases to regular test cases
ipcMain.handle('ai-move-to-testcases', async (_event, sessionId: string, testCases: AITestCaseResult[]) => {
  const eventStore = getEventStore();
  const now = Date.now();
  
  const addedIds: string[] = [];
  for (const tc of testCases) {
    await eventStore.addTestCase({
      id: tc.id,
      sessionId,
      name: tc.name,
      description: tc.description,
      steps: tc.steps,
      expectedResult: tc.expectedResult,
      priority: tc.priority,
      status: 'pending',
      source: 'ai',
      createdAt: now,
      updatedAt: now,
    });
    addedIds.push(tc.id);
  }
  
  console.log(`[IPC] Moved ${addedIds.length} AI test cases to storage`);
  return { success: true, addedIds };
});

// ============================================
// AI Job Queue Operations
// ============================================

// Create a new AI generation job
ipcMain.handle('ai-job-create', async (_event, options: CreateJobOptions) => {
  try {
    const jobProcessor = getAIJobProcessor();
    const jobId = await jobProcessor.createJob(options);
    return { success: true, jobId };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    };
  }
});

// Get all AI jobs with optional filtering
ipcMain.handle('ai-job-get-all', async (_event, filters?: {
  sessionId?: string;
  status?: AIGenerationJob['status'][];
  limit?: number;
}) => {
  const eventStore = getEventStore();
  return eventStore.getAIJobs(filters);
});

// Get a single AI job by ID
ipcMain.handle('ai-job-get', async (_event, jobId: string) => {
  const eventStore = getEventStore();
  return eventStore.getAIJob(jobId);
});

// Cancel an in-progress job
ipcMain.handle('ai-job-cancel', async (_event, jobId: string) => {
  const jobProcessor = getAIJobProcessor();
  const success = await jobProcessor.cancelJob(jobId);
  return { success };
});

// Retry a failed or cancelled job
ipcMain.handle('ai-job-retry', async (_event, jobId: string, updates?: {
  providerId?: string;
  model?: string;
}) => {
  const jobProcessor = getAIJobProcessor();
  await jobProcessor.retryJob(jobId, updates);
  return { success: true };
});

// Delete an AI job
ipcMain.handle('ai-job-delete', async (_event, jobId: string) => {
  const eventStore = getEventStore();
  await eventStore.deleteAIJob(jobId);
  return { success: true };
});

// Get enabled AI providers for selection
ipcMain.handle('ai-get-enabled-providers', async () => {
  const aiService = getAIService();
  const settings = aiService.getSettings();
  return settings.providers
    .filter(p => p.isEnabled && aiService.hasApiKey(p.id))
    .map(p => ({
      id: p.id,
      name: p.name,
      selectedModel: p.selectedModel,
      cachedModels: p.cachedModels,
    }));
});

// Read debug file for download
ipcMain.handle('ai-read-debug-file', async (_event, filePath: string) => {
  try {
    // Security check: ensure the file is in the ai-debug directory
    const debugDir = path.join(app.getPath('userData'), 'ai-debug');
    const resolvedPath = path.resolve(filePath);
    
    if (!resolvedPath.startsWith(debugDir)) {
      console.error('[IPC] Attempted to read file outside ai-debug directory:', filePath);
      return { success: false, error: 'Invalid file path' };
    }
    
    if (!fs.existsSync(resolvedPath)) {
      return { success: false, error: 'File not found' };
    }
    
    const content = fs.readFileSync(resolvedPath, 'utf-8');
    return { success: true, content };
  } catch (error) {
    console.error('[IPC] Failed to read debug file:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

// ============================================
// App Lifecycle
// ============================================

app.on('ready', async () => {
  // Initialize license manager first
  await initializeLicenseManager();
  
  // Initialize sync service
  const syncService = await initializeSyncService();
  
  // Resume any pending AI jobs
  const jobProcessor = getAIJobProcessor();
  await jobProcessor.resumePendingJobs();
  
  createDashboardWindow();
  
  // Set dashboard window for sync status updates
  if (dashboardWindow) {
    syncService.setDashboardWindow(dashboardWindow);
  }
  
  // Configure the persistent partition for webviews
  const webviewSession = session.fromPartition('persist:session');
  
  // Set a proper user agent
  webviewSession.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  
  // Handle certificate errors (for development)
  webviewSession.setCertificateVerifyProc((request, callback) => {
    callback(0);
  });

  // Note: webRequest listeners for the persistent partition are set up via web-contents-created event
  // to ensure each webview's session is properly monitored
});

// Listen for webContents being created (including webview tags)
// This allows us to set up HTTP error capture for each webview's session
app.on('web-contents-created', (_event, contents) => {
  // Check if this is a webview
  if (contents.getType() === 'webview') {
    // Get the webview's session and set up request monitoring
    const webviewSession = contents.session;
    
    // Track HTTP error responses from this webview
    webviewSession.webRequest.onCompleted({ urls: ['*://*/*'] }, (details) => {
      if (details.statusCode >= 400) {
        // Send to all session windows (the webview could belong to any of them)
        BrowserWindow.getAllWindows().forEach(win => {
          if (win !== dashboardWindow && !win.isDestroyed()) {
            win.webContents.send('http-error', {
              statusCode: details.statusCode,
              url: details.url,
              method: details.method,
              resourceType: details.resourceType,
              timestamp: Date.now(),
            });
          }
        });
      }
    });
    
    // Track network errors from this webview
    webviewSession.webRequest.onErrorOccurred({ urls: ['*://*/*'] }, (details) => {
      BrowserWindow.getAllWindows().forEach(win => {
        if (win !== dashboardWindow && !win.isDestroyed()) {
          win.webContents.send('http-error', {
            statusCode: 0,
            url: details.url,
            method: details.method || 'GET',
            resourceType: details.resourceType,
            error: details.error,
            timestamp: Date.now(),
          });
        }
      });
    });
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  // Cleanup SyncService
  await cleanupSyncService();
  
  // Cleanup SessionManager
  await cleanupSessionManager();
  
  // Close EventStore
  closeEventStore();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createDashboardWindow();
  }
});
