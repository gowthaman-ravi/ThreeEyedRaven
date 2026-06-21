/**
 * RuleEngine - Defines test case rules for each field type
 * 
 * Rules are organized by field type and generate specific test scenarios
 * including boundary tests, negative tests, security tests, and format tests.
 */

import { FieldType, FieldConstraints, AnalyzedField } from './fieldAnalyzer';

export type TestCaseCategory = 
  | 'boundary' 
  | 'negative' 
  | 'security' 
  | 'format' 
  | 'required'
  | 'accessibility';

export type TestCasePriority = 'critical' | 'high' | 'medium' | 'low';

export interface TestCaseRule {
  id: string;
  category: TestCaseCategory;
  name: string;
  description: string;
  priority: TestCasePriority;
  // Function to generate test value based on field constraints
  getTestValue: (field: AnalyzedField) => string;
  // Expected result description
  getExpectedResult: (field: AnalyzedField) => string;
  // Whether this rule applies to the field
  appliesTo: (field: AnalyzedField) => boolean;
}

// ============================================
// TEXT FIELD RULES
// ============================================

const textRules: TestCaseRule[] = [
  {
    id: 'text-empty',
    category: 'required',
    name: 'Empty field submission',
    description: 'Leave the field empty and submit the form',
    priority: 'critical',
    getTestValue: () => '',
    getExpectedResult: (field) => field.constraints.required 
      ? 'Validation error should appear indicating field is required'
      : 'Form should accept empty value',
    appliesTo: () => true,
  },
  {
    id: 'text-whitespace',
    category: 'required',
    name: 'Whitespace only',
    description: 'Enter only spaces/whitespace characters',
    priority: 'high',
    getTestValue: () => '   ',
    getExpectedResult: (field) => field.constraints.required 
      ? 'Should be treated as empty - validation error expected'
      : 'May be accepted or trimmed',
    appliesTo: (field) => field.constraints.required === true,
  },
  {
    id: 'text-max-length',
    category: 'boundary',
    name: 'Exceed maximum length',
    description: 'Enter text exceeding the maximum allowed length',
    priority: 'high',
    getTestValue: (field) => {
      const max = field.constraints.maxLength || 255;
      return 'a'.repeat(max + 10);
    },
    getExpectedResult: (field) => {
      const max = field.constraints.maxLength;
      return max 
        ? `Input should be limited to ${max} characters or show error`
        : 'Input may be truncated or rejected';
    },
    appliesTo: (field) => field.constraints.maxLength !== undefined || true,
  },
  {
    id: 'text-special-chars',
    category: 'negative',
    name: 'Special characters',
    description: 'Enter special characters to test input handling',
    priority: 'medium',
    getTestValue: () => '!@#$%^&*(){}[]|\\:";\'<>,.?/',
    getExpectedResult: () => 'Should be handled gracefully - accepted, escaped, or rejected with clear message',
    appliesTo: () => true,
  },
  {
    id: 'text-unicode',
    category: 'negative',
    name: 'Unicode characters',
    description: 'Enter unicode/emoji characters',
    priority: 'medium',
    getTestValue: () => '测试 テスト 🎉 émojis café',
    getExpectedResult: () => 'Should handle unicode properly - accept or reject with clear message',
    appliesTo: () => true,
  },
  {
    id: 'text-sql-injection',
    category: 'security',
    name: 'SQL injection attempt',
    description: 'Enter SQL injection payload',
    priority: 'critical',
    getTestValue: () => "'; DROP TABLE users; --",
    getExpectedResult: () => 'Input should be sanitized - no database errors, accepted as literal text or rejected',
    appliesTo: () => true,
  },
  {
    id: 'text-xss',
    category: 'security',
    name: 'XSS script injection',
    description: 'Enter JavaScript code to test XSS prevention',
    priority: 'critical',
    getTestValue: () => '<script>alert("XSS")</script>',
    getExpectedResult: () => 'Script should not execute - input escaped or rejected',
    appliesTo: () => true,
  },
  {
    id: 'text-html-tags',
    category: 'security',
    name: 'HTML tag injection',
    description: 'Enter HTML tags to test sanitization',
    priority: 'high',
    getTestValue: () => '<img src=x onerror=alert(1)>',
    getExpectedResult: () => 'HTML should be escaped or stripped - not rendered as HTML',
    appliesTo: () => true,
  },
];

// ============================================
// EMAIL FIELD RULES
// ============================================

