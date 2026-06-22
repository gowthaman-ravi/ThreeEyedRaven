/**
 * Dashboard Window Preload Script
 * Exposes session management APIs to the dashboard renderer
 */

import { contextBridge, ipcRenderer } from 'electron';
import { 
  Session, 
  SessionWindow, 
  SessionEvent, 
  CreateSessionRequest,
  AddWindowRequest,
} from '../shared/types';

contextBridge.exposeInMainWorld('dashboardAPI', {
  // ============================================
  // Session Management
  // ============================================
  
  createSession: async (request: CreateSessionRequest): Promise<Session> => {
    return ipcRenderer.invoke('session-create', request);
  },
  
  getActiveSessions: async (): Promise<Session[]> => {
    return ipcRenderer.invoke('session-get-active');
  },
  
  getSession: async (sessionId: string): Promise<Session | null> => {
    return ipcRenderer.invoke('session-get', sessionId);
  },
  
  updateSessionStatus: async (sessionId: string, status: string): Promise<Session | null> => {
    return ipcRenderer.invoke('session-update-status', sessionId, status);
  },
  
  endSession: async (sessionId: string): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('session-end', sessionId);
  },
  
  // ============================================
  // Window Management
  // ============================================
  
  addWindow: async (sessionId: string, label: string, role?: string): Promise<SessionWindow | null> => {
    const request: AddWindowRequest = { sessionId, label, role };
    return ipcRenderer.invoke('session-add-window', request);
  },
  
  closeWindow: async (sessionId: string, windowId: string): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('session-close-window', sessionId, windowId);
  },
  
  focusWindow: async (windowId: string): Promise<void> => {
    return ipcRenderer.invoke('session-focus-window', windowId);
  },
  
  // ============================================
  // Event Listeners
  // ============================================
  
  onSessionEvent: (callback: (event: SessionEvent) => void): void => {
    ipcRenderer.on('session-event', (_event, data: SessionEvent) => {
      callback(data);
    });
  },
  
  removeSessionEventListener: (): void => {
    ipcRenderer.removeAllListeners('session-event');
  },
  
  // ============================================
  // Session History
  // ============================================
  
  getSessionHistory: async (limit?: number, offset?: number): Promise<{ sessions: Session[]; total: number }> => {
    return ipcRenderer.invoke('session-get-history', limit, offset);
  },
  
  // ============================================
  // Export
  // ============================================
  
  exportSession: async (sessionId: string): Promise<void> => {
    return ipcRenderer.invoke('session-export', sessionId);
  },
  
  // ============================================
  // Errors
  // ============================================
  
  getSessionErrors: async (sessionId: string, limit?: number): Promise<unknown[]> => {
    return ipcRenderer.invoke('session-get-errors', sessionId, limit);
  },
  
  getSessionStats: async (sessionId: string): Promise<{ actionCount: number; errorCount: number }> => {
    return ipcRenderer.invoke('session-get-stats', sessionId);
  },
  
  getSessionActions: async (sessionId: string, limit?: number): Promise<unknown[]> => {
    return ipcRenderer.invoke('session-get-actions', sessionId, limit);
  },
  
  // ============================================
  // Delete
  // ============================================
  
  deleteSession: async (sessionId: string): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('session-delete', sessionId);
  },
  
  // ============================================
  // Settings
  // ============================================
  
  setMaxWindowsPerSession: async (limit: number): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('settings-set-max-windows', limit);
  },
  
  getMaxWindowsPerSession: async (): Promise<number> => {
    return ipcRenderer.invoke('settings-get-max-windows');
  },
  
  setSessionRules: async (rules: {
    sessionStartRule?: {
      id: string;
      event: 'session_start' | 'window_open';
      enabled: boolean;
      windowCount?: number;
      windowUrls?: string[];
      defaultUrl?: string;
    };
    windowOpenRule?: {
      id: string;
      event: 'session_start' | 'window_open';
      enabled: boolean;
      windowCount?: number;
      windowUrls?: string[];
      defaultUrl?: string;
    };
  }): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('settings-set-session-rules', rules);
  },
  
  getSessionRules: async (): Promise<{
    sessionStartRule?: {
      id: string;
      event: 'session_start' | 'window_open';
      enabled: boolean;
      windowCount?: number;
      windowUrls?: string[];
      defaultUrl?: string;
    };
    windowOpenRule?: {
      id: string;
      event: 'session_start' | 'window_open';
      enabled: boolean;
      windowCount?: number;
      windowUrls?: string[];
      defaultUrl?: string;
    };
  }> => {
    return ipcRenderer.invoke('settings-get-session-rules');
  },
  
  // ============================================
  // Licensing
  // ============================================
  
  /**
   * Get current license status
   */
  getLicenseStatus: async (): Promise<{
    isLicensed: boolean;
    tier: 'free' | 'pro' | 'enterprise';
    expiresAt?: number;
    daysUntilExpiry?: number;
    needsRevalidation: boolean;
    isInGracePeriod: boolean;
    email?: string;
    orgName?: string;
  }> => {
    return ipcRenderer.invoke('license-get-status');
  },
  
  /**
   * Activate a license key
   */
  activateLicense: async (licenseKey: string): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('license-activate', licenseKey);
  },
  
  /**
   * Deactivate current license
   */
  deactivateLicense: async (): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('license-deactivate');
  },
  
  /**
   * Check if a specific feature is enabled
   */
  isFeatureEnabled: async (feature: string): Promise<boolean> => {
    return ipcRenderer.invoke('license-is-feature-enabled', feature);
  },
  
  /**
   * Get current tier
   */
  getCurrentTier: async (): Promise<'free' | 'pro' | 'enterprise'> => {
    return ipcRenderer.invoke('license-get-tier');
  },
  
  /**
   * Get current limits based on tier
   */
  getCurrentLimits: async (): Promise<{
    maxActiveSessions: number;
    maxWindowsPerSession: number;
    maxActionsPerSession: number;
    historyRetentionDays: number;
  }> => {
    return ipcRenderer.invoke('license-get-limits');
  },
  
  /**
   * Get all features with their status
   */
  getAllFeatures: async (): Promise<Array<{
    id: string;
    name: string;
    description: string;
    tier: string;
    enabled: boolean;
    currentTier: string;
    requiredTier: string;
  }>> => {
    return ipcRenderer.invoke('license-get-all-features');
  },
  
  /**
   * Get tier information
   */
  getTierInfo: async (): Promise<{
    tiers: string[];
    features: Record<string, string[]>;
    limits: Record<string, {
      maxActiveSessions: number;
      maxWindowsPerSession: number;
      maxActionsPerSession: number;
      historyRetentionDays: number;
    }>;
  }> => {
    return ipcRenderer.invoke('license-get-tiers');
  },
  
  // ============================================
  // Sync
  // ============================================
  
  /**
   * Queue a session for sync
   */
  queueSessionForSync: async (sessionId: string): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('sync-queue-session', sessionId);
  },
  
  /**
   * Sync a session immediately
   */
  syncSession: async (sessionId: string): Promise<{
    success: boolean;
    syncedAt?: number;
    error?: string;
    serverSessionId?: string;
  }> => {
    return ipcRenderer.invoke('sync-session', sessionId);
  },
  
  /**
   * Get sync status for a session
   */
  getSyncStatus: async (sessionId: string): Promise<{
    sessionId: string;
    status: 'pending' | 'syncing' | 'synced' | 'failed' | 'not_synced';
    lastSyncedAt?: number;
    pendingActions: number;
    pendingErrors: number;
    totalSynced: number;
    error?: string;
  }> => {
    return ipcRenderer.invoke('sync-get-status', sessionId);
  },
  
  /**
   * Get pending sync queue
   */
  getPendingSyncQueue: async (): Promise<Array<{
    id: number;
    sessionId: string;
    type: string;
    status: string;
    priority: number;
    createdAt: number;
    attemptCount: number;
  }>> => {
    return ipcRenderer.invoke('sync-get-pending');
  },
  
  /**
   * Retry failed sync items
   */
  retryFailedSync: async (): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('sync-retry-failed');
  },
  
  /**
   * Start auto-sync
   */
  startAutoSync: async (): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('sync-start-auto');
  },
  
  /**
   * Stop auto-sync
   */
  stopAutoSync: async (): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('sync-stop-auto');
  },
  
  /**
   * Get sync configuration
   */
  getSyncConfig: async (): Promise<{
    apiUrl: string;
    apiKey?: string;
    batchSize: number;
    maxRetries: number;
    retryDelayMs: number;
    autoSync: boolean;
    syncIntervalMs: number;
  }> => {
    return ipcRenderer.invoke('sync-get-config');
  },
  
  /**
   * Update sync configuration
   */
  updateSyncConfig: async (config: {
    apiUrl?: string;
    apiKey?: string;
    autoSync?: boolean;
    syncIntervalMs?: number;
  }): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('sync-update-config', config);
  },
  
  /**
   * Remove session from sync queue
   */
  dequeueSession: async (sessionId: string): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('sync-dequeue-session', sessionId);
  },
  
  /**
   * Listen for sync status updates
   */
  onSyncStatusUpdate: (callback: (status: {
    sessionId: string;
    status: string;
    lastSyncedAt?: number;
    pendingActions: number;
    pendingErrors: number;
    totalSynced: number;
    error?: string;
  }) => void): void => {
    ipcRenderer.on('sync-status-update', (_event, status) => {
      callback(status);
    });
  },
  
  /**
   * Remove sync status listener
   */
  removeSyncStatusListener: (): void => {
    ipcRenderer.removeAllListeners('sync-status-update');
  },
  
  // ============================================
  // Code Generation API
  // ============================================
  
  /**
   * Preview code generation (detect pages)
   */
  previewCodegen: async (sessionId: string): Promise<{
    pages: {
      className: string;
      fileName: string;
      url: string;
      actionCount: number;
    }[];
    totalActions: number;
    estimatedFiles: number;
  }> => {
    return ipcRenderer.invoke('codegen-preview', sessionId);
  },
  
  /**
   * Generate Playwright code
   */
  generateCode: async (request: {
    sessionId: string;
    testName: string;
    framework: 'playwright';
    language: 'typescript';
  }): Promise<{
    success: boolean;
    outputPath?: string;
    filesGenerated?: string[];
    pagesDetected?: string[];
    error?: string;
  }> => {
    return ipcRenderer.invoke('codegen-generate', request);
  },
  
  /**
   * List generated projects
   */
  listGeneratedProjects: async (): Promise<{
    name: string;
    folderName: string;
    sessionId: string;
    framework: string;
    language: string;
    createdAt: number;
    pagesCount: number;
    actionsCount: number;
    files: string[];
  }[]> => {
    return ipcRenderer.invoke('codegen-list');
  },
  
  /**
   * Delete generated project
   */
  deleteGeneratedProject: async (projectPath: string): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('codegen-delete', projectPath);
  },
  
  /**
   * Open generated folder in file explorer
   */
  openGeneratedFolder: async (projectPath: string): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('codegen-open-folder', projectPath);
  },
  
  /**
   * Get base output directory
   */
  getCodegenOutputDir: async (): Promise<string> => {
    return ipcRenderer.invoke('codegen-get-output-dir');
  },
  
  // ============================================
  // Test Case Generation API
  // ============================================
  
  /**
   * Generate test cases for a session
   */
  generateTestCases: async (sessionId: string): Promise<{
    success: boolean;
    sessionId: string;
    testCases: Array<{
      id: string;
      sessionId: string;
      fieldId: string;
      fieldName: string;
      fieldSelector: string;
      category: string;
      name: string;
      description: string;
      testValue: string;
      expectedResult: string;
      priority: string;
      status: string;
      notes?: string;
      playwrightCode?: string;
      createdAt: number;
      updatedAt: number;
    }>;
    fieldsAnalyzed: number;
    error?: string;
  }> => {
    return ipcRenderer.invoke('testgen-generate', sessionId);
  },
  
  /**
   * Get test cases for a session
   */
  getTestCases: async (sessionId: string): Promise<Array<{
    id: string;
    sessionId: string;
    fieldId: string;
    fieldName: string;
    fieldSelector: string;
    category: string;
    name: string;
    description: string;
    testValue: string;
    expectedResult: string;
    priority: string;
    status: string;
    notes?: string;
    playwrightCode?: string;
    createdAt: number;
    updatedAt: number;
  }>> => {
    return ipcRenderer.invoke('testgen-get-cases', sessionId);
  },
  
  /**
   * Update test case status
   */
  updateTestCaseStatus: async (
    testCaseId: string, 
    status: 'pending' | 'passed' | 'failed' | 'skipped', 
    notes?: string
  ): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('testgen-update-status', testCaseId, status, notes);
  },
  
  /**
   * Get test case stats for a session
   */
  getTestCaseStats: async (sessionId: string): Promise<{
    total: number;
    pending: number;
    passed: number;
    failed: number;
    skipped: number;
    byCritical: number;
    byHigh: number;
    byMedium: number;
    byLow: number;
  }> => {
    return ipcRenderer.invoke('testgen-get-stats', sessionId);
  },
  
  /**
   * Check if session has test cases
   */
  hasTestCases: async (sessionId: string): Promise<boolean> => {
    return ipcRenderer.invoke('testgen-has-cases', sessionId);
  },
  
  /**
   * Export test cases as Markdown
   */
  exportTestCasesMarkdown: async (sessionId: string, sessionName: string): Promise<{
    success: boolean;
    path?: string;
    error?: string;
  }> => {
    return ipcRenderer.invoke('testgen-export-markdown', sessionId, sessionName);
  },
  
  /**
   * Export test cases as Playwright
   */
  exportTestCasesPlaywright: async (sessionId: string, sessionName: string): Promise<{
    success: boolean;
    path?: string;
    error?: string;
  }> => {
    return ipcRenderer.invoke('testgen-export-playwright', sessionId, sessionName);
  },
  
  /**
   * Export test cases as CSV
   */
  exportTestCasesCsv: async (sessionId: string, sessionName: string): Promise<{
    success: boolean;
    path?: string;
    error?: string;
  }> => {
    return ipcRenderer.invoke('testgen-export-csv', sessionId, sessionName);
  },
  
  /**
   * Export test cases as Excel
   */
  exportTestCasesExcel: async (sessionId: string, sessionName: string): Promise<{
    success: boolean;
    path?: string;
    error?: string;
  }> => {
    return ipcRenderer.invoke('testgen-export-excel', sessionId, sessionName);
  },
  
  /**
   * Delete test cases for a session
   */
  deleteTestCases: async (sessionId: string): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('testgen-delete', sessionId);
  },
  
  // ============================================
  // AI Integration APIs
  // ============================================
  
  /**
   * Get AI integration settings
   */
  getAISettings: async (): Promise<{
    providers: Array<{
      id: string;
      name: string;
      selectedModel: string;
      isEnabled: boolean;
      priority: number;
      lastValidated?: number;
      cachedModels?: Array<{ id: string; name: string; description?: string }>;
      modelsCachedAt?: number;
    }>;
    autoFallback: boolean;
  }> => {
    return ipcRenderer.invoke('ai-get-settings');
  },
  
  /**
   * Update AI integration settings
   */
  updateAISettings: async (settings: {
    autoFallback?: boolean;
  }): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('ai-update-settings', settings);
  },
  
  /**
   * Get a specific AI provider
   */
  getAIProvider: async (providerId: 'openai' | 'anthropic' | 'gemini'): Promise<{
    id: string;
    name: string;
    selectedModel: string;
    isEnabled: boolean;
    priority: number;
    lastValidated?: number;
  } | null> => {
    return ipcRenderer.invoke('ai-get-provider', providerId);
  },
  
  /**
   * Update AI provider configuration
   */
  updateAIProvider: async (providerId: 'openai' | 'anthropic' | 'gemini', updates: {
    selectedModel?: string;
    isEnabled?: boolean;
    priority?: number;
    lastValidated?: number;
  }): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('ai-update-provider', providerId, updates);
  },
  
  /**
   * Remove AI provider configuration
   */
  removeAIProvider: async (providerId: 'openai' | 'anthropic' | 'gemini'): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('ai-remove-provider', providerId);
  },
  
  /**
   * Validate an API key for a provider
   */
  validateAIKey: async (providerId: 'openai' | 'anthropic' | 'gemini', apiKey: string): Promise<{
    valid: boolean;
    error?: string;
  }> => {
    return ipcRenderer.invoke('ai-validate-key', providerId, apiKey);
  },
  
  /**
   * Store API key for a provider (encrypted)
   */
  storeAIKey: async (providerId: 'openai' | 'anthropic' | 'gemini', apiKey: string): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('ai-store-key', providerId, apiKey);
  },
  
  /**
   * Check if provider has stored API key
   */
  hasAIKey: async (providerId: 'openai' | 'anthropic' | 'gemini'): Promise<boolean> => {
    return ipcRenderer.invoke('ai-has-key', providerId);
  },
  
  /**
   * Get available models for a provider
   */
  getAIModels: async (providerId: 'openai' | 'anthropic' | 'gemini', forceRefresh = false): Promise<Array<{
    id: string;
    name: string;
    description?: string;
  }>> => {
    return ipcRenderer.invoke('ai-get-models', providerId, forceRefresh);
  },
  
  /**
   * Reorder AI providers (set priority)
   */
  reorderAIProviders: async (orderedIds: Array<'openai' | 'anthropic' | 'gemini'>): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('ai-reorder-providers', orderedIds);
  },
  
  // ============================================
  // AI Generation APIs
  // ============================================
  
  /**
   * Check if AI is enabled (any provider configured and enabled)
   */
  checkAIEnabled: async (): Promise<boolean> => {
    return ipcRenderer.invoke('ai-check-enabled');
  },
  
  /**
   * Generate test cases using AI
   */
  aiGenerateTestCases: async (options: {
    sessionId: string;
    selectedActionIds: string[];
    type: 'test-cases';
    testName?: string;
  }): Promise<{
    success: boolean;
    type: 'test-cases';
    testCases?: Array<{
      id: string;
      name: string;
      description: string;
      steps: string;
      expectedResult: string;
      priority: 'critical' | 'high' | 'medium' | 'low';
      selected?: boolean;
    }>;
    error?: string;
    tokensUsed?: number;
    maskedCount?: number;
  }> => {
    return ipcRenderer.invoke('ai-generate-test-cases', options);
  },
  
  /**
   * Generate code using AI
   */
  aiGenerateCode: async (options: {
    sessionId: string;
    selectedActionIds: string[];
    type: 'code-new' | 'code-optimize';
    framework?: 'playwright' | 'cypress';
    language?: 'typescript' | 'javascript';
    existingCode?: string;
    testName?: string;
  }): Promise<{
    success: boolean;
    type: 'code-new' | 'code-optimize';
    code?: {
      code: string;
      framework: 'playwright' | 'cypress';
      language: 'typescript' | 'javascript';
      changes?: string[];
    };
    error?: string;
    tokensUsed?: number;
    maskedCount?: number;
  }> => {
    return ipcRenderer.invoke('ai-generate-code', options);
  },
  
  /**
   * Move AI-generated test cases to regular test cases
   */
  aiMoveToTestCases: async (sessionId: string, testCases: Array<{
    id: string;
    name: string;
    description: string;
    steps: string;
    expectedResult: string;
    priority: 'critical' | 'high' | 'medium' | 'low';
  }>): Promise<{ success: boolean; addedIds?: string[] }> => {
    return ipcRenderer.invoke('ai-move-to-testcases', sessionId, testCases);
  },
  
  // ============================================
  // AI Job Queue Operations
  // ============================================
  
  /**
   * Create a new AI generation job
   */
  aiCreateJob: async (options: {
    sessionId: string;
    sessionName: string;
    type: 'test-cases' | 'code-new' | 'code-optimize';
    providerId?: string;
    model?: string;
    framework?: string;
    language?: string;
    selectedActionIds: string[];
    existingCode?: string;
    customInstructions?: string;
  }): Promise<{ success: boolean; jobId?: string; error?: string }> => {
    return ipcRenderer.invoke('ai-job-create', options);
  },
  
  /**
   * Get all AI jobs with optional filtering
   */
  aiGetJobs: async (filters?: {
    sessionId?: string;
    status?: ('pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled')[];
    limit?: number;
  }): Promise<Array<{
    id: string;
    sessionId: string;
    sessionName: string;
    type: 'test-cases' | 'code-new' | 'code-optimize';
    status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
    providerId: string;
    model: string;
    progress: number;
    totalBatches: number;
    completedBatches: number;
    tokensUsed: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
    error: string | null;
    createdAt: number;
    startedAt: number | null;
    completedAt: number | null;
  }>> => {
    return ipcRenderer.invoke('ai-job-get-all', filters);
  },
  
  /**
   * Get a single AI job by ID
   */
  aiGetJob: async (jobId: string): Promise<{
    id: string;
    sessionId: string;
    sessionName: string;
    type: 'test-cases' | 'code-new' | 'code-optimize';
    status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
    providerId: string;
    model: string;
    options: unknown;
    result: unknown | null;
    progress: number;
    totalBatches: number;
    completedBatches: number;
    tokensUsed: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
    error: string | null;
    createdAt: number;
    startedAt: number | null;
    completedAt: number | null;
  } | null> => {
    return ipcRenderer.invoke('ai-job-get', jobId);
  },
  
  /**
   * Cancel an in-progress job
   */
  aiCancelJob: async (jobId: string): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('ai-job-cancel', jobId);
  },
  
  /**
   * Retry a failed or cancelled job
   */
  aiRetryJob: async (jobId: string, updates?: {
    providerId?: string;
    model?: string;
  }): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('ai-job-retry', jobId, updates);
  },
  
  /**
   * Delete an AI job
   */
  aiDeleteJob: async (jobId: string): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('ai-job-delete', jobId);
  },
  
  /**
   * Get enabled AI providers for selection in modal
   */
  aiGetEnabledProviders: async (): Promise<Array<{
    id: string;
    name: string;
    selectedModel: string;
    cachedModels?: Array<{ id: string; name: string; description?: string }>;
  }>> => {
    return ipcRenderer.invoke('ai-get-enabled-providers');
  },
  
  /**
   * Read a debug file for download
   */
  readDebugFile: async (filePath: string): Promise<{ success: boolean; content?: string; error?: string }> => {
    return ipcRenderer.invoke('ai-read-debug-file', filePath);
  },
});

