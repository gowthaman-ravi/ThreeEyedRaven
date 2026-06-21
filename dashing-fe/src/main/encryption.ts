/**
 * Encryption Service for secure API key storage
 * 
 * Uses Electron's safeStorage API which leverages OS-level encryption:
 * - macOS: Keychain
 * - Windows: DPAPI
 * - Linux: libsecret or kwallet
 */

import { safeStorage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

const STORAGE_FILE = 'ai-keys.enc';

interface EncryptedKeyStore {
  [providerId: string]: string; // Base64 encoded encrypted data
}

class EncryptionService {
  private storagePath: string;
  private keyStore: EncryptedKeyStore = {};

  constructor() {
    this.storagePath = path.join(app.getPath('userData'), STORAGE_FILE);
    this.loadKeyStore();
  }

  /**
   * Check if encryption is available on this system
   */
  isEncryptionAvailable(): boolean {
    return safeStorage.isEncryptionAvailable();
  }

  /**
   * Encrypt and store an API key for a provider
   */
  encryptAndStore(providerId: string, apiKey: string): boolean {
    try {
      if (!this.isEncryptionAvailable()) {
        console.error('[EncryptionService] Encryption not available on this system');
        return false;
      }

      const encrypted = safeStorage.encryptString(apiKey);
      this.keyStore[providerId] = encrypted.toString('base64');
      this.saveKeyStore();
      
      console.log(`[EncryptionService] Stored encrypted key for ${providerId}`);
      return true;
    } catch (error) {
      console.error('[EncryptionService] Failed to encrypt:', error);
      return false;
    }
  }

  /**
   * Retrieve and decrypt an API key for a provider
   */
  decryptAndRetrieve(providerId: string): string | null {
    try {
      const encryptedBase64 = this.keyStore[providerId];
      if (!encryptedBase64) {
        return null;
      }

      if (!this.isEncryptionAvailable()) {
        console.error('[EncryptionService] Encryption not available on this system');
        return null;
      }

      const encrypted = Buffer.from(encryptedBase64, 'base64');
      const decrypted = safeStorage.decryptString(encrypted);
      
      return decrypted;
    } catch (error) {
      console.error('[EncryptionService] Failed to decrypt:', error);
      return null;
    }
  }

  /**
   * Remove stored key for a provider
   */
  removeKey(providerId: string): boolean {
    try {
      if (this.keyStore[providerId]) {
        delete this.keyStore[providerId];
        this.saveKeyStore();
        console.log(`[EncryptionService] Removed key for ${providerId}`);
        return true;
      }
      return false;
    } catch (error) {
      console.error('[EncryptionService] Failed to remove key:', error);
      return false;
    }
  }

  /**
   * Check if a key exists for a provider
   */
  hasKey(providerId: string): boolean {
    return !!this.keyStore[providerId];
  }

  /**
   * Get list of providers with stored keys
   */
  getStoredProviders(): string[] {
    return Object.keys(this.keyStore);
  }

  /**
   * Load key store from disk
   */
  private loadKeyStore(): void {
    try {
      if (fs.existsSync(this.storagePath)) {
        const data = fs.readFileSync(this.storagePath, 'utf-8');
        this.keyStore = JSON.parse(data);
        console.log('[EncryptionService] Loaded key store');
      }
    } catch (error) {
      console.error('[EncryptionService] Failed to load key store:', error);
      this.keyStore = {};
    }
  }

  /**
   * Save key store to disk
   */
  private saveKeyStore(): void {
    try {
      fs.writeFileSync(this.storagePath, JSON.stringify(this.keyStore, null, 2));
      console.log('[EncryptionService] Saved key store');
    } catch (error) {
      console.error('[EncryptionService] Failed to save key store:', error);
    }
  }
}

// Singleton instance
let encryptionService: EncryptionService | null = null;

export function getEncryptionService(): EncryptionService {
  if (!encryptionService) {
    encryptionService = new EncryptionService();
  }
  return encryptionService;
}

export { EncryptionService };
