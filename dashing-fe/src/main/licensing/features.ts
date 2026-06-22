/**
 * Feature flags and tier definitions for ThreeEyedRaven
 * 
 * This module defines all available features and which tiers have access to them.
 * Features are gated based on the user's license tier.
 */

// All available features in the application
export enum Feature {
  // ============================================
  // Free Tier Features
  // ============================================
  SESSION_RECORDING = 'session_recording',
  LOCAL_STORAGE = 'local_storage',
  BASIC_EXPORT_JSON = 'basic_export_json',
  BASIC_EXPORT_CSV = 'basic_export_csv',
  MULTI_WINDOW = 'multi_window',
  ERROR_CAPTURE = 'error_capture',
  ACTION_RECORDING = 'action_recording',
  IGNORE_ERRORS = 'ignore_errors',
  SESSION_HISTORY = 'session_history',
  
  // ============================================
  // Pro Tier Features
  // ============================================
  LOCAL_API_SERVER = 'local_api_server',
  CLOUD_SYNC = 'cloud_sync',
  EXPORT_PLAYWRIGHT = 'export_playwright',
  EXPORT_CYPRESS = 'export_cypress',
  EXPORT_HAR = 'export_har',
  UNLIMITED_SESSIONS = 'unlimited_sessions',
  EXTENDED_HISTORY = 'extended_history',
  TEST_CASE_GENERATION = 'test_case_generation',
  CODE_GENERATION = 'code_generation',
  
  // ============================================
  // Enterprise Tier Features
  // ============================================
  AI_INSIGHTS = 'ai_insights',
  TEST_GENERATION = 'test_generation',
  TEAM_SHARING = 'team_sharing',
  CUSTOM_INTEGRATIONS = 'custom_integrations',
  PRIORITY_SUPPORT = 'priority_support',
  SSO = 'sso',
}

// License tiers
export type LicenseTier = 'free' | 'pro' | 'enterprise';

// Feature definitions per tier
export const TIER_FEATURES: Record<LicenseTier, Feature[]> = {
  free: [
    Feature.SESSION_RECORDING,
    Feature.LOCAL_STORAGE,
    Feature.BASIC_EXPORT_JSON,
    Feature.BASIC_EXPORT_CSV,
    Feature.MULTI_WINDOW,
    Feature.ERROR_CAPTURE,
    Feature.ACTION_RECORDING,
    Feature.IGNORE_ERRORS,
    Feature.SESSION_HISTORY,
  ],
  
  pro: [
    // All free features
    Feature.SESSION_RECORDING,
    Feature.LOCAL_STORAGE,
    Feature.BASIC_EXPORT_JSON,
    Feature.BASIC_EXPORT_CSV,
    Feature.MULTI_WINDOW,
    Feature.ERROR_CAPTURE,
    Feature.ACTION_RECORDING,
    Feature.IGNORE_ERRORS,
    Feature.SESSION_HISTORY,
    // Pro features
    Feature.LOCAL_API_SERVER,
    Feature.CLOUD_SYNC,
    Feature.EXPORT_PLAYWRIGHT,
    Feature.EXPORT_CYPRESS,
    Feature.EXPORT_HAR,
    Feature.UNLIMITED_SESSIONS,
    Feature.EXTENDED_HISTORY,
    Feature.TEST_CASE_GENERATION,
    Feature.CODE_GENERATION,
  ],
  
  enterprise: [
    // All pro features
    Feature.SESSION_RECORDING,
    Feature.LOCAL_STORAGE,
    Feature.BASIC_EXPORT_JSON,
    Feature.BASIC_EXPORT_CSV,
    Feature.MULTI_WINDOW,
    Feature.ERROR_CAPTURE,
    Feature.ACTION_RECORDING,
    Feature.IGNORE_ERRORS,
    Feature.SESSION_HISTORY,
    Feature.LOCAL_API_SERVER,
    Feature.CLOUD_SYNC,
    Feature.EXPORT_PLAYWRIGHT,
    Feature.EXPORT_CYPRESS,
    Feature.EXPORT_HAR,
    Feature.UNLIMITED_SESSIONS,
    Feature.EXTENDED_HISTORY,
    Feature.TEST_CASE_GENERATION,
    Feature.CODE_GENERATION,
    // Enterprise features
    Feature.AI_INSIGHTS,
    Feature.TEST_GENERATION,
    Feature.TEAM_SHARING,
    Feature.CUSTOM_INTEGRATIONS,
    Feature.PRIORITY_SUPPORT,
    Feature.SSO,
  ],
};

// Tier limits
export interface TierLimits {
  maxActiveSessions: number;
  maxWindowsPerSession: number;
  maxActionsPerSession: number;
  historyRetentionDays: number;
}

export const TIER_LIMITS: Record<LicenseTier, TierLimits> = {
  free: {
    maxActiveSessions: 3,
    maxWindowsPerSession: 3,
    maxActionsPerSession: 1000,
    historyRetentionDays: 7,
  },
  pro: {
    maxActiveSessions: 10,
    maxWindowsPerSession: 10,
    maxActionsPerSession: 10000,
    historyRetentionDays: 90,
  },
  enterprise: {
    maxActiveSessions: 20,
    maxWindowsPerSession: 20,
    maxActionsPerSession: -1, // Unlimited
    historyRetentionDays: -1, // Unlimited
  },
};

