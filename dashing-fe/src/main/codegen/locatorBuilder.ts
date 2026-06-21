/**
 * LocatorBuilder - Builds locators with priority-based strategy
 * 
 * Priority order:
 * 1. XPath with text (most readable)
 * 2. XPath with role + text
 * 3. XPath with class
 * 4. CSS with class
 * 5. CSS with data-testid
 * 6. CSS with ID
 * 7. Fallback to recorded selector/XPath
 */

import { ElementInfo } from '../../shared/types';

export interface LocatorResult {
  locator: string;
  type: 'xpath' | 'css';
  strategy: string;
  comment: string;
}

export class LocatorBuilder {
  /**
   * Build the best locator for an element based on priority strategy
   */
  build(element: ElementInfo): LocatorResult {
    // 1. Try text-based XPath (most readable and stable for buttons/links)
    const textLocator = this.buildTextXPath(element);
    if (textLocator) {
      return textLocator;
    }

    // 2. Try role + text XPath
    const roleTextLocator = this.buildRoleTextXPath(element);
    if (roleTextLocator) {
      return roleTextLocator;
    }

    // 3. Try class-based XPath
    const classXPathLocator = this.buildClassXPath(element);
    if (classXPathLocator) {
      return classXPathLocator;
    }

    // 4. Try CSS with class
    const classCSSLocator = this.buildClassCSS(element);
    if (classCSSLocator) {
      return classCSSLocator;
    }

    // 5. Try data-testid
    const testIdLocator = this.buildDataTestId(element);
    if (testIdLocator) {
      return testIdLocator;
    }

    // 6. Try ID
    const idLocator = this.buildId(element);
    if (idLocator) {
      return idLocator;
    }

    // 7. Fallback to recorded XPath or selector
    return this.buildFallback(element);
  }

  /**
   * Generate a descriptive name for the locator based on element info
   */
  generateLocatorName(element: ElementInfo, actionType: string): string {
    const tag = element.tagName.toLowerCase();
    
    // Try to get a meaningful name from attributes
    if (element.attributes['aria-label']) {
      return this.camelCase(element.attributes['aria-label']);
    }
    
    if (element.attributes['placeholder']) {
      return this.camelCase(element.attributes['placeholder']) + 'Input';
    }
    
    if (element.attributes['name']) {
      return this.camelCase(element.attributes['name']);
    }
    
    if (element.id) {
      return this.camelCase(element.id);
    }
    
    if (element.text && element.text.length < 30) {
      const cleanText = element.text.replace(/[^a-zA-Z0-9\s]/g, '').trim();
      if (cleanText) {
        return this.camelCase(cleanText) + this.getElementSuffix(tag);
      }
    }
    
    // Use classes as last resort
    if (element.classes.length > 0) {
      const primaryClass = element.classes.find(c => !c.startsWith('hover') && !c.startsWith('active'));
      if (primaryClass) {
        return this.camelCase(primaryClass) + this.getElementSuffix(tag);
      }
    }
    
    // Generic fallback
    return actionType + this.getElementSuffix(tag);
  }

  private getElementSuffix(tag: string): string {
    const suffixes: Record<string, string> = {
      'button': 'Button',
      'input': 'Input',
      'a': 'Link',
      'select': 'Select',
      'textarea': 'TextArea',
      'div': 'Element',
      'span': 'Text',
      'img': 'Image',
      'form': 'Form',
    };
    return suffixes[tag] || 'Element';
  }

  private camelCase(str: string): string {
    return str
      .toLowerCase()
      .replace(/[^a-zA-Z0-9]+(.)/g, (_, chr) => chr.toUpperCase())
      .replace(/^./, c => c.toLowerCase())
      .replace(/[^a-zA-Z0-9]/g, '');
  }

  /**
   * Build XPath locator with text content
   */
  private buildTextXPath(element: ElementInfo): LocatorResult | null {
    const text = element.text?.trim();
    if (!text || text.length > 50 || text.includes('\n')) {
      return null;
    }

    const tag = element.tagName.toLowerCase();
    const escapedText = this.escapeXPathString(text);
    
    // For exact match on short text
    if (text.length < 20) {
      return {
        locator: `//${tag}[text()=${escapedText}]`,
        type: 'xpath',
        strategy: 'text-exact',
        comment: `${tag} with text "${text}"`,
      };
    }
    
    // For longer text, use contains
    return {
      locator: `//${tag}[contains(text(), ${escapedText})]`,
      type: 'xpath',
      strategy: 'text-contains',
      comment: `${tag} containing text "${text.substring(0, 30)}..."`,
    };
  }