const emailRules: TestCaseRule[] = [
  {
    id: 'email-empty',
    category: 'required',
    name: 'Empty email field',
    description: 'Leave email field empty',
    priority: 'critical',
    getTestValue: () => '',
    getExpectedResult: (field) => field.constraints.required 
      ? 'Required field error should appear'
      : 'Form should accept empty value',
    appliesTo: () => true,
  },
  {
    id: 'email-no-at',
    category: 'format',
    name: 'Missing @ symbol',
    description: 'Enter email without @ symbol',
    priority: 'high',
    getTestValue: () => 'testexample.com',
    getExpectedResult: () => 'Invalid email format error should appear',
    appliesTo: () => true,
  },
  {
    id: 'email-no-domain',
    category: 'format',
    name: 'Missing domain',
    description: 'Enter email without domain part',
    priority: 'high',
    getTestValue: () => 'test@',
    getExpectedResult: () => 'Invalid email format error should appear',
    appliesTo: () => true,
  },
  {
    id: 'email-no-tld',
    category: 'format',
    name: 'Missing TLD',
    description: 'Enter email without top-level domain',
    priority: 'high',
    getTestValue: () => 'test@example',
    getExpectedResult: () => 'May be accepted or rejected depending on validation strictness',
    appliesTo: () => true,
  },
  {
    id: 'email-spaces',
    category: 'format',
    name: 'Email with spaces',
    description: 'Enter email containing spaces',
    priority: 'medium',
    getTestValue: () => 'test @example.com',
    getExpectedResult: () => 'Invalid email format error - spaces not allowed in email',
    appliesTo: () => true,
  },
  {
    id: 'email-multiple-at',
    category: 'format',
    name: 'Multiple @ symbols',
    description: 'Enter email with multiple @ symbols',
    priority: 'medium',
    getTestValue: () => 'test@@example.com',
    getExpectedResult: () => 'Invalid email format error should appear',
    appliesTo: () => true,
  },
  {
    id: 'email-special-chars',
    category: 'negative',
    name: 'Special characters in local part',
    description: 'Enter email with special characters before @',
    priority: 'medium',
    getTestValue: () => 'test!#$%@example.com',
    getExpectedResult: () => 'Some special chars are valid in emails - verify behavior matches RFC 5321',
    appliesTo: () => true,
  },
  {
    id: 'email-very-long',
    category: 'boundary',
    name: 'Very long email address',
    description: 'Enter email exceeding 254 characters',
    priority: 'medium',
    getTestValue: () => 'a'.repeat(250) + '@example.com',
    getExpectedResult: () => 'Email exceeds max length (254 chars) - should be rejected',
    appliesTo: () => true,
  },
];

// ============================================
// NUMBER FIELD RULES
// ============================================

