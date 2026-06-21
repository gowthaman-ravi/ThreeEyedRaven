/**
 * FieldAnalyzer - Extracts and analyzes form field information from recorded actions
 * 
 * Detects:
 * - Field types (text, email, number, password, etc.)
 * - Constraints (required, minLength, maxLength, min, max, pattern)
 * - Field context (name, label, placeholder)
 */

import { RecordedAction, ElementInfo } from '../../shared/types';

export type FieldType = 
  | 'text' 
  | 'email' 
  | 'password' 
  | 'number' 
  | 'tel' 
  | 'url' 
  | 'date' 
  | 'datetime-local'
  | 'time'
  | 'select' 
  | 'checkbox' 
  | 'radio' 
  | 'textarea'
  | 'file'
  | 'search'
  | 'unknown';

export interface FieldConstraints {
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  step?: number;
  pattern?: string;
  accept?: string;  // For file inputs
  multiple?: boolean;
}

export interface AnalyzedField {
  id: string;
  fieldType: FieldType;
  name: string;
  label?: string;
  placeholder?: string;
  selector: string;
  xpath?: string;
  constraints: FieldConstraints;
  recordedValue?: string;
  formId?: string;
  pageUrl?: string;                   // URL where field was found
  actions: RecordedAction[];          // All actions on this field
  firstActionTimestamp: number;       // Timestamp of first interaction
  firstActionIndex: number;           // Index in the action sequence
}

export interface FieldAnalysisResult {
  fields: AnalyzedField[];
  formCount: number;
  totalFieldActions: number;
}

export class FieldAnalyzer {
  /**
   * Analyze recorded actions to extract field information
   */
  analyze(actions: RecordedAction[]): FieldAnalysisResult {
    const fieldMap = new Map<string, AnalyzedField>();
    let totalFieldActions = 0;

    for (let actionIndex = 0; actionIndex < actions.length; actionIndex++) {
      const action = actions[actionIndex];
      
      // Only analyze actions on form elements
      if (!this.isFieldAction(action)) continue;
      if (!action.element) continue;

      totalFieldActions++;
      const fieldKey = this.getFieldKey(action.element);
      
      if (fieldMap.has(fieldKey)) {
        // Update existing field
        const field = fieldMap.get(fieldKey)!;
        field.actions.push(action);
        
        // Update recorded value if this is a type action
        if (action.type === 'type' && action.data?.value) {
          field.recordedValue = action.data.value;
        }
      } else {
        // Create new field entry with timestamp and index tracking
        const field = this.createFieldFromAction(action, fieldKey, actionIndex);
        fieldMap.set(fieldKey, field);
      }
    }

    const fields = Array.from(fieldMap.values());
    const formIds = new Set(fields.map(f => f.formId).filter(Boolean));

    return {
      fields,
      formCount: formIds.size || (fields.length > 0 ? 1 : 0),
      totalFieldActions,
    };
  }

  /**
   * Check if action is on a form field
   */
  private isFieldAction(action: RecordedAction): boolean {
    if (!action.element) return false;
    
    const tag = action.element.tagName.toLowerCase();
    const type = action.element.attributes['type']?.toLowerCase();
    
    // Form field tags
    if (['input', 'select', 'textarea'].includes(tag)) {
      // Exclude hidden and submit inputs
      if (type === 'hidden' || type === 'submit' || type === 'button') {
        return false;
      }
      return true;
    }
    
    // Check for contenteditable
    if (action.element.attributes['contenteditable'] === 'true') {
      return true;
    }
    
    return false;
  }

  /**
   * Generate a unique key for a field
   */
  private getFieldKey(element: ElementInfo): string {
    // Prefer id, then name, then selector
    if (element.id) {
      return `id:${element.id}`;
    }
    if (element.attributes['name']) {
      return `name:${element.attributes['name']}`;
    }
    return `selector:${element.selector}`;
  }

  /**
   * Create an AnalyzedField from an action
   */
  private createFieldFromAction(
    action: RecordedAction, 
    fieldKey: string,
    actionIndex: number
  ): AnalyzedField {
    const element = action.element!;
    const attrs = element.attributes;
    
    return {
      id: fieldKey,
      fieldType: this.detectFieldType(element),
      name: this.getFieldName(element),
      label: this.getFieldLabel(element),
      placeholder: attrs['placeholder'],
      selector: element.selector,
      xpath: element.xpath,
      constraints: this.extractConstraints(element),
      recordedValue: action.type === 'type' ? action.data?.value : undefined,
      formId: attrs['form'] || undefined,
      pageUrl: action.tabUrl,
      actions: [action],
      firstActionTimestamp: action.timestamp,
      firstActionIndex: actionIndex,
    };
  }

