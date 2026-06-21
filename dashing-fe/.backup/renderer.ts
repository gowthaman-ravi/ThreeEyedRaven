/**
 * Dashing - Tab Management System with Browser Functionality
 * Chrome-like tabs with address bar and web navigation
 */

import './index.css';
import { RingBuffer } from './renderer/ringBuffer';
import type { Session, RecordedAction as StoredAction } from './shared/types';

// Memory buffer size for UI display (actual storage is in SQLite)
const RING_BUFFER_SIZE = 100;

// Type definitions
interface TabError {
  type: 'network' | 'console';
  level: 'error' | 'warning';
  message: string;
  statusCode?: number;
  url?: string;
  timestamp: Date;
}

interface Tab {
  id: string;
  title: string;
  icon: string;
  type: 'dashboard' | 'browser' | 'actions';
  createdAt: Date;
  url: string;
  errors: TabError[];
  actions: RecordedAction[];  // In-memory actions (recent only, for UI)
  actionsBuffer: RingBuffer<RecordedAction>;  // Ring buffer for memory efficiency
  totalActionCount: number;  // Total actions stored in SQLite
  isRecording: boolean;
  // For actions detail tabs
  parentTabId?: string;
  // For browser tabs - track if actions tab is open
  actionsTabId?: string;
}

// Constants for performance
const MAX_ERRORS_PER_TAB = 100;
const MAX_ERROR_MESSAGE_LENGTH = 500;
const MAX_ACTIONS_PER_TAB = 500; // Configurable action limit

// Action types for recording
type ActionType = 'click' | 'dblclick' | 'type' | 'keydown' | 'scroll' | 'contextmenu' | 'submit' | 'change' | 'focus' | 'navigate' | 'select' | 'drag';

// Recorded action interface
interface RecordedAction {
  id: string;
  type: ActionType;
  timestamp: Date;
  url: string;
  element: {
    tagName: string;
    id?: string;
    className?: string;
    name?: string;
    type?: string;
    text?: string;
    placeholder?: string;
    selector: string;
    xpath?: string;
  };
  data: {
    // For click/contextmenu
    x?: number;
    y?: number;
    button?: number;
    // For type/change
    value?: string;
    // For keydown
    key?: string;
    code?: string;
    ctrlKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
    metaKey?: boolean;
    // For scroll
    scrollX?: number;
    scrollY?: number;
    scrollDirection?: 'up' | 'down' | 'left' | 'right';
    // For navigate
    navigationType?: string;
    fromUrl?: string;
    userInput?: string;
    // For select/drag
    selectedText?: string;
    startX?: number;
    startY?: number;
    endX?: number;
    endY?: number;
    toUrl?: string;
  };
}

// Interface for ignored error patterns
interface IgnoredError {
  id: string;
  pattern: string;  // The error message pattern to match
  type: 'network' | 'console';
  statusCode?: number;
  addedAt: Date;
}

// ElectronAPI is now defined in preload.ts and globally available
// We just need to reference the types here

// Quick links for new tab page
const QUICK_LINKS = [
  { name: 'Google', url: 'https://www.google.com', icon: '🔍' },
  { name: 'GitHub', url: 'https://github.com', icon: '🐙' },
  { name: 'YouTube', url: 'https://www.youtube.com', icon: '▶️' },
  { name: 'Reddit', url: 'https://www.reddit.com', icon: '🤖' },
  { name: 'Twitter', url: 'https://twitter.com', icon: '🐦' },
  { name: 'LinkedIn', url: 'https://www.linkedin.com', icon: '💼' },
  { name: 'Stack Overflow', url: 'https://stackoverflow.com', icon: '📚' },
  { name: 'MDN', url: 'https://developer.mozilla.org', icon: '📖' },
];

// Tab Manager Class
class TabManager {
  private tabs: Tab[] = [];
  private activeTabId: string | null = null;
  private tabCounter = 0;
  private ignoredErrors: IgnoredError[] = [];
  private ignoredErrorCounter = 0;
  private expandedErrorSections: Set<string> = new Set(); // Track which error sections are expanded
  private expandedActionSections: Set<string> = new Set(); // Track which action sections are expanded
  private dashboardUpdatePending = false; // For throttling dashboard updates
  private actionCounter = 0; // For unique action IDs
  private actionsTabCounter = 0; // For unique actions tab IDs
  private actionFilters: Map<string, ActionType | 'all'> = new Map(); // Filter state per actions tab
  
  // Session management
  private currentSession: Session | null = null;

  private tabsListEl: HTMLElement | null = null;
  private tabContentsEl: HTMLElement | null = null;
  private newTabBtn: HTMLElement | null = null;

  constructor() {
    this.init();
  }

  private init(): void {
    // Get DOM elements
    this.tabsListEl = document.getElementById('tabs-list');
    this.tabContentsEl = document.getElementById('tab-contents');

    if (!this.tabsListEl || !this.tabContentsEl) {
      return;
    }

    // Start a new session for SQLite storage
    this.initSession();

    // Create the new tab button dynamically (will be placed after tabs)
    this.createNewTabButton();

    // Create the dashboard tab first (cannot be closed)
    this.createDashboardTab();

    // Listen for HTTP errors from main process (4xx, 5xx responses)
    this.setupHttpErrorListener();

    // Window controls (for Windows/Linux)
    document.getElementById('minimize-btn')?.addEventListener('click', () => {
      window.electronAPI?.minimize();
    });

    document.getElementById('maximize-btn')?.addEventListener('click', () => {
      window.electronAPI?.maximize();
    });

    document.getElementById('close-btn')?.addEventListener('click', () => {
      window.electronAPI?.close();
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 't') {
        e.preventDefault();
        this.createBrowserTab();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'w') {
        e.preventDefault();
        if (this.activeTabId && this.activeTabId !== 'dashboard') {
          this.closeTab(this.activeTabId);
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'l') {
        e.preventDefault();
        this.focusAddressBar();
      }
    });

  }

  private async initSession(): Promise<void> {
    try {
      // Start a new session with a default user (can be customized later)
      const session = await window.electronAPI.startSession({
        userId: 'qa-user',
        userName: 'QA Tester',
        metadata: {
          environment: 'development',
          startTime: new Date().toISOString(),
        },
      });
      this.currentSession = session;
      console.log('[Dashing] Session started:', session.id);
    } catch (error) {
      console.error('[Dashing] Failed to start session:', error);
    }
  }

  private createNewTabButton(): void {
    if (!this.tabsListEl) return;

    this.newTabBtn = document.createElement('button');
    this.newTabBtn.className = 'new-tab-btn';
    this.newTabBtn.title = 'New Tab (Ctrl+T)';
    this.newTabBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <line x1="12" y1="5" x2="12" y2="19"></line>
        <line x1="5" y1="12" x2="19" y2="12"></line>
      </svg>
    `;
    this.newTabBtn.addEventListener('click', () => this.createBrowserTab());
    this.tabsListEl.appendChild(this.newTabBtn);
  }

  private setupHttpErrorListener(): void {
    // Listen for HTTP errors (4xx, 5xx) from main process
    window.electronAPI?.onHttpError((error) => {
      // Find the tab that matches this URL
      const matchingTab = this.findTabByUrl(error.url, error.resourceType);
      
      // Format the error message
      const getErrorMessage = () => {
        const resourceLabel = error.resourceType !== 'mainFrame' ? ` [${error.resourceType}]` : '';
        
        // Network errors have statusCode 0 and an error string
        if (error.statusCode === 0 && error.error) {
          return `${error.method} Network Error: ${error.error}${resourceLabel}`;
        }
        
        const statusText = this.getHttpStatusText(error.statusCode);
        return `${error.method} ${error.statusCode} ${statusText}${resourceLabel}`;
      };

      const errorLevel = error.statusCode >= 500 || error.statusCode === 0 ? 'error' : 'warning';
      
      if (matchingTab) {
        this.addErrorToTab(matchingTab.id, {
          type: 'network',
          level: errorLevel,
          message: getErrorMessage(),
          statusCode: error.statusCode,
          url: error.url,
          timestamp: new Date(error.timestamp),
        });
      } else {
        // If no tab matched by origin, try to assign to the currently active browser tab
        const activeTab = this.tabs.find(t => t.id === this.activeTabId && t.type === 'browser');
        if (activeTab) {
          this.addErrorToTab(activeTab.id, {
            type: 'network',
            level: errorLevel,
            message: getErrorMessage(),
            statusCode: error.statusCode,
            url: error.url,
            timestamp: new Date(error.timestamp),
          });
        }
      }
    });
  }

  private findTabByUrl(requestUrl: string, resourceType: string): Tab | undefined {
    try {
      const requestUrlObj = new URL(requestUrl);
      const requestOrigin = requestUrlObj.origin;
      
      // For main frame (document) requests, check if any tab has this exact URL or is navigating to it
      if (resourceType === 'mainFrame') {
        // First try exact URL match
        const exactMatch = this.tabs.find(tab => {
          if (tab.type !== 'browser') return false;
          return tab.url === requestUrl || tab.url === requestUrlObj.href;
        });
        if (exactMatch) return exactMatch;
      }
      
      // Try origin match for all resource types
      const originMatch = this.tabs.find(tab => {
        if (tab.type !== 'browser' || !tab.url) return false;
        try {
          const tabOrigin = new URL(tab.url).origin;
          return requestOrigin === tabOrigin;
        } catch {
          return false;
        }
      });
      
      return originMatch;
    } catch {
      return undefined;
    }
  }

  private getHttpStatusText(code: number): string {
    const statusTexts: Record<number, string> = {
      400: 'Bad Request',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not Found',
      405: 'Method Not Allowed',
      408: 'Request Timeout',
      429: 'Too Many Requests',
      500: 'Internal Server Error',
      502: 'Bad Gateway',
      503: 'Service Unavailable',
      504: 'Gateway Timeout',
    };
    return statusTexts[code] || 'Error';
  }

  private createDashboardTab(): void {
    const dashboardTab: Tab = {
      id: 'dashboard',
      title: 'Dashboard',
      icon: this.getDashboardIcon(),
      type: 'dashboard',
      createdAt: new Date(),
      url: '',
      errors: [],
      actions: [],
      actionsBuffer: new RingBuffer<RecordedAction>(RING_BUFFER_SIZE),
      totalActionCount: 0,
      isRecording: false,
    };

    this.tabs.push(dashboardTab);
    this.renderTab(dashboardTab);
    this.renderDashboardContent();
    this.setActiveTab('dashboard');
    this.updateDashboardList();
  }

  createBrowserTab(initialUrl?: string): Tab {
    this.tabCounter++;
    const newTab: Tab = {
      id: `tab-${this.tabCounter}`,
      title: 'New Tab',
      icon: this.getPageIcon(),
      type: 'browser',
      createdAt: new Date(),
      url: initialUrl || '',
      errors: [],
      actions: [],
      actionsBuffer: new RingBuffer<RecordedAction>(RING_BUFFER_SIZE),
      totalActionCount: 0,
      isRecording: true, // Auto-start recording
    };

    this.tabs.push(newTab);
    this.renderTab(newTab);
    this.renderBrowserContent(newTab);
    this.setActiveTab(newTab.id);
    this.updateDashboardList();

    // If initial URL provided, navigate to it
    if (initialUrl) {
      setTimeout(() => this.navigateTab(newTab.id, initialUrl), 100);
    }

    return newTab;
  }

  private createActionsTab(parentTabId: string): Tab | null {
    const parentTab = this.tabs.find(t => t.id === parentTabId);
    if (!parentTab || parentTab.type !== 'browser') return null;

    // Check if actions tab already exists
    if (parentTab.actionsTabId) {
      // Switch to existing actions tab
      this.setActiveTab(parentTab.actionsTabId);
      return null;
    }

    this.actionsTabCounter++;
    const newTab: Tab = {
      id: `actions-${this.actionsTabCounter}`,
      title: `Actions: ${parentTab.title}`,
      icon: this.getActionsIcon(),
      type: 'actions',
      createdAt: new Date(),
      url: '',
      errors: [],
      actions: [], // Will reference parent's actions
      actionsBuffer: new RingBuffer<RecordedAction>(RING_BUFFER_SIZE),
      totalActionCount: 0,
      isRecording: false, // Don't record actions in this tab
      parentTabId: parentTabId,
    };

    // Link parent to this actions tab
    parentTab.actionsTabId = newTab.id;

    // Initialize filter state
    this.actionFilters.set(newTab.id, 'all');

    // Find parent tab index and insert after it
    const parentIndex = this.tabs.findIndex(t => t.id === parentTabId);
    this.tabs.splice(parentIndex + 1, 0, newTab);

    this.renderTab(newTab, parentIndex + 1);
    this.renderActionsTabContent(newTab);
    this.setActiveTab(newTab.id);
    this.updateDashboardList();

    return newTab;
  }

  private getActionsIcon(): string {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="16" y1="13" x2="8" y2="13"/>
      <line x1="16" y1="17" x2="8" y2="17"/>
      <polyline points="10 9 9 9 8 9"/>
    </svg>`;
  }