// Feature metadata for UI display
export interface FeatureInfo {
  name: string;
  description: string;
  tier: LicenseTier;
  icon?: string;
}

export const FEATURE_INFO: Record<Feature, FeatureInfo> = {
  [Feature.SESSION_RECORDING]: {
    name: 'Session Recording',
    description: 'Record QA testing sessions with full action tracking',
    tier: 'free',
  },
  [Feature.LOCAL_STORAGE]: {
    name: 'Local Storage',
    description: 'Store sessions locally on your device',
    tier: 'free',
  },
  [Feature.BASIC_EXPORT_JSON]: {
    name: 'JSON Export',
    description: 'Export sessions as JSON files',
    tier: 'free',
  },
  [Feature.BASIC_EXPORT_CSV]: {
    name: 'CSV Export',
    description: 'Export sessions as CSV files',
    tier: 'free',
  },
  [Feature.MULTI_WINDOW]: {
    name: 'Multi-Window Sessions',
    description: 'Test multi-user flows with multiple browser windows',
    tier: 'free',
  },
  [Feature.ERROR_CAPTURE]: {
    name: 'Error Capture',
    description: 'Capture HTTP and console errors automatically',
    tier: 'free',
  },
  [Feature.ACTION_RECORDING]: {
    name: 'Action Recording',
    description: 'Record clicks, inputs, scrolls, and other user actions',
    tier: 'free',
  },
  [Feature.IGNORE_ERRORS]: {
    name: 'Ignore Errors',
    description: 'Filter out known or expected errors',
    tier: 'free',
  },
  [Feature.SESSION_HISTORY]: {
    name: 'Session History',
    description: 'View and manage past testing sessions',
    tier: 'free',
  },
  [Feature.LOCAL_API_SERVER]: {
    name: 'Local API Server',
    description: 'REST API for external tool integration',
    tier: 'pro',
  },
  [Feature.CLOUD_SYNC]: {
    name: 'Cloud Sync',
    description: 'Sync sessions to your team\'s cloud backend',
    tier: 'pro',
  },
  [Feature.EXPORT_PLAYWRIGHT]: {
    name: 'Playwright Export',
    description: 'Generate Playwright test scripts from recordings',
    tier: 'pro',
  },
  [Feature.EXPORT_CYPRESS]: {
    name: 'Cypress Export',
    description: 'Generate Cypress test scripts from recordings',
    tier: 'pro',
  },
  [Feature.EXPORT_HAR]: {
    name: 'HAR Export',
    description: 'Export network activity as HAR files',
    tier: 'pro',
  },
  [Feature.UNLIMITED_SESSIONS]: {
    name: 'Unlimited Sessions',
    description: 'No limits on concurrent sessions',
    tier: 'pro',
  },
  [Feature.EXTENDED_HISTORY]: {
    name: 'Extended History',
    description: '90-day session history retention',
    tier: 'pro',
  },
  [Feature.TEST_CASE_GENERATION]: {
    name: 'Test Case Generation',
    description: 'Generate test cases from recorded form interactions',
    tier: 'pro',
  },
  [Feature.CODE_GENERATION]: {
    name: 'Code Generation',
    description: 'Generate Playwright test code from recordings',
    tier: 'pro',
  },
  [Feature.AI_INSIGHTS]: {
    name: 'AI Insights',
    description: 'AI-powered analysis of testing patterns and issues',
    tier: 'enterprise',
  },
  [Feature.TEST_GENERATION]: {
    name: 'Test Generation',
    description: 'Automatically generate test cases from recordings',
    tier: 'enterprise',
  },
  [Feature.TEAM_SHARING]: {
    name: 'Team Sharing',
    description: 'Share sessions and insights with your team',
    tier: 'enterprise',
  },
  [Feature.CUSTOM_INTEGRATIONS]: {
    name: 'Custom Integrations',
    description: 'Integrate with your existing tools and workflows',
    tier: 'enterprise',
  },
  [Feature.PRIORITY_SUPPORT]: {
    name: 'Priority Support',
    description: 'Get priority support from our team',
    tier: 'enterprise',
  },
  [Feature.SSO]: {
    name: 'Single Sign-On',
    description: 'Enterprise SSO integration',
    tier: 'enterprise',
  },
};

/**
 * Check if a feature is available for a given tier
 */
export function isFeatureAvailableForTier(feature: Feature, tier: LicenseTier): boolean {
  return TIER_FEATURES[tier].includes(feature);
}

/**
 * Get the minimum tier required for a feature
 */
export function getMinimumTierForFeature(feature: Feature): LicenseTier {
  if (TIER_FEATURES.free.includes(feature)) return 'free';
  if (TIER_FEATURES.pro.includes(feature)) return 'pro';
  return 'enterprise';
}

/**
 * Get all features available for a tier
 */
export function getFeaturesForTier(tier: LicenseTier): Feature[] {
  return TIER_FEATURES[tier];
}

/**
 * Get tier limits
 */
export function getLimitsForTier(tier: LicenseTier): TierLimits {
  return TIER_LIMITS[tier];
}