const numberRules: TestCaseRule[] = [
  {
    id: 'number-text',
    category: 'negative',
    name: 'Text instead of number',
    description: 'Enter alphabetic text in number field',
    priority: 'high',
    getTestValue: () => 'abc',
    getExpectedResult: () => 'Input should be rejected or show validation error',
    appliesTo: () => true,
  },
  {
    id: 'number-negative',
    category: 'boundary',
    name: 'Negative number',
    description: 'Enter a negative number',
    priority: 'medium',
    getTestValue: () => '-1',
    getExpectedResult: (field) => {
      if (field.constraints.min !== undefined && field.constraints.min >= 0) {
        return 'Should show error - value below minimum';
      }
      return 'May be valid depending on field purpose';
    },
    appliesTo: () => true,
  },
  {
    id: 'number-zero',
    category: 'boundary',
    name: 'Zero value',
    description: 'Enter zero',
    priority: 'medium',
    getTestValue: () => '0',
    getExpectedResult: (field) => {
      if (field.constraints.min !== undefined && field.constraints.min > 0) {
        return 'Should show error - value below minimum';
      }
      return 'Zero should be accepted if within range';
    },
    appliesTo: () => true,
  },
  {
    id: 'number-decimal',
    category: 'negative',
    name: 'Decimal number',
    description: 'Enter a decimal/float value',
    priority: 'medium',
    getTestValue: () => '3.14159',
    getExpectedResult: (field) => {
      if (field.constraints.step === 1) {
        return 'Should reject decimal - integer expected';
      }
      return 'May be accepted, rounded, or rejected depending on field';
    },
    appliesTo: () => true,
  },
  {
    id: 'number-below-min',
    category: 'boundary',
    name: 'Below minimum value',
    description: 'Enter value below the minimum constraint',
    priority: 'high',
    getTestValue: (field) => String((field.constraints.min || 0) - 1),
    getExpectedResult: (field) => `Value below minimum (${field.constraints.min}) - should show error`,
    appliesTo: (field) => field.constraints.min !== undefined,
  },
  {
    id: 'number-above-max',
    category: 'boundary',
    name: 'Above maximum value',
    description: 'Enter value above the maximum constraint',
    priority: 'high',
    getTestValue: (field) => String((field.constraints.max || 100) + 1),
    getExpectedResult: (field) => `Value above maximum (${field.constraints.max}) - should show error`,
    appliesTo: (field) => field.constraints.max !== undefined,
  },
  {
    id: 'number-at-min',
    category: 'boundary',
    name: 'At minimum boundary',
    description: 'Enter exact minimum value',
    priority: 'medium',
    getTestValue: (field) => String(field.constraints.min || 0),
    getExpectedResult: () => 'Should be accepted - value at minimum boundary',
    appliesTo: (field) => field.constraints.min !== undefined,
  },
  {
    id: 'number-at-max',
    category: 'boundary',
    name: 'At maximum boundary',
    description: 'Enter exact maximum value',
    priority: 'medium',
    getTestValue: (field) => String(field.constraints.max || 100),
    getExpectedResult: () => 'Should be accepted - value at maximum boundary',
    appliesTo: (field) => field.constraints.max !== undefined,
  },
  {
    id: 'number-very-large',
    category: 'boundary',
    name: 'Very large number',
    description: 'Enter an extremely large number',
    priority: 'low',
    getTestValue: () => '999999999999999',
    getExpectedResult: () => 'Should handle gracefully - accept, truncate, or show appropriate error',
    appliesTo: () => true,
  },
  {
    id: 'number-scientific',
    category: 'negative',
    name: 'Scientific notation',
    description: 'Enter number in scientific notation',
    priority: 'low',
    getTestValue: () => '1e10',
    getExpectedResult: () => 'May be accepted as valid number or rejected',
    appliesTo: () => true,
  },
];

// ============================================
// PASSWORD FIELD RULES
// ============================================

const passwordRules: TestCaseRule[] = [
  {
    id: 'password-empty',
    category: 'required',
    name: 'Empty password',
    description: 'Leave password field empty',
    priority: 'critical',
    getTestValue: () => '',
    getExpectedResult: () => 'Required field error should appear',
    appliesTo: () => true,
  },
  {
    id: 'password-short',
    category: 'boundary',
    name: 'Too short password',
    description: 'Enter password shorter than minimum requirement',
    priority: 'high',
    getTestValue: (field) => 'a'.repeat((field.constraints.minLength || 8) - 1),
    getExpectedResult: (field) => `Password too short - minimum ${field.constraints.minLength || 8} characters required`,
    appliesTo: () => true,
  },
  {
    id: 'password-no-number',
    category: 'format',
    name: 'No numbers in password',
    description: 'Enter password without any numbers',
    priority: 'medium',
    getTestValue: () => 'PasswordOnly!',
    getExpectedResult: () => 'May require at least one number - check validation rules',
    appliesTo: () => true,
  },
  {
    id: 'password-no-special',
    category: 'format',
    name: 'No special characters',
    description: 'Enter password without special characters',
    priority: 'medium',
    getTestValue: () => 'Password123',
    getExpectedResult: () => 'May require special character - check validation rules',
    appliesTo: () => true,
  },
  {
    id: 'password-no-uppercase',
    category: 'format',
    name: 'No uppercase letters',
    description: 'Enter password without uppercase letters',
    priority: 'medium',
    getTestValue: () => 'password123!',
    getExpectedResult: () => 'May require uppercase - check validation rules',
    appliesTo: () => true,
  },
  {
    id: 'password-common',
    category: 'security',
    name: 'Common password',
    description: 'Enter a commonly used password',
    priority: 'high',
    getTestValue: () => 'password123',
    getExpectedResult: () => 'Should be rejected if common password detection is enabled',
    appliesTo: () => true,
  },
  {
    id: 'password-spaces',
    category: 'negative',
    name: 'Password with spaces',
    description: 'Enter password containing spaces',
    priority: 'medium',
    getTestValue: () => 'pass word 123',
    getExpectedResult: () => 'Spaces may be allowed or rejected - verify expected behavior',
    appliesTo: () => true,
  },
];

