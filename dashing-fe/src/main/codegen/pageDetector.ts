/**
 * PageDetector - Detects and groups actions by page
 * 
 * Pages are detected by grouping actions between navigation events.
 * Page names are derived from the page title.
 */

import { RecordedAction } from '../../shared/types';

export interface DetectedPage {
  title: string;           // Original page title
  url: string;             // URL when on this page
  className: string;       // e.g., "LoginPage"
  fileName: string;        // e.g., "loginPage"
  actions: RecordedAction[];
}

export interface PageDetectionResult {
  pages: DetectedPage[];
  totalActions: number;
}

export class PageDetector {
  /**
   * Detect pages from a list of actions
   */
  detect(actions: RecordedAction[]): PageDetectionResult {
    if (actions.length === 0) {
      return { pages: [], totalActions: 0 };
    }

    // Sort actions by timestamp (oldest first for proper flow)
    const sortedActions = [...actions].sort((a, b) => a.timestamp - b.timestamp);
    
    const pages: DetectedPage[] = [];
    let currentPage: DetectedPage | null = null;
    const seenPageKeys = new Map<string, DetectedPage>();

    for (const action of sortedActions) {
      const pageKey = this.getPageKey(action.tabTitle, action.tabUrl);
      
      // Check if we should start a new page
      const isNavigation = action.type === 'navigate';
      const isDifferentPage = currentPage && pageKey !== this.getPageKey(currentPage.title, currentPage.url);
      
      if (isNavigation || !currentPage || isDifferentPage) {
        // Check if we've seen this page before
        if (seenPageKeys.has(pageKey)) {
          // Add to existing page
          currentPage = seenPageKeys.get(pageKey)!;
        } else {
          // Create new page
          currentPage = {
            title: action.tabTitle || 'Untitled Page',
            url: action.tabUrl || '',
            className: this.titleToClassName(action.tabTitle || 'Untitled'),
            fileName: this.titleToFileName(action.tabTitle || 'untitled'),
            actions: [],
          };
          pages.push(currentPage);
          seenPageKeys.set(pageKey, currentPage);
        }
      }
      
      if (currentPage) {
        currentPage.actions.push(action);
      }
    }

    // Deduplicate pages with the same className by merging
    const mergedPages = this.mergePagesByClassName(pages);

    return {
      pages: mergedPages,
      totalActions: sortedActions.length,
    };
  }

  /**
   * Get a unique key for a page based on title and URL
   */
  private getPageKey(title: string, url: string): string {
    // Use title + path (without query params) as key
    try {
      const urlObj = new URL(url);
      return `${title}::${urlObj.pathname}`;
    } catch {
      return `${title}::${url}`;
    }
  }

  /**
   * Merge pages that have the same className
   */
  private mergePagesByClassName(pages: DetectedPage[]): DetectedPage[] {
    const classNameMap = new Map<string, DetectedPage>();
    
    for (const page of pages) {
      if (classNameMap.has(page.className)) {
        // Merge actions into existing page
        const existing = classNameMap.get(page.className)!;
        existing.actions.push(...page.actions);
      } else {
        classNameMap.set(page.className, { ...page, actions: [...page.actions] });
      }
    }
    
    // Sort actions within each page by timestamp
    const result = Array.from(classNameMap.values());
    for (const page of result) {
      page.actions.sort((a, b) => a.timestamp - b.timestamp);
    }
    
    return result;
  }

  /**
   * Convert page title to PascalCase class name
   * Examples:
   *   "Login - MyApp" -> "LoginPage"
   *   "User Dashboard | Admin" -> "UserDashboardPage"
   *   "Settings & Preferences" -> "SettingsPreferencesPage"
   */
  titleToClassName(title: string): string {
    // Take first part before common separators
    let baseName = title
      .split(/[-|:•·]/)[0]
      .trim();
    
    // Remove common suffixes
    baseName = baseName
      .replace(/\s*(page|screen|view)$/i, '')
      .trim();
    
    // Convert to PascalCase
    const pascalCase = baseName
      .replace(/[^a-zA-Z0-9\s]/g, ' ')  // Replace special chars with space
      .split(/\s+/)                      // Split by whitespace
      .filter(word => word.length > 0)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('');
    
    // Ensure it starts with a letter
    const cleanName = pascalCase.replace(/^[0-9]+/, '');
    
    // Add "Page" suffix if not already there
    if (cleanName.endsWith('Page')) {
      return cleanName || 'UnknownPage';
    }
    
    return (cleanName || 'Unknown') + 'Page';
  }

  /**
   * Convert page title to camelCase file name
   * Examples:
   *   "Login - MyApp" -> "loginPage"
   *   "User Dashboard | Admin" -> "userDashboardPage"
   */
  titleToFileName(title: string): string {
    const className = this.titleToClassName(title);
    // Convert first char to lowercase for file name
    return className.charAt(0).toLowerCase() + className.slice(1);
  }

  /**
   * Generate a summary of detected pages
   */
  getSummary(result: PageDetectionResult): string[] {
    return result.pages.map(page => 
      `${page.className} (${page.actions.length} actions)`
    );
  }
}