  /**
   * Detect the field type from element info
   */
  private detectFieldType(element: ElementInfo): FieldType {
    const tag = element.tagName.toLowerCase();
    
    if (tag === 'select') return 'select';
    if (tag === 'textarea') return 'textarea';
    
    if (tag === 'input') {
      const type = element.attributes['type']?.toLowerCase() || 'text';
      
      switch (type) {
        case 'email': return 'email';
        case 'password': return 'password';
        case 'number': return 'number';
        case 'tel': return 'tel';
        case 'url': return 'url';
        case 'date': return 'date';
        case 'datetime-local': return 'datetime-local';
        case 'time': return 'time';
        case 'checkbox': return 'checkbox';
        case 'radio': return 'radio';
        case 'file': return 'file';
        case 'search': return 'search';
        case 'text':
        default:
          // Try to infer type from name/id
          return this.inferTypeFromName(element);
      }
    }
    
    return 'unknown';
  }

  /**
   * Infer field type from name/id when type="text"
   */
  private inferTypeFromName(element: ElementInfo): FieldType {
    const name = (element.attributes['name'] || element.id || '').toLowerCase();
    const placeholder = (element.attributes['placeholder'] || '').toLowerCase();
    const combined = `${name} ${placeholder}`;
    
    // Email patterns
    if (/email|e-mail|correo/.test(combined)) {
      return 'email';
    }
    
    // Phone patterns
    if (/phone|tel|mobile|cell|fax/.test(combined)) {
      return 'tel';
    }
    
    // Password patterns
    if (/password|pwd|pass|secret/.test(combined)) {
      return 'password';
    }
    
    // Number patterns
    if (/age|amount|quantity|qty|count|number|price|total|num/.test(combined)) {
      return 'number';
    }
    
    // URL patterns
    if (/url|website|site|link|href/.test(combined)) {
      return 'url';
    }
    
    // Date patterns
    if (/date|dob|birthday|birth/.test(combined)) {
      return 'date';
    }
    
    return 'text';
  }

  /**
   * Get field name from attributes
   */
  private getFieldName(element: ElementInfo): string {
    const attrs = element.attributes;
    
    // Try various sources for a meaningful name
    return attrs['aria-label'] 
      || attrs['name'] 
      || attrs['placeholder']
      || element.id
      || this.generateNameFromSelector(element.selector);
  }

  /**
   * Get field label (if associated label exists)
   */
  private getFieldLabel(element: ElementInfo): string | undefined {
    // This would ideally be extracted during recording
    // For now, use aria-label or placeholder as fallback
    return element.attributes['aria-label'] 
      || element.attributes['aria-labelledby']
      || undefined;
  }

  /**
   * Generate a readable name from selector
   */
  private generateNameFromSelector(selector: string): string {
    // Extract meaningful parts from selector
    const match = selector.match(/#([a-zA-Z0-9_-]+)|\.([a-zA-Z0-9_-]+)/);
    if (match) {
      const name = match[1] || match[2];
      // Convert camelCase or kebab-case to readable
      return name
        .replace(/[-_]/g, ' ')
        .replace(/([A-Z])/g, ' $1')
        .trim()
        .toLowerCase();
    }
    return 'field';
  }

  /**
   * Extract constraints from element attributes
   */
  private extractConstraints(element: ElementInfo): FieldConstraints {
    const attrs = element.attributes;
    const constraints: FieldConstraints = {};
    
    // Required
    if (attrs['required'] !== undefined || attrs['aria-required'] === 'true') {
      constraints.required = true;
    }
    
    // Length constraints
    if (attrs['minlength']) {
      constraints.minLength = parseInt(attrs['minlength'], 10);
    }
    if (attrs['maxlength']) {
      constraints.maxLength = parseInt(attrs['maxlength'], 10);
    }
    
    // Numeric constraints
    if (attrs['min']) {
      constraints.min = parseFloat(attrs['min']);
    }
    if (attrs['max']) {
      constraints.max = parseFloat(attrs['max']);
    }
    if (attrs['step']) {
      constraints.step = parseFloat(attrs['step']);
    }
    
    // Pattern
    if (attrs['pattern']) {
      constraints.pattern = attrs['pattern'];
    }
    
    // File input
    if (attrs['accept']) {
      constraints.accept = attrs['accept'];
    }
    if (attrs['multiple'] !== undefined) {
      constraints.multiple = true;
    }
    
    return constraints;
  }
}