// ============================================
// PHONE FIELD RULES
// ============================================

const phoneRules: TestCaseRule[] = [
  {
    id: 'phone-letters',
    category: 'negative',
    name: 'Letters in phone number',
    description: 'Enter alphabetic characters',
    priority: 'high',
    getTestValue: () => 'abc123def',
    getExpectedResult: () => 'Should reject letters or show format error',
    appliesTo: () => true,
  },
  {
    id: 'phone-short',
    category: 'boundary',
    name: 'Too short phone number',
    description: 'Enter very short phone number',
    priority: 'high',
    getTestValue: () => '123',
    getExpectedResult: () => 'Should show error - phone number too short',
    appliesTo: () => true,
  },
  {
    id: 'phone-long',
    category: 'boundary',
    name: 'Too long phone number',
    description: 'Enter phone number with too many digits',
    priority: 'medium',
    getTestValue: () => '12345678901234567890',
    getExpectedResult: () => 'Should show error or truncate - phone number too long',
    appliesTo: () => true,
  },
  {
    id: 'phone-international',
    category: 'format',
    name: 'International format',
    description: 'Enter phone in international format',
    priority: 'medium',
    getTestValue: () => '+1-555-123-4567',
    getExpectedResult: () => 'Should accept international format if supported',
    appliesTo: () => true,
  },
  {
    id: 'phone-special-chars',
    category: 'negative',
    name: 'Special characters',
    description: 'Enter phone with special characters',
    priority: 'medium',
    getTestValue: () => '555@123#4567',
    getExpectedResult: () => 'Should reject or sanitize invalid characters',
    appliesTo: () => true,
  },
];

// ============================================
// SELECT FIELD RULES
// ============================================

const selectRules: TestCaseRule[] = [
  {
    id: 'select-first',
    category: 'boundary',
    name: 'First option',
    description: 'Select the first available option',
    priority: 'medium',
    getTestValue: () => '[FIRST_OPTION]',
    getExpectedResult: () => 'First option should be selectable and valid',
    appliesTo: () => true,
  },
  {
    id: 'select-last',
    category: 'boundary',
    name: 'Last option',
    description: 'Select the last available option',
    priority: 'medium',
    getTestValue: () => '[LAST_OPTION]',
    getExpectedResult: () => 'Last option should be selectable and valid',
    appliesTo: () => true,
  },
  {
    id: 'select-none',
    category: 'required',
    name: 'No selection',
    description: 'Submit without making a selection',
    priority: 'high',
    getTestValue: () => '',
    getExpectedResult: (field) => field.constraints.required 
      ? 'Required field error should appear'
      : 'Form should accept no selection',
    appliesTo: () => true,
  },
];

// ============================================
// RULE ENGINE CLASS
// ============================================

export class RuleEngine {
  private rulesByType: Map<FieldType, TestCaseRule[]>;

  constructor() {
    this.rulesByType = new Map();
    
    // Register rules for each field type
    this.rulesByType.set('text', textRules);
    this.rulesByType.set('email', emailRules);
    this.rulesByType.set('number', numberRules);
    this.rulesByType.set('password', passwordRules);
    this.rulesByType.set('tel', phoneRules);
    this.rulesByType.set('select', selectRules);
    
    // Text rules apply to many field types as fallback
    this.rulesByType.set('textarea', textRules);
    this.rulesByType.set('search', textRules);
    this.rulesByType.set('url', textRules);  // Could have URL-specific rules
  }

  /**
   * Get applicable rules for a field
   */
  getRulesForField(field: AnalyzedField): TestCaseRule[] {
    const rules = this.rulesByType.get(field.fieldType) || textRules;
    
    // Filter to only applicable rules
    return rules.filter(rule => rule.appliesTo(field));
  }

  /**
   * Get all registered rules
   */
  getAllRules(): Map<FieldType, TestCaseRule[]> {
    return this.rulesByType;
  }

  /**
   * Get rules by category
   */
  getRulesByCategory(category: TestCaseCategory): TestCaseRule[] {
    const allRules: TestCaseRule[] = [];
    
    for (const rules of this.rulesByType.values()) {
      allRules.push(...rules.filter(r => r.category === category));
    }
    
    return allRules;
  }

  /**
   * Get security-focused rules (useful for security audits)
   */
  getSecurityRules(): TestCaseRule[] {
    return this.getRulesByCategory('security');
  }
}

