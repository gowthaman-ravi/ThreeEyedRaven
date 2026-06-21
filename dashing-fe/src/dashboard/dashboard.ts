/**
 * Dashing Dashboard - Session Management Interface
 * Handles session creation, monitoring, and history
 */

import './dashboard.css';
import { 
  Session, 
  SessionWindow, 
  SessionEvent, 
  CreateSessionRequest,
  RecordedAction,
} from '../shared/types';

// Extend window interface for electron API
interface TabError {
  id: string;
  tabId: string;
  sessionId?: string;
  windowId?: string;
  windowLabel?: string;
  type: 'network' | 'console' | 'http';
  message: string;
  source?: string;
  timestamp: number;
  statusCode?: number;
  method?: string;
  resourceType?: string;
}

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

// AI Provider types
type AIProviderId = 'openai' | 'anthropic' | 'gemini';

interface ModelInfo {
  id: string;
  name: string;
  description?: string;
}

interface AIProviderConfig {
  id: AIProviderId;
  name: string;
  selectedModel: string;
  isEnabled: boolean;
  priority: number;
  lastValidated?: number;
  cachedModels?: ModelInfo[];
  modelsCachedAt?: number;
}

interface AIIntegrationSettings {
  providers: AIProviderConfig[];
  autoFallback: boolean;
}

interface AIJob {
  id: string;
  sessionId: string;
  sessionName: string;
  type: 'test-cases' | 'code-new' | 'code-optimize';
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  providerId: string;
  model: string;
  options?: {
    framework?: string;
    language?: string;
    selectedActionIds: string[];
    existingCode?: string;
  };
  result?: unknown;
  progress: number;
  totalBatches: number;
  completedBatches: number;
  tokensUsed: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  error: string | null;
  debugFilePath: string | null;
  promptFilePath: string | null;
  actionsFilePath: string | null;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
}

interface DashboardSettings {
  maxSessions: number;
  maxWindowsPerSession: number;
  sessionRules?: SessionRulesSettings;
  aiIntegrations?: AIIntegrationSettings;
}

interface LicenseStatus {
  isLicensed: boolean;
  tier: 'free' | 'pro' | 'enterprise';
  expiresAt?: number;
  daysUntilExpiry?: number;
  needsRevalidation: boolean;
  isInGracePeriod: boolean;
  email?: string;
  orgName?: string;
}

interface TierLimits {
  maxActiveSessions: number;
  maxWindowsPerSession: number;
  maxActionsPerSession: number;
  historyRetentionDays: number;
}

declare global {
  interface Window {
    dashboardAPI: {
      // Session management
      createSession: (request: CreateSessionRequest) => Promise<Session>;
      getActiveSessions: () => Promise<Session[]>;
      getSession: (sessionId: string) => Promise<Session | null>;
      updateSessionStatus: (sessionId: string, status: string) => Promise<Session | null>;
      endSession: (sessionId: string) => Promise<{ success: boolean }>;
      
      // Window management
      addWindow: (sessionId: string, label: string, role?: string) => Promise<SessionWindow | null>;
      closeWindow: (sessionId: string, windowId: string) => Promise<{ success: boolean }>;
      focusWindow: (windowId: string) => Promise<void>;
      
      // Events
      onSessionEvent: (callback: (event: SessionEvent) => void) => void;
      removeSessionEventListener: () => void;
      
      // History
      getSessionHistory: (limit?: number, offset?: number) => Promise<{ sessions: Session[]; total: number }>;
      
      // Export
      exportSession: (sessionId: string) => Promise<void>;
      
      // Errors and Stats
      getSessionErrors: (sessionId: string, limit?: number) => Promise<TabError[]>;
      getSessionStats: (sessionId: string) => Promise<{ actionCount: number; errorCount: number }>;
      getSessionActions: (sessionId: string, limit?: number) => Promise<RecordedAction[]>;
      
      // Delete
      deleteSession: (sessionId: string) => Promise<{ success: boolean }>;
      
      // Settings
      setMaxWindowsPerSession: (limit: number) => Promise<{ success: boolean }>;
      getMaxWindowsPerSession: () => Promise<number>;
      setSessionRules: (rules: SessionRulesSettings) => Promise<{ success: boolean }>;
      getSessionRules: () => Promise<SessionRulesSettings>;
      
      // Licensing
      getLicenseStatus: () => Promise<LicenseStatus>;
      activateLicense: (licenseKey: string) => Promise<{ success: boolean; error?: string }>;
      deactivateLicense: () => Promise<{ success: boolean }>;
      isFeatureEnabled: (feature: string) => Promise<boolean>;
      getCurrentTier: () => Promise<'free' | 'pro' | 'enterprise'>;
      getCurrentLimits: () => Promise<TierLimits>;
      getAllFeatures: () => Promise<Array<{
        id: string;
        name: string;
        description: string;
        tier: string;
        enabled: boolean;
        currentTier: string;
        requiredTier: string;
      }>>;
      getTierInfo: () => Promise<{
        tiers: string[];
        features: Record<string, string[]>;
        limits: Record<string, TierLimits>;
      }>;
      
      // Sync
      queueSessionForSync: (sessionId: string) => Promise<{ success: boolean }>;
      syncSession: (sessionId: string) => Promise<{
        success: boolean;
        syncedAt?: number;
        error?: string;
        serverSessionId?: string;
      }>;
      getSyncStatus: (sessionId: string) => Promise<{
        sessionId: string;
        status: 'pending' | 'syncing' | 'synced' | 'failed' | 'not_synced';
        lastSyncedAt?: number;
        pendingActions: number;
        pendingErrors: number;
        totalSynced: number;
        error?: string;
      }>;
      getPendingSyncQueue: () => Promise<Array<{
        id: number;
        sessionId: string;
        type: string;
        status: string;
        priority: number;
        createdAt: number;
        attemptCount: number;
      }>>;
      retryFailedSync: () => Promise<{ success: boolean }>;
      startAutoSync: () => Promise<{ success: boolean }>;
      stopAutoSync: () => Promise<{ success: boolean }>;
      getSyncConfig: () => Promise<{
        apiUrl: string;
        apiKey?: string;
        batchSize: number;
        maxRetries: number;
        retryDelayMs: number;
        autoSync: boolean;
        syncIntervalMs: number;
      }>;
      updateSyncConfig: (config: {
        apiUrl?: string;
        apiKey?: string;
        autoSync?: boolean;
        syncIntervalMs?: number;
      }) => Promise<{ success: boolean }>;
      dequeueSession: (sessionId: string) => Promise<{ success: boolean }>;
      onSyncStatusUpdate: (callback: (status: {
        sessionId: string;
        status: string;
        lastSyncedAt?: number;
        pendingActions: number;
        pendingErrors: number;
        totalSynced: number;
        error?: string;
      }) => void) => void;
      removeSyncStatusListener: () => void;
      
      // Code Generation
      previewCodegen: (sessionId: string) => Promise<{
        pages: {
          className: string;
          fileName: string;
          url: string;
          actionCount: number;
        }[];
        totalActions: number;
        estimatedFiles: number;
      }>;
      generateCode: (request: {
        sessionId: string;
        testName: string;
        framework: 'playwright';
        language: 'typescript';
      }) => Promise<{
        success: boolean;
        outputPath?: string;
        filesGenerated?: string[];
        pagesDetected?: string[];
        error?: string;
      }>;
      listGeneratedProjects: () => Promise<{
        name: string;
        folderName: string;
        sessionId: string;
        framework: string;
        language: string;
        createdAt: number;
        pagesCount: number;
        actionsCount: number;
        files: string[];
      }[]>;
      deleteGeneratedProject: (projectPath: string) => Promise<{ success: boolean }>;
      openGeneratedFolder: (projectPath: string) => Promise<{ success: boolean }>;
      getCodegenOutputDir: () => Promise<string>;
      
      // Test Case Generation
      generateTestCases: (sessionId: string) => Promise<{
        success: boolean;
        sessionId: string;
        testCases: TestCase[];
        fieldsAnalyzed: number;
        error?: string;
      }>;
      getTestCases: (sessionId: string) => Promise<TestCase[]>;
      updateTestCaseStatus: (
        testCaseId: string, 
        status: 'pending' | 'passed' | 'failed' | 'skipped', 
        notes?: string
      ) => Promise<{ success: boolean }>;
      getTestCaseStats: (sessionId: string) => Promise<TestCaseStats>;
      hasTestCases: (sessionId: string) => Promise<boolean>;
      exportTestCasesMarkdown: (sessionId: string, sessionName: string) => Promise<{
        success: boolean;
        path?: string;
        error?: string;
      }>;
      exportTestCasesPlaywright: (sessionId: string, sessionName: string) => Promise<{
        success: boolean;
        path?: string;
        error?: string;
      }>;
      exportTestCasesCsv: (sessionId: string, sessionName: string) => Promise<{
        success: boolean;
        path?: string;
        error?: string;
      }>;
      exportTestCasesExcel: (sessionId: string, sessionName: string) => Promise<{
        success: boolean;
        path?: string;
        error?: string;
      }>;
      deleteTestCases: (sessionId: string) => Promise<{ success: boolean }>;
      
      // AI Integration
      getAISettings: () => Promise<AIIntegrationSettings>;
      updateAISettings: (settings: Partial<AIIntegrationSettings>) => Promise<{ success: boolean }>;
      getAIProvider: (providerId: AIProviderId) => Promise<AIProviderConfig | null>;
      updateAIProvider: (providerId: AIProviderId, updates: Partial<AIProviderConfig>) => Promise<{ success: boolean }>;
      removeAIProvider: (providerId: AIProviderId) => Promise<{ success: boolean }>;
      validateAIKey: (providerId: AIProviderId, apiKey: string) => Promise<{ valid: boolean; error?: string }>;
      storeAIKey: (providerId: AIProviderId, apiKey: string) => Promise<{ success: boolean }>;
      hasAIKey: (providerId: AIProviderId) => Promise<boolean>;
      getAIModels: (providerId: AIProviderId, forceRefresh?: boolean) => Promise<ModelInfo[]>;
      reorderAIProviders: (orderedIds: AIProviderId[]) => Promise<{ success: boolean }>;
      
      // AI Generation
      checkAIEnabled: () => Promise<boolean>;
      aiGenerateTestCases: (options: {
        sessionId: string;
        selectedActionIds: string[];
        type: 'test-cases';
        testName?: string;
      }) => Promise<{
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
      }>;
      aiGenerateCode: (options: {
        sessionId: string;
        selectedActionIds: string[];
        type: 'code-new' | 'code-optimize';
        framework?: 'playwright' | 'cypress';
        language?: 'typescript' | 'javascript';
        existingCode?: string;
        testName?: string;
      }) => Promise<{
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
      }>;
      aiMoveToTestCases: (sessionId: string, testCases: Array<{
        id: string;
        name: string;
        description: string;
        steps: string;
        expectedResult: string;
        priority: 'critical' | 'high' | 'medium' | 'low';
      }>) => Promise<{ success: boolean; addedIds?: string[] }>;
      
      // AI Job Queue
      aiCreateJob: (options: {
        sessionId: string;
        sessionName: string;
        type: 'test-cases' | 'code-new' | 'code-optimize';
        providerId?: string;
        model?: string;
        framework?: string;
        language?: string;
        selectedActionIds: string[];
        existingCode?: string;
      }) => Promise<{ success: boolean; jobId?: string; error?: string }>;
      aiGetJobs: (filters?: {
        sessionId?: string;
        status?: ('pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled')[];
        limit?: number;
      }) => Promise<AIJob[]>;
      aiGetJob: (jobId: string) => Promise<AIJob | null>;
      aiCancelJob: (jobId: string) => Promise<{ success: boolean }>;
      aiRetryJob: (jobId: string, updates?: { providerId?: string; model?: string }) => Promise<{ success: boolean }>;
      aiDeleteJob: (jobId: string) => Promise<{ success: boolean }>;
      aiGetEnabledProviders: () => Promise<Array<{
        id: string;
        name: string;
        selectedModel: string;
        cachedModels?: Array<{ id: string; name: string; description?: string }>;
      }>>;
      readDebugFile: (filePath: string) => Promise<{ success: boolean; content?: string; error?: string }>;
    };
  }
}

interface TestCase {
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
}

interface TestCaseStats {
  total: number;
  pending: number;
  passed: number;
  failed: number;
  skipped: number;
  byCritical: number;
  byHigh: number;
  byMedium: number;
  byLow: number;
}

class DashboardApp {
  private activeSessions: Map<string, Session> = new Map();
  private modal: HTMLElement | null = null;
  private actionsModal: HTMLElement | null = null;
  private generateModal: HTMLElement | null = null;
  private form: HTMLFormElement | null = null;
  private currentGenerateSessionId: string | null = null;
  private expandedErrorSections: Set<string> = new Set();
  private expandedActionSections: Set<string> = new Set();
  private sessionErrors: Map<string, TabError[]> = new Map();
  private sessionActions: Map<string, RecordedAction[]> = new Map();
  private sessionStats: Map<string, { actionCount: number; errorCount: number }> = new Map();
  private currentPage = 'sessions';
  private settings: DashboardSettings = {
    maxSessions: 3,
    maxWindowsPerSession: 3,
    sessionRules: {},
    aiIntegrations: {
      providers: [],
      autoFallback: true,
    },
  };
  
  // Ignored errors - keyed by error pattern (message prefix)
  private ignoredErrorPatterns: Set<string> = new Set();
  
  // License status
  private licenseStatus: LicenseStatus = {
    isLicensed: false,
    tier: 'free',
    needsRevalidation: false,
    isInGracePeriod: false,
  };
  
  // Sync config
  private syncConfig: {
    apiUrl: string;
    apiKey?: string;
    autoSync: boolean;
  } = {
    apiUrl: '',
    autoSync: false,
  };
  
  constructor() {
    this.init();
  }
  
  private async init(): Promise<void> {
    // Cache DOM elements
    this.modal = document.getElementById('create-session-modal');
    this.actionsModal = document.getElementById('actions-modal');
    this.generateModal = document.getElementById('generate-modal');
    this.form = document.getElementById('create-session-form') as HTMLFormElement;
    
    // Load settings from localStorage
    this.loadSettings();
    
    // Sync settings to main process
    await this.syncSettingsToMainProcess();
    
    // Load license status
    await this.loadLicenseStatus();
    
    // Setup event listeners
    this.setupEventListeners();
    this.setupNavigation();
    this.setupSettingsListeners();
    this.setupLicenseListeners();
    this.setupSyncListeners();
    this.setupGenerateListeners();
    this.setupTestCasesListeners();
    this.setupSessionRulesListeners();
    this.setupAIIntegrationsListeners();
    
    // Load initial data
    await this.loadActiveSessions();
    await this.loadSessionHistory();
    
    // Listen for real-time updates
    this.setupSessionEventListener();
    
    // Update badge
    this.updateSessionBadge();
  }
  
  private loadSettings(): void {
    const saved = localStorage.getItem('dashing-settings');
    if (saved) {
      try {
        this.settings = { ...this.settings, ...JSON.parse(saved) };
      } catch (e) {
        // Use defaults
      }
    }
    
    // Load ignored error patterns
    const savedPatterns = localStorage.getItem('dashing-ignored-errors');
    if (savedPatterns) {
      try {
        const patterns = JSON.parse(savedPatterns) as string[];
        this.ignoredErrorPatterns = new Set(patterns);
      } catch (e) {
        // Use empty set
      }
    }
    
    // Update UI
    const maxSessionsInput = document.getElementById('max-sessions') as HTMLInputElement;
    const maxWindowsInput = document.getElementById('max-windows') as HTMLInputElement;
    if (maxSessionsInput) maxSessionsInput.value = String(this.settings.maxSessions);
    if (maxWindowsInput) maxWindowsInput.value = String(this.settings.maxWindowsPerSession);
  }
  
  private saveIgnoredPatterns(): void {
    localStorage.setItem('dashing-ignored-errors', JSON.stringify([...this.ignoredErrorPatterns]));
  }
  
  private getErrorPattern(error: TabError): string {
    // Create a pattern from the error message (first 50 chars + type + status)
    const msgPrefix = error.message.slice(0, 50);
    return `${error.type}:${error.statusCode || 'none'}:${msgPrefix}`;
  }
  
  private isErrorIgnored(error: TabError): boolean {
    const pattern = this.getErrorPattern(error);
    return this.ignoredErrorPatterns.has(pattern);
  }
  
  private ignoreError(error: TabError): void {
    const pattern = this.getErrorPattern(error);
    this.ignoredErrorPatterns.add(pattern);
    this.saveIgnoredPatterns();
  }
  
  private unignoreError(pattern: string): void {
    this.ignoredErrorPatterns.delete(pattern);
    this.saveIgnoredPatterns();
  }
  
  private async saveSettings(): Promise<void> {
    localStorage.setItem('dashing-settings', JSON.stringify(this.settings));
    // Sync to main process
    await window.dashboardAPI.setMaxWindowsPerSession(this.settings.maxWindowsPerSession);
  }
  
  private async syncSettingsToMainProcess(): Promise<void> {
    // Sync settings to the main process on load
    await window.dashboardAPI.setMaxWindowsPerSession(this.settings.maxWindowsPerSession);
    await window.dashboardAPI.setSessionRules(this.settings.sessionRules || {});
  }
  
