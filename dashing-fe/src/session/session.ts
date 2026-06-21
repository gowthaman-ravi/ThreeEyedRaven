/**
 * Dashing Session Window - Browser Interface
 * Handles tab management, navigation, and action recording within a session
 */

import './session.css';
import { 
  RecordedAction, 
  TabError, 
  SessionTab,
  ActionType,
} from '../shared/types';

// Checklist test case interface
interface ChecklistTestCase {
  id: string;
  sessionId: string;
  source: 'manual' | 'auto';
  name: string;
  description?: string;
  steps?: string;
  expectedResult: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  status: 'pending' | 'passed' | 'failed' | 'skipped';
  createdAt: number;
  updatedAt: number;
}

// Extend window interface for electron API
declare global {
  interface Window {
    sessionAPI: {
      // Session context
      getContext: () => Promise<{ sessionId: string; sessionName: string; windowId: string; windowLabel: string } | null>;
      
      // Tab management
      createTab: (url?: string) => Promise<SessionTab>;
      updateTab: (tabId: string, updates: Partial<SessionTab>) => Promise<void>;
      closeTab: (tabId: string) => Promise<void>;
      
      // Action recording
      recordAction: (action: RecordedAction) => Promise<void>;
      recordError: (error: TabError) => Promise<void>;
      
      // Window controls
      minimize: () => void;
      maximize: () => void;
      close: () => void;
      addWindow: () => Promise<void>;
      
      // HTTP error listener
      onHttpError: (callback: (error: { 
        statusCode: number; 
        url: string; 
        method: string; 
        resourceType: string; 
        error?: string;
        timestamp: number;
      }) => void) => void;
      removeHttpErrorListener: () => void;
      
      // Session status
      onSessionStatusChange: (callback: (status: string) => void) => void;
      
      // TC Checklist
      getChecklistItems: (sessionId: string) => Promise<ChecklistTestCase[]>;
      addChecklistItem: (item: Omit<ChecklistTestCase, 'id' | 'createdAt' | 'updatedAt'>) => Promise<ChecklistTestCase>;
      updateChecklistItem: (id: string, updates: Partial<ChecklistTestCase>) => Promise<boolean>;
      deleteChecklistItem: (id: string) => Promise<boolean>;
    };
  }
}

interface BrowserTab {
  id: string;
  title: string;
  url: string;
  favicon?: string;
  webview?: Electron.WebviewTag;
  element?: HTMLElement;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  actionCount: number;
  errorCount: number;
}

class SessionApp {
  private sessionId = '';
  private sessionName = '';
  private windowId = '';
  private windowLabel = '';
  private sessionStatus: 'recording' | 'paused' = 'recording';
  
  private tabs: BrowserTab[] = [];
  private activeTabId = '';
  
  private tabBar: HTMLElement | null = null;
  private tabContentContainer: HTMLElement | null = null;
  private addressInput: HTMLInputElement | null = null;
  private contextMenu: HTMLElement | null = null;
  
  // Action recording
  private recordingEnabled = true;
  private lastScrollTime = 0;
  private scrollDebounceMs = 200;
  private lastTypeTime = 0;
  private typeDebounceMs = 300;
  private pendingTypeValue = '';
  
  // Deduplication - prevent same action from being recorded twice
  private lastActionKey = '';
  private lastActionTime = 0;
  private actionDedupeMs = 100; // Ignore duplicate actions within 100ms
  private lastContextMenuPosition: { x: number; y: number } | null = null;
  
  // Global mouse tracking for accurate context menu positioning
  private lastMousePosition: { x: number; y: number } = { x: 0, y: 0 };
  
  // TC Checklist panel
  private checklistPanel: HTMLElement | null = null;
  private checklistBtn: HTMLElement | null = null;
  private checklistTestCases: ChecklistTestCase[] = [];
  private editingTestCaseId: string | null = null;
  
  constructor() {
    this.init();
  }
  
  private async init(): Promise<void> {
    // Get session context
    const context = await window.sessionAPI.getContext();
    if (!context) {
      console.error('Failed to get session context');
      return;
    }
    
    this.sessionId = context.sessionId;
    this.sessionName = context.sessionName;
    this.windowId = context.windowId;
    this.windowLabel = context.windowLabel;
    
    // Set document title to include session name
    document.title = `${this.sessionName} - ${this.windowLabel}`;
    
    // Update UI
    const labelEl = document.getElementById('window-label');
    if (labelEl) labelEl.textContent = this.windowLabel;
    
    // Cache DOM elements
    this.tabBar = document.getElementById('tab-bar');
    this.tabContentContainer = document.getElementById('tab-content-container');
    this.addressInput = document.getElementById('address-input') as HTMLInputElement;
    this.contextMenu = document.getElementById('context-menu');
    
    // Setup event listeners
    this.setupWindowControls();
    this.setupNavigation();
    this.setupAddressBar();
    this.setupContextMenu();
    this.setupHttpErrorListener();
    this.setupSessionStatusListener();
    this.setupChecklistPanel();
    
    // Check for initialUrl parameter (from session rules)
    const urlParams = new URLSearchParams(window.location.search);
    const initialUrl = urlParams.get('initialUrl');
    
    // Create initial tab (optionally with a URL from session rules)
    await this.createTab(initialUrl || undefined);
  }
  
  // ============================================
  // Tab Management
  // ============================================
  
