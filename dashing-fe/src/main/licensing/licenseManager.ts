/**
 * License Manager for Dashing
 * 
 * Handles license key validation, storage, and feature access control.
 * Supports offline grace periods and periodic re-validation.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import {
  Feature,
  LicenseTier,
  TIER_FEATURES,
  TierLimits,
  TIER_LIMITS,
  isFeatureAvailableForTier
} from './features';
import { LICENSING_ENABLED } from '../../shared/config';

// License data structure
export interface License {
  key: string;
  tier: LicenseTier;
  features: Feature[];
  limits: TierLimits;
  validatedAt: number;
  expiresAt: number;
  email?: string;
  orgId?: string;
  orgName?: string;
  userName?: string;
}

// License validation response from backend
export interface LicenseValidationResponse {
  valid: boolean;
  tier: LicenseTier;
  expiresAt: number;
  email?: string;
  orgId?: string;
  orgName?: string;
  userName?: string;
  error?: string;
}

// License status for UI
export interface LicenseStatus {
  isLicensed: boolean;
  tier: LicenseTier;
  expiresAt?: number;
  daysUntilExpiry?: number;
  needsRevalidation: boolean;
  isInGracePeriod: boolean;
  email?: string;
  orgName?: string;
}

// Configuration
const LICENSE_FILE_NAME = 'license.dat';
const ENCRYPTION_KEY = 'dashing-license-v1'; // In production, use a more secure approach
const GRACE_PERIOD_DAYS = 7;
const REVALIDATION_INTERVAL_DAYS = 7;

// Backend API URL (configurable for different environments)
const LICENSE_API_URL = process.env.DASHING_LICENSE_API_URL || 'https://api.dashing.dev/v1/license';

class LicenseManager {
  private license: License | null = null;
  private licensePath: string;
  private initialized = false;

  constructor() {
    // Store license in app data directory
    const appDataPath = process.env.APPDATA || 
      (process.platform === 'darwin' 
        ? path.join(os.homedir(), 'Library', 'Application Support', 'dashing')
        : path.join(os.homedir(), '.dashing'));
    
    // Ensure directory exists
    if (!fs.existsSync(appDataPath)) {
      fs.mkdirSync(appDataPath, { recursive: true });
    }
    
    this.licensePath = path.join(appDataPath, LICENSE_FILE_NAME);
  }

  /**
   * Initialize the license manager - load existing license from disk
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    try {
      this.license = this.loadLicenseFromDisk();
      console.log(`[LicenseManager] Loaded license: ${this.license ? this.license.tier : 'none'}`);
    } catch (error) {
      console.error('[LicenseManager] Failed to load license:', error);
      this.license = null;
    }
    
    this.initialized = true;
  }

  /**
   * Validate a license key against the backend
   */
  async validateLicenseKey(key: string): Promise<{ success: boolean; error?: string }> {
    try {
      // For development/testing, allow special keys
      if (this.isDevLicenseKey(key)) {
        const devLicense = this.createDevLicense(key);
        this.license = devLicense;
        this.saveLicenseToDisk(devLicense);
        return { success: true };
      }

      // Call the backend API
      const response = await fetch(`${LICENSE_API_URL}/validate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          key,
          appVersion: process.env.npm_package_version || '1.0.0',
          platform: process.platform,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return { 
          success: false, 
          error: errorData.error || `Validation failed: ${response.status}` 
        };
      }

      const data: LicenseValidationResponse = await response.json();

      if (!data.valid) {
        return { success: false, error: data.error || 'Invalid license key' };
      }

      // Create and store the license
      const license: License = {
        key,
        tier: data.tier,
        features: TIER_FEATURES[data.tier],
        limits: TIER_LIMITS[data.tier],
        validatedAt: Date.now(),
        expiresAt: data.expiresAt,
        email: data.email,
        orgId: data.orgId,
        orgName: data.orgName,
        userName: data.userName,
      };

      this.license = license;
      this.saveLicenseToDisk(license);

      console.log(`[LicenseManager] License validated: ${license.tier}`);
      return { success: true };

    } catch (error) {
      console.error('[LicenseManager] Validation error:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Network error' 
      };
    }
  }

  /**
   * Check if revalidation is needed (periodic check)
   */
  async checkAndRevalidate(): Promise<void> {
    if (!this.license) return;

    const status = this.getStatus();
    if (status.needsRevalidation && !status.isInGracePeriod) {
      console.log('[LicenseManager] Revalidating license...');
      const result = await this.validateLicenseKey(this.license.key);
      if (!result.success) {
        console.warn('[LicenseManager] Revalidation failed:', result.error);
        // Don't clear license immediately - allow grace period
      }
    }
  }

  /**
   * Deactivate the current license
   */
  deactivateLicense(): void {
    this.license = null;
    this.deleteLicenseFromDisk();
    console.log('[LicenseManager] License deactivated');
  }

  /**
   * Check if a specific feature is enabled
   */
  isFeatureEnabled(feature: Feature): boolean {
    // Licensing temporarily disabled: all features are enabled by default.
    if (!LICENSING_ENABLED) return true;
    const tier = this.getCurrentTier();
    return isFeatureAvailableForTier(feature, tier);
  }

  /**
   * Get the current license tier
   */
  getCurrentTier(): LicenseTier {
    // Licensing temporarily disabled: treat everyone as the highest tier so
    // limits are generous and all features are unlocked.
    if (!LICENSING_ENABLED) return 'enterprise';
    if (!this.license) return 'free';
    
    // Check if license has expired
    if (this.license.expiresAt && Date.now() > this.license.expiresAt) {
      const daysPastExpiry = (Date.now() - this.license.expiresAt) / (1000 * 60 * 60 * 24);
      if (daysPastExpiry > GRACE_PERIOD_DAYS) {
        return 'free';
      }
    }
    
    return this.license.tier;
  }

  /**
   * Get current limits based on tier
   */
  getCurrentLimits(): TierLimits {
    return TIER_LIMITS[this.getCurrentTier()];
  }

  /**
   * Get license status for UI display
   */
  getStatus(): LicenseStatus {
    // Licensing temporarily disabled: report an unlocked enterprise status.
    if (!LICENSING_ENABLED) {
      return {
        isLicensed: true,
        tier: 'enterprise',
        needsRevalidation: false,
        isInGracePeriod: false,
      };
    }

    if (!this.license) {
      return {
        isLicensed: false,
        tier: 'free',
        needsRevalidation: false,
        isInGracePeriod: false,
      };
    }

    const now = Date.now();
    const daysSinceValidation = (now - this.license.validatedAt) / (1000 * 60 * 60 * 24);
    const needsRevalidation = daysSinceValidation > REVALIDATION_INTERVAL_DAYS;
    
    let isInGracePeriod = false;
    let daysUntilExpiry: number | undefined;

    if (this.license.expiresAt) {
      const msUntilExpiry = this.license.expiresAt - now;
      daysUntilExpiry = Math.ceil(msUntilExpiry / (1000 * 60 * 60 * 24));
      
      if (daysUntilExpiry < 0) {
        isInGracePeriod = Math.abs(daysUntilExpiry) <= GRACE_PERIOD_DAYS;
      }
    }

    return {
      isLicensed: true,
      tier: this.getCurrentTier(),
      expiresAt: this.license.expiresAt,
      daysUntilExpiry,
      needsRevalidation,
      isInGracePeriod,
      email: this.license.email,
      orgName: this.license.orgName,
    };
  }

  /**
   * Get the full license object (for debugging/display)
   */
  getLicense(): License | null {
    return this.license;
  }

  // ============================================
  // Private Methods
  // ============================================

  /**
   * Check if this is a development license key
   */
  private isDevLicenseKey(key: string): boolean {
    return key.startsWith('DEV-') || key.startsWith('TEST-');
  }

  /**
   * Create a development license for testing
   */
  private createDevLicense(key: string): License {
    let tier: LicenseTier = 'pro';
    
    if (key.includes('ENTERPRISE')) {
      tier = 'enterprise';
    } else if (key.includes('FREE')) {
      tier = 'free';
    }

    return {
      key,
      tier,
      features: TIER_FEATURES[tier],
      limits: TIER_LIMITS[tier],
      validatedAt: Date.now(),
      expiresAt: Date.now() + (365 * 24 * 60 * 60 * 1000), // 1 year
      email: 'dev@example.com',
      orgName: 'Development',
    };
  }

  /**
   * Load license from disk
   */
  private loadLicenseFromDisk(): License | null {
    if (!fs.existsSync(this.licensePath)) {
      return null;
    }

    try {
      const encryptedData = fs.readFileSync(this.licensePath, 'utf8');
      const decryptedData = this.decrypt(encryptedData);
      return JSON.parse(decryptedData);
    } catch (error) {
      console.error('[LicenseManager] Failed to read license file:', error);
      return null;
    }
  }

  /**
   * Save license to disk
   */
  private saveLicenseToDisk(license: License): void {
    try {
      const jsonData = JSON.stringify(license);
      const encryptedData = this.encrypt(jsonData);
      fs.writeFileSync(this.licensePath, encryptedData, 'utf8');
      console.log('[LicenseManager] License saved to disk');
    } catch (error) {
      console.error('[LicenseManager] Failed to save license:', error);
    }
  }

  /**
   * Delete license from disk
   */
  private deleteLicenseFromDisk(): void {
    try {
      if (fs.existsSync(this.licensePath)) {
        fs.unlinkSync(this.licensePath);
        console.log('[LicenseManager] License file deleted');
      }
    } catch (error) {
      console.error('[LicenseManager] Failed to delete license file:', error);
    }
  }

  /**
   * Simple encryption for license storage
   * Note: In production, use a more secure approach
   */
  private encrypt(text: string): string {
    const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  }

  /**
   * Decrypt license data
   */
  private decrypt(encryptedText: string): string {
    const [ivHex, encrypted] = encryptedText.split(':');
    const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }
}

// Singleton instance
let licenseManagerInstance: LicenseManager | null = null;

/**
 * Get or create the LicenseManager singleton
 */
export function getLicenseManager(): LicenseManager {
  if (!licenseManagerInstance) {
    licenseManagerInstance = new LicenseManager();
  }
  return licenseManagerInstance;
}

/**
 * Initialize the license manager (call once on app start)
 */
export async function initializeLicenseManager(): Promise<LicenseManager> {
  const manager = getLicenseManager();
  await manager.initialize();
  return manager;
}

export { LicenseManager };

