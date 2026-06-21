/**
 * NavigationPathFinder - Extracts the sequence of actions leading to a specific field
 * 
 * This class analyzes recorded actions to build the navigation path
 * that a user followed to reach a particular form field.
 */

import { RecordedAction, ActionType } from '../../shared/types';

/**
 * Represents a single step in a test case
 */
export interface TestStep {
  order: number;
  action: ActionType | 'navigate';
  description: string;      // Human-readable: "Click Login button"
  selector: string;
  xpath?: string;
  value?: string;
  url?: string;
  playwrightCode: string;   // await page.click('#login-btn')
}

/**
 * Result of finding the navigation path to a field
 */
export interface NavigationPath {
  steps: TestStep[];
  startUrl: string;
  endUrl: string;
  totalActions: number;
}

export class NavigationPathFinder {
  /**
   * Find all actions that lead to a specific field
   * 
   * @param allActions - All recorded actions in the session (sorted by timestamp)
   * @param fieldFirstActionTimestamp - Timestamp of the first action on the target field
   * @param fieldSelector - Selector of the target field
   * @returns Navigation path with all prerequisite steps
   */
  findPathToField(
    allActions: RecordedAction[],
    fieldFirstActionTimestamp: number,
    fieldSelector: string
  ): NavigationPath {
    // Get all actions before the first interaction with this field
    const precedingActions = allActions.filter(
      action => action.timestamp < fieldFirstActionTimestamp
    );

    // Convert actions to steps
    const steps = this.actionsToSteps(precedingActions);

    // Get start and end URLs
    const startUrl = precedingActions.length > 0 
      ? precedingActions[0].tabUrl 
      : allActions[0]?.tabUrl || '';
    
    const endUrl = precedingActions.length > 0
      ? precedingActions[precedingActions.length - 1].tabUrl
      : startUrl;

    return {
      steps,
      startUrl,
      endUrl,
      totalActions: precedingActions.length,
    };
  }

  /**
   * Convert recorded actions to test steps
   */
  actionsToSteps(actions: RecordedAction[]): TestStep[] {
    const steps: TestStep[] = [];
    let currentUrl = '';
    let stepOrder = 1;

    for (const action of actions) {
      // Check for navigation (URL change)
      if (action.tabUrl && action.tabUrl !== currentUrl) {
        // Add navigation step if URL changed
        if (currentUrl !== '') {
          steps.push({
            order: stepOrder++,
            action: 'navigate',
            description: `Navigate to ${this.getUrlPath(action.tabUrl)}`,
            selector: '',
            url: action.tabUrl,
            playwrightCode: `await page.goto('${action.tabUrl}');`,
          });
        } else {
          // First navigation
          steps.push({
            order: stepOrder++,
            action: 'navigate',
            description: `Open ${this.getUrlPath(action.tabUrl)}`,
            selector: '',
            url: action.tabUrl,
            playwrightCode: `await page.goto('${action.tabUrl}');`,
          });
        }
        currentUrl = action.tabUrl;
      }

      // Skip certain action types that don't need to be in steps
      if (this.shouldSkipAction(action)) {
        continue;
      }

      const step = this.actionToStep(action, stepOrder);
      if (step) {
        steps.push(step);
        stepOrder++;
      }
    }

    return steps;
  }

  /**
   * Convert a single action to a test step
   */
  private actionToStep(action: RecordedAction, order: number): TestStep | null {
    const element = action.element;
    const selector = element?.selector || '';
    const xpath = element?.xpath;
    const elementText = this.getElementDescription(action);

    switch (action.type) {
      case 'click':
        return {
          order,
          action: 'click',
          description: `Click ${elementText}`,
          selector,
          xpath,
          playwrightCode: this.generatePlaywrightCode('click', selector, xpath),
        };

      case 'type': {
        const value = action.data.value || '';
        return {
          order,
          action: 'type',
          description: `Fill ${elementText} with "${this.truncateValue(value)}"`,
          selector,
          xpath,
          value,
          playwrightCode: this.generatePlaywrightCode('fill', selector, xpath, value),
        };
      }

      case 'select': {
        const selectValue = action.data.value || '';
        return {
          order,
          action: 'select',
          description: `Select "${selectValue}" in ${elementText}`,
          selector,
          xpath,
          value: selectValue,
          playwrightCode: `await page.selectOption('${selector}', '${selectValue}');`,
        };
      }

      case 'check':
        return {
          order,
          action: 'check',
          description: `Check ${elementText}`,
          selector,
          xpath,
          playwrightCode: `await page.check('${selector}');`,
        };

      case 'uncheck':
        return {
          order,
          action: 'uncheck',
          description: `Uncheck ${elementText}`,
          selector,
          xpath,
          playwrightCode: `await page.uncheck('${selector}');`,
        };

      case 'hover':
        return {
          order,
          action: 'hover',
          description: `Hover over ${elementText}`,
          selector,
          xpath,
          playwrightCode: `await page.hover('${selector}');`,
        };

      case 'scroll':
        return {
          order,
          action: 'scroll',
          description: `Scroll page`,
          selector: '',
          playwrightCode: `await page.evaluate(() => window.scrollBy(0, ${action.data.deltaY || 100}));`,
        };

      case 'keypress': {
        const key = action.data.key || '';
        if (key === 'Enter' || key === 'Tab' || key === 'Escape') {
          return {
            order,
            action: 'keypress',
            description: `Press ${key} key`,
            selector: selector || 'body',
            playwrightCode: `await page.keyboard.press('${key}');`,
          };
        }
        return null;
      }

      default:
        return null;
    }
  }