  private renderTab(tab: Tab, insertAtIndex?: number): void {
    if (!this.tabsListEl) return;

    const tabEl = document.createElement('div');
    // Add appropriate classes based on tab type
    const typeClass = tab.type === 'dashboard' ? 'dashboard' : 
                     tab.type === 'actions' ? 'actions-tab' : '';
    tabEl.className = `tab ${typeClass}`.trim();
    tabEl.dataset.tabId = tab.id;

    // Add badge for actions tabs
    const badgeHtml = tab.type === 'actions' ? '<span class="tab-badge">ACTIONS</span>' : '';

    tabEl.innerHTML = `
      <span class="tab-icon">${tab.icon}</span>
      <span class="tab-title">${tab.title}</span>
      ${badgeHtml}
      <button class="tab-close" title="Close tab">
        <svg width="10" height="10" viewBox="0 0 10 10">
          <line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" stroke-width="1.5"/>
          <line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" stroke-width="1.5"/>
        </svg>
      </button>
    `;

    // Tab click handler
    tabEl.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.tab-close')) {
        this.setActiveTab(tab.id);
      }
    });

    // Close button handler (only for non-dashboard tabs)
    if (tab.type !== 'dashboard') {
      const closeBtn = tabEl.querySelector('.tab-close');
      if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.closeTab(tab.id);
        });
      }
    }

    // Insert at specific index if provided
    if (insertAtIndex !== undefined) {
      const allTabs = this.tabsListEl.querySelectorAll('.tab');
      if (insertAtIndex < allTabs.length) {
        this.tabsListEl.insertBefore(tabEl, allTabs[insertAtIndex]);
        return;
      }
    }

    // Insert tab before the new tab button
    if (this.newTabBtn && this.tabsListEl.contains(this.newTabBtn)) {
      this.tabsListEl.insertBefore(tabEl, this.newTabBtn);
    } else {
      this.tabsListEl.appendChild(tabEl);
    }
  }

  private renderDashboardContent(): void {
    if (!this.tabContentsEl) return;

    const contentEl = document.createElement('div');
    contentEl.className = 'tab-content';
    contentEl.id = 'content-dashboard';

    contentEl.innerHTML = `
      <div class="dashboard-page">
        <header class="dashboard-header">
          <h1>✦ Dashboard</h1>
          <p>Welcome to Dashing — your command center for all open tabs</p>
        </header>

        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-label">Total Tabs</div>
            <div class="stat-value" id="stat-total-tabs">0</div>
          </div>
          <div class="stat-card secondary">
            <div class="stat-label">Pages Open</div>
            <div class="stat-value" id="stat-pages-open">0</div>
          </div>
        </div>

        <section class="open-tabs-section">
          <div class="section-header">
            <h2 class="section-title">Open Tabs</h2>
          </div>
          <div class="open-tabs-list" id="open-tabs-list">
            <!-- Tab list will be rendered here -->
          </div>
        </section>
      </div>
    `;

    this.tabContentsEl.appendChild(contentEl);
  }

  private renderBrowserContent(tab: Tab): void {
    if (!this.tabContentsEl) return;

    const contentEl = document.createElement('div');
    contentEl.className = 'tab-content';
    contentEl.id = `content-${tab.id}`;

    // Create address bar and webview container
    contentEl.innerHTML = `
      <div class="address-bar" data-tab-id="${tab.id}">
        <button class="nav-btn back-btn" title="Go back (Alt+←)" disabled>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
        </button>
        <button class="nav-btn forward-btn" title="Go forward (Alt+→)" disabled>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M5 12h14M12 5l7 7-7 7"/>
          </svg>
        </button>
        <button class="nav-btn refresh-btn" title="Refresh (Ctrl+R)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M23 4v6h-6M1 20v-6h6"/>
            <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
          </svg>
        </button>
        <div class="url-container">
          <svg class="url-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="2" y1="12" x2="22" y2="12"/>
            <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>
          </svg>
          <input type="text" class="url-input" placeholder="Search or enter URL..." value="${tab.url}">
        </div>
        <button class="nav-btn home-btn" title="Go home">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
            <polyline points="9 22 9 12 15 12 15 22"/>
          </svg>
        </button>
      </div>
      <div class="webview-loading hidden" data-tab-id="${tab.id}"></div>
      <div class="webview-container" data-tab-id="${tab.id}">
        ${this.renderNewTabPage(tab.id)}
      </div>
    `;

    this.tabContentsEl.appendChild(contentEl);

    // Set up event listeners for this tab's browser controls
    this.setupBrowserControls(tab.id, contentEl);
  }

  private renderActionsTabContent(tab: Tab): void {
    if (!this.tabContentsEl || !tab.parentTabId) return;

    const parentTab = this.tabs.find(t => t.id === tab.parentTabId);
    if (!parentTab) return;

    const contentEl = document.createElement('div');
    contentEl.className = 'tab-content';
    contentEl.id = `content-${tab.id}`;

    contentEl.innerHTML = `
      <div class="actions-detail-page" data-tab-id="${tab.id}" data-parent-id="${tab.parentTabId}">
        <header class="actions-detail-header">
          <div class="actions-detail-title">
            <h1>📋 Actions: ${this.escapeHtml(parentTab.title)}</h1>
            <p>Detailed view of recorded actions from <strong>${this.escapeHtml(parentTab.url || 'New Tab')}</strong></p>
          </div>
          <div class="actions-detail-controls">
            <button class="action-detail-btn export-btn" title="Export as JSON">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Export JSON
            </button>
            <button class="action-detail-btn clear-btn" title="Clear all actions">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
              </svg>
              Clear
            </button>
          </div>
        </header>
        
        <div class="actions-filter-bar">
          <div class="filter-label">Filter:</div>
          <div class="filter-buttons">
            <button class="filter-btn active" data-filter="all">All</button>
            <button class="filter-btn" data-filter="click">👆 Click</button>
            <button class="filter-btn" data-filter="type">⌨️ Type</button>
            <button class="filter-btn" data-filter="scroll">📜 Scroll</button>
            <button class="filter-btn" data-filter="select">✂️ Select</button>
            <button class="filter-btn" data-filter="navigate">🔗 Navigate</button>
            <button class="filter-btn" data-filter="keydown">⌨️ Keyboard</button>
            <button class="filter-btn" data-filter="contextmenu">🖱️ Right-click</button>
          </div>
          <div class="actions-stats">
            <span class="stat-item">Total: <strong id="actions-total-${tab.id}">0</strong></span>
            <span class="stat-item">Filtered: <strong id="actions-filtered-${tab.id}">0</strong></span>
          </div>
        </div>

        <div class="actions-detail-list" id="actions-list-${tab.id}">
          <!-- Actions will be rendered here -->
        </div>
      </div>
    `;

    this.tabContentsEl.appendChild(contentEl);

    // Set up event listeners
    this.setupActionsDetailListeners(tab.id, contentEl);

    // Initial render of actions
    this.updateActionsDetailList(tab.id);
  }

  private setupActionsDetailListeners(tabId: string, contentEl: HTMLElement): void {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab || !tab.parentTabId) return;

    // Export button
    const exportBtn = contentEl.querySelector('.export-btn');
    exportBtn?.addEventListener('click', () => {
      if (tab.parentTabId) {
        this.exportTabActions(tab.parentTabId);
      }
    });

    // Clear button
    const clearBtn = contentEl.querySelector('.clear-btn');
    clearBtn?.addEventListener('click', () => {
      if (tab.parentTabId) {
        this.clearTabActions(tab.parentTabId);
        this.updateActionsDetailList(tabId);
      }
    });

    // Filter buttons
    const filterBtns = contentEl.querySelectorAll('.filter-btn');
    filterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const filter = (btn as HTMLElement).dataset.filter as ActionType | 'all';
        this.actionFilters.set(tabId, filter);
        
        // Update active state
        filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        this.updateActionsDetailList(tabId);
      });
    });
  }

  private updateActionsDetailList(tabId: string): void {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab || !tab.parentTabId) return;

    const parentTab = this.tabs.find(t => t.id === tab.parentTabId);
    if (!parentTab) return;

    const listEl = document.getElementById(`actions-list-${tabId}`);
    const totalEl = document.getElementById(`actions-total-${tabId}`);
    const filteredEl = document.getElementById(`actions-filtered-${tabId}`);
    if (!listEl) return;

    const filter = this.actionFilters.get(tabId) || 'all';
    const allActions = parentTab.actions;
    const filteredActions = filter === 'all' 
      ? allActions 
      : allActions.filter(a => a.type === filter);

    // Update stats
    if (totalEl) totalEl.textContent = String(allActions.length);
    if (filteredEl) filteredEl.textContent = String(filteredActions.length);

    if (filteredActions.length === 0) {
      listEl.innerHTML = `
        <div class="no-actions-detail">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
          </svg>
          <h3>${filter === 'all' ? 'No actions recorded yet' : `No ${filter} actions recorded`}</h3>
          <p>Interact with the page to record actions</p>
        </div>
      `;
      return;
    }

    // Render actions (most recent first)
    listEl.innerHTML = filteredActions.slice().reverse().map(action => {
      const element = action.element;
      const data = action.data;

      // Build attributes display
      const attrs: string[] = [];
      if (element.id) attrs.push(`id="${element.id}"`);
      if (element.className) attrs.push(`class="${element.className.slice(0, 50)}${element.className.length > 50 ? '...' : ''}"`);
      if (element.name) attrs.push(`name="${element.name}"`);
      if (element.type) attrs.push(`type="${element.type}"`);
      if (element.placeholder) attrs.push(`placeholder="${element.placeholder.slice(0, 30)}..."`);

      // Build data display
      const dataItems: string[] = [];
      if (data.x !== undefined && data.y !== undefined) {
        dataItems.push(`Coordinates: (${data.x}, ${data.y})`);
      }
      if (data.startX !== undefined && data.endX !== undefined) {
        dataItems.push(`Drag: (${data.startX}, ${data.startY}) → (${data.endX}, ${data.endY})`);
      }
      if (data.value !== undefined) {
        dataItems.push(`Value: "${String(data.value).slice(0, 100)}${String(data.value).length > 100 ? '...' : ''}"`);
      }
      if (data.selectedText) {
        dataItems.push(`Selected: "${data.selectedText.slice(0, 100)}${data.selectedText.length > 100 ? '...' : ''}"`);
      }
      if (data.key) {
        const mods = [
          data.ctrlKey ? 'Ctrl' : '',
          data.altKey ? 'Alt' : '',
          data.shiftKey ? 'Shift' : '',
          data.metaKey ? 'Cmd' : '',
        ].filter(Boolean).join('+');
        dataItems.push(`Key: ${mods ? mods + '+' : ''}${data.key}`);
      }
      if (data.scrollDirection) {
        dataItems.push(`Scroll: ${data.scrollDirection} (${data.scrollX}, ${data.scrollY})`);
      }
      if (data.userInput) {
        dataItems.push(`Input: "${data.userInput}"`);
      }

      return `
        <div class="action-detail-card" data-action-type="${action.type}">
          <div class="action-detail-header">
            <span class="action-detail-icon">${this.getActionIcon(action.type)}</span>
            <span class="action-detail-type">${action.type.toUpperCase()}</span>
            <span class="action-detail-time">${this.formatDetailedTime(action.timestamp)}</span>
          </div>
          <div class="action-detail-body">
            <div class="action-detail-description">${this.escapeHtml(this.formatActionDescription(action))}</div>
            <div class="action-detail-element">
              <div class="detail-label">Element:</div>
              <code class="detail-value">&lt;${element.tagName}${attrs.length ? ' ' + attrs.join(' ') : ''}&gt;</code>
            </div>
            <div class="action-detail-selector">
              <div class="detail-label">Selector:</div>
              <code class="detail-value copyable" title="Click to copy">${this.escapeHtml(element.selector)}</code>
            </div>
            ${dataItems.length > 0 ? `
              <div class="action-detail-data">
                <div class="detail-label">Data:</div>
                <div class="detail-data-items">
                  ${dataItems.map(item => `<div class="data-item">${this.escapeHtml(item)}</div>`).join('')}
                </div>
              </div>
            ` : ''}
            <div class="action-detail-url">
              <div class="detail-label">URL:</div>
              <code class="detail-value">${this.escapeHtml(this.truncateUrl(action.url, 100))}</code>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Add click-to-copy functionality
    listEl.querySelectorAll('.copyable').forEach(el => {
      el.addEventListener('click', () => {
        navigator.clipboard.writeText(el.textContent || '');
        el.classList.add('copied');
        setTimeout(() => el.classList.remove('copied'), 1000);
      });
    });
  }

  private formatDetailedTime(date: Date): string {
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }) + '.' + String(date.getMilliseconds()).padStart(3, '0');
  }

  private renderNewTabPage(tabId: string): string {
    const quickLinksHtml = QUICK_LINKS.map(link => `
      <div class="quick-link" data-url="${link.url}" data-tab-id="${tabId}">
        <div class="quick-link-icon">${link.icon}</div>
        <span class="quick-link-name">${link.name}</span>
      </div>
    `).join('');

    return `
      <div class="new-tab-page" data-tab-id="${tabId}">
        <div class="new-tab-logo">⚡</div>
        <h1 class="new-tab-title">New Tab</h1>
        <div class="quick-links">
          ${quickLinksHtml}
        </div>
      </div>
    `;
  }

  private setupBrowserControls(tabId: string, contentEl: HTMLElement): void {
    const addressBar = contentEl.querySelector(`.address-bar[data-tab-id="${tabId}"]`);
    const urlInput = addressBar?.querySelector('.url-input') as HTMLInputElement;
    const backBtn = addressBar?.querySelector('.back-btn') as HTMLButtonElement;
    const forwardBtn = addressBar?.querySelector('.forward-btn') as HTMLButtonElement;
    const refreshBtn = addressBar?.querySelector('.refresh-btn') as HTMLButtonElement;
    const homeBtn = addressBar?.querySelector('.home-btn') as HTMLButtonElement;
    const webviewContainer = contentEl.querySelector(`.webview-container[data-tab-id="${tabId}"]`);

    // URL input - Enter to navigate
    urlInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const url = urlInput.value.trim();
        if (url) {
          this.navigateTab(tabId, url);
        }
      }
    });

    // Select all on focus
    urlInput?.addEventListener('focus', () => {
      urlInput.select();
    });

    // Back button
    backBtn?.addEventListener('click', () => {
      const webview = webviewContainer?.querySelector('webview') as Electron.WebviewTag;
      if (webview?.canGoBack()) {
        webview.goBack();
      }
    });

    // Forward button
    forwardBtn?.addEventListener('click', () => {
      const webview = webviewContainer?.querySelector('webview') as Electron.WebviewTag;
      if (webview?.canGoForward()) {
        webview.goForward();
      }
    });

    // Refresh button
    refreshBtn?.addEventListener('click', () => {
      const webview = webviewContainer?.querySelector('webview') as Electron.WebviewTag;
      if (webview) {
        webview.reload();
      }
    });

    // Home button - go to new tab page
    homeBtn?.addEventListener('click', () => {
      this.goHome(tabId);
    });

    // Quick links click handlers
    const quickLinks = contentEl.querySelectorAll(`.quick-link[data-tab-id="${tabId}"]`);
    quickLinks.forEach(link => {
      link.addEventListener('click', () => {
        const url = (link as HTMLElement).dataset.url;
        if (url) {
          this.navigateTab(tabId, url);
        }
      });
    });
  }

  private navigateTab(tabId: string, inputUrl: string): void {
    // Normalize URL
    let url = inputUrl.trim();
    const originalInput = inputUrl.trim();
    
    // Check if it's a search query or URL
    if (!url.includes('.') || url.includes(' ')) {
      // Treat as search query
      url = `https://www.google.com/search?q=${encodeURIComponent(url)}`;
    } else if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `https://${url}`;
    }

    // Record the navigation action (user entered URL in address bar)
    const tab = this.tabs.find(t => t.id === tabId);
    if (tab && tab.isRecording) {
      this.addActionToTab(tabId, {
        type: 'navigate',
        timestamp: Date.now(),
        url: url,
        element: { tagName: 'addressbar', selector: 'addressbar' },
        data: {
          navigationType: 'addressbar',
          fromUrl: tab.url || '',
          toUrl: url,
          userInput: originalInput,
        },
      });
    }

    const contentEl = document.getElementById(`content-${tabId}`);
    const webviewContainer = contentEl?.querySelector(`.webview-container[data-tab-id="${tabId}"]`);
    const loadingBar = contentEl?.querySelector(`.webview-loading[data-tab-id="${tabId}"]`);
    const urlInput = contentEl?.querySelector('.url-input') as HTMLInputElement;

    if (!webviewContainer) return;

    // Update URL input
    if (urlInput) {
      urlInput.value = url;
    }

    // Show loading bar
    loadingBar?.classList.remove('hidden');

    // Create webview if it doesn't exist, or update existing one
    let webview = webviewContainer.querySelector('webview') as Electron.WebviewTag;
    
    if (!webview) {
      // Remove new tab page
      const newTabPage = webviewContainer.querySelector('.new-tab-page');
      if (newTabPage) {
        newTabPage.remove();
      }

      // Create webview with proper configuration
      webview = document.createElement('webview') as Electron.WebviewTag;
      webview.setAttribute('allowpopups', 'true');
      webview.setAttribute('partition', 'persist:browser');
      webview.setAttribute('useragent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      webview.style.width = '100%';
      webview.style.height = '100%';
      webviewContainer.appendChild(webview);
      
      // Set src after appending to DOM to ensure proper initialization
      webview.src = url;

      // Set up webview event listeners
      this.setupWebviewListeners(tabId, webview);
    } else {
      webview.src = url;
    }

    // Update tab data
    const tabToUpdate = this.tabs.find(t => t.id === tabId);
    if (tabToUpdate) {
      tabToUpdate.url = url;
    }
  }

  private setupWebviewListeners(tabId: string, webview: Electron.WebviewTag): void {
    // Prevent adding duplicate listeners
    if ((webview as any).__dashingListenersInitialized) {
      return;
    }
    (webview as any).__dashingListenersInitialized = true;

    const contentEl = document.getElementById(`content-${tabId}`);
    const addressBar = contentEl?.querySelector(`.address-bar[data-tab-id="${tabId}"]`);
    const urlInput = addressBar?.querySelector('.url-input') as HTMLInputElement;
    const backBtn = addressBar?.querySelector('.back-btn') as HTMLButtonElement;
    const forwardBtn = addressBar?.querySelector('.forward-btn') as HTMLButtonElement;
    const refreshBtn = addressBar?.querySelector('.refresh-btn') as HTMLButtonElement;
    const loadingBar = contentEl?.querySelector(`.webview-loading[data-tab-id="${tabId}"]`);
    const urlIcon = addressBar?.querySelector('.url-icon');

    // Page title updated
    webview.addEventListener('page-title-updated', (e) => {
      this.updateTabTitle(tabId, e.title);
    });

    // Navigation events
    webview.addEventListener('did-start-loading', () => {
      loadingBar?.classList.remove('hidden');
      refreshBtn?.classList.add('loading');
    });

    webview.addEventListener('did-stop-loading', () => {
      loadingBar?.classList.add('hidden');
      refreshBtn?.classList.remove('loading');
    });

    webview.addEventListener('did-navigate', (e) => {
      if (urlInput) {
        urlInput.value = e.url;
      }
      
      // Update tab URL
      const tab = this.tabs.find(t => t.id === tabId);
      if (tab) {
        tab.url = e.url;
        this.updateDashboardList();
      }

      // Update navigation buttons
      if (backBtn) backBtn.disabled = !webview.canGoBack();
      if (forwardBtn) forwardBtn.disabled = !webview.canGoForward();

      // Update security icon
      if (urlIcon) {
        if (e.url.startsWith('https://')) {
          urlIcon.classList.add('secure');
        } else {
          urlIcon.classList.remove('secure');
        }
      }
    });

    webview.addEventListener('did-navigate-in-page', (e) => {
      if (urlInput && e.isMainFrame) {
        urlInput.value = e.url;
      }
      if (backBtn) backBtn.disabled = !webview.canGoBack();
      if (forwardBtn) forwardBtn.disabled = !webview.canGoForward();
    });

    // Handle new window requests (open in new tab)
    webview.addEventListener('new-window', (e: Event) => {
      e.preventDefault();
      const newWindowEvent = e as unknown as { url: string };
      if (newWindowEvent.url) {
        this.createBrowserTab(newWindowEvent.url);
      }
    });

    // Handle loading errors - capture network errors
    webview.addEventListener('did-fail-load', (e: Event) => {
      const failEvent = e as unknown as { errorCode: number; errorDescription: string; validatedURL: string };
      loadingBar?.classList.add('hidden');
      refreshBtn?.classList.remove('loading');
      
      // Capture the error
      this.addErrorToTab(tabId, {
        type: 'network',
        level: 'error',
        message: failEvent.errorDescription || `Failed to load (Error ${failEvent.errorCode})`,
        statusCode: failEvent.errorCode,
        url: failEvent.validatedURL,
        timestamp: new Date(),
      });
    });

    // Hide loading bar when page loads and inject recorder
    webview.addEventListener('dom-ready', () => {
      loadingBar?.classList.add('hidden');
      
      // Inject action recorder script
      this.injectRecorder(webview, tabId);
    });

    // Capture console errors and warnings from web content only
    webview.addEventListener('console-message', (e: Event) => {
      const consoleEvent = e as unknown as { level: number; message: string; sourceId: string; line: number };
      
      // Only capture errors (level 3) and warnings (level 2)
      // Level 0 = debug, 1 = info, 2 = warning, 3 = error
      if (consoleEvent.level >= 2) {
        // Filter: Only capture errors from web content (http/https)
        // Exclude errors from Electron internals, extensions, file:// URLs
        const source = consoleEvent.sourceId || '';
        const isWebContent = source.startsWith('http://') || source.startsWith('https://');
        
        // Also allow errors without a source (inline scripts)
        const isInlineScript = !source || source === '';
        
        if (isWebContent || isInlineScript) {
          this.addErrorToTab(tabId, {
            type: 'console',
            level: consoleEvent.level === 3 ? 'error' : 'warning',
            message: consoleEvent.message,
            url: consoleEvent.sourceId ? `${consoleEvent.sourceId}:${consoleEvent.line}` : undefined,
            timestamp: new Date(),
          });
        }
      }
    });

    // Handle context menu (right-click) in webview
    webview.addEventListener('context-menu', (e: Event) => {
      const contextEvent = e as unknown as {
        params: {
          x: number;
          y: number;
          linkURL: string;
          linkText: string;
          srcURL: string;
          pageURL: string;
          frameURL: string;
          mediaType: string;
          hasImageContents: boolean;
          isEditable: boolean;
          selectionText: string;
          titleText: string;
          misspelledWord: string;
          editFlags: {
            canCut: boolean;
            canCopy: boolean;
            canPaste: boolean;
            canSelectAll: boolean;
            canUndo: boolean;
            canRedo: boolean;
          };
        };
      };

      const params = contextEvent.params;
      this.showContextMenu(webview, params);
    });
  }

  private showContextMenu(webview: Electron.WebviewTag, params: {
    x: number;
    y: number;
    linkURL: string;
    linkText?: string;
    srcURL: string;
    pageURL?: string;
    frameURL?: string;
    mediaType: string;
    hasImageContents: boolean;
    isEditable: boolean;
    selectionText: string;
    titleText?: string;
    misspelledWord?: string;
    editFlags: {
      canCut: boolean;
      canCopy: boolean;
      canPaste: boolean;
      canSelectAll: boolean;
      canUndo?: boolean;
      canRedo?: boolean;
    };
  }): void {
    // Create custom context menu
    const menuItems: Array<{ label: string; action: () => void; separator?: boolean; disabled?: boolean; shortcut?: string }> = [];

    // Link options - Chrome-like
    if (params.linkURL && params.linkURL.length > 0) {
      menuItems.push({
        label: 'Open Link in New Tab',
        action: () => this.createBrowserTab(params.linkURL),
      });
      menuItems.push({
        label: 'Open Link in New Window',
        action: () => this.createBrowserTab(params.linkURL),
      });
      menuItems.push({ label: '', action: () => { /* noop */ }, separator: true });
      menuItems.push({
        label: 'Copy Link',
        action: () => navigator.clipboard.writeText(params.linkURL),
      });
      menuItems.push({
        label: 'Copy Link Address',
        action: () => navigator.clipboard.writeText(params.linkURL),
      });
      if (params.linkText) {
        menuItems.push({
          label: 'Copy Link Text',
          action: () => navigator.clipboard.writeText(params.linkText || ''),
        });
      }
      menuItems.push({ label: '', action: () => { /* noop */ }, separator: true });
    }

    // Image options - Chrome-like
    if (params.mediaType === 'image' || params.hasImageContents) {
      menuItems.push({
        label: 'Open Image in New Tab',
        action: () => this.createBrowserTab(params.srcURL),
      });
      menuItems.push({
        label: 'Save Image As...',
        action: () => webview.downloadURL(params.srcURL),
      });
      menuItems.push({
        label: 'Copy Image',
        action: () => webview.executeJavaScript(`
          (async () => {
            try {
              const img = document.querySelector('img[src="${params.srcURL.replace(/'/g, "\\'")}"]') || 
                          document.elementFromPoint(${params.x}, ${params.y});
              if (img && img.tagName === 'IMG') {
                const canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth || img.width;
                canvas.height = img.naturalHeight || img.height;
                canvas.getContext('2d').drawImage(img, 0, 0);
                canvas.toBlob(blob => {
                  navigator.clipboard.write([new ClipboardItem({'image/png': blob})]);
                }, 'image/png');
              }
            } catch(e) { console.log('Copy image failed:', e); }
          })();
        `),
      });
      menuItems.push({
        label: 'Copy Image Address',
        action: () => navigator.clipboard.writeText(params.srcURL),
      });
      menuItems.push({ label: '', action: () => { /* noop */ }, separator: true });
    }

    // Selection/text options - Chrome-like
    if (params.selectionText && params.selectionText.length > 0) {
      menuItems.push({
        label: 'Copy',
        action: () => webview.copy(),
        shortcut: '⌘C',
      });
      menuItems.push({
        label: `Search Google for "${params.selectionText.slice(0, 25)}${params.selectionText.length > 25 ? '...' : ''}"`,
        action: () => this.createBrowserTab(`https://www.google.com/search?q=${encodeURIComponent(params.selectionText)}`),
      });
      menuItems.push({ label: '', action: () => { /* noop */ }, separator: true });
    }

    // Edit options (text inputs, textareas)
    if (params.isEditable) {
      if (params.editFlags.canUndo) {
        menuItems.push({
          label: 'Undo',
          action: () => webview.undo(),
          shortcut: '⌘Z',
        });
      }
      if (params.editFlags.canRedo) {
        menuItems.push({
          label: 'Redo',
          action: () => webview.redo(),
          shortcut: '⌘⇧Z',
        });
      }
      if (params.editFlags.canUndo || params.editFlags.canRedo) {
        menuItems.push({ label: '', action: () => { /* noop */ }, separator: true });
      }
      menuItems.push({
        label: 'Cut',
        action: () => webview.cut(),
        disabled: !params.editFlags.canCut,
        shortcut: '⌘X',
      });
      menuItems.push({
        label: 'Copy',
        action: () => webview.copy(),
        disabled: !params.editFlags.canCopy,
        shortcut: '⌘C',
      });
      menuItems.push({
        label: 'Paste',
        action: () => webview.paste(),
        disabled: !params.editFlags.canPaste,
        shortcut: '⌘V',
      });
      menuItems.push({
        label: 'Paste and Match Style',
        action: () => webview.pasteAndMatchStyle(),
        disabled: !params.editFlags.canPaste,
        shortcut: '⌘⇧V',
      });
      menuItems.push({ label: '', action: () => { /* noop */ }, separator: true });
      menuItems.push({
        label: 'Select All',
        action: () => webview.selectAll(),
        shortcut: '⌘A',
      });
      menuItems.push({ label: '', action: () => { /* noop */ }, separator: true });
    }

    // If no special context, show general page options
    if (!params.linkURL && !params.selectionText && !params.isEditable && params.mediaType !== 'image' && !params.hasImageContents) {
      // Navigation options
      menuItems.push({
        label: 'Back',
        action: () => webview.goBack(),
        disabled: !webview.canGoBack(),
      });
      menuItems.push({
        label: 'Forward',
        action: () => webview.goForward(),
        disabled: !webview.canGoForward(),
      });
      menuItems.push({
        label: 'Reload',
        action: () => webview.reload(),
        shortcut: '⌘R',
      });
      menuItems.push({ label: '', action: () => { /* noop */ }, separator: true });
      
      // Page actions
      menuItems.push({
        label: 'Save As...',
        action: () => {
          const currentUrl = webview.getURL();
          webview.downloadURL(currentUrl);
        },
        shortcut: '⌘S',
      });
      menuItems.push({
        label: 'Print...',
        action: () => webview.print(),
        shortcut: '⌘P',
      });
      menuItems.push({ label: '', action: () => { /* noop */ }, separator: true });
      
      // Copy page URL
      menuItems.push({
        label: 'Copy Page URL',
        action: () => navigator.clipboard.writeText(webview.getURL()),
      });
      menuItems.push({ label: '', action: () => { /* noop */ }, separator: true });
    }

    // Always show Select All if not in editable context
    if (!params.isEditable) {
      menuItems.push({
        label: 'Select All',
        action: () => webview.selectAll(),
        shortcut: '⌘A',
      });
      menuItems.push({ label: '', action: () => { /* noop */ }, separator: true });
    }

    // View source and Inspect Element (always available)
    menuItems.push({
      label: 'View Page Source',
      action: () => {
        const currentUrl = webview.getURL();
        this.createBrowserTab(`view-source:${currentUrl}`);
      },
      shortcut: '⌘U',
    });
    menuItems.push({
      label: 'Inspect Element',
      action: () => webview.inspectElement(params.x, params.y),
      shortcut: '⌘⌥I',
    });

    // Show custom context menu
    this.renderContextMenu(menuItems, params.x, params.y);
  }

  private renderContextMenu(items: Array<{ label: string; action: () => void; separator?: boolean; disabled?: boolean; shortcut?: string }>, x: number, y: number): void {
    // Remove any existing context menu
    const existingMenu = document.querySelector('.custom-context-menu');
    if (existingMenu) {
      existingMenu.remove();
    }

    // Create menu element
    const menu = document.createElement('div');
    menu.className = 'custom-context-menu';
    menu.style.cssText = `
      position: fixed;
      left: ${x}px;
      top: ${y}px;
      background: #1e1e2e;
      border: 1px solid rgba(0, 255, 213, 0.2);
      border-radius: 8px;
      padding: 6px 0;
      min-width: 220px;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6), 0 0 20px rgba(0, 255, 213, 0.1);
      z-index: 10000;
      font-family: 'Outfit', sans-serif;
      font-size: 13px;
      backdrop-filter: blur(10px);
    `;

    items.forEach(item => {
      if (item.separator) {
        const separator = document.createElement('div');
        separator.style.cssText = `
          height: 1px;
          background: rgba(255, 255, 255, 0.08);
          margin: 4px 8px;
        `;
        menu.appendChild(separator);
      } else {
        const menuItem = document.createElement('div');
        menuItem.style.cssText = `
          padding: 8px 16px;
          cursor: ${item.disabled ? 'not-allowed' : 'pointer'};
          color: ${item.disabled ? '#606078' : '#e8e8f0'};
          transition: background 0.15s, color 0.15s;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 20px;
        `;
        
        const labelSpan = document.createElement('span');
        labelSpan.textContent = item.label;
        labelSpan.style.cssText = `
          flex: 1;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        `;
        menuItem.appendChild(labelSpan);
        
        if (item.shortcut) {
          const shortcutSpan = document.createElement('span');
          shortcutSpan.textContent = item.shortcut;
          shortcutSpan.style.cssText = `
            color: ${item.disabled ? '#404050' : '#808090'};
            font-size: 11px;
            flex-shrink: 0;
          `;
          menuItem.appendChild(shortcutSpan);
        }
        
        if (!item.disabled) {
          menuItem.addEventListener('mouseenter', () => {
            menuItem.style.background = 'rgba(0, 255, 213, 0.15)';
            menuItem.style.color = '#00ffd5';
          });
          menuItem.addEventListener('mouseleave', () => {
            menuItem.style.background = 'transparent';
            menuItem.style.color = '#e8e8f0';
          });
          menuItem.addEventListener('click', () => {
            item.action();
            menu.remove();
          });
        }
        
        menu.appendChild(menuItem);
      }
    });

    document.body.appendChild(menu);

    // Adjust position if menu goes off screen
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menu.style.left = `${window.innerWidth - rect.width - 10}px`;
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = `${window.innerHeight - rect.height - 10}px`;
    }

    // Close menu helper
    const removeMenu = () => {
      if (menu.parentNode) {
        menu.remove();
      }
      document.removeEventListener('mousedown', closeOnMousedown);
      document.removeEventListener('click', closeOnClick);
      document.removeEventListener('contextmenu', closeOnContextMenu);
      document.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener('wheel', closeOnScroll);
      // Remove webview blur listeners
      document.querySelectorAll('webview').forEach(wv => {
        wv.removeEventListener('focus', closeOnWebviewFocus);
      });
    };

    // Close menu on mousedown outside (more responsive than click)
    const closeOnMousedown = (e: MouseEvent) => {
      if (!menu.contains(e.target as Node)) {
        removeMenu();
      }
    };

    // Close menu on click outside (backup for mousedown)
    const closeOnClick = (e: MouseEvent) => {
      if (!menu.contains(e.target as Node)) {
        removeMenu();
      }
    };

    // Close menu on another right-click
    const closeOnContextMenu = () => {
      removeMenu();
    };

    // Close menu on scroll
    const closeOnScroll = () => {
      removeMenu();
    };

    // Close menu when webview gets focus (user clicked inside webview)
    const closeOnWebviewFocus = () => {
      removeMenu();
    };

    // Close menu on escape
    const closeOnEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        removeMenu();
      }
    };

    // Add all event listeners with a small delay to prevent immediate close
    setTimeout(() => {
      document.addEventListener('mousedown', closeOnMousedown);
      document.addEventListener('click', closeOnClick);
      document.addEventListener('contextmenu', closeOnContextMenu);
      document.addEventListener('keydown', closeOnEscape);
      document.addEventListener('wheel', closeOnScroll);
      
      // Listen for webview focus events (when user clicks inside webview)
      document.querySelectorAll('webview').forEach(wv => {
        wv.addEventListener('focus', closeOnWebviewFocus);
      });
    }, 10);
  }

  private updateTabTitle(tabId: string, title: string): void {
    const tab = this.tabs.find(t => t.id === tabId);
    if (tab) {
      tab.title = title || 'New Tab';
      
      // Update tab element
      const tabEl = document.querySelector(`[data-tab-id="${tabId}"] .tab-title`);
      if (tabEl) {
        tabEl.textContent = tab.title;
      }

      // Update dashboard list
      this.updateDashboardList();
    }
  }

  private addErrorToTab(tabId: string, error: TabError): void {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) return;

    // Truncate long messages for performance
    if (error.message.length > MAX_ERROR_MESSAGE_LENGTH) {
      error.message = error.message.substring(0, MAX_ERROR_MESSAGE_LENGTH) + '...';
    }

    // Limit errors per tab for memory management
    if (tab.errors.length >= MAX_ERRORS_PER_TAB) {
      tab.errors.shift(); // Remove oldest error
    }

    tab.errors.push(error);

    // Update error badge in tab bar
    const visibleErrors = this.getVisibleErrors(tab);
    this.updateTabErrorBadge(tabId, visibleErrors.length);

    // Throttle dashboard updates to avoid excessive re-renders
    this.scheduleDashboardUpdate();
  }

  private scheduleDashboardUpdate(): void {
    if (this.dashboardUpdatePending) return;
    
    this.dashboardUpdatePending = true;
    requestAnimationFrame(() => {
      this.dashboardUpdatePending = false;
      this.updateDashboardList();
    });
  }

  private updateTabErrorBadge(tabId: string, errorCount: number): void {
    const tabEl = document.querySelector(`[data-tab-id="${tabId}"]`);
    if (!tabEl) return;

    // Remove existing badge
    const existingBadge = tabEl.querySelector('.tab-error-badge');
    if (existingBadge) {
      existingBadge.remove();
    }

    // Add badge if there are errors
    if (errorCount > 0) {
      const badge = document.createElement('span');
      badge.className = 'tab-error-badge';
      badge.textContent = errorCount > 99 ? '99+' : String(errorCount);
      badge.title = `${errorCount} error${errorCount > 1 ? 's' : ''}`;
      
      // Insert before close button
      const closeBtn = tabEl.querySelector('.tab-close');
      if (closeBtn) {
        tabEl.insertBefore(badge, closeBtn);
      } else {
        tabEl.appendChild(badge);
      }
    }
  }

  private goHome(tabId: string): void {
    const contentEl = document.getElementById(`content-${tabId}`);
    const webviewContainer = contentEl?.querySelector(`.webview-container[data-tab-id="${tabId}"]`);
    const urlInput = contentEl?.querySelector('.url-input') as HTMLInputElement;
    const backBtn = contentEl?.querySelector('.back-btn') as HTMLButtonElement;
    const forwardBtn = contentEl?.querySelector('.forward-btn') as HTMLButtonElement;

    if (!webviewContainer) return;

    // Remove webview
    const webview = webviewContainer.querySelector('webview');
    if (webview) {
      webview.remove();
    }

    // Show new tab page
    webviewContainer.innerHTML = this.renderNewTabPage(tabId);

    // Reset URL input
    if (urlInput) {
      urlInput.value = '';
    }

    // Reset navigation buttons
    if (backBtn) backBtn.disabled = true;
    if (forwardBtn) forwardBtn.disabled = true;

    // Update tab
    const tab = this.tabs.find(t => t.id === tabId);
    if (tab) {
      tab.title = 'New Tab';
      tab.url = '';
      
      const tabEl = document.querySelector(`[data-tab-id="${tabId}"] .tab-title`);
      if (tabEl) {
        tabEl.textContent = 'New Tab';
      }
    }

    // Re-setup quick link handlers
    const quickLinks = webviewContainer.querySelectorAll(`.quick-link[data-tab-id="${tabId}"]`);
    quickLinks.forEach(link => {
      link.addEventListener('click', () => {
        const url = (link as HTMLElement).dataset.url;
        if (url) {
          this.navigateTab(tabId, url);
        }
      });
    });

    this.updateDashboardList();
  }

  private focusAddressBar(): void {
    if (this.activeTabId && this.activeTabId !== 'dashboard') {
      const contentEl = document.getElementById(`content-${this.activeTabId}`);
      const urlInput = contentEl?.querySelector('.url-input') as HTMLInputElement;
      if (urlInput) {
        urlInput.focus();
        urlInput.select();
      }
    }
  }

  private setActiveTab(tabId: string): void {
    this.activeTabId = tabId;

    // Update tab styling
    document.querySelectorAll('.tab').forEach((el) => {
      el.classList.remove('active');
    });
    document.querySelector(`[data-tab-id="${tabId}"]`)?.classList.add('active');

    // Update content visibility
    document.querySelectorAll('.tab-content').forEach((el) => {
      el.classList.remove('active');
    });
    document.getElementById(`content-${tabId}`)?.classList.add('active');

    // Update dashboard list to reflect current tab
    this.updateDashboardList();
  }

  private closeTab(tabId: string, skipConfirmation = false): void {
    // Dashboard cannot be closed - it's always available
    if (tabId === 'dashboard') {
      return;
    }

    const tab = this.tabs.find((t) => t.id === tabId);
    if (!tab) return;

    // If this is a browser tab with an associated actions tab, show confirmation
    if (tab.type === 'browser' && tab.actionsTabId && !skipConfirmation) {
      this.showCloseConfirmationModal(tabId, tab.actionsTabId);
      return;
    }

    // If this is an actions tab, clear the reference from parent
    if (tab.type === 'actions' && tab.parentTabId) {
      const parentTab = this.tabs.find(t => t.id === tab.parentTabId);
      if (parentTab) {
        parentTab.actionsTabId = undefined;
      }
      // Clean up filter state
      this.actionFilters.delete(tabId);
    }

    // If this is a browser tab, also close associated actions tab
    if (tab.type === 'browser' && tab.actionsTabId) {
      const actionsTabId = tab.actionsTabId;
      // Close actions tab first (without triggering another confirmation)
      this.performTabClose(actionsTabId);
    }

    this.performTabClose(tabId);
  }

  private performTabClose(tabId: string): void {
    const tabIndex = this.tabs.findIndex((t) => t.id === tabId);
    if (tabIndex === -1) return;

    // Clean up webview polling interval before removing
    const contentEl = document.getElementById(`content-${tabId}`);
    const webview = contentEl?.querySelector('webview') as Electron.WebviewTag;
    if (webview) {
      this.stopActionPolling(webview);
    }

    // Remove tab from array
    this.tabs.splice(tabIndex, 1);

    // Remove DOM elements
    document.querySelector(`.tab[data-tab-id="${tabId}"]`)?.remove();
    contentEl?.remove();

    // If closing active tab, switch to previous tab or dashboard
    if (this.activeTabId === tabId) {
      const newActiveTab = this.tabs[Math.max(0, tabIndex - 1)];
      if (newActiveTab) {
        this.setActiveTab(newActiveTab.id);
      }
    }

    this.updateDashboardList();
  }

  private showCloseConfirmationModal(browserTabId: string, actionsTabId: string): void {
    const browserTab = this.tabs.find(t => t.id === browserTabId);
    if (!browserTab) return;

    // Remove any existing modal
    const existingModal = document.querySelector('.close-confirmation-modal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.className = 'close-confirmation-modal';
    modal.innerHTML = `
      <div class="modal-backdrop"></div>
      <div class="modal-content">
        <div class="modal-header">
          <h3>Close Tab?</h3>
        </div>
        <div class="modal-body">
          <p>The tab "<strong>${this.escapeHtml(browserTab.title)}</strong>" has an associated Actions tab open.</p>
          <p>What would you like to do?</p>
        </div>
        <div class="modal-actions">
          <button class="modal-btn modal-btn-secondary" data-action="cancel">Cancel</button>
          <button class="modal-btn modal-btn-primary" data-action="keep-actions">Keep Actions Tab</button>
          <button class="modal-btn modal-btn-danger" data-action="close-both">Close Both</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Handle button clicks
    modal.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const action = target.dataset.action;

      if (action === 'cancel' || target.classList.contains('modal-backdrop')) {
        modal.remove();
      } else if (action === 'keep-actions') {
        // Clear the reference so actions tab stays open independently
        browserTab.actionsTabId = undefined;
        const actionsTab = this.tabs.find(t => t.id === actionsTabId);
        if (actionsTab) {
          actionsTab.parentTabId = undefined;
        }
        modal.remove();
        this.closeTab(browserTabId, true);
      } else if (action === 'close-both') {
        modal.remove();
        this.closeTab(browserTabId, true);
      }
    });
  }

  private updateDashboardList(): void {
    const listEl = document.getElementById('open-tabs-list');
    const totalTabsEl = document.getElementById('stat-total-tabs');
    const pagesOpenEl = document.getElementById('stat-pages-open');

    if (!listEl) return;

    // Update stats (exclude dashboard from count)
    const browserCount = this.tabs.filter((t) => t.type === 'browser').length;
    if (totalTabsEl) totalTabsEl.textContent = String(browserCount);
    if (pagesOpenEl) pagesOpenEl.textContent = String(browserCount);

    // Update ignored errors section
    this.updateIgnoredErrorsSection();

    // Render open tabs list
    if (browserCount === 0) {
      listEl.innerHTML = `
        <div class="empty-state">
          <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <line x1="3" y1="9" x2="21" y2="9"/>
            <line x1="9" y1="3" x2="9" y2="9"/>
          </svg>
          <h3>No pages open</h3>
          <p>Click the + button to open a new tab</p>
        </div>
      `;
      return;
    }

    listEl.innerHTML = this.tabs
      .filter((tab) => tab.type === 'browser')
      .map((tab) => {
        const isCurrent = tab.id === this.activeTabId;
        const displayUrl = tab.url || 'New Tab';
        const visibleErrors = this.getVisibleErrors(tab);
        const errorCount = visibleErrors.length;
        const hasErrors = errorCount > 0;
        const isErrorExpanded = this.expandedErrorSections.has(tab.id);
        const isActionExpanded = this.expandedActionSections.has(tab.id);
        const actionCount = tab.actions.length;
        const hasActions = actionCount > 0;
        const actionsTabOpen = !!tab.actionsTabId;
        
        // Render error list HTML with ignore buttons
        const errorListHtml = hasErrors 
          ? visibleErrors.map((err, idx) => `
              <div class="error-item ${err.level}">
                <span class="error-icon">${err.level === 'error' ? '✕' : '⚠'}</span>
                <div class="error-content">
                  <span class="error-message">${this.escapeHtml(err.message)}</span>
                  ${err.url ? `<span class="error-source" title="${this.escapeHtml(err.url)}">${this.escapeHtml(this.truncateUrl(err.url))}</span>` : ''}
                </div>
                <span class="error-time">${this.formatErrorTime(err.timestamp)}</span>
                <button class="ignore-error-btn" data-tab-id="${tab.id}" data-error-idx="${idx}" title="Ignore this error type">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
                  </svg>
                </button>
              </div>
            `).join('')
          : '';

        // Render action list HTML (show last 20 actions, most recent first)
        const recentActions = tab.actions.slice(-20).reverse();
        const actionListHtml = hasActions
          ? recentActions.map((action) => `
              <div class="action-item" data-action-type="${action.type}">
                <span class="action-icon">${this.getActionIcon(action.type)}</span>
                <div class="action-content">
                  <span class="action-description">${this.escapeHtml(this.formatActionDescription(action))}</span>
                  <span class="action-selector" title="${this.escapeHtml(action.element.selector)}">${this.escapeHtml(this.truncateUrl(action.element.selector, 60))}</span>
                </div>
                <span class="action-time">${this.formatErrorTime(action.timestamp)}</span>
              </div>
            `).join('')
          : '';

        return `
          <div class="open-tab-card" data-tab-id="${tab.id}">
            <div class="open-tab-item ${isCurrent ? 'current active-indicator' : ''}">
              <div class="open-tab-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="2" y1="12" x2="22" y2="12"/>
                  <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>
                </svg>
              </div>
              <div class="open-tab-info">
                <div class="open-tab-name">${this.escapeHtml(tab.title)}</div>
                <div class="open-tab-url">${this.escapeHtml(displayUrl)}</div>
              </div>
              ${tab.isRecording ? '<span class="recording-indicator" title="Recording">●</span>' : ''}
              ${isCurrent ? '<span class="open-tab-badge">Current</span>' : ''}
              ${hasErrors ? `<span class="open-tab-error-count">${errorCount}</span>` : ''}
              ${hasActions ? `<span class="open-tab-action-count">${actionCount}</span>` : ''}
            </div>
            <div class="error-section ${isErrorExpanded ? '' : 'collapsed'}" data-tab-id="${tab.id}">
              <button class="error-toggle-btn" data-tab-id="${tab.id}">
                <svg class="toggle-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
                <span>${hasErrors ? `Errors (${errorCount})` : 'Errors'}</span>
              </button>
              <div class="error-list">
                ${hasErrors 
                  ? errorListHtml 
                  : `<div class="no-errors">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                        <polyline points="22 4 12 14.01 9 11.01"/>
                      </svg>
                      <span>No Errors, Looks Good!</span>
                    </div>`
                }
              </div>
            </div>
            <div class="action-section ${isActionExpanded ? '' : 'collapsed'}" data-tab-id="${tab.id}">
              <div class="action-section-header">
                <button class="action-toggle-btn" data-tab-id="${tab.id}">
                  <svg class="toggle-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                  <span>${hasActions ? `Actions (${actionCount})` : 'Actions'}</span>
                </button>
                <div class="action-controls">
                  <button class="action-export-btn" data-tab-id="${tab.id}" title="Export as JSON" ${!hasActions ? 'disabled' : ''}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                      <polyline points="7 10 12 15 17 10"/>
                      <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                  </button>
                  <button class="action-clear-btn" data-tab-id="${tab.id}" title="Clear all actions" ${!hasActions ? 'disabled' : ''}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                    </svg>
                  </button>
                  <button class="action-record-btn ${tab.isRecording ? 'recording' : ''}" data-tab-id="${tab.id}" title="${tab.isRecording ? 'Pause recording' : 'Resume recording'}">
                    ${tab.isRecording 
                      ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                           <rect x="6" y="6" width="12" height="12" rx="1"/>
                         </svg>`
                      : `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                           <circle cx="12" cy="12" r="6"/>
                         </svg>`
                    }
                  </button>
                  <button class="action-view-detail-btn ${actionsTabOpen ? 'active' : ''}" data-tab-id="${tab.id}" title="${actionsTabOpen ? 'Actions tab already open' : 'View detailed actions'}" ${actionsTabOpen ? 'disabled' : ''}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/>
                      <line x1="16" y1="13" x2="8" y2="13"/>
                      <line x1="16" y1="17" x2="8" y2="17"/>
                    </svg>
                  </button>
                </div>
              </div>
              <div class="action-list">
                ${hasActions 
                  ? actionListHtml 
                  : `<div class="no-actions">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"/>
                        <polyline points="12 6 12 12 16 14"/>
                      </svg>
                      <span>No actions recorded yet</span>
                    </div>`
                }
              </div>
            </div>
          </div>
        `;
      })
      .join('');

    // Add click handlers to tab items (navigate to tab)
    listEl.querySelectorAll('.open-tab-item').forEach((item) => {
      item.addEventListener('click', (e) => {
        // Don't navigate if clicking on error toggle
        if ((e.target as HTMLElement).closest('.error-toggle-btn')) return;
        const tabId = (item.closest('.open-tab-card') as HTMLElement)?.dataset.tabId;
        if (tabId) this.setActiveTab(tabId);
      });
    });

    // Add click handlers to error toggle buttons
    listEl.querySelectorAll('.error-toggle-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const tabId = (btn as HTMLElement).dataset.tabId;
        if (tabId) this.toggleErrorSection(tabId);
      });
    });

    // Add click handlers to ignore error buttons
    listEl.querySelectorAll('.ignore-error-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const tabId = (btn as HTMLElement).dataset.tabId;
        const errorIdx = parseInt((btn as HTMLElement).dataset.errorIdx || '0', 10);
        if (tabId) {
          const tab = this.tabs.find(t => t.id === tabId);
          if (tab) {
            const visibleErrors = this.getVisibleErrors(tab);
            const error = visibleErrors[errorIdx];
            if (error) {
              this.ignoreError(error);
            }
          }
        }
      });
    });

    // Add click handlers to action toggle buttons
    listEl.querySelectorAll('.action-toggle-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const tabId = (btn as HTMLElement).dataset.tabId;
        if (tabId) this.toggleActionSection(tabId);
      });
    });

    // Add click handlers to action export buttons
    listEl.querySelectorAll('.action-export-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const tabId = (btn as HTMLElement).dataset.tabId;
        if (tabId) this.exportTabActions(tabId);
      });
    });

    // Add click handlers to action clear buttons
    listEl.querySelectorAll('.action-clear-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const tabId = (btn as HTMLElement).dataset.tabId;
        if (tabId) this.clearTabActions(tabId);
      });
    });

    // Add click handlers to action record toggle buttons
    listEl.querySelectorAll('.action-record-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const tabId = (btn as HTMLElement).dataset.tabId;
        if (tabId) this.toggleRecording(tabId);
      });
    });

    // Add click handlers to view detail buttons
    listEl.querySelectorAll('.action-view-detail-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const tabId = (btn as HTMLElement).dataset.tabId;
        if (tabId) this.createActionsTab(tabId);
      });
    });
  }

  private updateIgnoredErrorsSection(): void {
    let section = document.getElementById('ignored-errors-section');
    const dashboardPage = document.querySelector('.dashboard-page');
    
    if (!dashboardPage) return;

    // Create section if it doesn't exist
    if (!section) {
      section = document.createElement('section');
      section.id = 'ignored-errors-section';
      section.className = 'ignored-errors-section';
      // Insert after open-tabs-section
      const openTabsSection = dashboardPage.querySelector('.open-tabs-section');
      if (openTabsSection) {
        openTabsSection.after(section);
      } else {
        dashboardPage.appendChild(section);
      }
    }

    const hasIgnored = this.ignoredErrors.length > 0;

    section.innerHTML = `
      <div class="section-header">
        <h2 class="section-title">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
          </svg>
          Ignored Errors
          ${hasIgnored ? `<span class="ignored-count">(${this.ignoredErrors.length})</span>` : ''}
        </h2>
      </div>
      <div class="ignored-errors-list">
        ${hasIgnored 
          ? this.ignoredErrors.map(ignored => `
              <div class="ignored-error-item" data-ignored-id="${ignored.id}">
                <div class="ignored-error-content">
                  <span class="ignored-error-type ${ignored.type}">${ignored.type === 'network' ? '🌐' : '📋'}</span>
                  <span class="ignored-error-pattern">${this.escapeHtml(ignored.pattern)}</span>
                  ${ignored.statusCode ? `<span class="ignored-error-code">${ignored.statusCode}</span>` : ''}
                </div>
                <button class="unignore-btn" data-ignored-id="${ignored.id}" title="Stop ignoring this error">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                    <line x1="10" y1="11" x2="10" y2="17"/>
                    <line x1="14" y1="11" x2="14" y2="17"/>
                  </svg>
                </button>
              </div>
            `).join('')
          : `<div class="no-ignored-errors">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                <polyline points="22 4 12 14.01 9 11.01"/>
              </svg>
              <span>No ignored errors</span>
            </div>`
        }
      </div>
    `;

    // Add click handlers for unignore buttons
    section.querySelectorAll('.unignore-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const ignoredId = (btn as HTMLElement).dataset.ignoredId;
        if (ignoredId) {
          this.unignoreError(ignoredId);
        }
      });
    });
  }

  private toggleErrorSection(tabId: string): void {
    const section = document.querySelector(`.error-section[data-tab-id="${tabId}"]`);
    if (section) {
      const isCollapsed = section.classList.toggle('collapsed');
      // Track expanded state
      if (isCollapsed) {
        this.expandedErrorSections.delete(tabId);
      } else {
        this.expandedErrorSections.add(tabId);
      }
    }
  }

  private ignoreError(error: TabError): void {
    this.ignoredErrorCounter++;
    const ignoredError: IgnoredError = {
      id: `ignored-${this.ignoredErrorCounter}`,
      pattern: error.message,
      type: error.type,
      statusCode: error.statusCode,
      addedAt: new Date(),
    };
    this.ignoredErrors.push(ignoredError);
    this.updateDashboardList();
  }

  private unignoreError(ignoredId: string): void {
    this.ignoredErrors = this.ignoredErrors.filter(e => e.id !== ignoredId);
    this.updateDashboardList();
  }

  private isErrorIgnored(error: TabError): boolean {
    return this.ignoredErrors.some(ignored => {
      // Match by message pattern and type
      if (ignored.type !== error.type) return false;
      
      // For network errors, also match by status code if available
      if (ignored.type === 'network' && ignored.statusCode !== undefined) {
        return ignored.pattern === error.message && ignored.statusCode === error.statusCode;
      }
      
      return ignored.pattern === error.message;
    });
  }

  private getVisibleErrors(tab: Tab): TabError[] {
    return tab.errors.filter(error => !this.isErrorIgnored(error));
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  private formatErrorTime(date: Date): string {
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  private truncateUrl(url: string, maxLength = 80): string {
    if (url.length <= maxLength) return url;
    
    try {
      const urlObj = new URL(url);
      const host = urlObj.host;
      const path = urlObj.pathname + urlObj.search;
      
      // If just the host is too long, truncate it
      if (host.length > maxLength - 10) {
        return host.substring(0, maxLength - 3) + '...';
      }
      
      // Show host + truncated path
      const availableForPath = maxLength - host.length - 6; // 6 for "..." and some buffer
      if (path.length > availableForPath && availableForPath > 10) {
        return host + path.substring(0, availableForPath) + '...';
      }
      
      return url.substring(0, maxLength - 3) + '...';
    } catch {
      // If URL parsing fails, just truncate
      return url.substring(0, maxLength - 3) + '...';
    }
  }

  private getDashboardIcon(): string {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="3" y="3" width="7" height="7" rx="1"/>
      <rect x="14" y="3" width="7" height="7" rx="1"/>
      <rect x="3" y="14" width="7" height="7" rx="1"/>
      <rect x="14" y="14" width="7" height="7" rx="1"/>
    </svg>`;
  }

  private getPageIcon(): string {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10"/>
      <line x1="2" y1="12" x2="22" y2="12"/>
      <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>
    </svg>`;
  }

  // ============================================
  // Action Recording System
  // ============================================

  private getRecorderScript(): string {
    return `
      (function() {
        if (window.__dashingRecorderInitialized) return;
        window.__dashingRecorderInitialized = true;
        window.__dashingActions = [];

        // Generate a CSS selector for an element
        function getSelector(el) {
          if (!el || el === document.body || el === document.documentElement) {
            return 'body';
          }
          
          // Try ID first
          if (el.id) {
            return '#' + CSS.escape(el.id);
          }
          
          // Build a selector path
          const parts = [];
          let current = el;
          
          while (current && current !== document.body && parts.length < 5) {
            let selector = current.tagName.toLowerCase();
            
            if (current.id) {
              selector = '#' + CSS.escape(current.id);
              parts.unshift(selector);
              break;
            }
            
            if (current.className && typeof current.className === 'string') {
              const classes = current.className.trim().split(/\\s+/).filter(c => c && !c.startsWith('ng-') && !c.startsWith('_'));
              if (classes.length > 0) {
                selector += '.' + classes.slice(0, 2).map(c => CSS.escape(c)).join('.');
              }
            }
            
            // Add nth-child if needed for uniqueness
            const parent = current.parentElement;
            if (parent) {
              const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
              if (siblings.length > 1) {
                const index = siblings.indexOf(current) + 1;
                selector += ':nth-child(' + index + ')';
              }
            }
            
            parts.unshift(selector);
            current = current.parentElement;
          }
          
          return parts.join(' > ');
        }

        // Get element info
        function getElementInfo(el) {
          if (!el) return null;
          return {
            tagName: el.tagName?.toLowerCase() || 'unknown',
            id: el.id || undefined,
            className: el.className && typeof el.className === 'string' ? el.className : undefined,
            name: el.name || undefined,
            type: el.type || undefined,
            text: (el.innerText || el.textContent || '').slice(0, 100).trim() || undefined,
            placeholder: el.placeholder || undefined,
            selector: getSelector(el)
          };
        }

        // Store action in queue (will be polled by parent)
        function recordAction(type, element, data) {
          window.__dashingActions.push({
            type: type,
            timestamp: Date.now(),
            url: window.location.href,
            element: element,
            data: data || {}
          });
          // Keep only last 100 actions in buffer
          if (window.__dashingActions.length > 100) {
            window.__dashingActions.shift();
          }
        }

        // Throttle scroll events
        let scrollTimeout = null;
        let lastScrollY = window.scrollY;

        // Click handler
        document.addEventListener('click', function(e) {
          recordAction('click', getElementInfo(e.target), {
            x: e.clientX,
            y: e.clientY,
            button: e.button
          });
        }, true);

        // Double click handler
        document.addEventListener('dblclick', function(e) {
          recordAction('dblclick', getElementInfo(e.target), {
            x: e.clientX,
            y: e.clientY
          });
        }, true);

        // Context menu (right-click) handler
        document.addEventListener('contextmenu', function(e) {
          recordAction('contextmenu', getElementInfo(e.target), {
            x: e.clientX,
            y: e.clientY
          });
        }, true);

        // Input/change handler for form fields
        document.addEventListener('input', function(e) {
          const target = e.target;
          if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
            // Debounce typing events
            clearTimeout(target.__dashingInputTimeout);
            target.__dashingInputTimeout = setTimeout(function() {
              recordAction('type', getElementInfo(target), {
                value: target.value
              });
            }, 500);
          }
        }, true);

        // Change handler (for select, checkbox, radio)
        document.addEventListener('change', function(e) {
          const target = e.target;
          recordAction('change', getElementInfo(target), {
            value: target.type === 'checkbox' || target.type === 'radio' ? target.checked : target.value
          });
        }, true);

        // Keydown handler for shortcuts
        document.addEventListener('keydown', function(e) {
          // Only capture if modifier key is pressed (shortcuts) or special keys
          if (e.ctrlKey || e.metaKey || e.altKey || e.key === 'Enter' || e.key === 'Escape' || e.key === 'Tab') {
            recordAction('keydown', getElementInfo(e.target), {
              key: e.key,
              code: e.code,
              ctrlKey: e.ctrlKey,
              shiftKey: e.shiftKey,
              altKey: e.altKey,
              metaKey: e.metaKey
            });
          }
        }, true);

        // Scroll handler (throttled)
        window.addEventListener('scroll', function() {
          clearTimeout(scrollTimeout);
          scrollTimeout = setTimeout(function() {
            const currentScrollY = window.scrollY;
            const direction = currentScrollY > lastScrollY ? 'down' : 'up';
            lastScrollY = currentScrollY;
            
            recordAction('scroll', { tagName: 'window', selector: 'window' }, {
              scrollX: window.scrollX,
              scrollY: window.scrollY,
              scrollDirection: direction
            });
          }, 300);
        }, true);

        // Form submit handler
        document.addEventListener('submit', function(e) {
          recordAction('submit', getElementInfo(e.target), {});
        }, true);

        // Focus handler (for important elements only)
        document.addEventListener('focus', function(e) {
          const target = e.target;
          if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
            recordAction('focus', getElementInfo(target), {});
          }
        }, true);

        // Text selection handler (mouseup after selection)
        let selectionTimeout = null;
        document.addEventListener('mouseup', function(e) {
          clearTimeout(selectionTimeout);
          selectionTimeout = setTimeout(function() {
            const selection = window.getSelection();
            const selectedText = selection ? selection.toString().trim() : '';
            
            if (selectedText && selectedText.length > 0) {
              // Get the element where selection starts
              const anchorNode = selection.anchorNode;
              const element = anchorNode ? (anchorNode.nodeType === 3 ? anchorNode.parentElement : anchorNode) : document.body;
              
              recordAction('select', getElementInfo(element), {
                selectedText: selectedText.slice(0, 200), // Limit to 200 chars
                x: e.clientX,
                y: e.clientY
              });
            }
          }, 100); // Small delay to ensure selection is complete
        }, true);

        // Drag handler (for drag and drop operations)
        let dragStartInfo = null;
        document.addEventListener('dragstart', function(e) {
          dragStartInfo = {
            element: getElementInfo(e.target),
            x: e.clientX,
            y: e.clientY,
            timestamp: Date.now()
          };
        }, true);

        document.addEventListener('dragend', function(e) {
          if (dragStartInfo) {
            recordAction('drag', dragStartInfo.element, {
              startX: dragStartInfo.x,
              startY: dragStartInfo.y,
              endX: e.clientX,
              endY: e.clientY
            });
            dragStartInfo = null;
          }
        }, true);
      })();
    `;
  }

  // Script to retrieve and clear recorded actions from webview
  private getActionPollScript(): string {
    return `
      (function() {
        const actions = window.__dashingActions || [];
        window.__dashingActions = [];
        return actions;
      })();
    `;
  }

  private startActionPolling(webview: Electron.WebviewTag, tabId: string): void {
    // Store interval reference on the webview element
    const pollInterval = setInterval(async () => {
      const tab = this.tabs.find(t => t.id === tabId);
      if (!tab || !tab.isRecording) {
        clearInterval(pollInterval);
        return;
      }

      try {
        const actions = await webview.executeJavaScript(this.getActionPollScript());
        if (Array.isArray(actions) && actions.length > 0) {
          actions.forEach((actionData: any) => {
            this.addActionToTab(tabId, actionData);
          });
        }
      } catch {
        // Ignore errors (page might be navigating)
      }
    }, 500); // Poll every 500ms

    // Store interval ID on webview for cleanup
    (webview as any).__dashingPollInterval = pollInterval;
  }

  private stopActionPolling(webview: Electron.WebviewTag): void {
    const interval = (webview as any).__dashingPollInterval;
    if (interval) {
      clearInterval(interval);
      (webview as any).__dashingPollInterval = null;
    }
  }

  private injectRecorder(webview: Electron.WebviewTag, tabId: string): void {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab || !tab.isRecording) return;

    // Stop any existing polling before starting a new one
    this.stopActionPolling(webview);

    webview.executeJavaScript(this.getRecorderScript()).then(() => {
      // Start polling for actions (only if not already polling)
      if (!(webview as any).__dashingPollInterval) {
        this.startActionPolling(webview, tabId);
      }
    }).catch(() => {
      // Ignore injection errors (e.g., for about:blank pages)
    });
  }

  private addActionToTab(tabId: string, actionData: any): void {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab || !tab.isRecording) return;

    this.actionCounter++;
    const action: RecordedAction = {
      id: `action-${this.actionCounter}`,
      type: actionData.type,
      timestamp: new Date(actionData.timestamp),
      url: actionData.url,
      element: actionData.element || { tagName: 'unknown', selector: '' },
      data: actionData.data || {},
    };

    // Add to ring buffer (for UI display - keeps last N actions in memory)
    tab.actionsBuffer.push(action);
    
    // Also maintain the actions array for backward compatibility (capped)
    if (tab.actions.length >= MAX_ACTIONS_PER_TAB) {
      tab.actions.shift(); // Remove oldest action
    }
    tab.actions.push(action);
    
    // Increment total count
    tab.totalActionCount++;

    // Store in SQLite via IPC (async, non-blocking)
    this.storeActionInDB(tab, action);

    // Update dashboard if viewing
    this.scheduleDashboardUpdate();
  }
  
  private async storeActionInDB(tab: Tab, action: RecordedAction): Promise<void> {
    try {
      // Convert to StoredAction format for the database
      const storedAction: StoredAction = {
        id: action.id,
        sessionId: this.currentSession?.id || '',
        tabId: tab.id,
        tabUrl: tab.url,
        tabTitle: tab.title,
        type: action.type as StoredAction['type'],
        timestamp: action.timestamp.getTime(),
        element: {
          selector: action.element.selector,
          xpath: action.element.xpath,
          tagName: action.element.tagName,
          id: action.element.id,
          classes: action.element.className ? action.element.className.split(' ') : [],
          text: action.element.text,
          attributes: {
            name: action.element.name || '',
            type: action.element.type || '',
            placeholder: action.element.placeholder || '',
          },
        },
        data: {
          x: action.data.x,
          y: action.data.y,
          button: action.data.button,
          value: action.data.value,
          key: action.data.key,
          modifiers: [
            action.data.ctrlKey ? 'ctrl' : '',
            action.data.shiftKey ? 'shift' : '',
            action.data.altKey ? 'alt' : '',
            action.data.metaKey ? 'meta' : '',
          ].filter(Boolean),
          scrollX: action.data.scrollX,
          scrollY: action.data.scrollY,
          url: action.data.toUrl || action.data.userInput,
          fromUrl: action.data.fromUrl,
          selectedText: action.data.selectedText,
          startX: action.data.startX,
          startY: action.data.startY,
          endX: action.data.endX,
          endY: action.data.endY,
        },
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
        },
      };
      
      await window.electronAPI.storeAction(storedAction);
    } catch (error) {
      // Silently fail - actions are still in memory
      console.error('[Dashing] Failed to store action in DB:', error);
    }
  }

  private toggleActionSection(tabId: string): void {
    const section = document.querySelector(`.action-section[data-tab-id="${tabId}"]`);
    if (section) {
      const isCollapsed = section.classList.toggle('collapsed');
      if (isCollapsed) {
        this.expandedActionSections.delete(tabId);
      } else {
        this.expandedActionSections.add(tabId);
      }
    }
  }

  private exportTabActions(tabId: string): void {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) return;

    const exportData = {
      tabId: tab.id,
      tabTitle: tab.title,
      tabUrl: tab.url,
      exportedAt: new Date().toISOString(),
      totalActions: tab.actions.length,
      actions: tab.actions.map(action => ({
        ...action,
        timestamp: action.timestamp.toISOString(),
      })),
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dashing-actions-${tab.title.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  private clearTabActions(tabId: string): void {
    const tab = this.tabs.find(t => t.id === tabId);
    if (tab) {
      tab.actions = [];
      this.scheduleDashboardUpdate();
    }
  }

  private toggleRecording(tabId: string): void {
    const tab = this.tabs.find(t => t.id === tabId);
    if (tab) {
      tab.isRecording = !tab.isRecording;
      this.scheduleDashboardUpdate();
    }
  }

  private getActionIcon(type: ActionType): string {
    const icons: Record<ActionType, string> = {
      click: '👆',
      dblclick: '👆👆',
      type: '⌨️',
      keydown: '⌨️',
      scroll: '📜',
      contextmenu: '🖱️',
      submit: '📤',
      change: '✏️',
      focus: '🎯',
      navigate: '🔗',
      select: '✂️',
      drag: '🔀',
    };
    return icons[type] || '•';
  }

  private formatActionDescription(action: RecordedAction): string {
    const element = action.element;
    const elementDesc = element.id ? `#${element.id}` : 
                       element.text ? `"${element.text.slice(0, 30)}${element.text.length > 30 ? '...' : ''}"` :
                       element.tagName;

    switch (action.type) {
      case 'click':
        return `Clicked on ${elementDesc}`;
      case 'dblclick':
        return `Double-clicked on ${elementDesc}`;
      case 'type': {
        const val = action.data.value || '';
        return `Typed "${val.slice(0, 30)}${val.length > 30 ? '...' : ''}" in ${elementDesc}`;
      }
      case 'keydown': {
        const modifiers = [
          action.data.ctrlKey ? 'Ctrl' : '',
          action.data.altKey ? 'Alt' : '',
          action.data.shiftKey ? 'Shift' : '',
          action.data.metaKey ? 'Cmd' : '',
        ].filter(Boolean).join('+');
        return `Pressed ${modifiers ? modifiers + '+' : ''}${action.data.key}`;
      }
      case 'scroll':
        return `Scrolled ${action.data.scrollDirection || 'page'}`;
      case 'contextmenu':
        return `Right-clicked on ${elementDesc}`;
      case 'submit':
        return 'Submitted form';
      case 'change':
        return `Changed ${elementDesc} to "${String(action.data.value).slice(0, 20)}"`;
      case 'focus':
        return `Focused on ${elementDesc}`;
      case 'navigate': {
        const input = action.data.userInput || '';
        if (action.data.navigationType === 'addressbar' && input) {
          return `Navigated to "${input.slice(0, 40)}${input.length > 40 ? '...' : ''}"`;
        }
        return `Navigated to ${action.data.toUrl || action.url}`;
      }
      case 'select': {
        const text = action.data.selectedText || '';
        return `Selected "${text.slice(0, 40)}${text.length > 40 ? '...' : ''}"`;
      }
      case 'drag':
        return `Dragged ${elementDesc}`;
      default:
        return `${action.type} on ${elementDesc}`;
    }
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new TabManager();
  });
} else {
  // DOM is already ready
  new TabManager();
}

