// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer } from 'electron';
import type {
  RecordedAction,
  TabError,
  Session,
  GetActionsRequest,
  GetActionsResponse,
  SessionStartRequest,
  SyncStatus,
} from './shared/types';

// HTTP Error type from main process
interface HttpErrorData {
  statusCode: number;
  url: string;
  method: string;
  resourceType: string;
  timestamp: number;
  error?: string;
}

contextBridge.exposeInMainWorld('electronAPI', {
  // ============================================
  // Window Controls
  // ============================================
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),

  // ============================================
  // Session Management
  // ============================================
  startSession: (request: SessionStartRequest): Promise<Session> =>
    ipcRenderer.invoke('session-start', request),
  
  endSession: (sessionId: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('session-end', sessionId),
  
  getCurrentSession: (): Promise<Session | null> =>
    ipcRenderer.invoke('session-current'),

  // ============================================
  // Action Storage
  // ============================================
  storeAction: (action: RecordedAction): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('store-action', action),
  
  storeActions: (actions: RecordedAction[]): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('store-actions', actions),
  
  getActions: (request: GetActionsRequest): Promise<GetActionsResponse> =>
    ipcRenderer.invoke('get-actions', request),
  
  getActionsByTab: (tabId: string, limit?: number): Promise<RecordedAction[]> =>
    ipcRenderer.invoke('get-actions-by-tab', tabId, limit),
  
  getActionCount: (tabId?: string): Promise<number> =>
    ipcRenderer.invoke('get-action-count', tabId),
  
  clearActions: (tabId?: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('clear-actions', tabId),

  // ============================================
  // Error Storage
  // ============================================
  storeError: (error: TabError): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('store-error', error),
  
  getErrors: (tabId?: string, limit?: number): Promise<TabError[]> =>
    ipcRenderer.invoke('get-errors', tabId, limit),
  
  clearErrors: (tabId?: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('clear-errors', tabId),

  // ============================================
  // Sync Status
  // ============================================
  getSyncStatus: (): Promise<SyncStatus> =>
    ipcRenderer.invoke('get-sync-status'),
  
  flushEvents: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('flush-events'),

  // ============================================
  // Event Listeners
  // ============================================
  
  // Listen for HTTP errors from main process
  onHttpError: (callback: (error: HttpErrorData) => void) => {
    ipcRenderer.on('http-error', (_event, error) => callback(error));
  },
  
  // Remove HTTP error listener
  removeHttpErrorListener: () => {
    ipcRenderer.removeAllListeners('http-error');
  },
  
  // Listen for open-in-new-tab requests from main process
  onOpenInNewTab: (callback: (url: string) => void) => {
    ipcRenderer.on('open-in-new-tab', (_event, url) => callback(url));
  },
  
  // Remove open-in-new-tab listener
  removeOpenInNewTabListener: () => {
    ipcRenderer.removeAllListeners('open-in-new-tab');
  },
});

// Type declaration for window.electronAPI
export interface ElectronAPI {
  // Window controls
  minimize: () => void;
  maximize: () => void;
  close: () => void;
  
  // Session management
  startSession: (request: SessionStartRequest) => Promise<Session>;
  endSession: (sessionId: string) => Promise<{ success: boolean }>;
  getCurrentSession: () => Promise<Session | null>;
  
  // Action storage
  storeAction: (action: RecordedAction) => Promise<{ success: boolean }>;
  storeActions: (actions: RecordedAction[]) => Promise<{ success: boolean }>;
  getActions: (request: GetActionsRequest) => Promise<GetActionsResponse>;
  getActionsByTab: (tabId: string, limit?: number) => Promise<RecordedAction[]>;
  getActionCount: (tabId?: string) => Promise<number>;
  clearActions: (tabId?: string) => Promise<{ success: boolean }>;
  
  // Error storage
  storeError: (error: TabError) => Promise<{ success: boolean }>;
  getErrors: (tabId?: string, limit?: number) => Promise<TabError[]>;
  clearErrors: (tabId?: string) => Promise<{ success: boolean }>;
  
  // Sync status
  getSyncStatus: () => Promise<SyncStatus>;
  flushEvents: () => Promise<{ success: boolean }>;
  
  // Event listeners
  onHttpError: (callback: (error: HttpErrorData) => void) => void;
  removeHttpErrorListener: () => void;
  onOpenInNewTab: (callback: (url: string) => void) => void;
  removeOpenInNewTabListener: () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
