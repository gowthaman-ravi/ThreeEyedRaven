/**
 * Session Window Preload Script
 * Exposes browser and recording APIs to the session renderer
 */

import { contextBridge, ipcRenderer } from 'electron';
import { 
  RecordedAction, 
  TabError, 
  SessionTab 
} from '../shared/types';

contextBridge.exposeInMainWorld('sessionAPI', {
  // ============================================
  // Session Context
  // ============================================
  
  getContext: async (): Promise<{ sessionId: string; windowId: string; windowLabel: string } | null> => {
    return ipcRenderer.invoke('session-get-context');
  },
  
  // ============================================
  // Tab Management
  // ============================================
  
  createTab: async (url?: string): Promise<SessionTab> => {
    return ipcRenderer.invoke('session-add-tab-local', url);
  },
  
  updateTab: async (tabId: string, updates: Partial<SessionTab>): Promise<void> => {
    return ipcRenderer.invoke('session-update-tab-local', tabId, updates);
  },
  
  closeTab: async (tabId: string): Promise<void> => {
    return ipcRenderer.invoke('session-close-tab-local', tabId);
  },
  
  // ============================================
  // Action Recording
  // ============================================
  
  recordAction: async (action: RecordedAction): Promise<void> => {
    return ipcRenderer.invoke('store-action', action);
  },
  
  recordError: async (error: TabError): Promise<void> => {
    return ipcRenderer.invoke('store-error', error);
  },
  
  // ============================================
  // Window Controls
  // ============================================
  
  minimize: (): void => {
    ipcRenderer.send('window-minimize');
  },
  
  maximize: (): void => {
    ipcRenderer.send('window-maximize');
  },
  
  close: (): void => {
    ipcRenderer.send('window-close');
  },
  
  addWindow: async (): Promise<void> => {
    return ipcRenderer.invoke('session-add-window-from-session');
  },
  
  // ============================================
  // HTTP Error Listener
  // ============================================
  
  onHttpError: (callback: (error: { 
    statusCode: number; 
    url: string; 
    method: string; 
    resourceType: string; 
    error?: string;
    timestamp: number;
  }) => void): void => {
    ipcRenderer.on('http-error', (_event, error) => {
      callback(error);
    });
  },
  
  removeHttpErrorListener: (): void => {
    ipcRenderer.removeAllListeners('http-error');
  },
  
  // ============================================
  // Session Status Listener
  // ============================================
  
  onSessionStatusChange: (callback: (status: string) => void): void => {
    ipcRenderer.on('session-status-change', (_event, status: string) => {
      callback(status);
    });
  },
  
  // ============================================
  // TC Checklist
  // ============================================
  
  getChecklistItems: async (sessionId: string): Promise<Array<{
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
  }>> => {
    return ipcRenderer.invoke('checklist-get-items', sessionId);
  },
  
  addChecklistItem: async (item: {
    sessionId: string;
    source: 'manual' | 'auto';
    name: string;
    description?: string;
    steps?: string;
    expectedResult: string;
    priority: 'critical' | 'high' | 'medium' | 'low';
    status: 'pending' | 'passed' | 'failed' | 'skipped';
  }): Promise<{
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
  }> => {
    return ipcRenderer.invoke('checklist-add-item', item);
  },
  
  updateChecklistItem: async (id: string, updates: {
    name?: string;
    description?: string;
    steps?: string;
    expectedResult?: string;
    priority?: 'critical' | 'high' | 'medium' | 'low';
    status?: 'pending' | 'passed' | 'failed' | 'skipped';
  }): Promise<boolean> => {
    return ipcRenderer.invoke('checklist-update-item', id, updates);
  },
  
  deleteChecklistItem: async (id: string): Promise<boolean> => {
    return ipcRenderer.invoke('checklist-delete-item', id);
  },
});

