/**
 * Data Masking Service
 * 
 * Masks sensitive data before sending to LLM and unmasks it in responses.
 * Supports: emails, passwords, credit cards, SSNs, phone numbers
 */

import { RecordedAction } from '../../shared/types';

// Sensitive data patterns
const PATTERNS = {
  email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  creditCard: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
  ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
  phone: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
};

// Input types that indicate sensitive data
const SENSITIVE_INPUT_TYPES = ['password', 'email', 'tel', 'credit-card'];

export interface MaskingDictionary {
  [placeholder: string]: string;
}

export interface MaskingResult {
  maskedActions: RecordedAction[];
  dictionary: MaskingDictionary;
}

type SensitiveType = 'EMAIL' | 'PASSWORD' | 'CREDIT_CARD' | 'SSN' | 'PHONE';

class DataMaskingService {
  private counters: Record<SensitiveType, number> = {
    EMAIL: 0,
    PASSWORD: 0,
    CREDIT_CARD: 0,
    SSN: 0,
    PHONE: 0,
  };

  /**
   * Reset counters for a new masking session
   */
  private resetCounters(): void {
    this.counters = {
      EMAIL: 0,
      PASSWORD: 0,
      CREDIT_CARD: 0,
      SSN: 0,
      PHONE: 0,
    };
  }

  /**
   * Generate a placeholder for sensitive data
   */
  private generatePlaceholder(type: SensitiveType): string {
    this.counters[type]++;
    return `__MASKED_${type}_${this.counters[type]}__`;
  }

  /**
   * Mask sensitive data in a string value
   */
  private maskString(value: string, dictionary: MaskingDictionary): string {
    let masked = value;

    // Mask emails
    masked = masked.replace(PATTERNS.email, (match) => {
      const existing = Object.entries(dictionary).find(([, v]) => v === match);
      if (existing) return existing[0];
      const placeholder = this.generatePlaceholder('EMAIL');
      dictionary[placeholder] = match;
      return placeholder;
    });

    // Mask credit cards
    masked = masked.replace(PATTERNS.creditCard, (match) => {
      const existing = Object.entries(dictionary).find(([, v]) => v === match);
      if (existing) return existing[0];
      const placeholder = this.generatePlaceholder('CREDIT_CARD');
      dictionary[placeholder] = match;
      return placeholder;
    });

    // Mask SSNs
    masked = masked.replace(PATTERNS.ssn, (match) => {
      const existing = Object.entries(dictionary).find(([, v]) => v === match);
      if (existing) return existing[0];
      const placeholder = this.generatePlaceholder('SSN');
      dictionary[placeholder] = match;
      return placeholder;
    });

    // Mask phone numbers
    masked = masked.replace(PATTERNS.phone, (match) => {
      const existing = Object.entries(dictionary).find(([, v]) => v === match);
      if (existing) return existing[0];
      const placeholder = this.generatePlaceholder('PHONE');
      dictionary[placeholder] = match;
      return placeholder;
    });

    return masked;
  }

  /**
   * Check if an element is a sensitive input type
   */
  private isSensitiveInputType(element?: RecordedAction['element']): boolean {
    if (!element) return false;
    
    const inputType = element.attributes?.type?.toLowerCase();
    if (inputType && SENSITIVE_INPUT_TYPES.includes(inputType)) {
      return true;
    }

    // Check for password-related attributes
    const name = element.attributes?.name?.toLowerCase() || '';
    const id = element.id?.toLowerCase() || '';
    const autocomplete = element.attributes?.autocomplete?.toLowerCase() || '';
    
    const sensitiveKeywords = ['password', 'pwd', 'pass', 'secret', 'pin', 'cvv', 'cvc'];
    return sensitiveKeywords.some(keyword => 
      name.includes(keyword) || id.includes(keyword) || autocomplete.includes(keyword)
    );
  }