  private setupSettingsListeners(): void {
    // Settings Navigation
    this.setupSettingsNavigation();
    
    // Settings inputs
    const maxSessionsInput = document.getElementById('max-sessions') as HTMLInputElement;
    const maxWindowsInput = document.getElementById('max-windows') as HTMLInputElement;
    const clearHistoryBtn = document.getElementById('clear-history-btn');
    const exportDataBtn = document.getElementById('export-data-btn');
    
    maxSessionsInput?.addEventListener('change', () => {
      this.settings.maxSessions = parseInt(maxSessionsInput.value) || 5;
      this.saveSettings();
    });
    
    maxWindowsInput?.addEventListener('change', () => {
      this.settings.maxWindowsPerSession = parseInt(maxWindowsInput.value) || 5;
      this.saveSettings();
    });
    
    clearHistoryBtn?.addEventListener('click', async () => {
      if (confirm('Are you sure you want to delete all session history? This cannot be undone.')) {
        const { sessions } = await window.dashboardAPI.getSessionHistory(1000, 0);
        for (const session of sessions) {
          if (session.status === 'ended') {
            await window.dashboardAPI.deleteSession(session.id);
          }
        }
        await this.loadSessionHistory();
      }
    });
    
    exportDataBtn?.addEventListener('click', async () => {
      try {
        const { sessions } = await window.dashboardAPI.getSessionHistory(10000, 0);
        const dataStr = JSON.stringify(sessions, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `dashing-export-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (error) {
        console.error('Failed to export data:', error);
      }
    });
  }
  
  private setupSettingsNavigation(): void {
    const settingsNav = document.getElementById('settings-nav');
    const settingsSubview = document.getElementById('settings-subview');
    const settingsBackBtn = document.getElementById('settings-back-btn');
    const settingsSubviewTitle = document.getElementById('settings-subview-title');
    const navCards = document.querySelectorAll('.settings-nav-card');
    
    // Section titles mapping
    const sectionTitles: Record<string, string> = {
      'license-sync': 'License & Sync',
      'session-limits': 'Session Limits',
      'data-management': 'Data Management',
      'session-rules': 'Session Rules',
      'integrations': 'Integrations'
    };
    
    // Navigate to a settings section
    navCards.forEach(card => {
      card.addEventListener('click', () => {
        const section = card.getAttribute('data-settings-section');
        if (!section) return;
        
        // Hide nav, show subview
        settingsNav?.classList.add('hidden');
        settingsSubview?.classList.remove('hidden');
        
        // Update title
        if (settingsSubviewTitle) {
          settingsSubviewTitle.textContent = sectionTitles[section] || 'Settings';
        }
        
        // Show the correct section content
        document.querySelectorAll('.settings-section-content').forEach(content => {
          content.classList.add('hidden');
        });
        const sectionContent = document.getElementById(`section-${section}`);
        sectionContent?.classList.remove('hidden');
      });
    });
    
    // Back button handler
    settingsBackBtn?.addEventListener('click', () => {
      // Hide subview, show nav
      settingsSubview?.classList.add('hidden');
      settingsNav?.classList.remove('hidden');
    });
  }
  
  // ============================================
  // License Management
  // ============================================
  
  private async loadLicenseStatus(): Promise<void> {
    try {
      this.licenseStatus = await window.dashboardAPI.getLicenseStatus();
      this.updateLicenseUI();
      
      // Update limits based on tier
      const limits = await window.dashboardAPI.getCurrentLimits();
      this.updateSettingsWithLimits(limits);
      
      // Load sync config and update sync UI
      await this.loadSyncConfig();
    } catch (error) {
      console.error('Failed to load license status:', error);
    }
  }
  
  private updateSettingsWithLimits(limits: TierLimits): void {
    // Update the max limits for inputs based on tier
    const maxSessionsInput = document.getElementById('max-sessions') as HTMLInputElement;
    const maxWindowsInput = document.getElementById('max-windows') as HTMLInputElement;
    const tierLimitNote = document.getElementById('tier-limit-note');
    
    if (limits.maxActiveSessions > 0) {
      if (maxSessionsInput) {
        maxSessionsInput.max = String(limits.maxActiveSessions);
        if (this.settings.maxSessions > limits.maxActiveSessions) {
          this.settings.maxSessions = limits.maxActiveSessions;
          maxSessionsInput.value = String(limits.maxActiveSessions);
        }
      }
    } else {
      if (maxSessionsInput) maxSessionsInput.max = '100';
    }
    
    if (limits.maxWindowsPerSession > 0) {
      if (maxWindowsInput) {
        maxWindowsInput.max = String(limits.maxWindowsPerSession);
        if (this.settings.maxWindowsPerSession > limits.maxWindowsPerSession) {
          this.settings.maxWindowsPerSession = limits.maxWindowsPerSession;
          maxWindowsInput.value = String(limits.maxWindowsPerSession);
        }
      }
    } else {
      if (maxWindowsInput) maxWindowsInput.max = '50';
    }
    
    // Show tier limit note
    if (tierLimitNote) {
      if (this.licenseStatus.tier === 'free') {
        tierLimitNote.textContent = `Free tier: Max ${limits.maxActiveSessions} sessions, ${limits.maxWindowsPerSession} windows. Upgrade to Pro for higher limits.`;
        tierLimitNote.classList.remove('hidden');
      } else if (this.licenseStatus.tier === 'pro') {
        tierLimitNote.textContent = `Pro tier: Max ${limits.maxActiveSessions} sessions, ${limits.maxWindowsPerSession} windows per session.`;
        tierLimitNote.classList.remove('hidden');
      } else {
        tierLimitNote.textContent = 'Enterprise tier: Unlimited sessions and windows.';
        tierLimitNote.classList.remove('hidden');
      }
    }
  }
  
  private updateLicenseUI(): void {
    const tierBadge = document.getElementById('license-tier-badge');
    const navLicenseBadge = document.getElementById('nav-license-badge');
    const licenseDetails = document.getElementById('license-details');
    const licenseInputSection = document.getElementById('license-input-section');
    const licenseActiveSection = document.getElementById('license-active-section');
    const upgradeCta = document.getElementById('upgrade-cta');
    const licenseEmail = document.getElementById('license-email');
    const licenseOrg = document.getElementById('license-org');
    const licenseExpires = document.getElementById('license-expires');
    
    if (!tierBadge) return;
    
    // Update tier badge (in license card)
    tierBadge.className = `license-tier-badge ${this.licenseStatus.tier}`;
    tierBadge.querySelector('.tier-name')!.textContent = this.licenseStatus.tier.toUpperCase();
    
    // Update navigation badge
    if (navLicenseBadge) {
      navLicenseBadge.className = `settings-nav-badge ${this.licenseStatus.tier}`;
      navLicenseBadge.querySelector('.tier-name')!.textContent = this.licenseStatus.tier.toUpperCase();
    }
    
    // Update details
    if (licenseDetails) {
      if (this.licenseStatus.isLicensed) {
        let statusText = `Licensed: ${this.licenseStatus.tier.charAt(0).toUpperCase() + this.licenseStatus.tier.slice(1)} tier`;
        if (this.licenseStatus.isInGracePeriod) {
          statusText += ' (Grace period - please renew)';
        } else if (this.licenseStatus.needsRevalidation) {
          statusText += ' (Revalidation needed)';
        }
        licenseDetails.querySelector('.license-info')!.textContent = statusText;
      } else {
        licenseDetails.querySelector('.license-info')!.textContent = 'Using free tier with basic features';
      }
    }
    
    // Toggle sections based on license status
    if (this.licenseStatus.isLicensed && this.licenseStatus.tier !== 'free') {
      licenseInputSection?.classList.add('hidden');
      licenseActiveSection?.classList.remove('hidden');
      upgradeCta?.classList.add('hidden');
      
      // Update active license info
      if (licenseEmail) licenseEmail.textContent = this.licenseStatus.email || '-';
      if (licenseOrg) licenseOrg.textContent = this.licenseStatus.orgName || '-';
      if (licenseExpires && this.licenseStatus.expiresAt) {
        const expiryDate = new Date(this.licenseStatus.expiresAt);
        licenseExpires.textContent = expiryDate.toLocaleDateString();
        if (this.licenseStatus.daysUntilExpiry !== undefined && this.licenseStatus.daysUntilExpiry <= 30) {
          licenseExpires.textContent += ` (${this.licenseStatus.daysUntilExpiry} days left)`;
        }
      } else if (licenseExpires) {
        licenseExpires.textContent = 'Never';
      }
    } else {
      licenseInputSection?.classList.remove('hidden');
      licenseActiveSection?.classList.add('hidden');
      upgradeCta?.classList.remove('hidden');
    }
  }
  
  private setupLicenseListeners(): void {
    const activateBtn = document.getElementById('activate-license-btn');
    const deactivateBtn = document.getElementById('deactivate-license-btn');
    const licenseKeyInput = document.getElementById('license-key') as HTMLInputElement;
    const licenseError = document.getElementById('license-error');
    
    activateBtn?.addEventListener('click', async () => {
      const key = licenseKeyInput?.value?.trim();
      if (!key) {
        this.showLicenseError('Please enter a license key');
        return;
      }
      
      activateBtn.textContent = 'Activating...';
      (activateBtn as HTMLButtonElement).disabled = true;
      
      try {
        const result = await window.dashboardAPI.activateLicense(key);
        if (result.success) {
          // Reload license status
          await this.loadLicenseStatus();
          licenseKeyInput.value = '';
          licenseError?.classList.add('hidden');
          this.showToast('License activated successfully!', 'success');
        } else {
          this.showLicenseError(result.error || 'Invalid license key');
        }
      } catch (error) {
        this.showLicenseError('Failed to activate license');
      } finally {
        activateBtn.textContent = 'Activate';
        (activateBtn as HTMLButtonElement).disabled = false;
      }
    });
    
    deactivateBtn?.addEventListener('click', async () => {
      if (!confirm('Are you sure you want to deactivate your license? You will revert to the free tier.')) {
        return;
      }
      
      try {
        await window.dashboardAPI.deactivateLicense();
        await this.loadLicenseStatus();
        this.showToast('License deactivated', 'info');
      } catch (error) {
        console.error('Failed to deactivate license:', error);
      }
    });
    
    // Allow Enter key to submit
    licenseKeyInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        activateBtn?.click();
      }
    });
  }
  
  private showLicenseError(message: string): void {
    const licenseError = document.getElementById('license-error');
    if (licenseError) {
      licenseError.textContent = message;
      licenseError.classList.remove('hidden');
    }
  }
  
  private showToast(message: string, type: 'success' | 'error' | 'info' = 'info'): void {
    // Create toast element
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <span>${message}</span>
      <button class="toast-close">&times;</button>
    `;
    
    // Add to document
    let container = document.querySelector('.toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    container.appendChild(toast);
    
    // Auto-remove after 3 seconds
    setTimeout(() => {
      toast.classList.add('toast-hiding');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
    
    // Manual close
    toast.querySelector('.toast-close')?.addEventListener('click', () => {
      toast.remove();
    });
  }
  
  // ============================================
  // Sync Status Methods
  // ============================================
  
  private async fetchSyncStatus(sessionId: string): Promise<void> {
    try {
      const status = await window.dashboardAPI.getSyncStatus(sessionId);
      this.updateSyncStatusBadge(sessionId, status.status);
    } catch (error) {
      console.error(`Failed to fetch sync status for ${sessionId}:`, error);
      this.updateSyncStatusBadge(sessionId, 'not_synced');
    }
  }
  
  private updateSyncStatusBadge(sessionId: string, status: string): void {
    const badge = document.querySelector(`.sync-status-badge[data-session-id="${sessionId}"]`);
    if (!badge) return;
    
    const textEl = badge.querySelector('.sync-status-text');
    const svgEl = badge.querySelector('svg');
    
    // Update badge based on status
    badge.className = `sync-status-badge sync-status-${status}`;
    
    let text = '';
    let svgPath = '';
    
    switch (status) {
      case 'synced':
        text = 'Synced';
        svgPath = '<polyline points="20,6 9,17 4,12"/>';
        break;
      case 'syncing':
        text = 'Syncing...';
        svgPath = '<path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0118.8-4.3M22 12.5a10 10 0 01-18.8 4.2"/>';
        break;
      case 'pending':
        text = 'Pending';
        svgPath = '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>';
        break;
      case 'failed':
        text = 'Failed';
        svgPath = '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>';
        break;
      default:
        text = 'Not Synced';
        svgPath = '<circle cx="12" cy="12" r="10"/>';
    }
    
    if (textEl) textEl.textContent = text;
    if (svgEl) svgEl.innerHTML = svgPath;
  }
  
  private async handleSyncAll(): Promise<void> {
    const syncAllBtn = document.getElementById('sync-all-btn') as HTMLButtonElement;
    if (!syncAllBtn) return;
    
    // Check license
    const licenseStatus = await window.dashboardAPI.getLicenseStatus();
    if (!licenseStatus.isLicensed || licenseStatus.tier === 'free') {
      this.showToast('Cloud sync requires a Pro or Enterprise license', 'error');
      return;
    }
    
    // Get all history sessions
    const historyResult = await window.dashboardAPI.getSessionHistory(100, 0);
    const endedSessions = historyResult.sessions.filter((s: Session) => s.status === 'ended');
    
    if (endedSessions.length === 0) {
      this.showToast('No sessions to sync', 'info');
      return;
    }
    
    // Update button state
    const originalHTML = syncAllBtn.innerHTML;
    syncAllBtn.disabled = true;
    
    // Add progress UI
    const sectionActions = syncAllBtn.parentElement;
    const progressContainer = document.createElement('div');
    progressContainer.className = 'sync-progress-wrapper';
    progressContainer.innerHTML = `
      <div class="sync-progress-container">
        <div class="sync-progress-bar" style="width: 0%"></div>
      </div>
      <span class="sync-progress-text">0 / ${endedSessions.length}</span>
    `;
    sectionActions?.appendChild(progressContainer);
    
    const progressBar = progressContainer.querySelector('.sync-progress-bar') as HTMLElement;
    const progressText = progressContainer.querySelector('.sync-progress-text') as HTMLElement;
    
    syncAllBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spinning">
        <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0118.8-4.3M22 12.5a10 10 0 01-18.8 4.2"/>
      </svg>
      Syncing...
    `;
    
    let successCount = 0;
    let failCount = 0;
    
    for (let i = 0; i < endedSessions.length; i++) {
      const session = endedSessions[i];
      this.updateSyncStatusBadge(session.id, 'syncing');
      
      try {
        const result = await window.dashboardAPI.syncSession(session.id);
        if (result.success) {
          successCount++;
          this.updateSyncStatusBadge(session.id, 'synced');
        } else {
          failCount++;
          this.updateSyncStatusBadge(session.id, 'failed');
        }
      } catch (error) {
        failCount++;
        this.updateSyncStatusBadge(session.id, 'failed');
        console.error(`Sync failed for session ${session.id}:`, error);
      }
      
      // Update progress
      const progress = Math.round(((i + 1) / endedSessions.length) * 100);
      if (progressBar) progressBar.style.width = `${progress}%`;
      if (progressText) progressText.textContent = `${i + 1} / ${endedSessions.length}`;
    }
    
    // Cleanup
    syncAllBtn.innerHTML = originalHTML;
    syncAllBtn.disabled = false;
    progressContainer.remove();
    
    // Show summary toast
    if (failCount === 0) {
      this.showToast(`Successfully synced ${successCount} session${successCount !== 1 ? 's' : ''}`, 'success');
    } else {
      this.showToast(`Synced ${successCount}, failed ${failCount}`, failCount > successCount ? 'error' : 'info');
    }
  }
  
  // ============================================
  // Sync Management
  // ============================================
  
  private async loadSyncConfig(): Promise<void> {
    try {
      const config = await window.dashboardAPI.getSyncConfig();
      this.syncConfig = {
        apiUrl: config.apiUrl,
        apiKey: config.apiKey,
        autoSync: config.autoSync,
      };
      this.updateSyncUI();
    } catch (error) {
      console.error('Failed to load sync config:', error);
    }
  }
  
  private updateSyncUI(): void {
    const syncLocked = document.getElementById('sync-locked');
    const syncConfig = document.getElementById('sync-config');
    const proBadge = document.getElementById('sync-pro-badge');
    
    // Check if sync feature is available based on license
    const isSyncEnabled = this.licenseStatus.tier === 'pro' || this.licenseStatus.tier === 'enterprise';
    
    if (syncLocked && syncConfig) {
      if (isSyncEnabled) {
        syncLocked.classList.add('hidden');
        syncConfig.classList.remove('hidden');
        proBadge?.classList.add('hidden');
        
        // Update form values
        const apiUrlInput = document.getElementById('sync-api-url') as HTMLInputElement;
        const apiKeyInput = document.getElementById('sync-api-key') as HTMLInputElement;
        const autoToggle = document.getElementById('sync-auto-toggle') as HTMLInputElement;
        
        if (apiUrlInput) apiUrlInput.value = this.syncConfig.apiUrl || '';
        if (apiKeyInput) apiKeyInput.value = this.syncConfig.apiKey || '';
        if (autoToggle) autoToggle.checked = this.syncConfig.autoSync;
        
        // Update status
        this.updateSyncStatusDisplay();
      } else {
        syncLocked.classList.remove('hidden');
        syncConfig.classList.add('hidden');
        proBadge?.classList.remove('hidden');
      }
    }
  }
  
  private updateSyncStatusDisplay(): void {
    const indicator = document.getElementById('sync-indicator');
    const statusText = indicator?.querySelector('.status-text');
    
    if (!indicator || !statusText) return;
    
    if (this.syncConfig.autoSync) {
      indicator.className = 'sync-status-indicator running';
      statusText.textContent = 'Auto-sync running';
    } else {
      indicator.className = 'sync-status-indicator stopped';
      statusText.textContent = 'Auto-sync stopped';
    }
  }
  
  private async updateSyncQueueStats(): Promise<void> {
    try {
      const queue = await window.dashboardAPI.getPendingSyncQueue();
      
      let pending = 0;
      let synced = 0;
      let failed = 0;
      
      for (const item of queue) {
        if (item.status === 'pending' || item.status === 'syncing') pending++;
        else if (item.status === 'synced') synced++;
        else if (item.status === 'failed') failed++;
      }
      
      const pendingEl = document.getElementById('sync-pending-count');
      const syncedEl = document.getElementById('sync-synced-count');
      const failedEl = document.getElementById('sync-failed-count');
      
      if (pendingEl) pendingEl.textContent = String(pending);
      if (syncedEl) syncedEl.textContent = String(synced);
      if (failedEl) failedEl.textContent = String(failed);
    } catch (error) {
      console.error('Failed to update sync queue stats:', error);
    }
  }
  
  private setupSyncListeners(): void {
    const saveConfigBtn = document.getElementById('sync-save-config-btn');
    const testBtn = document.getElementById('sync-test-btn');
    const autoToggle = document.getElementById('sync-auto-toggle') as HTMLInputElement;
    const retryFailedBtn = document.getElementById('sync-retry-failed-btn');
    
    saveConfigBtn?.addEventListener('click', async () => {
      const apiUrlInput = document.getElementById('sync-api-url') as HTMLInputElement;
      const apiKeyInput = document.getElementById('sync-api-key') as HTMLInputElement;
      
      const newConfig = {
        apiUrl: apiUrlInput?.value?.trim() || '',
        apiKey: apiKeyInput?.value?.trim() || undefined,
        autoSync: autoToggle?.checked || false,
      };
      
      try {
        await window.dashboardAPI.updateSyncConfig(newConfig);
        this.syncConfig = newConfig;
        this.showToast('Sync configuration saved', 'success');
        
        // Start or stop auto-sync based on toggle
        if (newConfig.autoSync) {
          await window.dashboardAPI.startAutoSync();
        } else {
          await window.dashboardAPI.stopAutoSync();
        }
        
        this.updateSyncStatusDisplay();
      } catch (error) {
        this.showToast('Failed to save configuration', 'error');
      }
    });
    
    testBtn?.addEventListener('click', async () => {
      const apiUrlInput = document.getElementById('sync-api-url') as HTMLInputElement;
      const apiUrl = apiUrlInput?.value?.trim();
      
      if (!apiUrl) {
        this.showToast('Please enter an API URL', 'error');
        return;
      }
      
      testBtn.textContent = 'Testing...';
      (testBtn as HTMLButtonElement).disabled = true;
      
      try {
        const response = await fetch(`${apiUrl}/health`, { method: 'GET' });
        if (response.ok) {
          this.showToast('Connection successful!', 'success');
        } else {
          this.showToast(`Connection failed: ${response.status}`, 'error');
        }
      } catch (error) {
        this.showToast('Connection failed: Network error', 'error');
      } finally {
        testBtn.textContent = 'Test Connection';
        (testBtn as HTMLButtonElement).disabled = false;
      }
    });
    
    autoToggle?.addEventListener('change', async () => {
      this.syncConfig.autoSync = autoToggle.checked;
      
      if (autoToggle.checked) {
        await window.dashboardAPI.startAutoSync();
        this.showToast('Auto-sync started', 'info');
      } else {
        await window.dashboardAPI.stopAutoSync();
        this.showToast('Auto-sync stopped', 'info');
      }
      
      this.updateSyncStatusDisplay();
    });
    
    retryFailedBtn?.addEventListener('click', async () => {
      try {
        await window.dashboardAPI.retryFailedSync();
        this.showToast('Retrying failed items...', 'info');
        await this.updateSyncQueueStats();
      } catch (error) {
        this.showToast('Failed to retry', 'error');
      }
    });
    
    // Listen for sync status updates
    window.dashboardAPI.onSyncStatusUpdate((status) => {
      this.updateSyncQueueStats();
    });
  }
  
  private setupGenerateListeners(): void {
    // Generate modal close
    const closeBtn = document.getElementById('generate-modal-close');
    closeBtn?.addEventListener('click', () => this.hideGenerateModal());
    
    // Generate modal cancel
    const cancelBtn = document.getElementById('generate-cancel-btn');
    cancelBtn?.addEventListener('click', () => this.hideGenerateModal());
    
    // Generate modal backdrop click
    const backdrop = this.generateModal?.querySelector('.modal-backdrop');
    backdrop?.addEventListener('click', () => this.hideGenerateModal());
    
    // Generate form submit
    const form = document.getElementById('generate-form') as HTMLFormElement;
    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleGenerateSubmit();
    });
    
    // Open generated folder button
    const openFolderBtn = document.getElementById('open-generated-folder-btn');
    openFolderBtn?.addEventListener('click', async () => {
      try {
        const outputDir = await window.dashboardAPI.getCodegenOutputDir();
        await window.dashboardAPI.openGeneratedFolder(outputDir);
      } catch (error) {
        this.showToast('Failed to open folder', 'error');
      }
    });
  }
  
  private setupNavigation(): void {
    const navItems = document.querySelectorAll('.nav-item[data-page]');
    navItems.forEach(item => {
      item.addEventListener('click', () => {
        const page = item.getAttribute('data-page');
        if (page) this.navigateTo(page);
      });
    });
  }
  
  private navigateTo(page: string): void {
    this.currentPage = page;
    
    // Update nav items
    const navItems = document.querySelectorAll('.nav-item[data-page]');
    navItems.forEach(item => {
      item.classList.toggle('active', item.getAttribute('data-page') === page);
    });
    
    // Update pages
    const pages = document.querySelectorAll('.page');
    pages.forEach(p => {
      p.classList.toggle('active', p.id === `page-${page}`);
    });
    
    // Update header title
    const pageTitle = document.getElementById('page-title');
    const titles: Record<string, string> = {
      sessions: 'Active Sessions',
      history: 'Session History',
      generated: 'Generated Tests',
      settings: 'Settings',
    };
    if (pageTitle) pageTitle.textContent = titles[page] || page;
    
    // Load generated projects when navigating to generated page
    if (page === 'generated') {
      this.loadGeneratedProjects();
      this.startJobPolling();
    } else {
      this.stopJobPolling();
    }
    
    // Update create button visibility
    const createBtn = document.getElementById('create-session-btn');
    if (createBtn) {
      createBtn.style.display = page === 'sessions' ? 'flex' : 'none';
    }
  }
  
  private setupEventListeners(): void {
    // Create session button
    const createBtn = document.getElementById('create-session-btn');
    createBtn?.addEventListener('click', () => this.showModal());
    
    // Empty state create button
    const emptyCreateBtn = document.getElementById('empty-create-btn');
    emptyCreateBtn?.addEventListener('click', () => this.showModal());
    
    // Modal close
    const closeBtn = document.getElementById('modal-close-btn');
    closeBtn?.addEventListener('click', () => this.hideModal());
    
    // Modal cancel
    const cancelBtn = document.getElementById('modal-cancel-btn');
    cancelBtn?.addEventListener('click', () => this.hideModal());
    
    // Modal backdrop click
    const backdrop = this.modal?.querySelector('.modal-backdrop');
    backdrop?.addEventListener('click', () => this.hideModal());
    
    // Sync All button
    const syncAllBtn = document.getElementById('sync-all-btn');
    syncAllBtn?.addEventListener('click', () => this.handleSyncAll());
    
    // Form submit
    this.form?.addEventListener('submit', (e) => this.handleCreateSession(e));
    
    // Actions modal close
    const actionsCloseBtn = document.getElementById('actions-modal-close');
    actionsCloseBtn?.addEventListener('click', () => this.hideActionsModal());
    
    const actionsBackdrop = this.actionsModal?.querySelector('.modal-backdrop');
    actionsBackdrop?.addEventListener('click', () => this.hideActionsModal());
    
    // Escape key to close modals
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (!this.modal?.classList.contains('hidden')) {
          this.hideModal();
        }
        if (!this.actionsModal?.classList.contains('hidden')) {
          this.hideActionsModal();
        }
      }
    });
  }
  
  private setupSessionEventListener(): void {
    console.log('[Dashboard] Setting up session event listener');
    window.dashboardAPI.onSessionEvent((event: SessionEvent) => {
      console.log('[Dashboard] Received session event:', event.type, event);
      switch (event.type) {
        case 'session-created':
          console.log('[Dashboard] Session created:', event.session.id);
          this.activeSessions.set(event.session.id, event.session);
          this.renderActiveSessions();
          this.updateSessionBadge();
          break;
          
        case 'session-updated':
          console.log('[Dashboard] Session updated:', event.session.id);
          if (this.activeSessions.has(event.session.id)) {
            this.activeSessions.set(event.session.id, event.session);
            this.renderActiveSessions();
          }
          break;
          
        case 'session-ended':
          console.log('[Dashboard] Session ended event received:', event.sessionId);
          this.activeSessions.delete(event.sessionId);
          this.renderActiveSessions();
          this.loadSessionHistory();
          this.updateSessionBadge();
          break;
          
        case 'window-added':
        case 'window-closed':
        case 'tab-added':
        case 'tab-updated':
        case 'tab-closed':
          this.refreshSession(event.sessionId);
          break;
          
        case 'action-recorded':
          // Update action count immediately without full refresh
          this.updateActionCountFromEvent(event.sessionId, event.actionCount);
          break;
          
        case 'error-captured':
          // Update error count immediately without full refresh
          this.updateErrorCountFromEvent(event.sessionId, event.errorCount);
          break;
          
        case 'session-synced':
          // Update sync status badge when auto-sync completes
          this.updateSyncStatusBadge(event.sessionId, 'synced');
          break;
          
        case 'session-sync-failed':
          // Update sync status badge when auto-sync fails
          this.updateSyncStatusBadge(event.sessionId, 'failed');
          break;
      }
    });
  }
  
  private updateSessionBadge(): void {
    const badge = document.getElementById('active-sessions-badge');
    if (badge) {
      const count = this.activeSessions.size;
      badge.textContent = count > 0 ? String(count) : '';
    }
  }
  
  private async refreshSession(sessionId: string): Promise<void> {
    const session = await window.dashboardAPI.getSession(sessionId);
    if (session) {
      this.activeSessions.set(sessionId, session);
      await this.fetchSessionStats(sessionId);
      this.renderActiveSessions();
    }
  }
  
  private updateActionCountFromEvent(sessionId: string, actionCount: number): void {
    // Update the cached stats
    const currentStats = this.sessionStats.get(sessionId) || { actionCount: 0, errorCount: 0 };
    currentStats.actionCount = actionCount;
    this.sessionStats.set(sessionId, currentStats);
    
    // Update the UI immediately without re-rendering the whole card
    const card = document.querySelector(`.session-card[data-session-id="${sessionId}"]`);
    if (card) {
      const actionStat = card.querySelector('.stat[data-stat-type="actions"] .stat-value');
      if (actionStat) {
        actionStat.textContent = String(actionCount);
      }
    }
  }
  
  private updateErrorCountFromEvent(sessionId: string, errorCount: number): void {
    // Update the cached stats
    const currentStats = this.sessionStats.get(sessionId) || { actionCount: 0, errorCount: 0 };
    currentStats.errorCount = errorCount;
    this.sessionStats.set(sessionId, currentStats);
    
    // Update the UI immediately without re-rendering the whole card
    const card = document.querySelector(`.session-card[data-session-id="${sessionId}"]`);
    if (card) {
      const errorStat = card.querySelector('.stat[data-stat-type="errors"] .stat-value');
      if (errorStat) {
        errorStat.textContent = String(errorCount);
      }
      // Update has-errors class
      const statEl = card.querySelector('.stat[data-stat-type="errors"]');
      if (statEl) {
        if (errorCount > 0) {
          statEl.classList.add('has-errors');
        } else {
          statEl.classList.remove('has-errors');
        }
      }
    }
  }
  
  private async loadActiveSessions(): Promise<void> {
    try {
      const sessions = await window.dashboardAPI.getActiveSessions();
      this.activeSessions.clear();
      sessions.forEach(s => this.activeSessions.set(s.id, s));
      
      // Fetch stats for all active sessions
      for (const session of sessions) {
        await this.fetchSessionStats(session.id);
      }
      
      this.renderActiveSessions();
      this.updateSessionBadge();
    } catch (error) {
      console.error('Failed to load active sessions:', error);
    }
  }
  
  private async fetchSessionStats(sessionId: string): Promise<void> {
    try {
      const stats = await window.dashboardAPI.getSessionStats(sessionId);
      this.sessionStats.set(sessionId, stats);
    } catch (error) {
      console.error('Failed to fetch session stats:', error);
    }
  }
  
  private async fetchSessionErrors(sessionId: string): Promise<void> {
    try {
      const errors = await window.dashboardAPI.getSessionErrors(sessionId, 200);
      this.sessionErrors.set(sessionId, errors);
      
      // Update stats cache immediately with the fetched count
      // This provides faster feedback than waiting for DB stats query
      const visibleErrors = errors.filter(err => !this.isErrorIgnored(err));
      const currentStats = this.sessionStats.get(sessionId) || { actionCount: 0, errorCount: 0 };
      currentStats.errorCount = visibleErrors.length;
      this.sessionStats.set(sessionId, currentStats);
      
      // Update the displayed count immediately
      this.updateDisplayedErrorCount(sessionId, visibleErrors.length);
    } catch (error) {
      console.error('Failed to fetch session errors:', error);
    }
  }
  
  private async fetchSessionActions(sessionId: string): Promise<void> {
    try {
      const actions = await window.dashboardAPI.getSessionActions(sessionId, 200);
      this.sessionActions.set(sessionId, actions);
    } catch (error) {
      console.error('Failed to fetch session actions:', error);
    }
  }
  
  private async loadSessionHistory(): Promise<void> {
    try {
      const { sessions } = await window.dashboardAPI.getSessionHistory(50, 0);
      
      // Fetch stats for history sessions
      for (const session of sessions) {
        const stats = await window.dashboardAPI.getSessionStats(session.id);
        session.actionCount = stats.actionCount;
        session.errorCount = stats.errorCount;
      }
      
      this.renderSessionHistory(sessions);
    } catch (error) {
      console.error('Failed to load session history:', error);
    }
  }
  
  private renderActiveSessions(): void {
    const container = document.getElementById('active-sessions-list');
    const emptyState = document.getElementById('no-active-sessions');
    
    if (!container) return;
    
    // Clear existing cards
    const cards = container.querySelectorAll('.session-card');
    cards.forEach(card => card.remove());
    
    if (this.activeSessions.size === 0) {
      emptyState?.classList.remove('hidden');
      return;
    }
    
    emptyState?.classList.add('hidden');
    
    // Sort by start time (newest first)
    const sortedSessions = Array.from(this.activeSessions.values())
      .sort((a, b) => b.startedAt - a.startedAt);
    
    for (const session of sortedSessions) {
      const card = this.createSessionCard(session);
      container.appendChild(card);
    }
  }
  
  private createSessionCard(session: Session): HTMLElement {
    const card = document.createElement('div');
    card.className = `session-card ${session.status === 'recording' ? 'active' : ''}`;
    card.dataset.sessionId = session.id;
    
    const windowCount = session.windows?.length || 0;
    const stats = this.sessionStats.get(session.id) || { actionCount: 0, errorCount: 0 };
    const actionCount = stats.actionCount;
    const errorCount = stats.errorCount;
    const duration = this.formatDuration(session.startedAt);
    
    card.innerHTML = `
      <div class="session-card-header">
        <span class="session-name">${this.escapeHtml(session.name)}</span>
        <span class="session-status ${session.status}">
          ${session.status === 'recording' ? '<span class="recording-dot"></span>' : ''}
          ${session.status}
        </span>
      </div>
      ${session.description ? `<p class="session-description">${this.escapeHtml(session.description)}</p>` : ''}
      <div class="session-meta">
        <span class="session-meta-item">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="9"/>
            <path d="M12 7v5l3 3"/>
          </svg>
          ${duration}
        </span>
        ${session.testSuite ? `
          <span class="session-meta-item">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 6h18M3 12h18M3 18h18"/>
            </svg>
            ${this.escapeHtml(session.testSuite)}
          </span>
        ` : ''}
        ${session.environment ? `
          <span class="session-meta-item">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <path d="M2 12h20M12 2a15 15 0 010 20M12 2a15 15 0 000 20"/>
            </svg>
            ${this.escapeHtml(session.environment)}
          </span>
        ` : ''}
      </div>
      <div class="session-windows">
        ${session.windows?.map(w => `
          <span class="window-badge ${w.isActive ? 'active' : ''}" data-window-id="${w.id}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <path d="M3 9h18"/>
            </svg>
            ${this.escapeHtml(w.label)}
            <span class="window-badge-count">${w.tabs?.length || 0} tabs</span>
          </span>
        `).join('') || ''}
        <button class="btn btn-sm btn-secondary add-window-btn" data-session-id="${session.id}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          Add Window
        </button>
      </div>
      <div class="session-stats">
        <div class="stat clickable" data-stat-type="actions" data-toggle-actions="${session.id}">
          <span class="stat-value">${actionCount}</span>
          <span class="stat-label">Actions</span>
        </div>
        <div class="stat clickable ${errorCount > 0 ? 'has-errors' : ''}" data-stat-type="errors" data-toggle-errors="${session.id}">
          <span class="stat-value">${errorCount}</span>
          <span class="stat-label">Errors</span>
        </div>
        <div class="stat">
          <span class="stat-value">${windowCount}</span>
          <span class="stat-label">Windows</span>
        </div>
      </div>
      <div class="session-errors-section collapsed" id="errors-${session.id}">
        <div class="errors-loading">Loading errors...</div>
        <div class="errors-list"></div>
      </div>
      <div class="session-actions">
        ${session.status === 'recording' ? `
          <button class="btn btn-sm btn-secondary pause-btn" data-session-id="${session.id}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="6" y="4" width="4" height="16"/>
              <rect x="14" y="4" width="4" height="16"/>
            </svg>
            Pause
          </button>
        ` : session.status === 'paused' ? `
          <button class="btn btn-sm btn-primary resume-btn" data-session-id="${session.id}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polygon points="5,3 19,12 5,21"/>
            </svg>
            Resume
          </button>
        ` : ''}
        <button class="btn btn-sm btn-danger end-btn" data-session-id="${session.id}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
          </svg>
          End Session
        </button>
      </div>
    `;
    
    // Attach event listeners
    this.attachCardEventListeners(card, session.id);
    
    return card;
  }
  
  private attachCardEventListeners(card: HTMLElement, sessionId: string): void {
    // Window badges - click to focus
    const windowBadges = card.querySelectorAll('.window-badge[data-window-id]');
    windowBadges.forEach(badge => {
      badge.addEventListener('click', () => {
        const windowId = badge.getAttribute('data-window-id');
        if (windowId) {
          window.dashboardAPI.focusWindow(windowId);
        }
      });
    });
    
    // Add window button
    const addWindowBtn = card.querySelector('.add-window-btn');
    addWindowBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.handleAddWindow(sessionId);
    });
    
    // Pause/Resume buttons
    const pauseBtn = card.querySelector('.pause-btn');
    pauseBtn?.addEventListener('click', () => this.handlePauseSession(sessionId));
    
    const resumeBtn = card.querySelector('.resume-btn');
    resumeBtn?.addEventListener('click', () => this.handleResumeSession(sessionId));
    
    // End session button
    const endBtn = card.querySelector('.end-btn');
    endBtn?.addEventListener('click', () => this.handleEndSession(sessionId));
    
    // Error toggle
    const errorToggle = card.querySelector('[data-toggle-errors]');
    errorToggle?.addEventListener('click', () => this.handleToggleErrors(sessionId, card));
    
    // Actions toggle
    const actionsToggle = card.querySelector('[data-toggle-actions]');
    actionsToggle?.addEventListener('click', () => this.showActionsModal(sessionId));
  }
  
  private async handleToggleErrors(sessionId: string, card: HTMLElement): Promise<void> {
    const errorsSection = card.querySelector(`#errors-${sessionId}`);
    if (!errorsSection) return;
    
    const isExpanded = this.expandedErrorSections.has(sessionId);
    
    if (isExpanded) {
      this.expandedErrorSections.delete(sessionId);
      errorsSection.classList.remove('expanded');
      errorsSection.classList.add('collapsed');
    } else {
      this.expandedErrorSections.add(sessionId);
      errorsSection.classList.remove('collapsed');
      errorsSection.classList.add('expanded');
      
      const loadingEl = errorsSection.querySelector('.errors-loading');
      const listEl = errorsSection.querySelector('.errors-list');
      if (loadingEl) loadingEl.classList.add('visible');
      if (listEl) listEl.innerHTML = '';
      
      await this.fetchSessionErrors(sessionId);
      
      if (loadingEl) loadingEl.classList.remove('visible');
      this.renderErrorsList(sessionId, errorsSection);
    }
  }
  
  private renderErrorsList(sessionId: string, section: Element): void {
    const listEl = section.querySelector('.errors-list');
    if (!listEl) return;
    
    const allErrors = this.sessionErrors.get(sessionId) || [];
    // Filter out ignored errors
    const errors = allErrors.filter(err => !this.isErrorIgnored(err));
    const ignoredCount = allErrors.length - errors.length;
    
    // Update the displayed error count in the session card
    this.updateDisplayedErrorCount(sessionId, errors.length);
    
    if (errors.length === 0 && ignoredCount === 0) {
      listEl.innerHTML = `
        <div class="no-errors-message">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
            <polyline points="22,4 12,14.01 9,11.01"/>
          </svg>
          <span>No Errors, Looks Good!</span>
        </div>
      `;
      return;
    }
    
    // Ignored errors toggle section
    let ignoredSection = '';
    if (ignoredCount > 0 || this.ignoredErrorPatterns.size > 0) {
      ignoredSection = `
        <div class="ignored-errors-toggle" data-session-id="${sessionId}">
          <button class="btn btn-sm btn-ghost ignored-errors-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/>
              <line x1="1" y1="1" x2="23" y2="23"/>
            </svg>
            ${ignoredCount > 0 ? `${ignoredCount} ignored in this session` : ''}
            ${this.ignoredErrorPatterns.size > 0 ? `(${this.ignoredErrorPatterns.size} patterns)` : ''}
          </button>
        </div>
        <div class="ignored-errors-list hidden" data-session-id="${sessionId}">
          <div class="ignored-errors-header">
            <span>Ignored Error Patterns</span>
          </div>
          ${[...this.ignoredErrorPatterns].map(pattern => `
            <div class="ignored-pattern-item" data-pattern="${this.escapeHtml(pattern)}">
              <span class="pattern-text">${this.truncateText(pattern, 60)}</span>
              <button class="btn-icon unignore-btn" title="Stop ignoring this error">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="18" y1="6" x2="6" y2="18"/>
                  <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
          `).join('')}
        </div>
      `;
    }
    
    if (errors.length === 0) {
      listEl.innerHTML = `
        ${ignoredSection}
        <div class="no-errors-message">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
            <polyline points="22,4 12,14.01 9,11.01"/>
          </svg>
          <span>No Errors (${ignoredCount} ignored)</span>
        </div>
      `;
      this.attachIgnoredErrorsHandlers(listEl, sessionId);
      return;
    }
    
    // Group errors by window
    const errorsByWindow = new Map<string, TabError[]>();
    for (const error of errors) {
      const windowKey = error.windowLabel || error.windowId || 'Unknown Window';
      if (!errorsByWindow.has(windowKey)) {
        errorsByWindow.set(windowKey, []);
      }
      errorsByWindow.get(windowKey)!.push(error);
    }
    
    let html = ignoredSection;
    for (const [windowLabel, windowErrors] of errorsByWindow) {
      const windowId = windowErrors[0]?.windowId || windowLabel;
      html += `
        <div class="error-window-group collapsed" data-window-id="${windowId}">
          <div class="error-window-header collapsible" data-window-id="${windowId}">
            <svg class="chevron-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <path d="M3 9h18"/>
            </svg>
            <span class="window-label">${this.escapeHtml(windowLabel)}</span>
            <span class="error-count-badge">${windowErrors.length} errors</span>
          </div>
          <div class="error-items">
            ${windowErrors.slice(0, 20).map(err => this.renderErrorItem(err, sessionId)).join('')}
            ${windowErrors.length > 20 ? `<div class="more-errors">...and ${windowErrors.length - 20} more errors</div>` : ''}
          </div>
        </div>
      `;
    }
    
    listEl.innerHTML = html;
    
    // Add click handlers for collapsible window groups
    const headers = listEl.querySelectorAll('.error-window-header.collapsible');
    headers.forEach(header => {
      header.addEventListener('click', () => {
        const windowId = header.getAttribute('data-window-id');
        const group = listEl.querySelector(`.error-window-group[data-window-id="${windowId}"]`);
        if (group) {
          group.classList.toggle('collapsed');
        }
      });
    });
    
    // Attach ignore button handlers
    this.attachIgnoreButtonHandlers(listEl, sessionId);
    this.attachIgnoredErrorsHandlers(listEl, sessionId);
  }
  
  private updateDisplayedErrorCount(sessionId: string, visibleCount: number): void {
    // Update the error count in the session card
    const card = document.querySelector(`.session-card[data-session-id="${sessionId}"]`);
    if (card) {
      const errorStat = card.querySelector('.stat[data-stat-type="errors"] .stat-value');
      if (errorStat) {
        errorStat.textContent = String(visibleCount);
      }
      // Update has-errors class
      const statEl = card.querySelector('.stat[data-stat-type="errors"]');
      if (statEl) {
        if (visibleCount > 0) {
          statEl.classList.add('has-errors');
        } else {
          statEl.classList.remove('has-errors');
        }
      }
    }
  }
  
  private attachIgnoreButtonHandlers(listEl: Element, sessionId: string): void {
    const ignoreButtons = listEl.querySelectorAll('.ignore-error-btn');
    ignoreButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const errorId = btn.getAttribute('data-error-id');
        const errors = this.sessionErrors.get(sessionId) || [];
        const error = errors.find(err => err.id === errorId);
        if (error) {
          this.ignoreError(error);
          this.showToast('Error pattern ignored');
          // Re-render - look for either session or history errors section
          const section = listEl.closest('.session-errors-section') || 
                          listEl.closest('.history-errors-section') ||
                          listEl.closest('[id^="errors-"]');
          if (section) {
            this.renderErrorsList(sessionId, section);
          }
        }
      });
    });
  }
  
  private attachIgnoredErrorsHandlers(listEl: Element, sessionId: string): void {
    // Toggle ignored errors list
    const toggleBtn = listEl.querySelector('.ignored-errors-btn');
    const ignoredList = listEl.querySelector('.ignored-errors-list');
    
    toggleBtn?.addEventListener('click', () => {
      ignoredList?.classList.toggle('hidden');
    });
    
    // Unignore buttons
    const unignoreButtons = listEl.querySelectorAll('.unignore-btn');
    unignoreButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const patternItem = btn.closest('.ignored-pattern-item');
        const pattern = patternItem?.getAttribute('data-pattern');
        if (pattern) {
          this.unignoreError(pattern);
          this.showToast('Error pattern restored');
          // Re-render - look for either session or history errors section
          const section = listEl.closest('.session-errors-section') || 
                          listEl.closest('.history-errors-section') ||
                          listEl.closest('[id^="errors-"]');
          if (section) {
            this.renderErrorsList(sessionId, section);
          }
        }
      });
    });
  }
  
  private renderErrorItem(error: TabError, sessionId: string): string {
    const time = new Date(error.timestamp).toLocaleTimeString();
    const typeClass = (error.type === 'network' || error.type === 'http') ? 'network-error' : 'console-error';
    const statusBadge = error.statusCode 
      ? `<span class="error-status-badge">${error.statusCode}</span>` 
      : '';
    
    // Ensure error has an ID
    if (!error.id) {
      error.id = `error-${error.timestamp}-${Math.random().toString(36).substr(2, 9)}`;
    }
    
    return `
      <div class="error-item ${typeClass}" data-error-id="${error.id}">
        <div class="error-item-header">
          <span class="error-type-badge ${error.type}">${error.type}</span>
          ${statusBadge}
          <span class="error-time">${time}</span>
          <button class="btn-icon ignore-error-btn" data-error-id="${error.id}" title="Ignore this error type">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/>
              <line x1="1" y1="1" x2="23" y2="23"/>
            </svg>
          </button>
        </div>
        <div class="error-message" title="${this.escapeHtml(error.message)}">${this.truncateText(error.message, 100)}</div>
        ${error.source ? `<div class="error-source" title="${this.escapeHtml(error.source)}">${this.truncateText(error.source, 60)}</div>` : ''}
      </div>
    `;
  }
  
  private async showActionsModal(sessionId: string): Promise<void> {
    if (!this.actionsModal) return;
    
    const session = this.activeSessions.get(sessionId);
    const title = document.getElementById('actions-modal-title');
    const body = document.getElementById('actions-modal-body');
    
    if (title) title.textContent = `Actions: ${session?.name || 'Session'}`;
    if (body) body.innerHTML = '<div class="actions-loading visible">Loading actions...</div>';
    
    this.actionsModal.classList.remove('hidden');
    
    // Fetch actions
    await this.fetchSessionActions(sessionId);
    
    // Render actions
    if (body) this.renderActionsModalContent(sessionId, body);
  }
  
  private renderActionsModalContent(sessionId: string, container: HTMLElement): void {
    const actions = this.sessionActions.get(sessionId) || [];
    
    if (actions.length === 0) {
      container.innerHTML = `
        <div class="no-actions-message">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span>No actions recorded yet</span>
        </div>
      `;
      return;
    }
    
    // Group actions by window
    const actionsByWindow = new Map<string, RecordedAction[]>();
    for (const action of actions) {
      const windowKey = action.windowLabel || action.windowId || 'Unknown Window';
      if (!actionsByWindow.has(windowKey)) {
        actionsByWindow.set(windowKey, []);
      }
      actionsByWindow.get(windowKey)!.push(action);
    }
    
    let html = '';
    for (const [windowLabel, windowActions] of actionsByWindow) {
      const windowId = windowActions[0]?.windowId || windowLabel;
      html += `
        <div class="action-window-group collapsed" data-window-id="${windowId}">
          <div class="action-window-header collapsible" data-window-id="${windowId}">
            <svg class="chevron-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <path d="M3 9h18"/>
            </svg>
            <span class="window-label">${this.escapeHtml(windowLabel)}</span>
            <span class="action-count-badge">${windowActions.length} actions</span>
          </div>
          <div class="action-items">
            ${windowActions.slice(0, 50).map(action => this.renderActionItem(action)).join('')}
            ${windowActions.length > 50 ? `<div class="more-actions">...and ${windowActions.length - 50} more actions</div>` : ''}
          </div>
        </div>
      `;
    }
    
    container.innerHTML = html;
    
    // Add click handlers for collapsible window groups
    const headers = container.querySelectorAll('.action-window-header.collapsible');
    headers.forEach(header => {
      header.addEventListener('click', () => {
        const windowId = header.getAttribute('data-window-id');
        const group = container.querySelector(`.action-window-group[data-window-id="${windowId}"]`);
        if (group) {
          group.classList.toggle('collapsed');
        }
      });
    });
  }
  
  private renderActionItem(action: RecordedAction): string {
    const time = new Date(action.timestamp).toLocaleTimeString();
    const element = action.element?.selector || action.element?.tagName || '';
    
    let description: string = action.type;
    const data = action.data as Record<string, unknown>;
    if (action.type === 'type' && data?.text) {
      description = `typed "${this.truncateText(data.text as string, 30)}"`;
    } else if (action.type === 'click') {
      description = `clicked ${element ? 'on ' + this.truncateText(element, 30) : ''}`;
    } else if (action.type === 'navigate') {
      description = `navigated to ${this.truncateText(data?.url as string || '', 40)}`;
    }
    
    return `
      <div class="action-item">
        <div class="action-item-header">
          <span class="action-type-badge">${action.type}</span>
          <span class="action-time">${time}</span>
        </div>
        <div class="action-message">${this.escapeHtml(description)}</div>
        ${element ? `<div class="action-element">${this.truncateText(element, 80)}</div>` : ''}
      </div>
    `;
  }
  
  private hideActionsModal(): void {
    this.actionsModal?.classList.add('hidden');
  }
  
  private renderSessionHistory(sessions: Session[]): void {
    const container = document.getElementById('session-history-list');
    const emptyState = document.getElementById('no-history');
    
    if (!container) return;
    
    // Clear existing cards
    const cards = container.querySelectorAll('.history-card');
    cards.forEach(card => card.remove());
    
    const endedSessions = sessions.filter(s => s.status === 'ended');
    
    if (endedSessions.length === 0) {
      emptyState?.classList.remove('hidden');
      return;
    }
    
    emptyState?.classList.add('hidden');
    
    for (const session of endedSessions) {
      const card = this.createHistoryCard(session);
      container.appendChild(card);
    }
  }
  
  private createHistoryCard(session: Session): HTMLElement {
    const card = document.createElement('div');
    card.className = 'history-card';
    card.dataset.sessionId = session.id;
    
    const dateStr = new Date(session.startedAt).toLocaleDateString();
    const durationStr = session.endedAt 
      ? this.formatDurationBetween(session.startedAt, session.endedAt)
      : 'N/A';
    
    card.innerHTML = `
      <!-- Line 1: Title and Sync Status -->
      <div class="history-row history-row-title">
        <div class="history-title-group">
          <span class="history-name">${this.escapeHtml(session.name)}</span>
          <span class="sync-status-badge" data-session-id="${session.id}" title="Sync Status">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
            </svg>
            <span class="sync-status-text">Checking...</span>
          </span>
        </div>
        <div class="history-icon-actions">
          <button class="btn btn-sm btn-icon export-btn" data-session-id="${session.id}" title="Export Session">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
              <polyline points="7,10 12,15 17,10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </button>
          <button class="btn btn-sm btn-icon btn-danger delete-btn" data-session-id="${session.id}" title="Delete Session">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3,6 5,6 21,6"/>
              <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
            </svg>
          </button>
        </div>
      </div>
      
      <!-- Line 2: Time, Duration, Meta -->
      <div class="history-row history-row-meta">
        <span class="meta-item">${dateStr}</span>
        <span class="meta-separator">•</span>
        <span class="meta-item">Duration: ${durationStr}</span>
        <span class="meta-separator">•</span>
        <span class="meta-item">${session.actionCount || 0} actions</span>
        <span class="meta-separator">•</span>
        <span class="meta-item ${(session.errorCount || 0) > 0 ? 'has-errors' : ''}">${session.errorCount || 0} errors</span>
      </div>
      
      <!-- Line 3: Action Buttons -->
      <div class="history-row history-row-actions">
        <button class="btn btn-sm btn-secondary view-actions-btn" data-session-id="${session.id}" title="View Actions">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
          Actions
        </button>
        <button class="btn btn-sm btn-secondary view-errors-btn" data-session-id="${session.id}" title="View Errors">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          Errors
        </button>
        <button class="btn btn-sm btn-primary sync-btn" data-session-id="${session.id}" title="Sync to Cloud">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0118.8-4.3M22 12.5a10 10 0 01-18.8 4.2"/>
          </svg>
          Sync
        </button>
        <button class="btn btn-sm testcases-btn" data-session-id="${session.id}" title="Test Cases">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 11l3 3L22 4"/>
            <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
          </svg>
          Test Cases
        </button>
        <button class="btn btn-sm generate-btn" data-session-id="${session.id}" title="Generate Test Code">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
            <polyline points="14,2 14,8 20,8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
          </svg>
          Generate
        </button>
      </div>
      
      <!-- AI Section (shown when AI is enabled) -->
      <div class="history-row history-row-ai hidden" data-session-id="${session.id}">
        <span class="ai-section-label">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
          </svg>
          AI
        </span>
        <button class="ai-generate-btn ai-cases-btn" data-session-id="${session.id}" title="Generate Test Cases with AI">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 11l3 3L22 4"/>
            <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
          </svg>
          AI Cases
        </button>
        <button class="ai-generate-btn ai-code-btn" data-session-id="${session.id}" title="Generate Code with AI">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="16 18 22 12 16 6"/>
            <polyline points="8 6 2 12 8 18"/>
          </svg>
          AI Code
        </button>
      </div>
      </div>
      <div class="history-errors-section collapsed" id="history-errors-${session.id}">
        <div class="errors-loading">Loading errors...</div>
        <div class="errors-list"></div>
      </div>
    `;
    
    // Event listeners
    const exportBtn = card.querySelector('.export-btn');
    exportBtn?.addEventListener('click', () => window.dashboardAPI.exportSession(session.id));
    
    const deleteBtn = card.querySelector('.delete-btn');
    deleteBtn?.addEventListener('click', () => this.handleDeleteSession(session.id));
    
    const viewErrorsBtn = card.querySelector('.view-errors-btn');
    viewErrorsBtn?.addEventListener('click', () => this.handleToggleHistoryErrors(session.id, card));
    
    const viewActionsBtn = card.querySelector('.view-actions-btn');
    viewActionsBtn?.addEventListener('click', () => this.showActionsModalForHistory(session));
    
    const syncBtn = card.querySelector('.sync-btn');
    syncBtn?.addEventListener('click', async () => {
      const btn = syncBtn as HTMLButtonElement;
      const originalText = btn.innerHTML;
      btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spinning">
        <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0118.8-4.3M22 12.5a10 10 0 01-18.8 4.2"/>
      </svg> Syncing...`;
      btn.disabled = true;
      
      try {
        const result = await window.dashboardAPI.syncSession(session.id);
        if (result.success) {
          this.showToast('Session synced successfully!', 'success');
          btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="20,6 9,17 4,12"/>
          </svg> Synced`;
          // Update sync status badge
          this.updateSyncStatusBadge(session.id, 'synced');
        } else {
          this.showToast(`Sync failed: ${result.error || 'Unknown error'}`, 'error');
          btn.innerHTML = originalText;
          this.updateSyncStatusBadge(session.id, 'failed');
        }
      } catch (error) {
        console.error('Sync error:', error);
        this.showToast('Sync failed: Network error', 'error');
        btn.innerHTML = originalText;
        this.updateSyncStatusBadge(session.id, 'failed');
      } finally {
        btn.disabled = false;
      }
    });
    
    // Generate button handler
    const generateBtn = card.querySelector('.generate-btn');
    generateBtn?.addEventListener('click', () => this.openGenerateModal(session));
    
    // Test Cases button handler
    const testCasesBtn = card.querySelector('.testcases-btn');
    testCasesBtn?.addEventListener('click', () => this.openTestCasesModal(session));
    
    // AI button handlers
    const aiCasesBtn = card.querySelector('.ai-cases-btn');
    aiCasesBtn?.addEventListener('click', () => this.openAIGenerationModal(session.id, 'cases'));
    
    const aiCodeBtn = card.querySelector('.ai-code-btn');
    aiCodeBtn?.addEventListener('click', () => this.openAIGenerationModal(session.id, 'code'));
    
    // Check if AI is enabled and show AI section
    this.checkAndShowAISection(card, session.id);
    
    // Fetch sync status for this session
    this.fetchSyncStatus(session.id);
    
    return card;
  }
  
  private async checkAndShowAISection(card: HTMLElement, sessionId: string): Promise<void> {
    try {
      const aiEnabled = await window.dashboardAPI.checkAIEnabled();
      if (aiEnabled) {
        const aiSection = card.querySelector(`.history-row-ai[data-session-id="${sessionId}"]`);
        aiSection?.classList.remove('hidden');
      }
    } catch (error) {
      console.error('[Dashboard] Error checking AI status:', error);
    }
  }
  
  private async showActionsModalForHistory(session: Session): Promise<void> {
    if (!this.actionsModal) return;
    
    const title = document.getElementById('actions-modal-title');
    const body = document.getElementById('actions-modal-body');
    
    if (title) title.textContent = `Actions: ${session.name}`;
    if (body) body.innerHTML = '<div class="actions-loading visible">Loading actions...</div>';
    
    this.actionsModal.classList.remove('hidden');
    
    await this.fetchSessionActions(session.id);
    
    if (body) this.renderActionsModalContent(session.id, body);
  }
  
  private async handleToggleHistoryErrors(sessionId: string, card: HTMLElement): Promise<void> {
    const errorsSection = card.querySelector(`#history-errors-${sessionId}`);
    if (!errorsSection) return;
    
    const key = `history-${sessionId}`;
    const isExpanded = this.expandedErrorSections.has(key);
    
    if (isExpanded) {
      this.expandedErrorSections.delete(key);
      errorsSection.classList.remove('expanded');
      errorsSection.classList.add('collapsed');
    } else {
      this.expandedErrorSections.add(key);
      errorsSection.classList.remove('collapsed');
      errorsSection.classList.add('expanded');
      
      const loadingEl = errorsSection.querySelector('.errors-loading');
      const listEl = errorsSection.querySelector('.errors-list');
      if (loadingEl) loadingEl.classList.add('visible');
      if (listEl) listEl.innerHTML = '';
      
      await this.fetchSessionErrors(sessionId);
      
      if (loadingEl) loadingEl.classList.remove('visible');
      this.renderErrorsList(sessionId, errorsSection);
    }
  }
  
  private async handleDeleteSession(sessionId: string): Promise<void> {
    const confirmed = confirm('Are you sure you want to delete this session? This action cannot be undone.');
    
    if (confirmed) {
      try {
        await window.dashboardAPI.deleteSession(sessionId);
        const card = document.querySelector(`[data-session-id="${sessionId}"]`);
        card?.remove();
        
        const historyList = document.getElementById('session-history-list');
        const remainingCards = historyList?.querySelectorAll('.history-card');
        if (remainingCards?.length === 0) {
          const emptyState = document.getElementById('no-history');
          emptyState?.classList.remove('hidden');
        }
      } catch (error) {
        console.error('Failed to delete session:', error);
      }
    }
  }
  
  private showModal(): void {
    // Check session limit
    if (this.activeSessions.size >= this.settings.maxSessions) {
      this.showToast(`Maximum of ${this.settings.maxSessions} active sessions allowed`);
      return;
    }
    
    this.modal?.classList.remove('hidden');
    const firstInput = this.form?.querySelector('input') as HTMLInputElement;
    firstInput?.focus();
  }
  
  private hideModal(): void {
    this.modal?.classList.add('hidden');
    this.form?.reset();
  }
  
  private async handleCreateSession(e: Event): Promise<void> {
    e.preventDefault();
    
    const nameInput = document.getElementById('session-name') as HTMLInputElement;
    const descInput = document.getElementById('session-description') as HTMLTextAreaElement;
    const testSuiteInput = document.getElementById('test-suite') as HTMLInputElement;
    const envSelect = document.getElementById('environment') as HTMLSelectElement;
    const windowLabelInput = document.getElementById('window-label') as HTMLInputElement;
    
    const request: CreateSessionRequest = {
      name: nameInput.value.trim(),
      description: descInput.value.trim() || undefined,
      userId: 'qa-user',
      testSuite: testSuiteInput.value.trim() || undefined,
      environment: envSelect.value || undefined,
    };
    
    try {
      const session = await window.dashboardAPI.createSession(request);
      
      // Only add a window manually if there's no active session start rule
      // (the rule already handles window creation)
      const sessionStartRule = this.settings.sessionRules?.sessionStartRule;
      const hasActiveSessionRule = sessionStartRule && sessionStartRule.enabled;
      
      if (!hasActiveSessionRule) {
        const windowLabel = windowLabelInput.value.trim() || 'Main Browser';
        await window.dashboardAPI.addWindow(session.id, windowLabel);
      }
      
      this.hideModal();
    } catch (error) {
      console.error('Failed to create session:', error);
    }
  }
  
  private async handleAddWindow(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      console.error('[Dashboard] Cannot add window - session not found in activeSessions:', sessionId);
      return;
    }
    
    // Check window limit
    const windowCount = session.windows?.length || 0;
    if (windowCount >= this.settings.maxWindowsPerSession) {
      this.showToast(`Maximum of ${this.settings.maxWindowsPerSession} windows per session allowed`);
      return;
    }
    
    const windowNumber = windowCount + 1;
    const label = `Window ${windowNumber}`;
    
    console.log(`[Dashboard] Adding window "${label}" to session ${sessionId}`);
    
    try {
      const result = await window.dashboardAPI.addWindow(sessionId, label);
      console.log('[Dashboard] addWindow result:', result);
      if (result) {
        // Refresh the session to show the new window
        await this.refreshSession(sessionId);
        this.showToast(`Window "${label}" added`);
      } else {
        this.showToast('Failed to add window - check if limit reached');
      }
    } catch (error) {
      console.error('Failed to add window:', error);
      this.showToast('Failed to add window');
    }
  }
  
  private async handlePauseSession(sessionId: string): Promise<void> {
    try {
      await window.dashboardAPI.updateSessionStatus(sessionId, 'paused');
    } catch (error) {
      console.error('Failed to pause session:', error);
    }
  }
  
  private async handleResumeSession(sessionId: string): Promise<void> {
    try {
      await window.dashboardAPI.updateSessionStatus(sessionId, 'recording');
    } catch (error) {
      console.error('Failed to resume session:', error);
    }
  }
  
  private async handleEndSession(sessionId: string): Promise<void> {
    const confirmed = confirm('Are you sure you want to end this session? This will close all associated windows.');
    
    if (confirmed) {
      try {
        console.log('[Dashboard] Ending session:', sessionId);
        const result = await window.dashboardAPI.endSession(sessionId);
        console.log('[Dashboard] End session result:', result);
        
        // Explicitly remove from local state and re-render
        // (in case the event listener doesn't fire)
        this.activeSessions.delete(sessionId);
        this.renderActiveSessions();
        this.updateSessionBadge();
        
        // Refresh history to show the ended session
        await this.loadSessionHistory();
        
        console.log('[Dashboard] Session ended and UI updated');
      } catch (error) {
        console.error('Failed to end session:', error);
      }
    }
  }
  
  // ============================================
  // Code Generation Methods
  // ============================================
  
  private async openGenerateModal(session: Session): Promise<void> {
    if (!this.generateModal) return;
    
    this.currentGenerateSessionId = session.id;
    
    // Set test name based on session name
    const testNameInput = document.getElementById('generate-test-name') as HTMLInputElement;
    if (testNameInput) {
      testNameInput.value = `${session.name} Test`;
    }
    
    // Set session ID
    const sessionIdInput = document.getElementById('generate-session-id') as HTMLInputElement;
    if (sessionIdInput) {
      sessionIdInput.value = session.id;
    }
    
    // Reset pages preview
    const pagesPreview = document.getElementById('generate-pages-preview');
    if (pagesPreview) {
      pagesPreview.innerHTML = '<div class="loading-spinner">Detecting pages...</div>';
    }
    
    // Show modal
    this.generateModal.classList.remove('hidden');
    
    // Load preview
    await this.loadGeneratePreview(session.id);
  }
  
  private hideGenerateModal(): void {
    if (!this.generateModal) return;
    this.generateModal.classList.add('hidden');
    this.currentGenerateSessionId = null;
  }
  
  private async loadGeneratePreview(sessionId: string): Promise<void> {
    const pagesPreview = document.getElementById('generate-pages-preview');
    if (!pagesPreview) return;
    
    try {
      const preview = await window.dashboardAPI.previewCodegen(sessionId);
      
      if (preview.pages.length === 0) {
        pagesPreview.innerHTML = '<p class="no-pages">No pages detected. Make sure the session has recorded actions.</p>';
        return;
      }
      
      const pagesHtml = preview.pages.map(p => `
        <li>
          <span class="page-name">${this.escapeHtml(p.className)}</span>
          <span class="page-actions">${p.actionCount} actions</span>
        </li>
      `).join('');
      
      pagesPreview.innerHTML = `
        <ul>${pagesHtml}</ul>
        <div class="preview-summary">
          <strong>${preview.pages.length} pages</strong> • 
          <strong>${preview.totalActions} actions</strong> • 
          <strong>~${preview.estimatedFiles} files</strong>
        </div>
      `;
    } catch (error) {
      console.error('Failed to load preview:', error);
      pagesPreview.innerHTML = '<p class="error">Failed to load preview</p>';
    }
  }
  
  private async handleGenerateSubmit(): Promise<void> {
    const sessionId = this.currentGenerateSessionId;
    if (!sessionId) return;
    
    const testNameInput = document.getElementById('generate-test-name') as HTMLInputElement;
    const submitBtn = document.getElementById('generate-submit-btn') as HTMLButtonElement;
    const frameworkSelect = document.getElementById('generate-framework') as HTMLSelectElement;
    const languageSelect = document.getElementById('generate-language') as HTMLSelectElement;
    
    const testName = testNameInput?.value.trim();
    if (!testName) {
      this.showToast('Please enter a test name', 'error');
      return;
    }
    
    // Show loading state
    if (submitBtn) {
      submitBtn.classList.add('generating');
      submitBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 12a9 9 0 11-6.219-8.56"/>
        </svg>
        Generating...
      `;
      submitBtn.disabled = true;
    }
    
    try {
      const result = await window.dashboardAPI.generateCode({
        sessionId,
        testName,
        framework: (frameworkSelect?.value || 'playwright') as 'playwright',
        language: (languageSelect?.value || 'typescript') as 'typescript',
      });
      
      if (result.success) {
        this.showToast(`Test code generated successfully! ${result.filesGenerated?.length || 0} files created.`, 'success');
        this.hideGenerateModal();
        
        // Navigate to generated page
        this.navigateTo('generated');
        
        // Offer to open the folder
        if (result.outputPath) {
          const openFolder = confirm('Test code generated! Would you like to open the folder?');
          if (openFolder) {
            await window.dashboardAPI.openGeneratedFolder(result.outputPath);
          }
        }
      } else {
        this.showToast(`Generation failed: ${result.error || 'Unknown error'}`, 'error');
      }
    } catch (error) {
      console.error('Generate error:', error);
      this.showToast('Generation failed: Unexpected error', 'error');
    } finally {
      // Reset button state
      if (submitBtn) {
        submitBtn.classList.remove('generating');
        submitBtn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
            <polyline points="14,2 14,8 20,8"/>
          </svg>
          Generate
        `;
        submitBtn.disabled = false;
      }
    }
  }
  
  private async loadGeneratedProjects(): Promise<void> {
    const container = document.getElementById('generated-list');
    const emptyState = document.getElementById('no-generated');
    
    if (!container) return;
    
    try {
      // Load both AI jobs and regular generated projects
      // Handle each independently to avoid one failure breaking the other
      let jobs: AIJob[] = [];
      let projects: Array<{
        name: string;
        folderName: string;
        sessionId: string;
        framework: string;
        language: string;
        createdAt: number;
        pagesCount: number;
        actionsCount: number;
        files: string[];
      }> = [];
      
      try {
        jobs = await window.dashboardAPI.aiGetJobs();
      } catch (e) {
        console.warn('Failed to load AI jobs:', e);
      }
      
      try {
        projects = await window.dashboardAPI.listGeneratedProjects();
      } catch (e) {
        console.warn('Failed to load generated projects:', e);
      }
      
      if (jobs.length === 0 && projects.length === 0) {
        container.innerHTML = '';
        emptyState?.classList.remove('hidden');
        return;
      }
      
      emptyState?.classList.add('hidden');
      container.innerHTML = '';
      
      // Render AI jobs first (as line-item cards)
      for (const job of jobs) {
        const jobCard = this.createAIJobCard(job);
        container.appendChild(jobCard);
      }
      
      // Then render regular generated projects
      for (const project of projects) {
        const card = this.createGeneratedCard(project);
        container.appendChild(card);
      }
    } catch (error) {
      console.error('Failed to load generated projects:', error);
      container.innerHTML = '<p class="error">Failed to load generated projects</p>';
    }
  }
  
  private createAIJobCard(job: AIJob): HTMLElement {
    const card = document.createElement('div');
    card.className = `generated-item generated-item-${job.status}`;
    card.dataset.jobId = job.id;
    
    const dateStr = new Date(job.createdAt).toLocaleDateString();
    const timeStr = new Date(job.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    // Status info
    const statusInfo = this.getJobStatusInfo(job);
    
    // Job type label
    const typeLabels: Record<string, string> = {
      'test-cases': 'Test Cases',
      'code-new': 'New Code',
      'code-optimize': 'Optimize Code',
    };
    
    // Session name fallback
    const displayName = job.sessionName || 'Unknown Session';
    
    // Full error for tooltip
    const fullError = job.error ? this.escapeHtml(job.error) : '';
    
    card.innerHTML = `
      <div class="generated-item-icon">
        ${this.getJobTypeIcon(job.type)}
      </div>
      <div class="generated-item-info">
        <span class="generated-item-name">${this.escapeHtml(displayName)}</span>
        <span class="generated-item-meta">${typeLabels[job.type] || job.type} via ${job.model}</span>
        ${job.status === 'failed' && job.error ? `
          <span class="generated-item-error" title="${fullError}">
            ${this.escapeHtml(job.error.length > 200 ? job.error.substring(0, 200) + '...' : job.error)}
          </span>
        ` : ''}
      </div>
      <div class="generated-item-status ${statusInfo.class}" ${job.error ? `title="${fullError}"` : ''}>
        ${statusInfo.icon}
        <span class="status-text">${statusInfo.text}</span>
        ${job.status === 'in_progress' ? `
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${job.progress}%"></div>
          </div>
        ` : ''}
      </div>
      <div class="generated-item-date">${dateStr} ${timeStr}</div>
      <div class="generated-item-actions">
        ${job.promptFilePath ? `
          <button class="btn-icon btn-download-prompt" title="Download Prompt" data-action="download-prompt">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="12" y1="18" x2="12" y2="12"/>
              <polyline points="9 15 12 18 15 15"/>
            </svg>
          </button>
        ` : ''}
        ${job.actionsFilePath ? `
          <button class="btn-icon btn-download-actions" title="Download Actions" data-action="download-actions">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="8" y1="13" x2="16" y2="13"/>
              <line x1="8" y1="17" x2="16" y2="17"/>
            </svg>
          </button>
        ` : ''}
        ${job.status === 'in_progress' ? `
          <button class="btn-icon btn-stop" title="Stop" data-action="stop">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="6" y="6" width="12" height="12"/>
            </svg>
          </button>
        ` : ''}
        ${job.status === 'failed' || job.status === 'cancelled' ? `
          <button class="btn-icon btn-retry" title="Retry" data-action="retry">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M1 4v6h6"/>
              <path d="M3.51 15a9 9 0 102.13-9.36L1 10"/>
            </svg>
          </button>
        ` : ''}
        ${job.status === 'completed' ? `
          <button class="btn-icon btn-view" title="View Results" data-action="view">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
          </button>
        ` : ''}
        <button class="btn-icon btn-delete" title="Delete" data-action="delete">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3,6 5,6 21,6"/>
            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
          </svg>
        </button>
      </div>
    `;
    
    // Add event listeners
    this.attachJobCardListeners(card, job);
    
    return card;
  }
  
  private getJobStatusInfo(job: AIJob): { class: string; icon: string; text: string } {
    switch (job.status) {
      case 'pending':
        return {
          class: 'status-pending',
          icon: `<svg class="status-icon pulse" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
          </svg>`,
          text: 'Waiting...',
        };
      case 'in_progress':
        return {
          class: 'status-in-progress',
          icon: `<div class="spinner-small"></div>`,
          text: `Generating... (${job.completedBatches}/${job.totalBatches})`,
        };
      case 'completed':
        return {
          class: 'status-completed',
          icon: `<svg class="status-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
            <polyline points="22 4 12 14.01 9 11.01"/>
          </svg>`,
          text: job.tokensUsed
            ? (job.inputTokens && job.outputTokens
              ? `Completed (${job.inputTokens.toLocaleString()} in / ${job.outputTokens.toLocaleString()} out)`
              : `Completed (${job.tokensUsed.toLocaleString()} tokens)`)
            : 'Completed',
        };
      case 'failed': {
        return {
          class: 'status-failed',
          icon: `<svg class="status-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="15" y1="9" x2="9" y2="15"/>
            <line x1="9" y1="9" x2="15" y2="15"/>
          </svg>`,
          text: 'Failed. Try again',
        };
      }
      case 'cancelled':
        return {
          class: 'status-cancelled',
          icon: `<svg class="status-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="6" y="6" width="12" height="12"/>
          </svg>`,
          text: 'Cancelled',
        };
      default:
        return { class: '', icon: '', text: job.status };
    }
  }
  
  private getJobTypeIcon(type: string): string {
    if (type === 'test-cases') {
      return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M9 11l3 3L22 4"/>
        <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
      </svg>`;
    }
    return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="16 18 22 12 16 6"/>
      <polyline points="8 6 2 12 8 18"/>
    </svg>`;
  }
  
  private attachJobCardListeners(card: HTMLElement, job: AIJob): void {
    // Download prompt button
    card.querySelector('[data-action="download-prompt"]')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (job.promptFilePath) {
        await this.downloadDebugFile(job.promptFilePath);
      }
    });
    
    // Download actions button
    card.querySelector('[data-action="download-actions"]')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (job.actionsFilePath) {
        await this.downloadDebugFile(job.actionsFilePath);
      }
    });
    
    // Stop button
    card.querySelector('[data-action="stop"]')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm('Stop this generation? Progress will be lost.')) {
        await this.handleStopJob(job.id);
      }
    });
    
    // Retry button
    card.querySelector('[data-action="retry"]')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      await this.handleRetryJob(job.id);
    });
    
    // View button
    card.querySelector('[data-action="view"]')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      await this.handleViewJobResult(job.id);
    });
    
    // Delete button
    card.querySelector('[data-action="delete"]')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm('Delete this AI generation? This cannot be undone.')) {
        await this.handleDeleteJob(job.id);
      }
    });
    
    // Click on card to view (if completed or failed)
    card.addEventListener('click', async () => {
      if (job.status === 'completed') {
        await this.handleViewJobResult(job.id);
      } else if (job.status === 'failed') {
        await this.handleViewJobError(job.id);
      }
    });
  }
  
  private async handleStopJob(jobId: string): Promise<void> {
    try {
      await window.dashboardAPI.aiCancelJob(jobId);
      this.showToast('Generation stopped', 'info');
      await this.loadGeneratedProjects();
    } catch (error) {
      console.error('Failed to stop job:', error);
      this.showToast('Failed to stop generation', 'error');
    }
  }
  
  private async handleRetryJob(jobId: string): Promise<void> {
    try {
      await window.dashboardAPI.aiRetryJob(jobId);
      this.showToast('Generation restarted', 'info');
      await this.loadGeneratedProjects();
    } catch (error) {
      console.error('Failed to retry job:', error);
      this.showToast('Failed to restart generation', 'error');
    }
  }
  
  private async handleDeleteJob(jobId: string): Promise<void> {
    try {
      await window.dashboardAPI.aiDeleteJob(jobId);
      this.showToast('Generation deleted', 'success');
      await this.loadGeneratedProjects();
    } catch (error) {
      console.error('Failed to delete job:', error);
      this.showToast('Failed to delete generation', 'error');
    }
  }
  
  // ============================================
  // AI Error Modal
  // ============================================
  
  private currentErrorJob: AIJob | null = null;
  
  private async handleViewJobError(jobId: string): Promise<void> {
    const job = await window.dashboardAPI.aiGetJob(jobId);
    if (!job) {
      this.showToast('Job not found', 'error');
      return;
    }
    
    this.currentErrorJob = job;
    
    const modal = document.getElementById('ai-error-modal');
    if (!modal) return;
    
    // Populate job info
    const sessionEl = document.getElementById('ai-error-session');
    const typeEl = document.getElementById('ai-error-type');
    const providerEl = document.getElementById('ai-error-provider');
    const startedEl = document.getElementById('ai-error-started');
    const messageEl = document.getElementById('ai-error-detail-message');
    const debugSection = document.getElementById('ai-error-debug-section');
    const debugPathEl = document.getElementById('ai-error-debug-path');
    const downloadBtn = document.getElementById('ai-error-download-btn');
    
    const typeLabels: Record<string, string> = {
      'test-cases': 'Test Cases',
      'code-new': 'New Code',
      'code-optimize': 'Optimize Code',
    };
    
    if (sessionEl) sessionEl.textContent = job.sessionName || 'Unknown Session';
    if (typeEl) typeEl.textContent = typeLabels[job.type] || job.type;
    if (providerEl) providerEl.textContent = `${job.providerId} / ${job.model}`;
    if (startedEl) {
      startedEl.textContent = job.startedAt 
        ? new Date(job.startedAt).toLocaleString()
        : 'N/A';
    }
    if (messageEl) messageEl.textContent = job.error || 'An unknown error occurred during AI generation.';

    // Show tokens used if available
    const tokensRow = document.getElementById('ai-error-tokens-row');
    const tokensEl = document.getElementById('ai-error-tokens');
    if (job.tokensUsed && job.tokensUsed > 0) {
      if (tokensRow) tokensRow.style.display = '';
      if (tokensEl) {
        if (job.inputTokens && job.outputTokens) {
          tokensEl.textContent = `~${job.tokensUsed.toLocaleString()} total (${job.inputTokens.toLocaleString()} in / ${job.outputTokens.toLocaleString()} out)`;
        } else {
          tokensEl.textContent = `~${job.tokensUsed.toLocaleString()}`;
        }
      }
    } else {
      if (tokensRow) tokensRow.style.display = 'none';
    }
    
    // Show debug file section if available
    if (job.debugFilePath) {
      debugSection?.classList.remove('hidden');
      downloadBtn?.classList.remove('hidden');
      if (debugPathEl) debugPathEl.textContent = job.debugFilePath;
    } else {
      debugSection?.classList.add('hidden');
      downloadBtn?.classList.add('hidden');
    }
    
    // Setup listeners (only once)
    this.setupErrorModalListeners();
    
    // Show modal
    modal.classList.remove('hidden');
  }
  
  private errorModalListenersSetup = false;
  
  private setupErrorModalListeners(): void {
    if (this.errorModalListenersSetup) return;
    this.errorModalListenersSetup = true;
    
    const modal = document.getElementById('ai-error-modal');
    const closeBtn = document.getElementById('ai-error-modal-close');
    const closeBtnAction = document.getElementById('ai-error-close-btn');
    const retryBtn = document.getElementById('ai-error-retry-btn');
    const downloadBtn = document.getElementById('ai-error-download-btn');
    const backdrop = modal?.querySelector('.modal-backdrop');
    
    closeBtn?.addEventListener('click', () => this.closeErrorModal());
    closeBtnAction?.addEventListener('click', () => this.closeErrorModal());
    backdrop?.addEventListener('click', () => this.closeErrorModal());
    
    retryBtn?.addEventListener('click', async () => {
      if (this.currentErrorJob) {
        this.closeErrorModal();
        await this.handleRetryJob(this.currentErrorJob.id);
      }
    });
    
    downloadBtn?.addEventListener('click', async () => {
      if (this.currentErrorJob?.debugFilePath) {
        await this.downloadDebugFile(this.currentErrorJob.debugFilePath);
      }
    });
  }
  
  private closeErrorModal(): void {
    const modal = document.getElementById('ai-error-modal');
    modal?.classList.add('hidden');
    this.currentErrorJob = null;
  }
  
  private async downloadDebugFile(filePath: string): Promise<void> {
    try {
      const result = await window.dashboardAPI.readDebugFile(filePath);
      if (!result.success || !result.content) {
        this.showToast('Failed to read debug file', 'error');
        return;
      }
      
      // Create a blob and trigger download
      const blob = new Blob([result.content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filePath.split('/').pop() || 'debug-file.txt';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      this.showToast('Debug file downloaded', 'success');
    } catch (error) {
      console.error('Failed to download debug file:', error);
      this.showToast('Failed to download debug file', 'error');
    }
  }
  
  // ============================================
  // AI Result Modal
  // ============================================
  
  private currentResultJob: AIJob | null = null;
  private resultSelectedTestCases: Set<string> = new Set();
  
  private async handleViewJobResult(jobId: string): Promise<void> {
    const job = await window.dashboardAPI.aiGetJob(jobId);
    if (!job || !job.result) {
      this.showToast('No results available', 'error');
      return;
    }
    
    this.currentResultJob = job;
    this.resultSelectedTestCases = new Set();
    
    const modal = document.getElementById('ai-result-modal');
    if (!modal) return;
    
    // Update title
    const title = document.getElementById('ai-result-modal-title');
    if (title) {
      title.textContent = job.type === 'test-cases' ? 'Generated Test Cases' : 'Generated Code';
    }
    
    // Update info
    const sessionInfo = document.getElementById('ai-result-session');
    const providerInfo = document.getElementById('ai-result-provider');
    const tokensInfo = document.getElementById('ai-result-tokens');
    
    if (sessionInfo) sessionInfo.textContent = `Session: ${job.sessionName}`;
    if (providerInfo) providerInfo.textContent = `Model: ${job.model}`;
    if (tokensInfo) tokensInfo.textContent = `Tokens: ${job.tokensUsed || 'N/A'}`;
    
    // Show appropriate section
    const testcasesSection = document.getElementById('ai-result-testcases');
    const codeSection = document.getElementById('ai-result-code');
    const moveTcBtn = document.getElementById('ai-result-move-tc-btn');
    const saveCodeBtn = document.getElementById('ai-result-save-code-btn');
    
    if (job.type === 'test-cases') {
      testcasesSection?.classList.remove('hidden');
      codeSection?.classList.add('hidden');
      moveTcBtn?.classList.remove('hidden');
      saveCodeBtn?.classList.add('hidden');
      
      this.renderResultTestCases(job.result as { testCases?: Array<{
        id: string;
        name: string;
        description: string;
        steps: string;
        expectedResult: string;
        priority: 'critical' | 'high' | 'medium' | 'low';
      }> });
    } else {
      testcasesSection?.classList.add('hidden');
      codeSection?.classList.remove('hidden');
      moveTcBtn?.classList.add('hidden');
      saveCodeBtn?.classList.remove('hidden');
      
      this.renderResultCode(job.result as { code?: { code: string; changes?: string[] } });
    }
    
    // Setup event listeners
    this.setupResultModalListeners();
    
    // Show modal
    modal.classList.remove('hidden');
  }
  
  private renderResultTestCases(result: { testCases?: Array<{
    id: string;
    name: string;
    description: string;
    steps: string;
    expectedResult: string;
    priority: 'critical' | 'high' | 'medium' | 'low';
  }> }): void {
    const list = document.getElementById('ai-result-testcases-list');
    if (!list || !result.testCases) return;
    
    // Select all by default
    result.testCases.forEach(tc => this.resultSelectedTestCases.add(tc.id));
    
    list.innerHTML = result.testCases.map(tc => `
      <label class="ai-result-tc-item" data-tc-id="${tc.id}">
        <input type="checkbox" checked data-tc-id="${tc.id}">
        <div class="ai-result-tc-content">
          <div class="ai-result-tc-name">
            ${this.escapeHtml(tc.name)}
            <span class="ai-result-tc-priority ${tc.priority}">${tc.priority}</span>
          </div>
          <div class="ai-result-tc-desc">${this.escapeHtml(tc.description)}</div>
          <div class="ai-result-tc-expected">
            <strong>Expected:</strong> ${this.escapeHtml(tc.expectedResult)}
          </div>
        </div>
      </label>
    `).join('');
    
    // Add change listeners
    list.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
      checkbox.addEventListener('change', (e) => {
        const tcId = (e.target as HTMLInputElement).dataset.tcId;
        if (tcId) {
          if ((e.target as HTMLInputElement).checked) {
            this.resultSelectedTestCases.add(tcId);
          } else {
            this.resultSelectedTestCases.delete(tcId);
          }
          this.updateResultTcCount();
        }
      });
    });
    
    this.updateResultTcCount();
  }
  
  private updateResultTcCount(): void {
    const countEl = document.getElementById('ai-result-tc-count');
    const moveBtn = document.getElementById('ai-result-move-tc-btn') as HTMLButtonElement;
    
    if (countEl) {
      countEl.textContent = `${this.resultSelectedTestCases.size} test cases selected`;
    }
    if (moveBtn) {
      moveBtn.disabled = this.resultSelectedTestCases.size === 0;
    }
  }
  
  private renderResultCode(result: { code?: { code: string; changes?: string[] } }): void {
    const preview = document.getElementById('ai-result-code-preview');
    const changesSection = document.getElementById('ai-result-code-changes');
    const changesList = document.getElementById('ai-result-changes-list');
    
    if (preview && result.code) {
      const codeEl = preview.querySelector('code');
      if (codeEl) {
        codeEl.textContent = result.code.code;
      }
    }
    
    if (result.code?.changes && result.code.changes.length > 0) {
      changesSection?.classList.remove('hidden');
      if (changesList) {
        changesList.innerHTML = result.code.changes.map(c => 
          `<li>${this.escapeHtml(c)}</li>`
        ).join('');
      }
    } else {
      changesSection?.classList.add('hidden');
    }
  }
  
  private setupResultModalListeners(): void {
    const modal = document.getElementById('ai-result-modal');
    
    // Close button
    document.getElementById('ai-result-modal-close')?.addEventListener('click', () => {
      this.closeResultModal();
    });
    
    // Close button in footer
    document.getElementById('ai-result-close-btn')?.addEventListener('click', () => {
      this.closeResultModal();
    });
    
    // Backdrop click
    modal?.querySelector('.modal-backdrop')?.addEventListener('click', () => {
      this.closeResultModal();
    });
    
    // Select/Deselect all
    document.getElementById('ai-result-select-all')?.addEventListener('click', () => {
      this.resultSelectAllTestCases(true);
    });
    
    document.getElementById('ai-result-deselect-all')?.addEventListener('click', () => {
      this.resultSelectAllTestCases(false);
    });
    
    // Copy code
    document.getElementById('ai-result-copy-code')?.addEventListener('click', () => {
      this.copyResultCode();
    });
    
    // Move to test cases
    document.getElementById('ai-result-move-tc-btn')?.addEventListener('click', () => {
      this.moveResultToTestCases();
    });
    
    // Save code
    document.getElementById('ai-result-save-code-btn')?.addEventListener('click', () => {
      this.saveResultCode();
    });
  }
  
  private closeResultModal(): void {
    const modal = document.getElementById('ai-result-modal');
    modal?.classList.add('hidden');
    this.currentResultJob = null;
    this.resultSelectedTestCases.clear();
  }
  
  private resultSelectAllTestCases(select: boolean): void {
    const list = document.getElementById('ai-result-testcases-list');
    if (!list) return;
    
    list.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
      (checkbox as HTMLInputElement).checked = select;
      const tcId = (checkbox as HTMLInputElement).dataset.tcId;
      if (tcId) {
        if (select) {
          this.resultSelectedTestCases.add(tcId);
        } else {
          this.resultSelectedTestCases.delete(tcId);
        }
      }
    });
    
    this.updateResultTcCount();
  }
  
  private copyResultCode(): void {
    const preview = document.getElementById('ai-result-code-preview');
    const codeEl = preview?.querySelector('code');
    if (codeEl?.textContent) {
      navigator.clipboard.writeText(codeEl.textContent).then(() => {
        this.showToast('Code copied to clipboard!', 'success');
      }).catch(() => {
        this.showToast('Failed to copy code', 'error');
      });
    }
  }
  
  private async moveResultToTestCases(): Promise<void> {
    if (!this.currentResultJob || this.resultSelectedTestCases.size === 0) return;
    
    const result = this.currentResultJob.result as { testCases?: Array<{
      id: string;
      name: string;
      description: string;
      steps: string;
      expectedResult: string;
      priority: 'critical' | 'high' | 'medium' | 'low';
    }> };
    
    if (!result.testCases) return;
    
    const selectedCases = result.testCases.filter(tc => 
      this.resultSelectedTestCases.has(tc.id)
    );
    
    try {
      const apiResult = await window.dashboardAPI.aiMoveToTestCases(
        this.currentResultJob.sessionId,
        selectedCases
      );
      
      if (apiResult.success) {
        this.showToast(`${selectedCases.length} test cases moved successfully!`, 'success');
        this.closeResultModal();
      } else {
        this.showToast('Failed to move test cases', 'error');
      }
    } catch (error) {
      console.error('Error moving test cases:', error);
      this.showToast('Failed to move test cases', 'error');
    }
  }
  
  private async saveResultCode(): Promise<void> {
    if (!this.currentResultJob) return;
    
    const result = this.currentResultJob.result as { code?: { code: string; framework: string; language: string } };
    if (!result.code) return;
    
    try {
      const genResult = await window.dashboardAPI.generateCode({
        sessionId: this.currentResultJob.sessionId,
        testName: this.currentResultJob.sessionName,
        framework: (result.code.framework || 'playwright') as 'playwright',
        language: (result.code.language || 'typescript') as 'typescript',
      });
      
      if (genResult.success) {
        this.showToast('Code saved to Generated folder!', 'success');
        this.closeResultModal();
        await this.loadGeneratedProjects();
      } else {
        this.showToast(`Failed to save code: ${genResult.error || 'Unknown error'}`, 'error');
      }
    } catch (error) {
      console.error('Error saving code:', error);
      this.showToast('Failed to save code', 'error');
    }
  }
  
  // ============================================
  // Job Polling
  // ============================================
  
  private jobPollInterval: NodeJS.Timeout | null = null;
  private readonly JOB_POLL_INTERVAL_MS = 3000;
  
  private startJobPolling(): void {
    // Clear any existing interval
    this.stopJobPolling();
    
    // Start new polling interval
    this.jobPollInterval = setInterval(async () => {
      await this.pollJobUpdates();
    }, this.JOB_POLL_INTERVAL_MS);
    
    console.log('[Dashboard] Started job polling');
  }
  
  private stopJobPolling(): void {
    if (this.jobPollInterval) {
      clearInterval(this.jobPollInterval);
      this.jobPollInterval = null;
      console.log('[Dashboard] Stopped job polling');
    }
  }
  
  private async pollJobUpdates(): Promise<void> {
    try {
      // Get all jobs to check for status changes
      const allJobs = await window.dashboardAPI.aiGetJobs();
      const container = document.getElementById('generated-list');
      
      // Check if any jobs changed status (e.g., from in_progress to completed)
      let statusChanged = false;
      for (const job of allJobs) {
        const card = container?.querySelector(`.generated-item[data-job-id="${job.id}"]`);
        if (card) {
          const currentStatusClass = card.className.match(/generated-item-(\w+)/)?.[1];
          if (currentStatusClass && currentStatusClass !== job.status) {
            // Status changed, need to refresh
            statusChanged = true;
            break;
          }
        }
      }
      
      if (statusChanged) {
        // Refresh the entire list to show updated status
        await this.loadGeneratedProjects();
      } else {
        // Just update progress for in-progress jobs
        const activeJobs = allJobs.filter(j => j.status === 'pending' || j.status === 'in_progress');
        for (const job of activeJobs) {
          this.updateJobCardInPlace(job);
        }
      }
      
      // Check if we should stop polling (no more active jobs)
      const hasActiveJobs = allJobs.some(j => j.status === 'pending' || j.status === 'in_progress');
      if (!hasActiveJobs) {
        this.stopJobPolling();
      }
    } catch (error) {
      console.error('[Dashboard] Error polling job updates:', error);
    }
  }
  
  private updateJobCardInPlace(job: AIJob): void {
    const card = document.querySelector(`.generated-item[data-job-id="${job.id}"]`) as HTMLElement;
    if (!card) return;
    
    // Update progress bar
    const progressFill = card.querySelector('.progress-fill') as HTMLElement;
    if (progressFill) {
      progressFill.style.width = `${job.progress}%`;
    }
    
    // Update status text
    const statusText = card.querySelector('.status-text');
    if (statusText) {
      statusText.textContent = `Generating... (${job.completedBatches}/${job.totalBatches})`;
    }
  }
  
  private createGeneratedCard(project: {
    name: string;
    folderName: string;
    sessionId: string;
    framework: string;
    language: string;
    createdAt: number;
    pagesCount: number;
    actionsCount: number;
    files: string[];
  }): HTMLElement {
    const card = document.createElement('div');
    card.className = 'generated-card';
    
    const dateStr = new Date(project.createdAt).toLocaleDateString();
    
    card.innerHTML = `
      <div class="generated-card-header">
        <h4 class="generated-card-title">${this.escapeHtml(project.name)}</h4>
        <span class="generated-card-date">${dateStr}</span>
      </div>
      <div class="generated-card-meta">
        <span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
          </svg>
          ${project.pagesCount} pages
        </span>
        <span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9,14 4,9 9,4"/>
            <path d="M20 20v-7a4 4 0 00-4-4H4"/>
          </svg>
          ${project.actionsCount} actions
        </span>
        <span class="generated-card-framework">${project.framework}</span>
      </div>
      <div class="generated-card-actions">
        <button class="btn btn-sm btn-primary open-btn" title="Open in File Explorer">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
          </svg>
          Open
        </button>
        <button class="btn btn-sm btn-danger delete-btn" title="Delete">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3,6 5,6 21,6"/>
            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
          </svg>
          Delete
        </button>
      </div>
    `;
    
    // Event listeners
    const openBtn = card.querySelector('.open-btn');
    openBtn?.addEventListener('click', async () => {
      try {
        const outputDirFull = await window.dashboardAPI.getCodegenOutputDir();
        await window.dashboardAPI.openGeneratedFolder(`${outputDirFull}/${project.folderName}`);
      } catch (error) {
        console.error('Open folder error:', error);
        this.showToast('Failed to open folder', 'error');
      }
    });
    
    const deleteBtn = card.querySelector('.delete-btn');
    deleteBtn?.addEventListener('click', async () => {
      if (!confirm(`Are you sure you want to delete "${project.name}"? This cannot be undone.`)) {
        return;
      }
      
      try {
        const outputDirFull = await window.dashboardAPI.getCodegenOutputDir();
        const result = await window.dashboardAPI.deleteGeneratedProject(`${outputDirFull}/${project.folderName}`);
        if (result.success) {
          this.showToast('Project deleted', 'success');
          this.loadGeneratedProjects(); // Refresh list
        } else {
          this.showToast('Failed to delete project', 'error');
        }
      } catch (error) {
        console.error('Delete project error:', error);
        this.showToast('Failed to delete project', 'error');
      }
    });
    
    return card;
  }
  
  // ============================================
  // Test Cases Modal
  // ============================================
  
  private testCasesModal: HTMLElement | null = null;
  private testCaseDetailModal: HTMLElement | null = null;
  private currentTestCasesSession: Session | null = null;
  private testCases: TestCase[] = [];
  private filteredTestCases: TestCase[] = [];
  
  private async openTestCasesModal(session: Session): Promise<void> {
    this.testCasesModal = document.getElementById('test-cases-modal');
    this.testCaseDetailModal = document.getElementById('test-case-detail-modal');
    if (!this.testCasesModal) return;
    
    this.currentTestCasesSession = session;
    
    // Update session name in header
    const sessionNameEl = document.getElementById('test-cases-session-name');
    if (sessionNameEl) sessionNameEl.textContent = session.name;
    
    // Show loading state
    const loadingEl = document.getElementById('test-cases-loading');
    const listEl = document.getElementById('test-cases-list');
    const emptyEl = document.getElementById('test-cases-empty');
    
    loadingEl?.classList.remove('hidden');
    listEl?.classList.add('hidden');
    emptyEl?.classList.add('hidden');
    
    this.testCasesModal.classList.remove('hidden');
    
    // Check if session has test cases
    const hasCases = await window.dashboardAPI.hasTestCases(session.id);
    
    if (!hasCases) {
      // Generate test cases first time
      this.showToast('Generating test cases...', 'info');
      const result = await window.dashboardAPI.generateTestCases(session.id);
      
      if (!result.success) {
        this.showToast(result.error || 'Failed to generate test cases', 'error');
        loadingEl?.classList.add('hidden');
        emptyEl?.classList.remove('hidden');
        return;
      }
      
      this.testCases = result.testCases;
      this.showToast(`Generated ${result.testCases.length} test cases`, 'success');
    } else {
      // Load existing test cases
      this.testCases = await window.dashboardAPI.getTestCases(session.id);
    }
    
    // Update stats
    await this.updateTestCaseStats(session.id);
    
    // Apply filters and render
    this.applyTestCaseFilters();
    
    loadingEl?.classList.add('hidden');
  }
  
  private async updateTestCaseStats(sessionId: string): Promise<void> {
    const stats = await window.dashboardAPI.getTestCaseStats(sessionId);
    
    const totalEl = document.getElementById('tc-total');
    const pendingEl = document.getElementById('tc-pending');
    const passedEl = document.getElementById('tc-passed');
    const failedEl = document.getElementById('tc-failed');
    const skippedEl = document.getElementById('tc-skipped');
    
    if (totalEl) totalEl.textContent = String(stats.total);
    if (pendingEl) pendingEl.textContent = String(stats.pending);
    if (passedEl) passedEl.textContent = String(stats.passed);
    if (failedEl) failedEl.textContent = String(stats.failed);
    if (skippedEl) skippedEl.textContent = String(stats.skipped);
  }
  
  private applyTestCaseFilters(): void {
    const statusFilter = (document.getElementById('tc-filter-status') as HTMLSelectElement)?.value || 'all';
    const priorityFilter = (document.getElementById('tc-filter-priority') as HTMLSelectElement)?.value || 'all';
    const categoryFilter = (document.getElementById('tc-filter-category') as HTMLSelectElement)?.value || 'all';
    const sourceFilter = (document.getElementById('tc-filter-source') as HTMLSelectElement)?.value || 'all';
    
    this.filteredTestCases = this.testCases.filter(tc => {
      if (statusFilter !== 'all' && tc.status !== statusFilter) return false;
      if (priorityFilter !== 'all' && tc.priority !== priorityFilter) return false;
      if (categoryFilter !== 'all' && tc.category !== categoryFilter) return false;
      if (sourceFilter !== 'all') {
        const tcSource = (tc as TestCase & { source?: string }).source || 'auto';
        if (tcSource !== sourceFilter) return false;
      }
      return true;
    });
    
    this.renderTestCasesList();
  }
  
  private renderTestCasesList(): void {
    const sectionsEl = document.getElementById('test-cases-sections');
    const emptyEl = document.getElementById('test-cases-empty');
    
    if (!sectionsEl) return;
    
    if (this.filteredTestCases.length === 0) {
      sectionsEl.classList.add('hidden');
      emptyEl?.classList.remove('hidden');
      return;
    }
    
    sectionsEl.classList.remove('hidden');
    emptyEl?.classList.add('hidden');
    
    // Group test cases by status
    const pending = this.filteredTestCases.filter(tc => tc.status === 'pending');
    const passed = this.filteredTestCases.filter(tc => tc.status === 'passed');
    const failed = this.filteredTestCases.filter(tc => tc.status === 'failed');
    const skipped = this.filteredTestCases.filter(tc => tc.status === 'skipped');
    
    // Update section counts
    const pendingCount = document.getElementById('section-count-pending');
    const passedCount = document.getElementById('section-count-passed');
    const failedCount = document.getElementById('section-count-failed');
    const skippedCount = document.getElementById('section-count-skipped');
    
    if (pendingCount) pendingCount.textContent = String(pending.length);
    if (passedCount) passedCount.textContent = String(passed.length);
    if (failedCount) failedCount.textContent = String(failed.length);
    if (skippedCount) skippedCount.textContent = String(skipped.length);
    
    // Render each section
    this.renderTestCasesSection('section-list-pending', pending);
    this.renderTestCasesSection('section-list-passed', passed);
    this.renderTestCasesSection('section-list-failed', failed);
    this.renderTestCasesSection('section-list-skipped', skipped);
    
    // Setup section toggle listeners
    this.setupSectionToggles();
  }
  
  private renderTestCasesSection(containerId: string, testCases: TestCase[]): void {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    if (testCases.length === 0) {
      container.innerHTML = '<div class="section-empty">No test cases in this section</div>';
      return;
    }
    
    container.innerHTML = testCases.map(tc => this.createTestCaseItem(tc)).join('');
    
    // Add click listeners to each item
    container.querySelectorAll('.tc-item').forEach(item => {
      item.addEventListener('click', (e) => {
        const tcId = (item as HTMLElement).dataset.tcId;
        if (tcId) {
          if ((e.target as HTMLElement).closest('.tc-quick-btn')) {
            return;
          }
          this.openTestCaseDetail(tcId);
        }
      });
      
      item.querySelectorAll('.tc-quick-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const tcId = (item as HTMLElement).dataset.tcId;
          const status = (btn as HTMLElement).dataset.status as 'passed' | 'failed' | 'skipped';
          if (tcId && status) {
            await this.updateTestCaseStatusQuick(tcId, status);
          }
        });
      });
    });
  }
  
  private setupSectionToggles(): void {
    document.querySelectorAll('.test-cases-section-header').forEach(header => {
      // Remove existing listeners by cloning
      const newHeader = header.cloneNode(true) as HTMLElement;
      header.parentNode?.replaceChild(newHeader, header);
      
      newHeader.addEventListener('click', () => {
        const section = newHeader.closest('.test-cases-section');
        const body = section?.querySelector('.test-cases-section-body');
        section?.classList.toggle('collapsed');
        body?.classList.toggle('collapsed');
      });
    });
  }
  
  private createTestCaseItem(tc: TestCase): string {
    const statusIcon = this.getStatusIcon(tc.status);
    const tcWithSource = tc as TestCase & { source?: string };
    const source = tcWithSource.source || 'auto';
    const sourceBadge = `<span class="tc-source-badge ${source}">${source === 'manual' ? 'Manual' : 'Auto'}</span>`;
    
    // For manual test cases, show description; for auto, show field name
    const fieldInfo = source === 'manual' 
      ? '' 
      : `<div class="tc-field">Field: ${this.escapeHtml(tc.fieldName || 'N/A')}</div>`;
    const categoryBadge = tc.category 
      ? `<span class="tc-badge tc-badge-${tc.category}">${tc.category}</span>` 
      : '';
    
    return `
      <div class="tc-item" data-tc-id="${tc.id}" data-status="${tc.status}">
        <div class="tc-checkbox">
          ${statusIcon}
        </div>
        <div class="tc-content">
          <div class="tc-header">
            <span class="tc-name">${this.escapeHtml(tc.name)}</span>
            ${sourceBadge}
            <div class="tc-badges">
              <span class="tc-badge tc-badge-${tc.priority}">${tc.priority}</span>
              ${categoryBadge}
            </div>
          </div>
          ${fieldInfo}
          <div class="tc-description">${this.escapeHtml(tc.description || '')}</div>
        </div>
        <div class="tc-quick-actions">
          <button class="tc-quick-btn pass" data-status="passed" title="Mark as Passed">✓</button>
          <button class="tc-quick-btn fail" data-status="failed" title="Mark as Failed">✗</button>
          <button class="tc-quick-btn skip" data-status="skipped" title="Skip">→</button>
        </div>
      </div>
    `;
  }
  
  private getStatusIcon(status: string): string {
    switch (status) {
      case 'passed':
        return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>';
      case 'failed':
        return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      case 'skipped':
        return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></svg>';
      default:
        return '';
    }
  }
  
  private async updateTestCaseStatusQuick(tcId: string, status: 'pending' | 'passed' | 'failed' | 'skipped'): Promise<void> {
    const result = await window.dashboardAPI.updateTestCaseStatus(tcId, status);
    
    if (result.success) {
      // Update local state
      const tc = this.testCases.find(t => t.id === tcId);
      if (tc) tc.status = status;
      
      // Re-render and update stats
      this.applyTestCaseFilters();
      if (this.currentTestCasesSession) {
        await this.updateTestCaseStats(this.currentTestCasesSession.id);
      }
    } else {
      this.showToast('Failed to update test case', 'error');
    }
  }
  
  private openTestCaseDetail(tcId: string): void {
    const tc = this.testCases.find(t => t.id === tcId);
    if (!tc || !this.testCaseDetailModal) return;
    
    // Populate modal fields
    (document.getElementById('tc-detail-id') as HTMLInputElement).value = tc.id;
    (document.getElementById('tc-detail-title') as HTMLElement).textContent = tc.name;
    (document.getElementById('tc-detail-field') as HTMLElement).textContent = tc.fieldName;
    (document.getElementById('tc-detail-description') as HTMLElement).textContent = tc.description;
    (document.getElementById('tc-detail-category') as HTMLElement).textContent = tc.category;
    (document.getElementById('tc-detail-category') as HTMLElement).className = `tc-badge tc-badge-${tc.category}`;
    (document.getElementById('tc-detail-priority') as HTMLElement).textContent = tc.priority;
    (document.getElementById('tc-detail-priority') as HTMLElement).className = `tc-badge tc-badge-${tc.priority}`;
    (document.getElementById('tc-detail-test-value') as HTMLElement).textContent = tc.testValue || '(empty)';
    (document.getElementById('tc-detail-expected') as HTMLElement).textContent = tc.expectedResult;
    (document.getElementById('tc-detail-code') as HTMLElement).textContent = tc.playwrightCode || '// No code generated';
    (document.getElementById('tc-detail-notes') as HTMLTextAreaElement).value = tc.notes || '';
    
    // Set current status
    const statusBtns = document.querySelectorAll('#tc-status-buttons .tc-status-btn');
    statusBtns.forEach(btn => {
      btn.classList.remove('active');
      if ((btn as HTMLElement).dataset.status === tc.status) {
        btn.classList.add('active');
      }
    });
    
    this.testCaseDetailModal.classList.remove('hidden');
  }
  
  private setupTestCasesListeners(): void {
    // Close modal
    const closeBtn = document.getElementById('test-cases-modal-close');
    closeBtn?.addEventListener('click', () => this.closeTestCasesModal());
    
    // Close detail modal
    const detailCloseBtn = document.getElementById('tc-detail-close');
    const detailCancelBtn = document.getElementById('tc-detail-cancel');
    detailCloseBtn?.addEventListener('click', () => this.closeTestCaseDetailModal());
    detailCancelBtn?.addEventListener('click', () => this.closeTestCaseDetailModal());
    
    // Save detail changes
    const detailSaveBtn = document.getElementById('tc-detail-save');
    detailSaveBtn?.addEventListener('click', () => this.saveTestCaseDetail());
    
    // Status buttons in detail modal
    const statusBtns = document.querySelectorAll('#tc-status-buttons .tc-status-btn');
    statusBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        statusBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });
    
    // Filters
    const statusFilter = document.getElementById('tc-filter-status');
    const priorityFilter = document.getElementById('tc-filter-priority');
    const categoryFilter = document.getElementById('tc-filter-category');
    const sourceFilter = document.getElementById('tc-filter-source');
    
    statusFilter?.addEventListener('change', () => this.applyTestCaseFilters());
    priorityFilter?.addEventListener('change', () => this.applyTestCaseFilters());
    categoryFilter?.addEventListener('change', () => this.applyTestCaseFilters());
    sourceFilter?.addEventListener('change', () => this.applyTestCaseFilters());
    
    // Export buttons
    const exportMdBtn = document.getElementById('test-cases-export-md-btn');
    const exportPwBtn = document.getElementById('test-cases-export-pw-btn');
    const exportCsvBtn = document.getElementById('test-cases-export-csv-btn');
    const exportExcelBtn = document.getElementById('test-cases-export-excel-btn');
    
    exportMdBtn?.addEventListener('click', async () => {
      if (!this.currentTestCasesSession) return;
      const result = await window.dashboardAPI.exportTestCasesMarkdown(
        this.currentTestCasesSession.id,
        this.currentTestCasesSession.name
      );
      if (result.success) {
        this.showToast('Exported to ' + result.path, 'success');
      } else {
        this.showToast(result.error || 'Export failed', 'error');
      }
    });
    
    exportPwBtn?.addEventListener('click', async () => {
      if (!this.currentTestCasesSession) return;
      const result = await window.dashboardAPI.exportTestCasesPlaywright(
        this.currentTestCasesSession.id,
        this.currentTestCasesSession.name
      );
      if (result.success) {
        this.showToast('Exported to ' + result.path, 'success');
      } else {
        this.showToast(result.error || 'Export failed', 'error');
      }
    });
    
    exportCsvBtn?.addEventListener('click', async () => {
      if (!this.currentTestCasesSession) return;
      const result = await window.dashboardAPI.exportTestCasesCsv(
        this.currentTestCasesSession.id,
        this.currentTestCasesSession.name
      );
      if (result.success) {
        this.showToast('Exported to ' + result.path, 'success');
      } else {
        this.showToast(result.error || 'Export failed', 'error');
      }
    });
    
    exportExcelBtn?.addEventListener('click', async () => {
      if (!this.currentTestCasesSession) return;
      const result = await window.dashboardAPI.exportTestCasesExcel(
        this.currentTestCasesSession.id,
        this.currentTestCasesSession.name
      );
      if (result.success) {
        this.showToast('Exported to ' + result.path, 'success');
      } else {
        this.showToast(result.error || 'Export failed', 'error');
      }
    });
    
    // Backdrop click
    const backdrop = this.testCasesModal?.querySelector('.modal-backdrop');
    backdrop?.addEventListener('click', () => this.closeTestCasesModal());
  }
  
  private async saveTestCaseDetail(): Promise<void> {
    const tcId = (document.getElementById('tc-detail-id') as HTMLInputElement).value;
    const notes = (document.getElementById('tc-detail-notes') as HTMLTextAreaElement).value;
    const activeStatusBtn = document.querySelector('#tc-status-buttons .tc-status-btn.active');
    const status = (activeStatusBtn as HTMLElement)?.dataset.status as 'pending' | 'passed' | 'failed' | 'skipped' || 'pending';
    
    const result = await window.dashboardAPI.updateTestCaseStatus(tcId, status, notes);
    
    if (result.success) {
      // Update local state
      const tc = this.testCases.find(t => t.id === tcId);
      if (tc) {
        tc.status = status;
        tc.notes = notes;
      }
      
      this.closeTestCaseDetailModal();
      this.applyTestCaseFilters();
      if (this.currentTestCasesSession) {
        await this.updateTestCaseStats(this.currentTestCasesSession.id);
      }
      this.showToast('Test case updated', 'success');
    } else {
      this.showToast('Failed to update test case', 'error');
    }
  }
  
  private closeTestCasesModal(): void {
    this.testCasesModal?.classList.add('hidden');
    this.currentTestCasesSession = null;
  }
  
  private closeTestCaseDetailModal(): void {
    this.testCaseDetailModal?.classList.add('hidden');
  }
  
  // ============================================
  // Session Rules
  // ============================================
  
  private rulesHaveUnsavedChanges = false;
  
  private setupSessionRulesListeners(): void {
    const createRuleBtn = document.getElementById('create-rule-btn');
    const addRuleBtn = document.getElementById('add-rule-btn');
    const saveRulesBtn = document.getElementById('save-rules-btn');
    
    createRuleBtn?.addEventListener('click', () => this.showRuleCreator());
    addRuleBtn?.addEventListener('click', () => this.showRuleCreator());
    saveRulesBtn?.addEventListener('click', () => this.saveSessionRules());
    
    // Initial render
    this.renderSessionRules();
  }
  
  private markRulesAsUnsaved(): void {
    this.rulesHaveUnsavedChanges = true;
    const indicator = document.getElementById('rules-unsaved-indicator');
    indicator?.classList.remove('hidden');
  }
  
  private markRulesAsSaved(): void {
    this.rulesHaveUnsavedChanges = false;
    const indicator = document.getElementById('rules-unsaved-indicator');
    indicator?.classList.add('hidden');
  }
  
  private async saveSessionRules(): Promise<void> {
    this.saveSettings();
    await this.syncSessionRulesToMain();
    this.markRulesAsSaved();
    this.showToast('Session rules saved', 'success');
  }
  
  private showRuleCreator(): void {
    // Check which rules already exist
    const rules = this.settings.sessionRules || {};
    const hasSessionStartRule = !!rules.sessionStartRule;
    const hasWindowOpenRule = !!rules.windowOpenRule;
    
    // If both rules exist, don't allow more
    if (hasSessionStartRule && hasWindowOpenRule) {
      this.showToast('Maximum of 2 rules allowed (one per event type)', 'info');
      return;
    }
    
    // Determine which event to default to
    const defaultEvent = !hasSessionStartRule ? 'session_start' : 'window_open';
    
    // Create a new rule
    const newRule: SessionRule = {
      id: `rule-${Date.now()}`,
      event: defaultEvent,
      enabled: true,
      windowCount: defaultEvent === 'session_start' ? 1 : undefined,
      windowUrls: defaultEvent === 'session_start' ? [''] : undefined,
      defaultUrl: defaultEvent === 'window_open' ? '' : undefined,
    };
    
    // Add to settings
    if (defaultEvent === 'session_start') {
      this.settings.sessionRules = { ...rules, sessionStartRule: newRule };
    } else {
      this.settings.sessionRules = { ...rules, windowOpenRule: newRule };
    }
    
    this.renderSessionRules();
    this.markRulesAsUnsaved();
  }
  
  private updateSessionRule(ruleType: 'session_start' | 'window_open', updates: Partial<SessionRule>): void {
    const rules = this.settings.sessionRules || {};
    
    if (ruleType === 'session_start' && rules.sessionStartRule) {
      this.settings.sessionRules = {
        ...rules,
        sessionStartRule: { ...rules.sessionStartRule, ...updates }
      };
    } else if (ruleType === 'window_open' && rules.windowOpenRule) {
      this.settings.sessionRules = {
        ...rules,
        windowOpenRule: { ...rules.windowOpenRule, ...updates }
      };
    }
    
    this.markRulesAsUnsaved();
  }
  
  private deleteSessionRule(ruleType: 'session_start' | 'window_open'): void {
    const rules = this.settings.sessionRules || {};
    
    if (ruleType === 'session_start') {
      this.settings.sessionRules = { ...rules, sessionStartRule: undefined };
    } else {
      this.settings.sessionRules = { ...rules, windowOpenRule: undefined };
    }
    
    this.renderSessionRules();
    this.markRulesAsUnsaved();
  }
  
  private renderSessionRules(): void {
    const emptyState = document.getElementById('rules-empty-state');
    const rulesList = document.getElementById('rules-list');
    const rulesActions = document.getElementById('rules-actions');
    const saveContainer = document.getElementById('rules-save-container');
    
    if (!emptyState || !rulesList || !rulesActions) return;
    
    const rules = this.settings.sessionRules || {};
    const hasRules = rules.sessionStartRule || rules.windowOpenRule;
    
    if (!hasRules) {
      emptyState.classList.remove('hidden');
      rulesList.classList.add('hidden');
      rulesActions.classList.add('hidden');
      saveContainer?.classList.add('hidden');
      return;
    }
    
    emptyState.classList.add('hidden');
    rulesList.classList.remove('hidden');
    saveContainer?.classList.remove('hidden');
    
    // Show add rule button only if less than 2 rules
    const ruleCount = (rules.sessionStartRule ? 1 : 0) + (rules.windowOpenRule ? 1 : 0);
    if (ruleCount < 2) {
      rulesActions.classList.remove('hidden');
    } else {
      rulesActions.classList.add('hidden');
    }
    
    // Render rule cards
    let html = '';
    
    if (rules.sessionStartRule) {
      html += this.renderRuleCard(rules.sessionStartRule);
    }
    
    if (rules.windowOpenRule) {
      html += this.renderRuleCard(rules.windowOpenRule);
    }
    
    rulesList.innerHTML = html;
    this.attachRuleCardListeners();
  }
  
  private renderRuleCard(rule: SessionRule): string {
    const isSessionStart = rule.event === 'session_start';
    const eventLabel = isSessionStart ? 'When Session Starts' : 'When Window Opens';
    const eventDescription = isSessionStart 
      ? 'Triggers when a new session is created'
      : 'Triggers when a new window is manually added';
    const eventTooltip = isSessionStart
      ? 'Automatically launches the specified number of windows with configured URLs when you start a new session.'
      : 'Automatically navigates to the configured URL when you manually add a new window to an active session.';
    const eventIcon = isSessionStart 
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>';
    
    let actionHtml = '';
    
    if (isSessionStart) {
      const windowCount = rule.windowCount || 1;
      const windowUrls = rule.windowUrls || Array(windowCount).fill('');
      
      actionHtml = `
        <div class="rule-config-section">
          <span class="rule-config-label">Action: Launch Windows</span>
          <div class="rule-window-count">
            <label>Number of windows:</label>
            <input type="number" min="1" max="${this.settings.maxWindowsPerSession}" value="${windowCount}" 
                   data-rule-type="${rule.event}" data-field="windowCount">
          </div>
          <div class="rule-window-urls">
            ${windowUrls.map((url, i) => `
              <div class="rule-window-url-item">
                <span class="window-number">${i + 1}</span>
                <div class="url-input-group">
                  <span class="url-label">Launch URL for Window ${i + 1}</span>
                  <input type="url" placeholder="https://example.com" value="${this.escapeHtml(url)}"
                         data-rule-type="${rule.event}" data-field="windowUrl" data-index="${i}">
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    } else {
      actionHtml = `
        <div class="rule-config-section">
          <span class="rule-config-label">Action: Launch URL</span>
          <input type="url" class="rule-default-url" placeholder="https://example.com" 
                 value="${this.escapeHtml(rule.defaultUrl || '')}"
                 data-rule-type="${rule.event}" data-field="defaultUrl">
        </div>
      `;
    }
    
    return `
      <div class="rule-card ${rule.enabled ? '' : 'disabled'}" data-rule-id="${rule.id}">
        <div class="rule-header">
          <div class="rule-header-left">
            <div class="rule-event-label">
              <div class="rule-event-icon">
                ${eventIcon}
              </div>
              <div class="rule-event-text">
                <span class="rule-event-title">${eventLabel}</span>
                <span class="rule-event-description">${eventDescription}</span>
              </div>
              <div class="rule-info-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="12" y1="16" x2="12" y2="12"/>
                  <line x1="12" y1="8" x2="12.01" y2="8"/>
                </svg>
                <div class="rule-info-tooltip">${eventTooltip}</div>
              </div>
            </div>
          </div>
          <div class="rule-header-actions">
            <div class="rule-toggle">
              <label class="toggle-switch">
                <input type="checkbox" ${rule.enabled ? 'checked' : ''} data-rule-type="${rule.event}" data-field="enabled">
                <span class="toggle-slider"></span>
              </label>
            </div>
            <button class="rule-delete-btn" data-rule-type="${rule.event}" title="Delete rule">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
              </svg>
            </button>
          </div>
        </div>
        <div class="rule-body">
          ${actionHtml}
        </div>
      </div>
    `;
  }
  
  private attachRuleCardListeners(): void {
    const rulesList = document.getElementById('rules-list');
    if (!rulesList) return;
    
    // Info icon tooltip positioning
    rulesList.querySelectorAll('.rule-info-icon').forEach(icon => {
      icon.addEventListener('mouseenter', (e) => {
        const target = e.currentTarget as HTMLElement;
        const tooltip = target.querySelector('.rule-info-tooltip') as HTMLElement;
        if (!tooltip) return;
        
        const iconRect = target.getBoundingClientRect();
        const tooltipWidth = 300;
        
        // Position below the icon and to the right
        tooltip.style.top = `${iconRect.bottom + 8}px`;
        tooltip.style.left = `${Math.max(10, iconRect.left - tooltipWidth / 2 + iconRect.width / 2)}px`;
        
        // Ensure it doesn't go off the right edge
        const rightEdge = iconRect.left - tooltipWidth / 2 + iconRect.width / 2 + tooltipWidth;
        if (rightEdge > window.innerWidth - 10) {
          tooltip.style.left = `${window.innerWidth - tooltipWidth - 10}px`;
        }
      });
    });
    
    // Window count changes
    rulesList.querySelectorAll('input[data-field="windowCount"]').forEach(input => {
      input.addEventListener('change', (e) => {
        const target = e.target as HTMLInputElement;
        const ruleType = target.dataset.ruleType as 'session_start' | 'window_open';
        const newCount = Math.min(Math.max(1, parseInt(target.value) || 1), this.settings.maxWindowsPerSession);
        
        const rules = this.settings.sessionRules || {};
        const currentRule = rules.sessionStartRule;
        if (currentRule && ruleType === 'session_start') {
          const currentUrls = currentRule.windowUrls || [];
          const newUrls = Array(newCount).fill('').map((_, i) => currentUrls[i] || '');
          this.updateSessionRule(ruleType, { windowCount: newCount, windowUrls: newUrls });
          this.renderSessionRules();
        }
      });
    });
    
    // Window URL changes
    rulesList.querySelectorAll('input[data-field="windowUrl"]').forEach(input => {
      input.addEventListener('change', (e) => {
        const target = e.target as HTMLInputElement;
        const ruleType = target.dataset.ruleType as 'session_start' | 'window_open';
        const index = parseInt(target.dataset.index || '0');
        
        const rules = this.settings.sessionRules || {};
        const currentRule = rules.sessionStartRule;
        if (currentRule && ruleType === 'session_start') {
          const urls = [...(currentRule.windowUrls || [])];
          urls[index] = target.value;
          this.updateSessionRule(ruleType, { windowUrls: urls });
        }
      });
    });
    
    // Default URL changes (for window_open rule)
    rulesList.querySelectorAll('input[data-field="defaultUrl"]').forEach(input => {
      input.addEventListener('change', (e) => {
        const target = e.target as HTMLInputElement;
        const ruleType = target.dataset.ruleType as 'session_start' | 'window_open';
        this.updateSessionRule(ruleType, { defaultUrl: target.value });
      });
    });
    
    // Enabled toggle
    rulesList.querySelectorAll('input[data-field="enabled"]').forEach(input => {
      input.addEventListener('change', (e) => {
        const target = e.target as HTMLInputElement;
        const ruleType = target.dataset.ruleType as 'session_start' | 'window_open';
        this.updateSessionRule(ruleType, { enabled: target.checked });
        this.renderSessionRules();
      });
    });
    
    // Delete buttons
    rulesList.querySelectorAll('.rule-delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLElement;
        const ruleType = target.dataset.ruleType as 'session_start' | 'window_open';
        if (confirm('Are you sure you want to delete this rule?')) {
          this.deleteSessionRule(ruleType);
        }
      });
    });
  }
  
  private async syncSessionRulesToMain(): Promise<void> {
    try {
      await window.dashboardAPI.setSessionRules(this.settings.sessionRules || {});
    } catch (error) {
      console.error('Failed to sync session rules to main process:', error);
    }
  }
  
  // ============================================
  // AI Integrations
  // ============================================
  
  private currentAIProviderConfig: {
    providerId: AIProviderId | null;
    apiKey: string;
    selectedModel: string;
    isEnabled: boolean;
    isValid: boolean;
  } = {
    providerId: null,
    apiKey: '',
    selectedModel: '',
    isEnabled: false,
    isValid: false,
  };
  
  private setupAIIntegrationsListeners(): void {
    // Configure buttons for each provider
    document.querySelectorAll('.ai-provider-configure').forEach(btn => {
      btn.addEventListener('click', async () => {
        const providerId = btn.getAttribute('data-provider') as AIProviderId;
        await this.openAIProviderModal(providerId);
      });
    });
    
    // Modal close button
    const modalClose = document.getElementById('ai-provider-modal-close');
    const cancelBtn = document.getElementById('ai-provider-cancel-btn');
    
    modalClose?.addEventListener('click', () => this.closeAIProviderModal());
    cancelBtn?.addEventListener('click', () => this.closeAIProviderModal());
    
    // Modal backdrop click
    const modal = document.getElementById('ai-provider-modal');
    modal?.querySelector('.modal-backdrop')?.addEventListener('click', () => this.closeAIProviderModal());
    
    // API key toggle visibility
    const apiKeyToggle = document.getElementById('ai-api-key-toggle');
    const apiKeyInput = document.getElementById('ai-api-key') as HTMLInputElement;
    
    apiKeyToggle?.addEventListener('click', () => {
      if (apiKeyInput) {
        apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
      }
    });
    
    // Test connection button
    const testBtn = document.getElementById('ai-provider-test-btn');
    testBtn?.addEventListener('click', () => this.testAIConnection());
    
    // Save button
    const saveBtn = document.getElementById('ai-provider-save-btn');
    saveBtn?.addEventListener('click', () => this.saveAIProvider());
    
    // Auto-fallback toggle
    const autoFallbackToggle = document.getElementById('ai-auto-fallback') as HTMLInputElement;
    autoFallbackToggle?.addEventListener('change', async () => {
      await window.dashboardAPI.updateAISettings({ autoFallback: autoFallbackToggle.checked });
    });
    
    // Setup drag-and-drop for provider reordering
    this.setupAIProviderDragAndDrop();
    
    // Load initial AI settings
    this.loadAISettings();
  }
  
  private async loadAISettings(): Promise<void> {
    try {
      const settings = await window.dashboardAPI.getAISettings();
      
      // Update auto-fallback toggle
      const autoFallbackToggle = document.getElementById('ai-auto-fallback') as HTMLInputElement;
      if (autoFallbackToggle) {
        autoFallbackToggle.checked = settings.autoFallback;
      }
      
      // Update provider cards
      for (const providerId of ['openai', 'anthropic', 'gemini'] as AIProviderId[]) {
        const provider = settings.providers.find(p => p.id === providerId);
        const hasKey = await window.dashboardAPI.hasAIKey(providerId);
        this.updateProviderCard(providerId, provider, hasKey);
      }
      
      // Reorder cards based on priority
      this.reorderProviderCards(settings.providers);
    } catch (error) {
      console.error('Failed to load AI settings:', error);
    }
  }
  
  private updateProviderCard(providerId: AIProviderId, provider: AIProviderConfig | undefined, hasKey: boolean): void {
    const card = document.querySelector(`.ai-provider-card[data-provider="${providerId}"]`);
    if (!card) return;
    
    const modelSpan = card.querySelector('.ai-provider-model');
    const statusDot = card.querySelector('.status-dot');
    const statusText = card.querySelector('.status-text');
    
    if (hasKey && provider?.isEnabled) {
      card.classList.add('connected');
      statusDot?.classList.remove('disconnected');
      statusDot?.classList.add('connected');
      if (statusText) statusText.textContent = 'Connected';
      if (modelSpan) modelSpan.textContent = provider.selectedModel || 'No model selected';
    } else {
      card.classList.remove('connected');
      statusDot?.classList.add('disconnected');
      statusDot?.classList.remove('connected');
      if (statusText) statusText.textContent = hasKey ? 'Disabled' : 'Not Connected';
      if (modelSpan) modelSpan.textContent = hasKey ? 'Configured' : 'Not configured';
    }
  }
  
  private reorderProviderCards(providers: AIProviderConfig[]): void {
    const list = document.getElementById('ai-providers-list');
    if (!list) return;
    
    // Sort providers by priority
    const sortedProviders = [...providers].sort((a, b) => a.priority - b.priority);
    
    // Reorder DOM elements
    sortedProviders.forEach(provider => {
      const card = list.querySelector(`.ai-provider-card[data-provider="${provider.id}"]`);
      if (card) {
        list.appendChild(card);
      }
    });
  }
  
  private async openAIProviderModal(providerId: AIProviderId): Promise<void> {
    const modal = document.getElementById('ai-provider-modal');
    if (!modal) return;
    
    // Set provider ID
    this.currentAIProviderConfig.providerId = providerId;
    
    // Update modal title
    const titles: Record<AIProviderId, string> = {
      openai: 'Configure OpenAI',
      anthropic: 'Configure Anthropic',
      gemini: 'Configure Google Gemini',
    };
    const titleEl = document.getElementById('ai-provider-modal-title');
    if (titleEl) titleEl.textContent = titles[providerId];
    
    // Update API key hint
    const hints: Record<AIProviderId, string> = {
      openai: 'Get your API key from platform.openai.com',
      anthropic: 'Get your API key from console.anthropic.com',
      gemini: 'Get your API key from ai.google.dev',
    };
    const hintEl = document.getElementById('ai-api-key-hint');
    if (hintEl) hintEl.textContent = hints[providerId];
    
    // Load provider config
    const provider = await window.dashboardAPI.getAIProvider(providerId);
    const hasKey = await window.dashboardAPI.hasAIKey(providerId);
    
    // Reset form
    const apiKeyInput = document.getElementById('ai-api-key') as HTMLInputElement;
    const modelSelect = document.getElementById('ai-model-select') as HTMLSelectElement;
    const enabledToggle = document.getElementById('ai-provider-enabled') as HTMLInputElement;
    const saveBtn = document.getElementById('ai-provider-save-btn') as HTMLButtonElement;
    
    if (apiKeyInput) {
      apiKeyInput.value = '';
      apiKeyInput.placeholder = hasKey ? '••••••••••••••••' : 'Enter your API key';
    }
    
    if (modelSelect) {
      modelSelect.innerHTML = '<option value="">Validate API key first</option>';
      modelSelect.disabled = !hasKey;
    }
    
    if (enabledToggle) {
      enabledToggle.checked = provider?.isEnabled || false;
    }
    
    this.currentAIProviderConfig.selectedModel = provider?.selectedModel || '';
    this.currentAIProviderConfig.isEnabled = provider?.isEnabled || false;
    this.currentAIProviderConfig.isValid = hasKey;
    
    // If provider has key, load models
    if (hasKey) {
      await this.loadModelsForProvider(providerId, provider?.selectedModel);
    }
    
    // Update save button state
    if (saveBtn) {
      saveBtn.disabled = !hasKey && !apiKeyInput?.value;
    }
    
    // Hide validation status
    this.hideValidationStatus();
    
    // Show modal
    modal.classList.remove('hidden');
  }
  
  private closeAIProviderModal(): void {
    const modal = document.getElementById('ai-provider-modal');
    if (modal) {
      modal.classList.add('hidden');
    }
    
    // Reset state
    this.currentAIProviderConfig = {
      providerId: null,
      apiKey: '',
      selectedModel: '',
      isEnabled: false,
      isValid: false,
    };
  }
  
  private async loadModelsForProvider(providerId: AIProviderId, selectedModel?: string): Promise<void> {
    const modelSelect = document.getElementById('ai-model-select') as HTMLSelectElement;
    if (!modelSelect) return;
    
    modelSelect.innerHTML = '<option value="">Loading models...</option>';
    modelSelect.disabled = true;
    
    try {
      const models = await window.dashboardAPI.getAIModels(providerId);
      
      modelSelect.innerHTML = '';
      
      if (models.length === 0) {
        modelSelect.innerHTML = '<option value="">No models available</option>';
        return;
      }
      
      models.forEach(model => {
        const option = document.createElement('option');
        option.value = model.id;
        option.textContent = model.name;
        if (model.description) {
          option.title = model.description;
        }
        if (model.id === selectedModel) {
          option.selected = true;
        }
        modelSelect.appendChild(option);
      });
      
      modelSelect.disabled = false;
      
      // Set selected model if none was specified
      if (!selectedModel && models.length > 0) {
        this.currentAIProviderConfig.selectedModel = models[0].id;
      }
    } catch (error) {
      console.error('Failed to load models:', error);
      modelSelect.innerHTML = '<option value="">Failed to load models</option>';
    }
  }
  
  private async testAIConnection(): Promise<void> {
    const providerId = this.currentAIProviderConfig.providerId;
    if (!providerId) return;
    
    const apiKeyInput = document.getElementById('ai-api-key') as HTMLInputElement;
    const apiKey = apiKeyInput?.value;
    
    if (!apiKey) {
      this.showValidationError('Please enter an API key');
      return;
    }
    
    // Show loading state
    this.showValidationLoading();
    
    try {
      const result = await window.dashboardAPI.validateAIKey(providerId, apiKey);
      
      if (result.valid) {
        this.showValidationSuccess();
        this.currentAIProviderConfig.apiKey = apiKey;
        this.currentAIProviderConfig.isValid = true;
        
        // Enable save button
        const saveBtn = document.getElementById('ai-provider-save-btn') as HTMLButtonElement;
        if (saveBtn) saveBtn.disabled = false;
        
        // Load models
        await this.loadModelsForProvider(providerId);
      } else {
        this.showValidationError(result.error || 'Invalid API key');
        this.currentAIProviderConfig.isValid = false;
      }
    } catch (error) {
      this.showValidationError('Connection failed. Please try again.');
      this.currentAIProviderConfig.isValid = false;
    }
  }
  
  private showValidationLoading(): void {
    const container = document.getElementById('ai-validation-status');
    const loading = document.getElementById('ai-validation-loading');
    const success = document.getElementById('ai-validation-success');
    const error = document.getElementById('ai-validation-error');
    
    container?.classList.remove('hidden');
    loading?.classList.remove('hidden');
    success?.classList.add('hidden');
    error?.classList.add('hidden');
  }
  
  private showValidationSuccess(): void {
    const container = document.getElementById('ai-validation-status');
    const loading = document.getElementById('ai-validation-loading');
    const success = document.getElementById('ai-validation-success');
    const error = document.getElementById('ai-validation-error');
    
    container?.classList.remove('hidden');
    loading?.classList.add('hidden');
    success?.classList.remove('hidden');
    error?.classList.add('hidden');
  }
  
  private showValidationError(message: string): void {
    const container = document.getElementById('ai-validation-status');
    const loading = document.getElementById('ai-validation-loading');
    const success = document.getElementById('ai-validation-success');
    const error = document.getElementById('ai-validation-error');
    const errorMsg = document.getElementById('ai-validation-error-msg');
    
    container?.classList.remove('hidden');
    loading?.classList.add('hidden');
    success?.classList.add('hidden');
    error?.classList.remove('hidden');
    if (errorMsg) errorMsg.textContent = message;
  }
  
  private hideValidationStatus(): void {
    const container = document.getElementById('ai-validation-status');
    container?.classList.add('hidden');
  }
  
  private async saveAIProvider(): Promise<void> {
    const providerId = this.currentAIProviderConfig.providerId;
    if (!providerId) return;
    
    const modelSelect = document.getElementById('ai-model-select') as HTMLSelectElement;
    const enabledToggle = document.getElementById('ai-provider-enabled') as HTMLInputElement;
    
    const selectedModel = modelSelect?.value || this.currentAIProviderConfig.selectedModel;
    const isEnabled = enabledToggle?.checked || false;
    
    try {
      // Store API key if a new one was validated
      if (this.currentAIProviderConfig.apiKey) {
        await window.dashboardAPI.storeAIKey(providerId, this.currentAIProviderConfig.apiKey);
      }
      
      // Update provider config
      await window.dashboardAPI.updateAIProvider(providerId, {
        selectedModel,
        isEnabled,
        lastValidated: Date.now(),
      });
      
      // Refresh provider card
      const provider = await window.dashboardAPI.getAIProvider(providerId);
      const hasKey = await window.dashboardAPI.hasAIKey(providerId);
      this.updateProviderCard(providerId, provider as AIProviderConfig | undefined, hasKey);
      
      // Close modal
      this.closeAIProviderModal();
    } catch (error) {
      console.error('Failed to save AI provider:', error);
      this.showValidationError('Failed to save configuration');
    }
  }
  
  private setupAIProviderDragAndDrop(): void {
    const list = document.getElementById('ai-providers-list');
    if (!list) return;
    
    let draggedCard: HTMLElement | null = null;
    
    // Make cards draggable
    list.querySelectorAll('.ai-provider-card').forEach(card => {
      card.setAttribute('draggable', 'true');
      
      card.addEventListener('dragstart', (e) => {
        draggedCard = card as HTMLElement;
        (card as HTMLElement).style.opacity = '0.5';
        (e as DragEvent).dataTransfer?.setData('text/plain', '');
      });
      
      card.addEventListener('dragend', () => {
        (card as HTMLElement).style.opacity = '1';
        draggedCard = null;
        
        // Save new order
        this.saveProviderOrder();
      });
      
      card.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (!draggedCard || draggedCard === card) return;
        
        const rect = card.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        
        if ((e as DragEvent).clientY < midY) {
          list.insertBefore(draggedCard, card);
        } else {
          list.insertBefore(draggedCard, card.nextSibling);
        }
      });
    });
  }
  
  private async saveProviderOrder(): Promise<void> {
    const list = document.getElementById('ai-providers-list');
    if (!list) return;
    
    const orderedIds: AIProviderId[] = [];
    list.querySelectorAll('.ai-provider-card').forEach(card => {
      const providerId = card.getAttribute('data-provider') as AIProviderId;
      if (providerId) {
        orderedIds.push(providerId);
      }
    });
    
    try {
      await window.dashboardAPI.reorderAIProviders(orderedIds);
    } catch (error) {
      console.error('Failed to save provider order:', error);
    }
  }
  
  // ============================================
  // AI Generation Modal Methods
  // ============================================
  
  private aiModal: HTMLElement | null = null;
  private aiCurrentSessionId = '';
  private aiCurrentMode: 'cases' | 'code' = 'cases';
  private aiSelectedActionIds: Set<string> = new Set();
  private aiModalListenersSetup = false;
  private aiGeneratedTestCases: Array<{
    id: string;
    name: string;
    description: string;
    steps: string;
    expectedResult: string;
    priority: 'critical' | 'high' | 'medium' | 'low';
    selected: boolean;
  }> = [];
  private aiGeneratedCode = '';
  
  private async openAIGenerationModal(sessionId: string, mode: 'cases' | 'code'): Promise<void> {
    this.aiModal = document.getElementById('ai-generation-modal');
    if (!this.aiModal) return;
    
    this.aiCurrentSessionId = sessionId;
    this.aiCurrentMode = mode;
    this.aiSelectedActionIds = new Set();
    this.aiGeneratedTestCases = [];
    this.aiGeneratedCode = '';
    
    // Update modal title
    const title = document.getElementById('ai-modal-title');
    if (title) {
      title.textContent = mode === 'cases' ? 'Generate AI Test Cases' : 'Generate AI Code';
    }
    
    // Show/hide code options
    const codeOptions = document.getElementById('ai-code-options');
    if (codeOptions) {
      codeOptions.classList.toggle('hidden', mode === 'cases');
    }
    
    // Reset UI state
    this.resetAIModalState();
    
    // Load AI providers for selection
    await this.loadAIProvidersForModal();
    
    // Load actions for selection
    await this.loadActionsForAIModal(sessionId);
    
    // Setup event listeners
    this.setupAIModalEventListeners();
    
    // Show modal
    this.aiModal.classList.remove('hidden');
  }
  
  private aiEnabledProviders: Array<{
    id: string;
    name: string;
    selectedModel: string;
    cachedModels?: Array<{ id: string; name: string; description?: string }>;
  }> = [];
  
  private async loadAIProvidersForModal(): Promise<void> {
    const providerSelect = document.getElementById('ai-gen-provider') as HTMLSelectElement;
    const modelSelect = document.getElementById('ai-gen-model') as HTMLSelectElement;
    const noProvidersMsg = document.getElementById('ai-no-providers');
    const providerSection = document.querySelector('.ai-provider-selection .form-row') as HTMLElement;
    
    if (!providerSelect || !modelSelect) return;
    
    try {
      this.aiEnabledProviders = await window.dashboardAPI.aiGetEnabledProviders();
      
      if (this.aiEnabledProviders.length === 0) {
        // No providers configured
        noProvidersMsg?.classList.remove('hidden');
        providerSection?.classList.add('hidden');
        return;
      }
      
      noProvidersMsg?.classList.add('hidden');
      providerSection?.classList.remove('hidden');
      
      // Populate provider dropdown
      providerSelect.innerHTML = this.aiEnabledProviders.map(p => 
        `<option value="${p.id}">${p.name}</option>`
      ).join('');
      
      // Select first provider and load its models
      if (this.aiEnabledProviders.length > 0) {
        providerSelect.value = this.aiEnabledProviders[0].id;
        this.updateAIModelDropdown(this.aiEnabledProviders[0].id);
      }
      
      // Add change listener for provider
      providerSelect.onchange = () => {
        this.updateAIModelDropdown(providerSelect.value);
      };
    } catch (error) {
      console.error('Failed to load AI providers:', error);
      noProvidersMsg?.classList.remove('hidden');
      providerSection?.classList.add('hidden');
    }
  }
  
  private updateAIModelDropdown(providerId: string): void {
    const modelSelect = document.getElementById('ai-gen-model') as HTMLSelectElement;
    if (!modelSelect) return;
    
    const provider = this.aiEnabledProviders.find(p => p.id === providerId);
    if (!provider) return;
    
    const models = provider.cachedModels || [];
    
    if (models.length === 0) {
      // Use selectedModel as fallback
      modelSelect.innerHTML = `<option value="${provider.selectedModel}">${provider.selectedModel}</option>`;
    } else {
      modelSelect.innerHTML = models.map(m => 
        `<option value="${m.id}" ${m.id === provider.selectedModel ? 'selected' : ''}>${m.name}</option>`
      ).join('');
    }
  }
  
  private resetAIModalState(): void {
    // Reset checkbox
    const consentCheckbox = document.getElementById('ai-consent-checkbox') as HTMLInputElement;
    if (consentCheckbox) consentCheckbox.checked = false;
    
    // Hide sections
    const loadingSection = document.getElementById('ai-loading-section');
    const testcasesResults = document.getElementById('ai-testcases-results');
    const codeResults = document.getElementById('ai-code-results');
    const errorSection = document.getElementById('ai-error-section');
    const maskingSummary = document.getElementById('ai-masking-summary');
    
    loadingSection?.classList.add('hidden');
    testcasesResults?.classList.add('hidden');
    codeResults?.classList.add('hidden');
    errorSection?.classList.add('hidden');
    maskingSummary?.classList.add('hidden');
    
    // Reset buttons
    const generateBtn = document.getElementById('ai-generate-btn');
    const moveBtn = document.getElementById('ai-move-testcases-btn');
    const saveCodeBtn = document.getElementById('ai-save-code-btn');
    
    if (generateBtn) {
      generateBtn.classList.remove('hidden');
      (generateBtn as HTMLButtonElement).disabled = true;
    }
    moveBtn?.classList.add('hidden');
    saveCodeBtn?.classList.add('hidden');
  }
  
  private async loadActionsForAIModal(sessionId: string): Promise<void> {
    const actionsList = document.getElementById('ai-actions-list');
    if (!actionsList) return;
    
    actionsList.innerHTML = '<div class="ai-loading-placeholder">Loading actions...</div>';
    
    try {
      await this.fetchSessionActions(sessionId);
      const actions = this.sessionActions.get(sessionId) || [];
      
      if (actions.length === 0) {
        actionsList.innerHTML = '<div class="ai-empty-state">No actions recorded for this session.</div>';
        return;
      }
      
      // Render action items
      actionsList.innerHTML = actions.map(action => {
        const actionType = action.type;
        const description = this.getActionDescription(action);
        const selector = action.element?.selector || '';
        
        return `
          <label class="ai-action-item" data-action-id="${action.id}">
            <input type="checkbox" checked data-action-id="${action.id}">
            <div class="ai-action-content">
              <div>
                <span class="ai-action-type ${actionType}">${actionType}</span>
                <span class="ai-action-desc">${this.escapeHtml(description)}</span>
              </div>
              <div class="ai-action-meta">
                <span>${this.truncateText(selector, 50)}</span>
              </div>
            </div>
          </label>
        `;
      }).join('');
      
      // Initialize selected action IDs
      this.aiSelectedActionIds = new Set(actions.map(a => a.id));
      this.updateAIActionCounts();
      
      // Add change listeners to checkboxes
      actionsList.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
          const target = e.target as HTMLInputElement;
          const actionId = target.dataset.actionId;
          if (actionId) {
            if (target.checked) {
              this.aiSelectedActionIds.add(actionId);
            } else {
              this.aiSelectedActionIds.delete(actionId);
            }
            this.updateAIActionCounts();
            this.updateAIGenerateButton();
          }
        });
      });
    } catch (error) {
      console.error('[Dashboard] Error loading actions for AI modal:', error);
      actionsList.innerHTML = '<div class="ai-error-state">Failed to load actions.</div>';
    }
  }
  
  private getActionDescription(action: RecordedAction): string {
    switch (action.type) {
      case 'click':
        return `Clicked on ${action.element?.tagName || 'element'}${action.element?.text ? `: "${action.element.text.substring(0, 30)}"` : ''}`;
      case 'type':
        return `Typed "${action.data.value?.substring(0, 30) || ''}"`;
      case 'navigate':
        return `Navigated to ${action.data.url || action.tabUrl}`;
      case 'scroll':
        return `Scrolled the page`;
      case 'hover':
        return `Hovered over ${action.element?.tagName || 'element'}`;
      case 'select':
        return `Selected text: "${action.data.selectedText?.substring(0, 30) || ''}"`;
      case 'keypress':
        return `Pressed ${action.data.key}`;
      default:
        return action.type;
    }
  }
  
  private updateAIActionCounts(): void {
    const selectedCount = document.getElementById('ai-selected-count');
    const totalCount = document.getElementById('ai-total-count');
    const actions = this.sessionActions.get(this.aiCurrentSessionId) || [];
    
    if (selectedCount) selectedCount.textContent = String(this.aiSelectedActionIds.size);
    if (totalCount) totalCount.textContent = String(actions.length);
  }
  
  private updateAIGenerateButton(): void {
    const generateBtn = document.getElementById('ai-generate-btn') as HTMLButtonElement;
    const consentCheckbox = document.getElementById('ai-consent-checkbox') as HTMLInputElement;
    
    if (generateBtn && consentCheckbox) {
      generateBtn.disabled = !consentCheckbox.checked || this.aiSelectedActionIds.size === 0;
    }
  }
  
  private setupAIModalEventListeners(): void {
    // Only set up listeners once
    if (this.aiModalListenersSetup) {
      console.log('[Dashboard] AI modal listeners already set up');
      return;
    }
    this.aiModalListenersSetup = true;
    console.log('[Dashboard] Setting up AI modal event listeners');
    
    // Close button
    const closeBtn = document.getElementById('ai-generation-modal-close');
    closeBtn?.addEventListener('click', () => this.closeAIModal());
    
    // Cancel button
    const cancelBtn = document.getElementById('ai-cancel-btn');
    cancelBtn?.addEventListener('click', () => this.closeAIModal());
    
    // Backdrop click
    const backdrop = this.aiModal?.querySelector('.modal-backdrop');
    backdrop?.addEventListener('click', () => this.closeAIModal());
    
    // Consent checkbox
    const consentCheckbox = document.getElementById('ai-consent-checkbox');
    consentCheckbox?.addEventListener('change', () => this.updateAIGenerateButton());
    
    // Select/Deselect all actions
    const selectAllBtn = document.getElementById('ai-select-all-btn');
    selectAllBtn?.addEventListener('click', () => this.aiSelectAllActions(true));
    
    const deselectAllBtn = document.getElementById('ai-deselect-all-btn');
    deselectAllBtn?.addEventListener('click', () => this.aiSelectAllActions(false));
    
    // Generate button
    const generateBtn = document.getElementById('ai-generate-btn');
    console.log('[Dashboard] Generate button element:', generateBtn);
    if (generateBtn) {
      generateBtn.addEventListener('click', (e) => {
        console.log('[Dashboard] Generate button clicked, disabled:', (generateBtn as HTMLButtonElement).disabled);
        this.handleAIGenerate();
      });
    }
    
    // Move to test cases button
    const moveBtn = document.getElementById('ai-move-testcases-btn');
    moveBtn?.addEventListener('click', () => this.handleAIMoveToTestCases());
    
    // Save code button
    const saveCodeBtn = document.getElementById('ai-save-code-btn');
    saveCodeBtn?.addEventListener('click', () => this.handleAISaveCode());
    
    // Copy code button
    const copyCodeBtn = document.getElementById('ai-copy-code-btn');
    copyCodeBtn?.addEventListener('click', () => this.handleAICopyCode());
    
    // Test case select/deselect all
    const tcSelectAllBtn = document.getElementById('ai-tc-select-all');
    tcSelectAllBtn?.addEventListener('click', () => this.aiSelectAllTestCases(true));
    
    const tcDeselectAllBtn = document.getElementById('ai-tc-deselect-all');
    tcDeselectAllBtn?.addEventListener('click', () => this.aiSelectAllTestCases(false));
    
    // Retry button
    const retryBtn = document.getElementById('ai-retry-btn');
    retryBtn?.addEventListener('click', () => this.handleAIGenerate());
    
    // Go to settings link
    const gotoSettingsLink = document.getElementById('ai-goto-settings');
    gotoSettingsLink?.addEventListener('click', (e) => {
      e.preventDefault();
      this.closeAIModal();
      this.navigateTo('settings');
    });
  }
  
  private aiSelectAllActions(select: boolean): void {
    const actionsList = document.getElementById('ai-actions-list');
    if (!actionsList) return;
    
    actionsList.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
      (checkbox as HTMLInputElement).checked = select;
      const actionId = (checkbox as HTMLInputElement).dataset.actionId;
      if (actionId) {
        if (select) {
          this.aiSelectedActionIds.add(actionId);
        } else {
          this.aiSelectedActionIds.delete(actionId);
        }
      }
    });
    
    this.updateAIActionCounts();
    this.updateAIGenerateButton();
  }
  
  private aiSelectAllTestCases(select: boolean): void {
    const testcasesList = document.getElementById('ai-testcases-list');
    if (!testcasesList) return;
    
    testcasesList.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
      (checkbox as HTMLInputElement).checked = select;
      const tcId = (checkbox as HTMLInputElement).dataset.tcId;
      const tc = this.aiGeneratedTestCases.find(t => t.id === tcId);
      if (tc) tc.selected = select;
    });
    
    this.updateAITestCaseSelectedCount();
  }
  
  private async handleAIGenerate(): Promise<void> {
    console.log('[Dashboard] handleAIGenerate called');
    const errorSection = document.getElementById('ai-error-section');
    const providerSelect = document.getElementById('ai-gen-provider') as HTMLSelectElement;
    const modelSelect = document.getElementById('ai-gen-model') as HTMLSelectElement;
    const codeMode = document.getElementById('ai-code-mode') as HTMLSelectElement;
    const framework = document.getElementById('ai-framework') as HTMLSelectElement;
    const language = document.getElementById('ai-language') as HTMLSelectElement;
    
    console.log('[Dashboard] Provider select:', providerSelect?.value);
    console.log('[Dashboard] Session ID:', this.aiCurrentSessionId);
    console.log('[Dashboard] Selected actions:', this.aiSelectedActionIds.size);
    
    // Validate provider selection
    if (!providerSelect?.value) {
      console.log('[Dashboard] No provider selected');
      this.showAIError('No AI provider selected. Please configure an AI provider in Settings.');
      return;
    }
    
    // Get session name for the job
    const session = await window.dashboardAPI.getSession(this.aiCurrentSessionId);
    const sessionName = session?.name || 'Unknown Session';
    
    // Determine job type
    let jobType: 'test-cases' | 'code-new' | 'code-optimize' = 'test-cases';
    if (this.aiCurrentMode === 'code') {
      jobType = (codeMode?.value as 'code-new' | 'code-optimize') || 'code-new';
    }
    
    try {
      console.log('[Dashboard] Creating AI job...');
      // Create the job
      const result = await window.dashboardAPI.aiCreateJob({
        sessionId: this.aiCurrentSessionId,
        sessionName,
        type: jobType,
        providerId: providerSelect.value,
        model: modelSelect?.value,
        framework: framework?.value,
        language: language?.value,
        selectedActionIds: Array.from(this.aiSelectedActionIds),
      });
      
      console.log('[Dashboard] AI job result:', result);
      
      if (!result.success) {
        this.showAIError(result.error || 'Failed to create generation job');
        return;
      }
      
      console.log('[Dashboard] Job created successfully:', result.jobId);
      
      // Close modal
      this.closeAIModal();
      
      // Navigate to Generated section
      this.navigateTo('generated');
      
      // Refresh the generated list to show the new job
      await this.loadGeneratedProjects();
      
      // Show success toast/notification
      this.showToast('AI generation started. You can track progress in the Generated section.', 'info');
      
    } catch (error) {
      errorSection?.classList.remove('hidden');
      this.showAIError(error instanceof Error ? error.message : String(error));
    }
  }
  
  private renderAITestCaseResults(tokensUsed?: number): void {
    const resultsSection = document.getElementById('ai-testcases-results');
    const testcasesList = document.getElementById('ai-testcases-list');
    const moveBtn = document.getElementById('ai-move-testcases-btn');
    const tokensEl = document.getElementById('ai-tokens-used');
    
    if (!resultsSection || !testcasesList) return;
    
    // Render test cases
    testcasesList.innerHTML = this.aiGeneratedTestCases.map(tc => `
      <label class="ai-testcase-item" data-tc-id="${tc.id}">
        <input type="checkbox" checked data-tc-id="${tc.id}">
        <div class="ai-testcase-content">
          <div class="ai-testcase-name">
            ${this.escapeHtml(tc.name)}
            <span class="ai-testcase-priority ${tc.priority}">${tc.priority}</span>
          </div>
          <div class="ai-testcase-description">${this.escapeHtml(tc.description)}</div>
          <div class="ai-testcase-expected">
            <strong>Expected:</strong> ${this.escapeHtml(tc.expectedResult)}
          </div>
        </div>
      </label>
    `).join('');
    
    // Add change listeners
    testcasesList.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
      checkbox.addEventListener('change', (e) => {
        const target = e.target as HTMLInputElement;
        const tcId = target.dataset.tcId;
        const tc = this.aiGeneratedTestCases.find(t => t.id === tcId);
        if (tc) tc.selected = target.checked;
        this.updateAITestCaseSelectedCount();
      });
    });
    
    // Show results section and move button
    resultsSection.classList.remove('hidden');
    moveBtn?.classList.remove('hidden');
    
    // Update counts
    this.updateAITestCaseSelectedCount();
    
    if (tokensEl && tokensUsed) {
      tokensEl.textContent = `~${tokensUsed.toLocaleString()} tokens used`;
    }
  }
  
  private updateAITestCaseSelectedCount(): void {
    const countEl = document.getElementById('ai-tc-selected-count');
    const moveBtn = document.getElementById('ai-move-testcases-btn') as HTMLButtonElement;
    
    const selectedCount = this.aiGeneratedTestCases.filter(tc => tc.selected).length;
    if (countEl) countEl.textContent = String(selectedCount);
    if (moveBtn) moveBtn.disabled = selectedCount === 0;
  }
  
  private renderAICodeResult(code: { code: string; framework: string; language: string; changes?: string[] }, tokensUsed?: number): void {
    const resultsSection = document.getElementById('ai-code-results');
    const codePreview = document.getElementById('ai-code-preview');
    const saveBtn = document.getElementById('ai-save-code-btn');
    const tokensEl = document.getElementById('ai-code-tokens-used');
    const changesEl = document.getElementById('ai-code-changes');
    
    if (!resultsSection || !codePreview) return;
    
    // Render code
    const codeEl = codePreview.querySelector('code');
    if (codeEl) codeEl.textContent = code.code;
    
    // Show results and save button
    resultsSection.classList.remove('hidden');
    saveBtn?.classList.remove('hidden');
    
    if (tokensEl && tokensUsed) {
      tokensEl.textContent = `~${tokensUsed.toLocaleString()} tokens used`;
    }
    
    if (changesEl && code.changes && code.changes.length > 0) {
      changesEl.textContent = `${code.changes.length} optimizations applied`;
    }
  }
  
  private showAIError(message: string): void {
    const errorSection = document.getElementById('ai-error-section');
    const errorMessage = document.getElementById('ai-error-message');
    const generateBtn = document.getElementById('ai-generate-btn');
    
    if (errorMessage) errorMessage.textContent = message;
    errorSection?.classList.remove('hidden');
    generateBtn?.classList.remove('hidden');
  }
  
  private async handleAIMoveToTestCases(): Promise<void> {
    const selectedCases = this.aiGeneratedTestCases.filter(tc => tc.selected);
    if (selectedCases.length === 0) return;
    
    try {
      const result = await window.dashboardAPI.aiMoveToTestCases(this.aiCurrentSessionId, selectedCases);
      
      if (result.success) {
        this.showToast(`${selectedCases.length} test cases added successfully!`, 'success');
        this.closeAIModal();
      } else {
        this.showToast('Failed to add test cases', 'error');
      }
    } catch (error) {
      console.error('[Dashboard] Error moving test cases:', error);
      this.showToast('Failed to add test cases', 'error');
    }
  }
  
  private async handleAISaveCode(): Promise<void> {
    if (!this.aiGeneratedCode) return;
    
    try {
      const framework = document.getElementById('ai-framework') as HTMLSelectElement;
      const language = document.getElementById('ai-language') as HTMLSelectElement;
      
      const result = await window.dashboardAPI.generateCode({
        sessionId: this.aiCurrentSessionId,
        testName: 'AI Generated Test',
        framework: framework?.value as 'playwright' || 'playwright',
        language: language?.value as 'typescript' || 'typescript',
      });
      
      if (result.success) {
        this.showToast('Code saved to Generated folder!', 'success');
        this.closeAIModal();
        this.navigateTo('generated');
      } else {
        this.showToast(`Failed to save code: ${result.error || 'Unknown error'}`, 'error');
      }
    } catch (error) {
      console.error('[Dashboard] Error saving AI code:', error);
      this.showToast('Failed to save code', 'error');
    }
  }
  
  private handleAICopyCode(): void {
    if (!this.aiGeneratedCode) return;
    
    navigator.clipboard.writeText(this.aiGeneratedCode).then(() => {
      this.showToast('Code copied to clipboard!', 'success');
    }).catch(() => {
      this.showToast('Failed to copy code', 'error');
    });
  }
  
  private closeAIModal(): void {
    this.aiModal?.classList.add('hidden');
    this.aiCurrentSessionId = '';
    this.aiSelectedActionIds.clear();
    this.aiGeneratedTestCases = [];
    this.aiGeneratedCode = '';
  }
  
  // Utility Methods
  private escapeHtml(str: string): string {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
  
  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return this.escapeHtml(text);
    return this.escapeHtml(text.substring(0, maxLength)) + '...';
  }
  
  private formatDuration(startTime: number): string {
    const diff = Date.now() - startTime;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  }
  
  private formatDurationBetween(start: number, end: number): string {
    const diff = end - start;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    }
    if (minutes > 0) {
      return `${minutes}m`;
    }
    return `${seconds}s`;
  }
}

// Initialize dashboard
document.addEventListener('DOMContentLoaded', () => {
  new DashboardApp();
  
  // Remove webpack-dev-server error overlay if it appears
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLElement) {
          if (node.id?.includes('webpack') || 
              (node.tagName === 'IFRAME' && node.getAttribute('src')?.includes('webpack'))) {
            node.remove();
          }
        }
      }
    }
  });
  
  observer.observe(document.body, { childList: true, subtree: true });
});
