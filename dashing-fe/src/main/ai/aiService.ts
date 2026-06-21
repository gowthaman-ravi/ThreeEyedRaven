/**
 * AI Service Layer
 * 
 * Manages AI provider configurations, model fetching, and provides
 * a unified interface for making AI requests with auto-fallback support.
 */

import { getEncryptionService } from '../encryption';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

// Provider IDs
export type AIProviderId = 'openai' | 'anthropic' | 'gemini';

// Model information
export interface ModelInfo {
  id: string;
  name: string;
  description?: string;
}

// Provider configuration
export interface AIProviderConfig {
  id: AIProviderId;
  name: string;
  selectedModel: string;
  isEnabled: boolean;
  priority: number;
  lastValidated?: number;
  cachedModels?: ModelInfo[];
  modelsCachedAt?: number;
}

// Full AI integration settings
export interface AIIntegrationSettings {
  providers: AIProviderConfig[];
  autoFallback: boolean;
}

// Provider metadata
export const AI_PROVIDERS: Record<AIProviderId, { name: string; icon: string; defaultModels: ModelInfo[] }> = {
  openai: {
    name: 'OpenAI',
    icon: 'openai',
    defaultModels: [
      { id: 'gpt-4o', name: 'GPT-4o', description: 'Most capable model' },
      { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', description: 'Fast and capable' },
      { id: 'gpt-4', name: 'GPT-4', description: 'Original GPT-4' },
      { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', description: 'Fast and economical' },
    ],
  },
  anthropic: {
    name: 'Anthropic',
    icon: 'anthropic',
    defaultModels: [
      { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', description: 'Latest model' },
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', description: 'Best balance of speed and intelligence' },
      { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', description: 'Most capable' },
      { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku', description: 'Fast and economical' },
    ],
  },
  gemini: {
    name: 'Google Gemini',
    icon: 'gemini',
    defaultModels: [
      { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', description: 'Most capable' },
      { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', description: 'Fast responses' },
      { id: 'gemini-pro', name: 'Gemini Pro', description: 'Balanced performance' },
    ],
  },
};

const SETTINGS_FILE = 'ai-settings.json';
const MODEL_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

class AIService {
  private settings: AIIntegrationSettings;
  private settingsPath: string;

  constructor() {
    this.settingsPath = path.join(app.getPath('userData'), SETTINGS_FILE);
    this.settings = this.loadSettings();
  }

  /**
   * Get current AI integration settings
   */
  getSettings(): AIIntegrationSettings {
    return this.settings;
  }

  /**
   * Update AI integration settings
   */
  updateSettings(settings: Partial<AIIntegrationSettings>): void {
    this.settings = { ...this.settings, ...settings };
    this.saveSettings();
  }

  /**
   * Get a specific provider configuration
   */
  getProvider(providerId: AIProviderId): AIProviderConfig | undefined {
    return this.settings.providers.find(p => p.id === providerId);
  }

  /**
   * Update a provider configuration
   */
  updateProvider(providerId: AIProviderId, updates: Partial<AIProviderConfig>): void {
    const index = this.settings.providers.findIndex(p => p.id === providerId);
    if (index >= 0) {
      this.settings.providers[index] = { ...this.settings.providers[index], ...updates };
    } else {
      this.settings.providers.push({
        id: providerId,
        name: AI_PROVIDERS[providerId].name,
        selectedModel: AI_PROVIDERS[providerId].defaultModels[0]?.id || '',
        isEnabled: false,
        priority: this.settings.providers.length + 1,
        ...updates,
      });
    }
    this.saveSettings();
  }

  /**
   * Remove a provider configuration
   */
  removeProvider(providerId: AIProviderId): void {
    this.settings.providers = this.settings.providers.filter(p => p.id !== providerId);
    const encryptionService = getEncryptionService();
    encryptionService.removeKey(providerId);
    this.saveSettings();
  }

  /**
   * Get the active provider (highest priority enabled provider with valid key)
   */
  getActiveProvider(): AIProviderConfig | null {
    const encryptionService = getEncryptionService();
    const enabledProviders = this.settings.providers
      .filter(p => p.isEnabled && encryptionService.hasKey(p.id))
      .sort((a, b) => a.priority - b.priority);
    
    return enabledProviders[0] || null;
  }

  /**
   * Get the next fallback provider after the given one
   */
  getNextFallbackProvider(currentProviderId: AIProviderId): AIProviderConfig | null {
    const encryptionService = getEncryptionService();
    const current = this.getProvider(currentProviderId);
    if (!current) return null;

    const nextProviders = this.settings.providers
      .filter(p => p.isEnabled && p.priority > current.priority && encryptionService.hasKey(p.id))
      .sort((a, b) => a.priority - b.priority);
    
    return nextProviders[0] || null;
  }

  /**
   * Reorder providers (update priorities)
   */
  reorderProviders(orderedIds: AIProviderId[]): void {
    orderedIds.forEach((id, index) => {
      const provider = this.settings.providers.find(p => p.id === id);
      if (provider) {
        provider.priority = index + 1;
      }
    });
    this.saveSettings();
  }

  /**
   * Check if a provider has a stored API key
   */
  hasApiKey(providerId: AIProviderId): boolean {
    const encryptionService = getEncryptionService();
    return encryptionService.hasKey(providerId);
  }

  /**
   * Store an API key for a provider
   */
  storeApiKey(providerId: AIProviderId, apiKey: string): boolean {
    const encryptionService = getEncryptionService();
    return encryptionService.encryptAndStore(providerId, apiKey);
  }

  /**
   * Get an API key for a provider
   */
  getApiKey(providerId: AIProviderId): string | null {
    const encryptionService = getEncryptionService();
    return encryptionService.decryptAndRetrieve(providerId);
  }

  /**
   * Get available models for a provider (with caching)
   */
  async getAvailableModels(providerId: AIProviderId, forceRefresh = false): Promise<ModelInfo[]> {
    const provider = this.getProvider(providerId);
    
    // Check cache
    if (!forceRefresh && provider?.cachedModels && provider.modelsCachedAt) {
      const cacheAge = Date.now() - provider.modelsCachedAt;
      if (cacheAge < MODEL_CACHE_TTL) {
        return provider.cachedModels;
      }
    }

    // Try to fetch from API
    const apiKey = this.getApiKey(providerId);
    if (!apiKey) {
      return AI_PROVIDERS[providerId].defaultModels;
    }

    try {
      let models: ModelInfo[];
      
      switch (providerId) {
        case 'openai':
          models = await this.fetchOpenAIModels(apiKey);
          break;
        case 'anthropic':
          // Anthropic doesn't have a models endpoint, use curated list
          models = AI_PROVIDERS.anthropic.defaultModels;
          break;
        case 'gemini':
          models = await this.fetchGeminiModels(apiKey);
          break;
        default:
          models = [];
      }

      // Cache the models
      if (models.length > 0) {
        this.updateProvider(providerId, {
          cachedModels: models,
          modelsCachedAt: Date.now(),
        });
      }

      return models;
    } catch (error) {
      console.error(`[AIService] Failed to fetch models for ${providerId}:`, error);
      return AI_PROVIDERS[providerId].defaultModels;
    }
  }

  /**
   * Fetch models from OpenAI API
   */
  private async fetchOpenAIModels(apiKey: string): Promise<ModelInfo[]> {
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const models: ModelInfo[] = data.data
      .filter((m: { id: string }) => m.id.startsWith('gpt-'))
      .map((m: { id: string }) => ({
        id: m.id,
        name: m.id,
        description: '',
      }))
      .sort((a: ModelInfo, b: ModelInfo) => {
        // Sort by capability (gpt-4o first, then gpt-4, then gpt-3.5)
        const order = ['gpt-4o', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5'];
        const aIndex = order.findIndex(o => a.id.startsWith(o));
        const bIndex = order.findIndex(o => b.id.startsWith(o));
        return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
      });

    return models.slice(0, 10); // Return top 10 most relevant
  }

  /**
   * Fetch models from Gemini API
   */
  private async fetchGeminiModels(apiKey: string): Promise<ModelInfo[]> {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`);

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    const models: ModelInfo[] = data.models
      .filter((m: { name: string }) => m.name.includes('gemini'))
      .map((m: { name: string; displayName: string; description?: string }) => ({
        id: m.name.replace('models/', ''),
        name: m.displayName || m.name,
        description: m.description || '',
      }));

    return models;
  }

  /**
   * Validate an API key for a provider
   */
  async validateApiKey(providerId: AIProviderId, apiKey: string): Promise<{ valid: boolean; error?: string }> {
    try {
      switch (providerId) {
        case 'openai':
          return await this.validateOpenAIKey(apiKey);
        case 'anthropic':
          return await this.validateAnthropicKey(apiKey);
        case 'gemini':
          return await this.validateGeminiKey(apiKey);
        default:
          return { valid: false, error: 'Unknown provider' };
      }
    } catch (error) {
      return { valid: false, error: String(error) };
    }
  }

  /**
   * Validate OpenAI API key
   */
  private async validateOpenAIKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (response.ok) {
      return { valid: true };
    }

    const error = await response.json().catch(() => ({}));
    return { 
      valid: false, 
      error: error.error?.message || `HTTP ${response.status}` 
    };
  }

  /**
   * Validate Anthropic API key
   */
  private async validateAnthropicKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    });

    // A 200 or 400 (invalid request but valid key) means the key is valid
    if (response.ok || response.status === 400) {
      return { valid: true };
    }

    if (response.status === 401) {
      return { valid: false, error: 'Invalid API key' };
    }

    const error = await response.json().catch(() => ({}));
    return { 
      valid: false, 
      error: error.error?.message || `HTTP ${response.status}` 
    };
  }

  /**
   * Validate Gemini API key
   */
  private async validateGeminiKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`);

    if (response.ok) {
      return { valid: true };
    }

    const error = await response.json().catch(() => ({}));
    return { 
      valid: false, 
      error: error.error?.message || `HTTP ${response.status}` 
    };
  }

  /**
   * Load settings from disk
   */
  private loadSettings(): AIIntegrationSettings {
    try {
      if (fs.existsSync(this.settingsPath)) {
        const data = fs.readFileSync(this.settingsPath, 'utf-8');
        return JSON.parse(data);
      }
    } catch (error) {
      console.error('[AIService] Failed to load settings:', error);
    }

    // Return default settings
    return {
      providers: [],
      autoFallback: true,
    };
  }

  /**
   * Save settings to disk
   */
  private saveSettings(): void {
    try {
      fs.writeFileSync(this.settingsPath, JSON.stringify(this.settings, null, 2));
      console.log('[AIService] Settings saved');
    } catch (error) {
      console.error('[AIService] Failed to save settings:', error);
    }
  }
}

// Singleton instance
let aiService: AIService | null = null;

export function getAIService(): AIService {
  if (!aiService) {
    aiService = new AIService();
  }
  return aiService;
}

export { AIService };