  /**
   * Mask a single action
   */
  private maskAction(action: RecordedAction, dictionary: MaskingDictionary): RecordedAction {
    const maskedAction = JSON.parse(JSON.stringify(action)) as RecordedAction;

    // Mask typed values
    if (maskedAction.data.value) {
      // If it's a password field, mask the entire value
      if (this.isSensitiveInputType(action.element)) {
        const existing = Object.entries(dictionary).find(([, v]) => v === maskedAction.data.value);
        if (existing) {
          maskedAction.data.value = existing[0];
        } else {
          const placeholder = this.generatePlaceholder('PASSWORD');
          dictionary[placeholder] = maskedAction.data.value as string;
          maskedAction.data.value = placeholder;
        }
      } else {
        // Check for patterns in the value
        maskedAction.data.value = this.maskString(maskedAction.data.value, dictionary);
      }
    }

    // Mask URL parameters that might contain sensitive data
    if (maskedAction.data.url) {
      maskedAction.data.url = this.maskString(maskedAction.data.url, dictionary);
    }
    if (maskedAction.data.fromUrl) {
      maskedAction.data.fromUrl = this.maskString(maskedAction.data.fromUrl, dictionary);
    }

    // Mask tab URL
    if (maskedAction.tabUrl) {
      maskedAction.tabUrl = this.maskString(maskedAction.tabUrl, dictionary);
    }

    // Mask element text if it contains sensitive data
    if (maskedAction.element?.text) {
      maskedAction.element.text = this.maskString(maskedAction.element.text, dictionary);
    }

    // Mask expected values in assertions
    if (maskedAction.data.expectedText) {
      maskedAction.data.expectedText = this.maskString(maskedAction.data.expectedText, dictionary);
    }
    if (maskedAction.data.expectedValue) {
      maskedAction.data.expectedValue = this.maskString(maskedAction.data.expectedValue, dictionary);
    }

    // Mask selected text
    if (maskedAction.data.selectedText) {
      maskedAction.data.selectedText = this.maskString(maskedAction.data.selectedText, dictionary);
    }

    return maskedAction;
  }

  /**
   * Mask sensitive data in a list of actions
   */
  maskActions(actions: RecordedAction[]): MaskingResult {
    this.resetCounters();
    const dictionary: MaskingDictionary = {};
    const maskedActions = actions.map(action => this.maskAction(action, dictionary));

    console.log(`[DataMasking] Masked ${Object.keys(dictionary).length} sensitive values`);

    return {
      maskedActions,
      dictionary,
    };
  }

  /**
   * Unmask text using the dictionary
   */
  unmaskText(text: string, dictionary: MaskingDictionary): string {
    let unmasked = text;

    for (const [placeholder, original] of Object.entries(dictionary)) {
      // Use a global regex to replace all occurrences
      const escapedPlaceholder = placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      unmasked = unmasked.replace(new RegExp(escapedPlaceholder, 'g'), original);
    }

    return unmasked;
  }

  /**
   * Get a summary of what was masked (for user information)
   */
  getMaskingSummary(dictionary: MaskingDictionary): Record<SensitiveType, number> {
    const summary: Record<SensitiveType, number> = {
      EMAIL: 0,
      PASSWORD: 0,
      CREDIT_CARD: 0,
      SSN: 0,
      PHONE: 0,
    };

    for (const placeholder of Object.keys(dictionary)) {
      if (placeholder.includes('_EMAIL_')) summary.EMAIL++;
      else if (placeholder.includes('_PASSWORD_')) summary.PASSWORD++;
      else if (placeholder.includes('_CREDIT_CARD_')) summary.CREDIT_CARD++;
      else if (placeholder.includes('_SSN_')) summary.SSN++;
      else if (placeholder.includes('_PHONE_')) summary.PHONE++;
    }

    return summary;
  }
}

// Singleton instance
let dataMaskingService: DataMaskingService | null = null;

export function getDataMaskingService(): DataMaskingService {
  if (!dataMaskingService) {
    dataMaskingService = new DataMaskingService();
  }
  return dataMaskingService;
}

export { DataMaskingService };