  private async createTab(url?: string): Promise<void> {
    const tab: BrowserTab = {
      id: `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      title: 'New Tab',
      url: url || '',
      isLoading: false,
      canGoBack: false,
      canGoForward: false,
      actionCount: 0,
      errorCount: 0,
    };
    
    // Create tab element in tab bar
    const tabElement = this.createTabElement(tab);
    this.tabBar?.insertBefore(tabElement, this.tabBar.querySelector('.new-tab-btn'));
    
    // Create tab content
    const content = this.createTabContent(tab);
    this.tabContentContainer?.appendChild(content);
    
    // Store reference
    tab.element = tabElement;
    this.tabs.push(tab);
    
    // Notify backend
    await window.sessionAPI.createTab(url);
    
    // Activate tab
    this.activateTab(tab.id);
    
    // Navigate if URL provided
    if (url) {
      this.navigateTo(url);
    }
  }
  
  private createTabElement(tab: BrowserTab): HTMLElement {
    const element = document.createElement('div');
    element.className = 'tab';
    element.dataset.tabId = tab.id;
    
    element.innerHTML = `
      <img class="tab-favicon" src="" style="display: none;">
      <span class="tab-title">${this.escapeHtml(tab.title)}</span>
      <button class="tab-close">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    `;
    
    // Click to activate
    element.addEventListener('click', (e) => {
      if (!(e.target as HTMLElement).closest('.tab-close')) {
        this.activateTab(tab.id);
      }
    });
    
    // Close button
    const closeBtn = element.querySelector('.tab-close');
    closeBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeTab(tab.id);
    });
    
    return element;
  }
  
  private createTabContent(tab: BrowserTab): HTMLElement {
    const content = document.createElement('div');
    content.className = 'tab-content';
    content.dataset.tabId = tab.id;
    
    if (tab.url) {
      // Create webview with full interaction support
      const webview = document.createElement('webview');
      webview.src = tab.url;
      // webview.setAttribute('partition', 'persist:session');
      webview.setAttribute('partition', `persist:session-${this.sessionId}-${this.windowId}`);
      webview.setAttribute('webpreferences', 'contextIsolation=yes, allowRunningInsecureContent=no');
      webview.setAttribute('allowpopups', 'true');
      webview.setAttribute('autosize', 'on');
      // Ensure webview is focusable and interactive
      webview.style.width = '100%';
      webview.style.height = '100%';
      webview.style.display = 'flex';
      content.appendChild(webview);
      tab.webview = webview as Electron.WebviewTag;
      this.setupWebviewListeners(tab);
    } else {
      // New tab page
      content.innerHTML = `
        <div class="new-tab-page">
          <svg class="new-tab-logo" viewBox="0 0 32 32" fill="none">
            <rect x="2" y="2" width="28" height="28" rx="6" stroke="currentColor" stroke-width="2"/>
            <circle cx="16" cy="16" r="6" fill="currentColor"/>
            <path d="M16 4V12M16 20V28M4 16H12M20 16H28" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
          <div class="new-tab-title">New Tab</div>
          <div class="new-tab-subtitle">Enter a URL in the address bar to begin</div>
        </div>
      `;
    }
    
    return content;
  }
  
  private activateTab(tabId: string): void {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) return;
    
    // Deactivate all tabs
    this.tabs.forEach(t => {
      t.element?.classList.remove('active');
      const content = this.tabContentContainer?.querySelector(`[data-tab-id="${t.id}"]`);
      content?.classList.remove('active');
    });
    
    // Activate this tab
    tab.element?.classList.add('active');
    const content = this.tabContentContainer?.querySelector(`[data-tab-id="${tabId}"]`);
    content?.classList.add('active');
    
    this.activeTabId = tabId;
    
    // Update address bar
    if (this.addressInput) {
      this.addressInput.value = tab.url || '';
    }
    
    // Update nav buttons
    this.updateNavButtons(tab);
    
    // Update counters
    this.updateCounters(tab);
  }
  
  private closeTab(tabId: string): void {
    const tabIndex = this.tabs.findIndex(t => t.id === tabId);
    if (tabIndex === -1) return;
    
    const tab = this.tabs[tabIndex];
    
    // Remove DOM elements
    tab.element?.remove();
    const content = this.tabContentContainer?.querySelector(`[data-tab-id="${tabId}"]`);
    content?.remove();
    
    // Remove from array
    this.tabs.splice(tabIndex, 1);
    
    // Notify backend
    window.sessionAPI.closeTab(tabId);
    
    // If this was the active tab, activate another
    if (this.activeTabId === tabId) {
      if (this.tabs.length > 0) {
        const newIndex = Math.min(tabIndex, this.tabs.length - 1);
        this.activateTab(this.tabs[newIndex].id);
      } else {
        // No more tabs - close window or create new tab
        this.createTab();
      }
    }
  }
  
  private getActiveTab(): BrowserTab | undefined {
    return this.tabs.find(t => t.id === this.activeTabId);
  }
  
  // ============================================
  // Webview Listeners & Action Recording
  // ============================================
  
  private setupWebviewListeners(tab: BrowserTab): void {
    const webview = tab.webview;
    if (!webview) return;
    
    // Loading events
    webview.addEventListener('did-start-loading', () => {
      tab.isLoading = true;
      this.updateTabLoading(tab);
    });
    
    webview.addEventListener('did-stop-loading', () => {
      tab.isLoading = false;
      this.updateTabLoading(tab);
    });
    
    // Handle load failures - redirect to Google search like Chrome does
    webview.addEventListener('did-fail-load', (e: Event) => {
      const failEvent = e as Electron.DidFailLoadEvent;
      
      // Only handle main frame failures (not subresources)
      if (!failEvent.isMainFrame) return;
      
      // DNS and connection errors that should trigger Google search
      const searchableErrors = [
        -105, // ERR_NAME_NOT_RESOLVED
        -106, // ERR_INTERNET_DISCONNECTED (still try search, might work)
        -109, // ERR_ADDRESS_UNREACHABLE
        -118, // ERR_CONNECTION_TIMED_OUT
        -137, // ERR_NAME_RESOLUTION_FAILED
        -800, // ERR_DNS_MALFORMED_RESPONSE
        -801, // ERR_DNS_SERVER_REQUIRES_TCP
        -802, // ERR_DNS_SERVER_FAILED
        -803, // ERR_DNS_TIMED_OUT
      ];
      
      if (searchableErrors.includes(failEvent.errorCode)) {
        const failedUrl = failEvent.validatedURL || tab.url;
        
        // Extract search query from the URL
        // If it looks like a domain (has dots), search for it as-is
        // Otherwise treat it as a search term
        let searchQuery = failedUrl;
        
        try {
          const url = new URL(failedUrl);
          // Use the hostname as the search term
          searchQuery = url.hostname;
        } catch {
          // If it's not a valid URL, use it directly as a search term
          // Remove common prefixes
          searchQuery = failedUrl
            .replace(/^https?:\/\//, '')
            .replace(/^www\./, '')
            .replace(/\/$/, '');
        }
        
        // Redirect to Google search
        const googleSearchUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`;
        webview.loadURL(googleSearchUrl);
        
        console.log(`[Session] URL failed to load (${failEvent.errorCode}), redirecting to Google search: ${searchQuery}`);
      }
    });
    
    // Navigation events
    webview.addEventListener('did-navigate', (e: Event) => {
      const navEvent = e as Electron.DidNavigateEvent;
      tab.url = navEvent.url;
      if (tab.id === this.activeTabId && this.addressInput) {
        this.addressInput.value = navEvent.url;
      }
      this.recordNavigateAction(tab, navEvent.url);
    });
    
    webview.addEventListener('did-navigate-in-page', (e: Event) => {
      const navEvent = e as Electron.DidNavigateInPageEvent;
      tab.url = navEvent.url;
      if (tab.id === this.activeTabId && this.addressInput) {
        this.addressInput.value = navEvent.url;
      }
    });
    
    // Title/favicon updates
    webview.addEventListener('page-title-updated', (e: Event) => {
      const titleEvent = e as Electron.PageTitleUpdatedEvent;
      tab.title = titleEvent.title;
      this.updateTabTitle(tab);
    });
    
    webview.addEventListener('page-favicon-updated', (e: Event) => {
      const faviconEvent = e as Electron.PageFaviconUpdatedEvent;
      if (faviconEvent.favicons && faviconEvent.favicons.length > 0) {
        tab.favicon = faviconEvent.favicons[0];
        this.updateTabFavicon(tab);
      }
    });
    
    // Navigation history
    webview.addEventListener('did-navigate', () => {
      tab.canGoBack = webview.canGoBack();
      tab.canGoForward = webview.canGoForward();
      if (tab.id === this.activeTabId) {
        this.updateNavButtons(tab);
      }
    });
    
    // Console messages (for error tracking)
    webview.addEventListener('console-message', (e: Event) => {
      const consoleEvent = e as Electron.ConsoleMessageEvent;
      if (consoleEvent.level === 2) { // Error level
        const message = consoleEvent.message;
        const source = consoleEvent.sourceId || '';
        
        // Filter out Electron, webpack, and other non-website errors
        if (
          message === 'Script error.' ||  // Cross-origin script errors
          message.includes('webpack-dev-server') ||  // Dev server errors
          message.includes('webpack-internal://') ||  // Webpack internal errors
          message.includes('[HMR]') ||  // Hot module replacement
          message.includes('ResizeObserver loop') ||  // Common benign error
          message.startsWith('[Dashing]') ||  // Our own debug messages
          message.includes('Electron Security Warning') ||  // Electron security warnings
          message.includes('Electron Deprecation Warning') ||  // Electron deprecation warnings
          message.includes('%cElectron') ||  // Styled Electron messages
          source.includes('electron') ||  // Electron internal sources
          source.includes('sandbox_bundle') ||  // Electron sandbox bundle
          source.includes('node:electron') ||  // Node electron modules
          source.includes('node:internal') ||  // Node internal modules
          message.includes('Content-Security-Policy') && message.includes('Electron')  // CSP warnings from Electron
        ) {
          return;
        }
        
        this.recordError(tab, {
          type: 'console',
          message: message,
          source: source,
        });
      }
    });
    
    // DOM ready - inject action recorder
    webview.addEventListener('dom-ready', () => {
      this.injectActionRecorder(tab);
      
      // Setup context menu for "Add as Expected" feature
      this.setupWebviewContextMenu(tab);
    });
    
    // New window requests
    webview.addEventListener('new-window', (e: Event) => {
      const newWindowEvent = e as unknown as { url: string };
      e.preventDefault();
      this.createTab(newWindowEvent.url);
    });
  }
  
  private injectActionRecorder(tab: BrowserTab): void {
    const webview = tab.webview;
    if (!webview || !this.recordingEnabled) return;
    
    const recorderScript = `
      (function() {
        if (window.__dashingRecorderInitialized) return;
        window.__dashingRecorderInitialized = true;
        
        // Deduplication to prevent same action firing twice
        let lastActionKey = '';
        let lastActionTime = 0;
        const DEDUPE_MS = 100;
        
        const sendAction = (type, data) => {
          // Create a key for deduplication
          const selector = data?.element?.selector || 'none';
          const actionKey = type + ':' + selector;
          const now = Date.now();
          
          // Skip duplicate actions within 100ms
          if (actionKey === lastActionKey && (now - lastActionTime) < DEDUPE_MS) {
            return;
          }
          lastActionKey = actionKey;
          lastActionTime = now;
          
          // Use console.log for communication since postMessage doesn't reach webview listener
          console.log(JSON.stringify({
            type: 'dashing-action',
            payload: { type, ...data }
          }));
        };
        
        const getSelector = (el) => {
          if (!el || el === document.body) return 'body';
          if (el.id) return '#' + el.id;
          
          let path = [];
          while (el && el !== document.body) {
            let selector = el.tagName.toLowerCase();
            if (el.id) {
              selector += '#' + el.id;
              path.unshift(selector);
              break;
            }
            if (el.className && typeof el.className === 'string') {
              selector += '.' + el.className.trim().split(/\\s+/).join('.');
            }
            const siblings = Array.from(el.parentElement?.children || []);
            const index = siblings.indexOf(el);
            if (siblings.length > 1) {
              selector += ':nth-child(' + (index + 1) + ')';
            }
            path.unshift(selector);
            el = el.parentElement;
          }
          return path.join(' > ');
        };
        
        const getElementInfo = (el) => {
          if (!el) return null;
          return {
            selector: getSelector(el),
            tagName: el.tagName?.toLowerCase() || '',
            id: el.id || undefined,
            classes: el.className && typeof el.className === 'string' 
              ? el.className.trim().split(/\\s+/).filter(Boolean) 
              : [],
            text: (el.innerText || el.textContent || '').slice(0, 100),
            attributes: Object.fromEntries(
              Array.from(el.attributes || [])
                .filter(a => ['href', 'src', 'name', 'type', 'value', 'placeholder', 'aria-label', 'role'].includes(a.name))
                .map(a => [a.name, a.value])
            ),
          };
        };
        
        // Click
        document.addEventListener('click', (e) => {
          sendAction('click', {
            element: getElementInfo(e.target),
            data: { x: e.clientX, y: e.clientY, button: e.button }
          });
        }, true);
        
        // Double click
        document.addEventListener('dblclick', (e) => {
          sendAction('dblclick', {
            element: getElementInfo(e.target),
            data: { x: e.clientX, y: e.clientY }
          });
        }, true);
        
        // Context menu (right click)
        document.addEventListener('contextmenu', (e) => {
          sendAction('rightclick', {
            element: getElementInfo(e.target),
            data: { x: e.clientX, y: e.clientY }
          });
        }, true);
        
        // Input (debounced)
        let typeTimer = null;
        document.addEventListener('input', (e) => {
          if (typeTimer) clearTimeout(typeTimer);
          typeTimer = setTimeout(() => {
            sendAction('type', {
              element: getElementInfo(e.target),
              data: { value: e.target.value || '' }
            });
          }, 300);
        }, true);
        
        // Key down (for shortcuts)
        document.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.ctrlKey || e.metaKey) {
            sendAction('keypress', {
              element: getElementInfo(e.target),
              data: {
                key: e.key,
                modifiers: [
                  e.ctrlKey && 'Ctrl',
                  e.altKey && 'Alt', 
                  e.shiftKey && 'Shift',
                  e.metaKey && 'Meta'
                ].filter(Boolean)
              }
            });
          }
        }, true);
        
        // Scroll (debounced)
        let scrollTimer = null;
        window.addEventListener('scroll', () => {
          if (scrollTimer) clearTimeout(scrollTimer);
          scrollTimer = setTimeout(() => {
            sendAction('scroll', {
              data: { scrollX: window.scrollX, scrollY: window.scrollY }
            });
          }, 200);
        }, true);
        
        // Focus - commented out to reduce noise
        // document.addEventListener('focus', (e) => {
        //   if (e.target !== document && e.target !== window) {
        //     sendAction('focus', {
        //       element: getElementInfo(e.target)
        //     });
        //   }
        // }, true);
        
        // Submit
        document.addEventListener('submit', (e) => {
          sendAction('submit', {
            element: getElementInfo(e.target)
          });
        }, true);
        
        // Select (text selection)
        document.addEventListener('mouseup', () => {
          const selection = window.getSelection();
          if (selection && selection.toString().trim()) {
            sendAction('select', {
              data: { selectedText: selection.toString() }
            });
          }
        }, true);
        
        // Drag and drop
        let dragStartElement = null;
        let dragStartPos = null;
        
        document.addEventListener('dragstart', (e) => {
          dragStartElement = e.target;
          dragStartPos = { x: e.clientX, y: e.clientY };
          sendAction('dragstart', {
            element: getElementInfo(e.target),
            data: { x: e.clientX, y: e.clientY }
          });
        }, true);
        
        document.addEventListener('drop', (e) => {
          sendAction('drop', {
            element: getElementInfo(e.target),
            data: { 
              x: e.clientX, 
              y: e.clientY,
              fromX: dragStartPos?.x,
              fromY: dragStartPos?.y
            }
          });
          dragStartElement = null;
          dragStartPos = null;
        }, true);
        
        // Change (for select/checkbox/radio)
        document.addEventListener('change', (e) => {
          const target = e.target;
          if (target.tagName === 'SELECT' || target.type === 'checkbox' || target.type === 'radio') {
            sendAction('change', {
              element: getElementInfo(target),
              data: { 
                value: target.value,
                checked: target.checked
              }
            });
          }
        }, true);
        
        // Hover (only when mouse stays over interactive element for 2+ seconds)
        let hoverTimer = null;
        let lastHoveredElement = null;
        document.addEventListener('mouseover', (e) => {
          const target = e.target;
          const tagName = target.tagName?.toLowerCase();
          
          // Clear previous timer if we moved to a different element
          if (hoverTimer && target !== lastHoveredElement) {
            clearTimeout(hoverTimer);
            hoverTimer = null;
          }
          lastHoveredElement = target;
          
          if (['a', 'button', 'input', 'select', 'textarea'].includes(tagName) || 
              target.role === 'button' || target.onclick) {
            hoverTimer = setTimeout(() => {
              sendAction('hover', {
                element: getElementInfo(target),
                data: { x: e.clientX, y: e.clientY }
              });
              hoverTimer = null;
            }, 2000);
          }
        }, true);
        
        // Clear hover timer when mouse leaves
        document.addEventListener('mouseout', (e) => {
          if (hoverTimer) {
            clearTimeout(hoverTimer);
            hoverTimer = null;
          }
        }, true);
        
        console.log('[Dashing] Action recorder initialized');
      })();
    `;
    
    webview.executeJavaScript(recorderScript).catch(err => {
      console.error('Failed to inject recorder:', err);
    });
    
    // Only add the console-message listener once per tab
    // We use a flag on the webview to prevent duplicate listeners
    const webviewEl = webview as unknown as { __dashingActionListenerAdded?: boolean };
    if (!webviewEl.__dashingActionListenerAdded) {
      webviewEl.__dashingActionListenerAdded = true;
      
      // Listen for actions via console-message
      webview.addEventListener('console-message', (e: Event) => {
        const consoleEvent = e as Electron.ConsoleMessageEvent;
        try {
          if (consoleEvent.message.startsWith('{"type":"dashing-action"')) {
            const data = JSON.parse(consoleEvent.message);
            this.handleRecordedAction(tab, data.payload);
          } else if (consoleEvent.message.startsWith('{"type":"dashing-click"')) {
            // Hide context menu when webview is clicked
            this.hideContextMenu();
          } else if (consoleEvent.message.startsWith('{"type":"dashing-context-position"')) {
            // Store the context menu position from webview
            const data = JSON.parse(consoleEvent.message);
            this.lastContextMenuPosition = data.payload;
          }
        } catch {
          // Not a dashing action message
        }
      });
    }
  }
  
  private handleRecordedAction(tab: BrowserTab, actionData: { type: ActionType; element?: unknown; data?: unknown }): void {
    if (this.sessionStatus !== 'recording') return;
    
    // Deduplicate: create a key from action type and element selector
    const elementInfo = actionData.element as { selector?: string } | undefined;
    const actionKey = `${actionData.type}:${elementInfo?.selector || 'none'}`;
    const now = Date.now();
    
    // Skip if same action on same element within deduplication window
    if (actionKey === this.lastActionKey && (now - this.lastActionTime) < this.actionDedupeMs) {
      return;
    }
    
    this.lastActionKey = actionKey;
    this.lastActionTime = now;
    
    const action: RecordedAction = {
      id: `action-${now}-${Math.random().toString(36).substr(2, 9)}`,
      sessionId: this.sessionId,
      windowId: this.windowId,
      windowLabel: this.windowLabel,
      tabId: tab.id,
      tabUrl: tab.url,
      tabTitle: tab.title,
      type: actionData.type,
      timestamp: now,
      element: actionData.element as RecordedAction['element'],
      data: (actionData.data || {}) as RecordedAction['data'],
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
    };
    
    tab.actionCount++;
    this.updateCounters(tab);
    
    // Send to backend
    window.sessionAPI.recordAction(action);
  }
  
  private recordNavigateAction(tab: BrowserTab, url: string): void {
    if (this.sessionStatus !== 'recording') return;
    
    const action: RecordedAction = {
      id: `action-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      sessionId: this.sessionId,
      windowId: this.windowId,
      windowLabel: this.windowLabel,
      tabId: tab.id,
      tabUrl: url,
      tabTitle: tab.title,
      type: 'navigate',
      timestamp: Date.now(),
      data: { url },
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
    };
    
    tab.actionCount++;
    this.updateCounters(tab);
    
    window.sessionAPI.recordAction(action);
  }
  
  private recordError(tab: BrowserTab, errorData: { type: 'console' | 'http'; message: string; source?: string; statusCode?: number }): void {
    const error: TabError = {
      id: `error-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      sessionId: this.sessionId,
      windowId: this.windowId,
      windowLabel: this.windowLabel,
      tabId: tab.id,
      type: errorData.type,
      message: errorData.message,
      source: errorData.source || tab.url,
      timestamp: Date.now(),
      statusCode: errorData.statusCode,
    };
    
    tab.errorCount++;
    this.updateCounters(tab);
    
    window.sessionAPI.recordError(error);
  }
  
  // ============================================
  // UI Updates
  // ============================================
  
  private updateTabTitle(tab: BrowserTab): void {
    const titleEl = tab.element?.querySelector('.tab-title');
    if (titleEl) titleEl.textContent = tab.title;
  }
  
  private updateTabFavicon(tab: BrowserTab): void {
    const faviconEl = tab.element?.querySelector('.tab-favicon') as HTMLImageElement;
    if (faviconEl && tab.favicon) {
      faviconEl.src = tab.favicon;
      faviconEl.style.display = 'block';
    }
  }
  
  private updateTabLoading(tab: BrowserTab): void {
    // Could add loading indicator
  }
  
  private updateNavButtons(tab: BrowserTab): void {
    const backBtn = document.getElementById('back-btn') as HTMLButtonElement;
    const forwardBtn = document.getElementById('forward-btn') as HTMLButtonElement;
    
    if (backBtn) backBtn.disabled = !tab.canGoBack;
    if (forwardBtn) forwardBtn.disabled = !tab.canGoForward;
  }
  
  private updateCounters(tab: BrowserTab): void {
    const actionCountEl = document.getElementById('action-count');
    const errorCountEl = document.getElementById('error-count');
    
    if (actionCountEl) {
      const spanEl = actionCountEl.querySelector('span');
      if (spanEl) spanEl.textContent = tab.actionCount.toString();
    }
    
    if (errorCountEl) {
      const spanEl = errorCountEl.querySelector('span');
      if (spanEl) spanEl.textContent = tab.errorCount.toString();
      errorCountEl.classList.toggle('hidden', tab.errorCount === 0);
    }
  }
  
  // ============================================
  // Navigation
  // ============================================
  
  private setupNavigation(): void {
    const backBtn = document.getElementById('back-btn');
    const forwardBtn = document.getElementById('forward-btn');
    const refreshBtn = document.getElementById('refresh-btn');
    const homeBtn = document.getElementById('home-btn');
    
    backBtn?.addEventListener('click', () => this.goBack());
    forwardBtn?.addEventListener('click', () => this.goForward());
    refreshBtn?.addEventListener('click', () => this.refresh());
    homeBtn?.addEventListener('click', () => this.goHome());
  }
  
  private goBack(): void {
    const tab = this.getActiveTab();
    if (tab?.webview?.canGoBack()) {
      tab.webview.goBack();
    }
  }
  
  private goForward(): void {
    const tab = this.getActiveTab();
    if (tab?.webview?.canGoForward()) {
      tab.webview.goForward();
    }
  }
  
  private refresh(): void {
    const tab = this.getActiveTab();
    tab?.webview?.reload();
  }
  
  private goHome(): void {
    this.navigateTo('about:blank');
  }
  
  private setupAddressBar(): void {
    if (!this.addressInput) return;
    
    // Enter to navigate
    this.addressInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.navigateTo(this.addressInput!.value);
      }
    });
    
    // Go button
    const goBtn = document.getElementById('go-btn');
    goBtn?.addEventListener('click', () => {
      this.navigateTo(this.addressInput!.value);
    });
    
    // Select all on focus
    this.addressInput.addEventListener('focus', () => {
      this.addressInput?.select();
    });
  }
  
  private navigateTo(url: string): void {
    const tab = this.getActiveTab();
    if (!tab) return;
    
    // Normalize URL
    let normalizedUrl = url.trim();
    if (!normalizedUrl) return;
    
    if (!/^https?:\/\//i.test(normalizedUrl) && !/^about:/i.test(normalizedUrl)) {
      // Check if it looks like a domain
      if (/^[\w-]+\.[a-z]{2,}(\/|$)/i.test(normalizedUrl)) {
        normalizedUrl = 'https://' + normalizedUrl;
      } else {
        // Treat as search query
        normalizedUrl = `https://www.google.com/search?q=${encodeURIComponent(normalizedUrl)}`;
      }
    }
    
    if (tab.webview) {
      tab.webview.loadURL(normalizedUrl);
    } else {
      // Create webview for this tab with full interaction support
      const content = this.tabContentContainer?.querySelector(`[data-tab-id="${tab.id}"]`);
      if (content) {
        content.innerHTML = '';
        const webview = document.createElement('webview');
        webview.src = normalizedUrl;
        webview.setAttribute('partition', 'persist:session');
        webview.setAttribute('webpreferences', 'contextIsolation=yes, allowRunningInsecureContent=no');
        webview.setAttribute('allowpopups', 'true');
        webview.setAttribute('autosize', 'on');
        webview.style.width = '100%';
        webview.style.height = '100%';
        webview.style.display = 'flex';
        content.appendChild(webview);
        tab.webview = webview as Electron.WebviewTag;
        this.setupWebviewListeners(tab);
      }
    }
    
    tab.url = normalizedUrl;
    if (this.addressInput) {
      this.addressInput.value = normalizedUrl;
    }
  }
  
  // ============================================
  // Window Controls
  // ============================================
  
  private setupWindowControls(): void {
    document.getElementById('minimize-btn')?.addEventListener('click', () => {
      window.sessionAPI.minimize();
    });
    
    document.getElementById('maximize-btn')?.addEventListener('click', () => {
      window.sessionAPI.maximize();
    });
    
    document.getElementById('close-btn')?.addEventListener('click', () => {
      window.sessionAPI.close();
    });
    
    document.getElementById('add-window-btn')?.addEventListener('click', () => {
      window.sessionAPI.addWindow();
    });
    
    // New tab button
    const newTabBtn = document.createElement('button');
    newTabBtn.className = 'new-tab-btn';
    newTabBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="12" y1="5" x2="12" y2="19"/>
        <line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
    `;
    newTabBtn.addEventListener('click', () => this.createTab());
    this.tabBar?.appendChild(newTabBtn);
  }
  
  // ============================================
  // Context Menu
  // ============================================
  
  private setupContextMenu(): void {
    // Track mouse position globally for accurate context menu positioning
    document.addEventListener('mousemove', (e) => {
      this.lastMousePosition = { x: e.clientX, y: e.clientY };
    });
    
    // Also track on mousedown for more accurate right-click position
    document.addEventListener('mousedown', (e) => {
      this.lastMousePosition = { x: e.clientX, y: e.clientY };
      if (this.contextMenu && !this.contextMenu.contains(e.target as Node)) {
        this.hideContextMenu();
      }
    });
    
    // Close on escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.hideContextMenu();
      }
    });
    
    // Close on any click (including webview clicks which don't bubble)
    document.addEventListener('click', () => {
      this.hideContextMenu();
    });
  }
  
  private showContextMenu(items: Array<{ label: string; action: () => void; shortcut?: string; disabled?: boolean; separator?: boolean }>, x: number, y: number): void {
    if (!this.contextMenu) return;
    
    this.contextMenu.innerHTML = '';
    
    for (const item of items) {
      if (item.separator) {
        const sep = document.createElement('div');
        sep.className = 'context-menu-separator';
        this.contextMenu.appendChild(sep);
      } else {
        const menuItem = document.createElement('div');
        menuItem.className = `context-menu-item${item.disabled ? ' disabled' : ''}`;
        menuItem.innerHTML = `
          <span>${item.label}</span>
          ${item.shortcut ? `<span class="context-menu-shortcut">${item.shortcut}</span>` : ''}
        `;
        
        if (!item.disabled) {
          menuItem.addEventListener('click', () => {
            item.action();
            this.hideContextMenu();
          });
        }
        
        this.contextMenu.appendChild(menuItem);
      }
    }
    
    // Position menu
    this.contextMenu.style.left = `${x}px`;
    this.contextMenu.style.top = `${y}px`;
    this.contextMenu.classList.remove('hidden');
    
    // Adjust if off screen
    const rect = this.contextMenu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      this.contextMenu.style.left = `${window.innerWidth - rect.width - 10}px`;
    }
    if (rect.bottom > window.innerHeight) {
      this.contextMenu.style.top = `${window.innerHeight - rect.height - 10}px`;
    }
  }
  
  private hideContextMenu(): void {
    this.contextMenu?.classList.add('hidden');
  }
  
  // ============================================
  // Webview Context Menu (Add as Expected)
  // ============================================
  
  private setupWebviewContextMenu(tab: BrowserTab): void {
    const webview = tab.webview;
    if (!webview) return;
    
    // Inject context menu handler script
    const contextMenuScript = `
      (function() {
        if (window.__dashingContextMenuInitialized) return;
        window.__dashingContextMenuInitialized = true;
        
        // Store the last right-clicked element
        let lastRightClickedElement = null;
        let lastRightClickedElementInfo = null;
        
        const getSelector = (el) => {
          if (!el || el === document.body) return 'body';
          if (el.id) return '#' + el.id;
          
          let path = [];
          let current = el;
          while (current && current !== document.body) {
            let selector = current.tagName.toLowerCase();
            if (current.id) {
              selector += '#' + current.id;
              path.unshift(selector);
              break;
            }
            if (current.className && typeof current.className === 'string') {
              selector += '.' + current.className.trim().split(/\\s+/).join('.');
            }
            const siblings = Array.from(current.parentElement?.children || []);
            const index = siblings.indexOf(current);
            if (siblings.length > 1) {
              selector += ':nth-child(' + (index + 1) + ')';
            }
            path.unshift(selector);
            current = current.parentElement;
          }
          return path.join(' > ');
        };
        
        const getElementInfo = (el) => {
          if (!el) return null;
          const rect = el.getBoundingClientRect();
          return {
            selector: getSelector(el),
            tagName: el.tagName?.toLowerCase() || '',
            id: el.id || undefined,
            classes: el.className && typeof el.className === 'string' 
              ? el.className.trim().split(/\\s+/).filter(Boolean) 
              : [],
            text: (el.innerText || el.textContent || '').slice(0, 200),
            attributes: Object.fromEntries(
              Array.from(el.attributes || [])
                .filter(a => ['href', 'src', 'name', 'type', 'value', 'placeholder', 'aria-label', 'role', 'title', 'data-testid'].includes(a.name))
                .map(a => [a.name, a.value])
            ),
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            value: el.value,
            checked: el.checked,
            disabled: el.disabled,
            visible: rect.width > 0 && rect.height > 0,
          };
        };
        
        // Store right-click context info for synchronous retrieval
        window.__dashingLastRightClickPos = null;
        window.__dashingLastRightClickContext = null;
        
        // Find the closest link element (anchor with href)
        const findClosestLink = (el) => {
          let current = el;
          while (current && current !== document.body) {
            if (current.tagName === 'A' && current.href) {
              return current.href;
            }
            current = current.parentElement;
          }
          return null;
        };
        
        // Find image source if clicking on an image
        const findImageSrc = (el) => {
          if (el.tagName === 'IMG' && el.src) {
            return el.src;
          }
          // Check for background image
          const style = window.getComputedStyle(el);
          const bgImage = style.backgroundImage;
          if (bgImage && bgImage !== 'none') {
            const match = bgImage.match(/url\\(['"]?([^'"\\)]+)['"]?\\)/);
            if (match) return match[1];
          }
          return null;
        };
        
        // Capture right-click element, position, and context
        document.addEventListener('contextmenu', (e) => {
          lastRightClickedElement = e.target;
          lastRightClickedElementInfo = getElementInfo(e.target);
          
          // Store position on window for synchronous access
          window.__dashingLastRightClickPos = { x: e.clientX, y: e.clientY };
          
          // Store additional context info
          const linkURL = findClosestLink(e.target);
          const imageSrc = findImageSrc(e.target);
          const selection = window.getSelection();
          const selectedText = selection && selection.toString().trim();
          const isEditable = e.target.isContentEditable || 
                            e.target.tagName === 'INPUT' || 
                            e.target.tagName === 'TEXTAREA' ||
                            e.target.tagName === 'SELECT';
          
          window.__dashingLastRightClickContext = {
            linkURL: linkURL,
            imageSrc: imageSrc,
            selectedText: selectedText || null,
            isEditable: isEditable,
            tagName: e.target.tagName?.toLowerCase() || '',
          };
          
          // Also send position via console for backup
          console.log(JSON.stringify({
            type: 'dashing-context-position',
            payload: { x: e.clientX, y: e.clientY }
          }));
        }, true);
        
        // Notify parent on any click (to close context menu)
        document.addEventListener('click', () => {
          console.log(JSON.stringify({
            type: 'dashing-click'
          }));
        }, true);
        
        // Handle "Add as Expected" request from main process
        window.addEventListener('message', (event) => {
          if (event.data && event.data.type === 'dashing-add-expected') {
            if (lastRightClickedElementInfo) {
              // Determine assertion type based on element
              const el = lastRightClickedElement;
              let assertionType = 'visible';
              let expectedText = lastRightClickedElementInfo.text || '';
              let expectedValue = lastRightClickedElementInfo.value || '';
              
              if (el) {
                if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                  assertionType = 'hasValue';
                  expectedValue = el.value || '';
                } else if (el.tagName === 'SELECT') {
                  assertionType = 'hasValue';
                  expectedValue = el.value || '';
                } else if (el.type === 'checkbox' || el.type === 'radio') {
                  assertionType = el.checked ? 'checked' : 'visible';
                } else if (expectedText.trim()) {
                  assertionType = 'hasText';
                }
              }
              
              // Send the expected assertion action
              console.log(JSON.stringify({
                type: 'dashing-action',
                payload: {
                  type: 'addExpected',
                  element: lastRightClickedElementInfo,
                  data: {
                    assertionType: assertionType,
                    expectedText: expectedText,
                    expectedValue: expectedValue,
                  }
                }
              }));
            }
          }
        });
        
        console.log('[Dashing] Context menu handler initialized');
      })();
    `;
    
    webview.executeJavaScript(contextMenuScript).catch(err => {
      console.error('Failed to inject context menu handler:', err);
    });
    
    // Listen for context-menu event from the webview
    // The event params contain detailed info about what was right-clicked
    webview.addEventListener('context-menu', async (e: Event) => {
      // Access the params from Electron's context-menu event
      const params = (e as Event & { params: Electron.ContextMenuParams }).params;
      
      // Prevent default immediately
      e.preventDefault();
      
      // Get the webview's position in the window
      const webviewRect = webview.getBoundingClientRect();
      
      // Synchronously fetch the last right-click position and context from the webview
      // This is more reliable than waiting for console messages
      let webviewPosition: { x: number; y: number } | null = null;
      let webviewContext: { 
        linkURL: string | null; 
        imageSrc: string | null; 
        selectedText: string | null;
        isEditable: boolean;
        tagName: string;
      } | null = null;
      
      try {
        const result = await webview.executeJavaScript(`
          (function() {
            return {
              position: window.__dashingLastRightClickPos || null,
              context: window.__dashingLastRightClickContext || null
            };
          })();
        `);
        webviewPosition = result?.position as { x: number; y: number } | null;
        webviewContext = result?.context as typeof webviewContext;
      } catch {
        // Ignore errors, will fall back to params
      }
      
      // Calculate the position
      let x: number;
      let y: number;
      
      if (webviewPosition) {
        // Position from inside webview - add webview's position to get window coordinates
        x = webviewRect.left + webviewPosition.x;
        y = webviewRect.top + webviewPosition.y;
      } else if (this.lastContextMenuPosition) {
        // Fallback to async captured position
        x = webviewRect.left + this.lastContextMenuPosition.x;
        y = webviewRect.top + this.lastContextMenuPosition.y;
        this.lastContextMenuPosition = null;
      } else {
        // Fallback to params (may be less accurate)
        x = webviewRect.left + (params?.x || 0);
        y = webviewRect.top + (params?.y || 0);
      }
      
      // Build context menu items based on what was clicked
      const menuItems: Array<{ label: string; action: () => void; shortcut?: string; disabled?: boolean; separator?: boolean }> = [];
      
      // Add "Add as Expected" option when recording
      if (this.sessionStatus === 'recording') {
        menuItems.push({
          label: '✓ Add as Expected',
          action: () => {
            webview.executeJavaScript(`
              window.postMessage({ type: 'dashing-add-expected' }, '*');
            `);
          },
        });
        menuItems.push({ label: '', action: () => { /* separator */ }, separator: true });
      }
      
      // Link options - check both Electron params and webview context
      const linkURL = params?.linkURL || webviewContext?.linkURL;
      if (linkURL) {
        menuItems.push({
          label: 'Open Link in New Tab',
          action: () => this.createTab(linkURL),
        });
        menuItems.push({
          label: 'Copy Link Address',
          action: () => {
            navigator.clipboard.writeText(linkURL);
          },
        });
        menuItems.push({ label: '', action: () => { /* separator */ }, separator: true });
      }
      
      // Image options - check both Electron params and webview context
      const imageSrc = (params?.mediaType === 'image' && params?.srcURL) ? params.srcURL : webviewContext?.imageSrc;
      if (imageSrc) {
        menuItems.push({
          label: 'Open Image in New Tab',
          action: () => this.createTab(imageSrc),
        });
        menuItems.push({
          label: 'Copy Image Address',
          action: () => {
            navigator.clipboard.writeText(imageSrc);
          },
        });
        menuItems.push({ label: '', action: () => { /* separator */ }, separator: true });
      }
      
      // Selection options - check both Electron params and webview context
      const selectionText = params?.selectionText || webviewContext?.selectedText;
      if (selectionText) {
        menuItems.push({
          label: 'Copy',
          action: () => webview.copy(),
          shortcut: '⌘C',
        });
        menuItems.push({
          label: `Search Google for "${selectionText.slice(0, 30)}${selectionText.length > 30 ? '...' : ''}"`,
          action: () => {
            const query = encodeURIComponent(selectionText);
            this.createTab(`https://www.google.com/search?q=${query}`);
          },
        });
        menuItems.push({ label: '', action: () => { /* separator */ }, separator: true });
      }
      
      // Editable field options - check both Electron params and webview context
      const isEditable = params?.isEditable || webviewContext?.isEditable;
      if (isEditable) {
        menuItems.push({
          label: 'Undo',
          action: () => webview.undo(),
          shortcut: '⌘Z',
        });
        menuItems.push({
          label: 'Redo',
          action: () => webview.redo(),
          shortcut: '⇧⌘Z',
        });
        menuItems.push({ label: '', action: () => { /* separator */ }, separator: true });
        menuItems.push({
          label: 'Cut',
          action: () => webview.cut(),
          shortcut: '⌘X',
        });
        menuItems.push({
          label: 'Copy',
          action: () => webview.copy(),
          shortcut: '⌘C',
        });
        menuItems.push({
          label: 'Paste',
          action: () => webview.paste(),
          shortcut: '⌘V',
        });
        menuItems.push({
          label: 'Select All',
          action: () => webview.selectAll(),
          shortcut: '⌘A',
        });
        menuItems.push({ label: '', action: () => { /* separator */ }, separator: true });
      }
      
      // Navigation options (always show)
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
      menuItems.push({ label: '', action: () => { /* separator */ }, separator: true });
      
      // Page actions
      menuItems.push({
        label: 'View Page Source',
        action: () => {
          const currentUrl = webview.getURL();
          this.createTab(`view-source:${currentUrl}`);
        },
      });
      menuItems.push({
        label: 'Inspect Element',
        action: () => webview.inspectElement(params?.x || 0, params?.y || 0),
      });
      
      this.showContextMenu(menuItems, x, y);
    });
  }
  
  // ============================================
  // Error & Status Listeners
  // ============================================
  
  private setupHttpErrorListener(): void {
    window.sessionAPI.onHttpError((errorData: { 
      statusCode: number; 
      url: string; 
      method: string; 
      resourceType: string; 
      error?: string;
      timestamp: number;
    }) => {
      // Find the tab that this error belongs to
      let matchedTab = this.tabs.find(t => t.isLoading || t.url === errorData.url);
      
      // Try to match by hostname if exact URL match fails
      if (!matchedTab) {
        try {
          const errorUrl = new URL(errorData.url);
          matchedTab = this.tabs.find(t => {
            try {
              const tabUrl = new URL(t.url);
              return tabUrl.hostname === errorUrl.hostname;
            } catch {
              return false;
            }
          });
        } catch {
          // Invalid URL, use active tab
        }
      }
      
      // Fall back to active tab
      if (!matchedTab) {
        matchedTab = this.tabs.find(t => t.id === this.activeTabId);
      }
      
      if (matchedTab && this.sessionStatus === 'recording') {
        const message = errorData.error 
          ? `${errorData.method} ${errorData.url} - ${errorData.error}`
          : `${errorData.method} ${errorData.url} returned ${errorData.statusCode}`;
        
        this.recordError(matchedTab, {
          type: 'http',
          message,
          source: errorData.url,
          statusCode: errorData.statusCode,
        });
      }
    });
  }
  
  private setupSessionStatusListener(): void {
    window.sessionAPI.onSessionStatusChange((status: string) => {
      this.sessionStatus = status as 'recording' | 'paused';
      
      const statusEl = document.getElementById('session-status');
      if (statusEl) {
        statusEl.className = `session-status ${status}`;
        statusEl.innerHTML = status === 'recording' 
          ? '<span class="recording-dot"></span>Recording'
          : 'Paused';
      }
    });
  }
  
  // ============================================
  // TC Checklist Panel
  // ============================================
  
  private setupChecklistPanel(): void {
    this.checklistPanel = document.getElementById('tc-side-panel');
    this.checklistBtn = document.getElementById('tc-checklist-btn');
    
    // Toggle button
    this.checklistBtn?.addEventListener('click', () => this.toggleChecklistPanel());
    
    // Close button
    document.getElementById('tc-panel-close')?.addEventListener('click', () => this.hideChecklistPanel());
    
    // Empty state buttons
    document.getElementById('tc-upload-btn')?.addEventListener('click', () => this.triggerCsvUpload());
    document.getElementById('tc-create-btn')?.addEventListener('click', () => this.showCreateModal());
    
    // Footer buttons
    document.getElementById('tc-footer-upload-btn')?.addEventListener('click', () => this.triggerCsvUpload());
    document.getElementById('tc-footer-create-btn')?.addEventListener('click', () => this.showCreateModal());
    
    // CSV file input
    document.getElementById('tc-csv-input')?.addEventListener('change', (e) => this.handleCsvUpload(e));
    
    // Modal buttons
    document.getElementById('tc-modal-close')?.addEventListener('click', () => this.hideModal());
    document.getElementById('tc-modal-cancel')?.addEventListener('click', () => this.hideModal());
    document.getElementById('tc-modal-save')?.addEventListener('click', () => this.saveTestCase());
    
    // Clear error state on input
    document.getElementById('tc-form-title')?.addEventListener('input', (e) => {
      (e.target as HTMLInputElement).classList.remove('error');
    });
    document.getElementById('tc-form-expected')?.addEventListener('input', (e) => {
      (e.target as HTMLTextAreaElement).classList.remove('error');
    });
    
    // Section toggle
    document.querySelectorAll('.tc-section-header').forEach(header => {
      header.addEventListener('click', (e) => this.toggleSection(e));
    });
  }
  
  private toggleChecklistPanel(): void {
    if (this.checklistPanel?.classList.contains('hidden')) {
      this.showChecklistPanel();
    } else {
      this.hideChecklistPanel();
    }
  }
  
  private async showChecklistPanel(): Promise<void> {
    this.checklistPanel?.classList.remove('hidden');
    this.checklistBtn?.classList.add('active');
    
    // Load test cases from backend
    await this.loadChecklist();
  }
  
  private hideChecklistPanel(): void {
    this.checklistPanel?.classList.add('hidden');
    this.checklistBtn?.classList.remove('active');
  }
  
  private async loadChecklist(): Promise<void> {
    try {
      this.checklistTestCases = await window.sessionAPI.getChecklistItems(this.sessionId);
      this.renderChecklist();
    } catch (error) {
      console.error('[Session] Failed to load checklist:', error);
    }
  }
  
  private renderChecklist(): void {
    const emptyState = document.getElementById('tc-empty-state');
    const checklistContent = document.getElementById('tc-checklist-content');
    const panelFooter = document.getElementById('tc-panel-footer');
    
    // Filter by status
    const pending = this.checklistTestCases.filter(tc => tc.status === 'pending');
    const passed = this.checklistTestCases.filter(tc => tc.status === 'passed');
    const failed = this.checklistTestCases.filter(tc => tc.status === 'failed');
    const skipped = this.checklistTestCases.filter(tc => tc.status === 'skipped');
    
    // Update counts
    const pendingCount = document.getElementById('tc-count-pending');
    const passedCount = document.getElementById('tc-count-passed');
    const failedCount = document.getElementById('tc-count-failed');
    const skippedCount = document.getElementById('tc-count-skipped');
    
    if (pendingCount) pendingCount.textContent = String(pending.length);
    if (passedCount) passedCount.textContent = String(passed.length);
    if (failedCount) failedCount.textContent = String(failed.length);
    if (skippedCount) skippedCount.textContent = String(skipped.length);
    
    if (this.checklistTestCases.length === 0) {
      emptyState?.classList.remove('hidden');
      checklistContent?.classList.add('hidden');
      panelFooter?.classList.add('hidden');
    } else {
      emptyState?.classList.add('hidden');
      checklistContent?.classList.remove('hidden');
      panelFooter?.classList.remove('hidden');
      
      // Render each section
      this.renderSectionCards('tc-list-pending', pending);
      this.renderSectionCards('tc-list-passed', passed);
      this.renderSectionCards('tc-list-failed', failed);
      this.renderSectionCards('tc-list-skipped', skipped);
    }
  }
  
  private renderSectionCards(containerId: string, testCases: ChecklistTestCase[]): void {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    if (testCases.length === 0) {
      container.innerHTML = '<p class="tc-section-empty">No test cases</p>';
      return;
    }
    
    container.innerHTML = testCases.map(tc => this.renderTestCaseCard(tc)).join('');
    
    // Attach event listeners
    container.querySelectorAll('.tc-status-btn').forEach(btn => {
      btn.addEventListener('click', (e) => this.handleStatusChange(e));
    });
    
    container.querySelectorAll('.tc-card-btn.edit').forEach(btn => {
      btn.addEventListener('click', (e) => this.handleEditClick(e));
    });
    
    container.querySelectorAll('.tc-card-btn.delete').forEach(btn => {
      btn.addEventListener('click', (e) => this.handleDeleteClick(e));
    });
  }
  
  private renderTestCaseCard(tc: ChecklistTestCase): string {
    const priorityClass = tc.priority;
    const statusClass = tc.status !== 'pending' ? tc.status : '';
    
    return `
      <div class="tc-case-card ${statusClass}" data-tc-id="${tc.id}">
        <div class="tc-case-header">
          <span class="tc-case-title">${this.escapeHtml(tc.name)}</span>
          <span class="tc-case-priority ${priorityClass}">${tc.priority}</span>
        </div>
        ${tc.description ? `<p class="tc-case-description">${this.escapeHtml(tc.description)}</p>` : ''}
        <div class="tc-case-actions">
          <div class="tc-status-actions">
            <button class="tc-status-btn pass ${tc.status === 'passed' ? 'active' : ''}" data-status="passed" data-tc-id="${tc.id}" title="Mark as Passed">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </button>
            <button class="tc-status-btn fail ${tc.status === 'failed' ? 'active' : ''}" data-status="failed" data-tc-id="${tc.id}" title="Mark as Failed">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
            <button class="tc-status-btn skip ${tc.status === 'skipped' ? 'active' : ''}" data-status="skipped" data-tc-id="${tc.id}" title="Mark as Skipped">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="5 4 15 12 5 20 5 4"/>
                <line x1="19" y1="5" x2="19" y2="19"/>
              </svg>
            </button>
          </div>
          <div class="tc-card-actions">
            <button class="tc-card-btn edit" data-tc-id="${tc.id}" title="Edit">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
            <button class="tc-card-btn delete" data-tc-id="${tc.id}" title="Delete">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    `;
  }
  
  private toggleSection(e: Event): void {
    const header = e.currentTarget as HTMLElement;
    const section = header.closest('.tc-section');
    const body = section?.querySelector('.tc-section-body');
    
    section?.classList.toggle('collapsed');
    body?.classList.toggle('collapsed');
  }
  
  private async handleStatusChange(e: Event): Promise<void> {
    const btn = e.currentTarget as HTMLElement;
    const tcId = btn.dataset.tcId;
    const newStatus = btn.dataset.status as 'passed' | 'failed' | 'skipped';
    
    if (!tcId) return;
    
    // If clicking the same status, toggle back to pending
    const tc = this.checklistTestCases.find(t => t.id === tcId);
    const finalStatus = tc?.status === newStatus ? 'pending' : newStatus;
    
    try {
      await window.sessionAPI.updateChecklistItem(tcId, { status: finalStatus });
      await this.loadChecklist();
    } catch (error) {
      console.error('[Session] Failed to update test case status:', error);
    }
  }
  
  private handleEditClick(e: Event): void {
    const btn = e.currentTarget as HTMLElement;
    const tcId = btn.dataset.tcId;
    if (!tcId) return;
    
    const tc = this.checklistTestCases.find(t => t.id === tcId);
    if (!tc) return;
    
    this.editingTestCaseId = tcId;
    this.showEditModal(tc);
  }
  
  private async handleDeleteClick(e: Event): Promise<void> {
    const btn = e.currentTarget as HTMLElement;
    const tcId = btn.dataset.tcId;
    if (!tcId) return;
    
    try {
      await window.sessionAPI.deleteChecklistItem(tcId);
      await this.loadChecklist();
    } catch (error) {
      console.error('[Session] Failed to delete test case:', error);
    }
  }
  
  private triggerCsvUpload(): void {
    const input = document.getElementById('tc-csv-input') as HTMLInputElement;
    input?.click();
  }
  
  private async handleCsvUpload(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    
    try {
      const text = await file.text();
      const testCases = this.parseCsv(text);
      
      for (const tc of testCases) {
        await window.sessionAPI.addChecklistItem({
          sessionId: this.sessionId,
          source: 'manual',
          name: tc.name,
          description: tc.description,
          steps: tc.steps,
          expectedResult: tc.expectedResult,
          priority: tc.priority,
          status: 'pending',
        });
      }
      
      await this.loadChecklist();
      input.value = '';
    } catch (error) {
      console.error('[Session] Failed to parse CSV:', error);
    }
  }
  
  private parseCsv(text: string): Array<{
    name: string;
    description?: string;
    steps?: string;
    expectedResult: string;
    priority: 'critical' | 'high' | 'medium' | 'low';
  }> {
    const lines = text.split('\n');
    const results: Array<{
      name: string;
      description?: string;
      steps?: string;
      expectedResult: string;
      priority: 'critical' | 'high' | 'medium' | 'low';
    }> = [];
    
    // Skip header row
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      const parts = this.parseCsvLine(line);
      if (parts.length >= 4) {
        const [title, description, steps, expectedResult, priorityStr] = parts;
        const priority = this.normalizePriority(priorityStr || 'medium');
        
        results.push({
          name: title,
          description: description || undefined,
          steps: steps || undefined,
          expectedResult: expectedResult,
          priority,
        });
      }
    }
    
    return results;
  }
  
  private parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    
    result.push(current.trim());
    return result;
  }
  
  private normalizePriority(str: string): 'critical' | 'high' | 'medium' | 'low' {
    const lower = str.toLowerCase().trim();
    if (lower === 'critical') return 'critical';
    if (lower === 'high') return 'high';
    if (lower === 'low') return 'low';
    return 'medium';
  }
  
  private showCreateModal(): void {
    this.editingTestCaseId = null;
    
    const modalTitle = document.getElementById('tc-modal-title');
    if (modalTitle) modalTitle.textContent = 'Create Test Case';
    
    // Clear form
    (document.getElementById('tc-form-title') as HTMLInputElement).value = '';
    (document.getElementById('tc-form-description') as HTMLTextAreaElement).value = '';
    (document.getElementById('tc-form-steps') as HTMLTextAreaElement).value = '';
    (document.getElementById('tc-form-expected') as HTMLTextAreaElement).value = '';
    (document.getElementById('tc-form-priority') as HTMLSelectElement).value = 'medium';
    
    document.getElementById('tc-modal-overlay')?.classList.remove('hidden');
  }
  
  private showEditModal(tc: ChecklistTestCase): void {
    const modalTitle = document.getElementById('tc-modal-title');
    if (modalTitle) modalTitle.textContent = 'Edit Test Case';
    
    // Populate form
    (document.getElementById('tc-form-title') as HTMLInputElement).value = tc.name;
    (document.getElementById('tc-form-description') as HTMLTextAreaElement).value = tc.description || '';
    (document.getElementById('tc-form-steps') as HTMLTextAreaElement).value = tc.steps || '';
    (document.getElementById('tc-form-expected') as HTMLTextAreaElement).value = tc.expectedResult;
    (document.getElementById('tc-form-priority') as HTMLSelectElement).value = tc.priority;
    
    document.getElementById('tc-modal-overlay')?.classList.remove('hidden');
  }
  
  private hideModal(): void {
    document.getElementById('tc-modal-overlay')?.classList.add('hidden');
    this.editingTestCaseId = null;
  }
  
  private async saveTestCase(): Promise<void> {
    const titleInput = document.getElementById('tc-form-title') as HTMLInputElement;
    const expectedInput = document.getElementById('tc-form-expected') as HTMLTextAreaElement;
    const title = titleInput.value.trim();
    const description = (document.getElementById('tc-form-description') as HTMLTextAreaElement).value.trim();
    const steps = (document.getElementById('tc-form-steps') as HTMLTextAreaElement).value.trim();
    const expectedResult = expectedInput.value.trim();
    const priority = (document.getElementById('tc-form-priority') as HTMLSelectElement).value as 'critical' | 'high' | 'medium' | 'low';
    
    // Clear previous error states
    titleInput.classList.remove('error');
    expectedInput.classList.remove('error');
    
    // Validate mandatory fields
    let hasError = false;
    if (!title) {
      titleInput.classList.add('error');
      hasError = true;
    }
    if (!expectedResult) {
      expectedInput.classList.add('error');
      hasError = true;
    }
    
    if (hasError) {
      return;
    }
    
    try {
      if (this.editingTestCaseId) {
        await window.sessionAPI.updateChecklistItem(this.editingTestCaseId, {
          name: title,
          description: description || undefined,
          steps: steps || undefined,
          expectedResult,
          priority,
        });
      } else {
        await window.sessionAPI.addChecklistItem({
          sessionId: this.sessionId,
          source: 'manual',
          name: title,
          description: description || undefined,
          steps: steps || undefined,
          expectedResult,
          priority,
          status: 'pending',
        });
      }
      
      this.hideModal();
      await this.loadChecklist();
    } catch (error) {
      console.error('[Session] Failed to save test case:', error);
    }
  }
  
  // ============================================
  // Utilities
  // ============================================
  
  private escapeHtml(str: string): string {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}

// Initialize session app
document.addEventListener('DOMContentLoaded', () => {
  new SessionApp();
  
  // Remove webpack-dev-server error overlay if it appears
  const removeOverlay = () => {
    const overlays = document.querySelectorAll('iframe[id*="webpack"], div[id*="webpack-dev-server"]');
    overlays.forEach(overlay => overlay.remove());
    
    // Also check for any modal-like overlays that block interaction
    const blockingOverlays = document.querySelectorAll('[style*="position: fixed"][style*="z-index"]');
    blockingOverlays.forEach(overlay => {
      if (overlay.id?.includes('webpack') || overlay.className?.includes('webpack')) {
        overlay.remove();
      }
    });
  };
  
  // Remove immediately and watch for new ones
  removeOverlay();
  
  // Use MutationObserver to remove overlays as they appear
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLElement) {
          if (node.id?.includes('webpack') || node.tagName === 'IFRAME') {
            const src = node.getAttribute('src') || '';
            if (src.includes('webpack') || node.id?.includes('webpack')) {
              node.remove();
            }
          }
        }
      }
    }
  });
  
  observer.observe(document.body, { childList: true, subtree: true });
});