  /**
   * Generate human-readable element description
   */
  private getElementDescription(action: RecordedAction): string {
    const element = action.element;
    if (!element) return 'element';

    // Priority: aria-label > text content > name > id > placeholder > tag
    if (element.attributes?.['aria-label']) {
      return `"${element.attributes['aria-label']}"`;
    }
    if (element.text && element.text.trim().length > 0 && element.text.length < 50) {
      return `"${element.text.trim()}"`;
    }
    if (element.attributes?.name) {
      return `"${element.attributes.name}" field`;
    }
    if (element.id) {
      return `"${element.id}"`;
    }
    if (element.attributes?.placeholder) {
      return `"${element.attributes.placeholder}" field`;
    }
    if (element.tagName) {
      const tag = element.tagName.toLowerCase();
      if (tag === 'button') return 'button';
      if (tag === 'input') return `${element.attributes?.type || 'text'} input`;
      if (tag === 'a') return 'link';
      return tag;
    }
    return 'element';
  }

  /**
   * Generate Playwright code for an action
   */
  private generatePlaywrightCode(
    action: 'click' | 'fill',
    selector: string,
    xpath?: string,
    value?: string
  ): string {
    // Prefer xpath with text for more reliable locators
    const locator = this.getBestLocator(selector, xpath);

    if (action === 'click') {
      return `await page.${locator}.click();`;
    }
    if (action === 'fill' && value !== undefined) {
      const escapedValue = value.replace(/'/g, "\\'");
      return `await page.${locator}.fill('${escapedValue}');`;
    }
    return `await page.${locator}.click();`;
  }

  /**
   * Get the best locator strategy
   */
  private getBestLocator(selector: string, xpath?: string): string {
    // If we have a good xpath with text, prefer that
    if (xpath && xpath.includes('text()')) {
      return `locator("xpath=${xpath}")`;
    }
    // If selector is an ID, use it directly
    if (selector.startsWith('#') && !selector.includes(' ')) {
      return `locator('${selector}')`;
    }
    // If selector has data-testid, prefer that
    if (selector.includes('data-testid') || selector.includes('data-test')) {
      return `locator('${selector}')`;
    }
    // Default to selector
    return `locator('${selector}')`;
  }

  /**
   * Check if an action should be skipped in step generation
   */
  private shouldSkipAction(action: RecordedAction): boolean {
    // Skip mouse movements and other non-essential actions
    const skipTypes: ActionType[] = ['mousemove', 'mouseenter', 'mouseleave', 'focus', 'blur'];
    if (skipTypes.includes(action.type)) {
      return true;
    }

    // Skip scroll actions that are minor
    if (action.type === 'scroll' && Math.abs(action.data.deltaY || 0) < 50) {
      return true;
    }

    // Skip non-intentional hover actions
    if (action.type === 'hover' && !this.isIntentionalHover(action)) {
      return true;
    }

    // Skip actions without element info (except scroll)
    if (!action.element && action.type !== 'scroll' && action.type !== 'keypress') {
      return true;
    }

    return false;
  }

  /**
   * Check if a hover action is intentional (tooltip, info, description)
   * 
   * Intentional hovers are on elements that:
   * - Have a title attribute (native tooltip)
   * - Have aria-describedby (accessible description)
   * - Have data-tooltip or similar attributes
   * - Have tooltip-related classes
   * - Are info/help icons (i, ?, info, help)
   * - Have role="tooltip" or similar
   */
  private isIntentionalHover(action: RecordedAction): boolean {
    const element = action.element;
    if (!element) return false;

    const attrs = element.attributes || {};
    const classes = element.classes || [];
    const text = element.text?.toLowerCase() || '';
    const tagName = element.tagName?.toLowerCase() || '';

    // Check for title attribute (native tooltip)
    if (attrs.title) {
      return true;
    }

    // Check for aria-describedby (accessible description)
    if (attrs['aria-describedby']) {
      return true;
    }

    // Check for tooltip-related data attributes
    const tooltipDataAttrs = [
      'data-tooltip',
      'data-tip',
      'data-title',
      'data-toggle="tooltip"',
      'data-placement',
      'data-bs-toggle="tooltip"',
      'data-bs-placement',
    ];
    for (const attr of Object.keys(attrs)) {
      if (tooltipDataAttrs.some(ta => attr.includes(ta) || attrs[attr]?.includes('tooltip'))) {
        return true;
      }
    }

    // Check for tooltip-related classes
    const tooltipClasses = [
      'tooltip',
      'tip',
      'hint',
      'info',
      'help',
      'popover',
      'popper',
      'description',
      'hover-info',
      'hover-tip',
    ];
    if (classes.some(c => tooltipClasses.some(tc => c.toLowerCase().includes(tc)))) {
      return true;
    }

    // Check for info/help icon elements
    if (tagName === 'i' || tagName === 'svg' || tagName === 'span') {
      const infoPatterns = ['info', 'help', 'question', '?', 'ℹ', 'tooltip'];
      if (infoPatterns.some(p => text.includes(p) || classes.some(c => c.toLowerCase().includes(p)))) {
        return true;
      }
    }

    // Check for role attribute
    const role = attrs.role?.toLowerCase() || '';
    if (['tooltip', 'note', 'definition'].includes(role)) {
      return true;
    }

    // Not an intentional hover
    return false;
  }

  /**
   * Extract path from URL for cleaner display
   */
  private getUrlPath(url: string): string {
    try {
      const parsed = new URL(url);
      return parsed.pathname || '/';
    } catch {
      return url;
    }
  }

  /**
   * Truncate long values for display
   */
  private truncateValue(value: string, maxLength = 30): string {
    if (value.length <= maxLength) return value;
    return value.substring(0, maxLength) + '...';
  }
}