  /**
   * Build XPath with role and text
   */
  private buildRoleTextXPath(element: ElementInfo): LocatorResult | null {
    const role = element.attributes['role'];
    const text = element.text?.trim();
    
    if (!role || !text || text.length > 50) {
      return null;
    }

    const escapedText = this.escapeXPathString(text);
    
    return {
      locator: `//*[@role='${role}'][contains(text(), ${escapedText})]`,
      type: 'xpath',
      strategy: 'role-text',
      comment: `${role} with text "${text.substring(0, 30)}"`,
    };
  }

  /**
   * Build XPath with class attribute
   */
  private buildClassXPath(element: ElementInfo): LocatorResult | null {
    if (element.classes.length === 0) {
      return null;
    }

    // Find a meaningful class (not utility classes)
    const meaningfulClass = element.classes.find(cls => 
      !cls.match(/^(hover|active|focus|disabled|hidden|show|fade|in|out)/) &&
      !cls.match(/^(p|m|w|h|flex|grid|col|row)-/) && // Tailwind utility classes
      cls.length > 3
    );

    if (!meaningfulClass) {
      return null;
    }

    const tag = element.tagName.toLowerCase();
    
    return {
      locator: `//${tag}[contains(@class, '${meaningfulClass}')]`,
      type: 'xpath',
      strategy: 'class-xpath',
      comment: `${tag} with class "${meaningfulClass}"`,
    };
  }

  /**
   * Build CSS selector with class
   */
  private buildClassCSS(element: ElementInfo): LocatorResult | null {
    if (element.classes.length === 0) {
      return null;
    }

    // Find meaningful classes
    const meaningfulClasses = element.classes.filter(cls => 
      !cls.match(/^(hover|active|focus|disabled|hidden|show|fade)/) &&
      !cls.match(/^(p|m|w|h|flex|grid|col|row)-/) &&
      cls.length > 3
    );

    if (meaningfulClasses.length === 0) {
      return null;
    }

    const tag = element.tagName.toLowerCase();
    const classSelector = meaningfulClasses.slice(0, 2).map(c => `.${c}`).join('');
    
    return {
      locator: `${tag}${classSelector}`,
      type: 'css',
      strategy: 'class-css',
      comment: `${tag} with classes "${meaningfulClasses.slice(0, 2).join(', ')}"`,
    };
  }

  /**
   * Build CSS selector with data-testid
   */
  private buildDataTestId(element: ElementInfo): LocatorResult | null {
    const testId = element.attributes['data-testid'] || element.attributes['data-test'];
    
    if (!testId) {
      return null;
    }

    return {
      locator: `[data-testid="${testId}"]`,
      type: 'css',
      strategy: 'data-testid',
      comment: `Element with data-testid "${testId}"`,
    };
  }

  /**
   * Build CSS selector with ID
   */
  private buildId(element: ElementInfo): LocatorResult | null {
    if (!element.id) {
      return null;
    }

    return {
      locator: `#${element.id}`,
      type: 'css',
      strategy: 'id',
      comment: `Element with id "${element.id}"`,
    };
  }

  /**
   * Fallback to recorded selector or XPath
   */
  private buildFallback(element: ElementInfo): LocatorResult {
    // Prefer XPath if available
    if (element.xpath) {
      return {
        locator: element.xpath,
        type: 'xpath',
        strategy: 'fallback-xpath',
        comment: 'Fallback to recorded XPath',
      };
    }

    return {
      locator: element.selector,
      type: 'css',
      strategy: 'fallback-css',
      comment: 'Fallback to recorded CSS selector',
    };
  }

  /**
   * Escape string for XPath
   */
  private escapeXPathString(str: string): string {
    if (!str.includes("'")) {
      return `'${str}'`;
    }
    if (!str.includes('"')) {
      return `"${str}"`;
    }
    // Handle strings with both quotes
    return `concat('${str.replace(/'/g, "', \"'\", '")}')`;
  }
}

