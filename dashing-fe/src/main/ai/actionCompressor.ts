/**
 * Action Compressor
 *
 * Preprocesses recorded actions before sending to AI providers.
 * Applies a configurable set of compression rules to reduce token
 * usage by removing noise, deduplicating, and consolidating actions.
 */

import { RecordedAction, ActionType } from '../../shared/types';

export interface CompressionRule {
  id: string;
  category: 'noise' | 'dedup' | 'consolidation' | 'redundancy' | 'trimming' | 'smart';
  name: string;
  description: string;
  defaultEnabled: boolean;
  apply: (actions: RecordedAction[]) => RecordedAction[];
}

export type CompressionConfig = Record<string, boolean>;

export interface CompressionStats {
  before: number;
  after: number;
  rulesApplied: string[];
  removedByRule: Record<string, number>;
}

export interface CompressionResult {
  compressed: RecordedAction[];
  stats: CompressionStats;
}

// ============================================
// Helper utilities
// ============================================

function sameElement(a: RecordedAction, b: RecordedAction): boolean {
  if (!a.element?.selector || !b.element?.selector) return false;
  return a.element.selector === b.element.selector;
}

function isInteractiveElement(action: RecordedAction): boolean {
  if (!action.element) return false;
  const tag = action.element.tagName?.toLowerCase();
  const role = action.element.attributes?.role?.toLowerCase();
  const interactiveTags = ['button', 'a', 'input', 'select', 'textarea', 'details', 'summary'];
  const interactiveRoles = ['button', 'link', 'menuitem', 'tab', 'option', 'combobox', 'listbox', 'menu'];
  return interactiveTags.includes(tag) || interactiveRoles.includes(role);
}

function isInputElement(action: RecordedAction): boolean {
  if (!action.element) return false;
  const tag = action.element.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select';
}

// ============================================
// Compression Rules
// ============================================

const COMPRESSION_RULES: CompressionRule[] = [

  // ---- Category: Noise Removal ----

  {
    id: 'REMOVE_MOUSEMOVE',
    category: 'noise',
    name: 'Remove Mouse Move',
    description: 'Remove all mousemove actions. Cursor movement is never relevant for test cases.',
    defaultEnabled: true,
    apply: (actions) => actions.filter(a => a.type !== 'mousemove'),
  },

  {
    id: 'REMOVE_MOUSEENTER',
    category: 'noise',
    name: 'Remove Mouse Enter',
    description: 'Remove all mouseenter actions. These fire when cursor enters an element boundary.',
    defaultEnabled: true,
    apply: (actions) => actions.filter(a => a.type !== 'mouseenter'),
  },

  {
    id: 'REMOVE_MOUSELEAVE',
    category: 'noise',
    name: 'Remove Mouse Leave',
    description: 'Remove all mouseleave actions. These fire when cursor leaves an element boundary.',
    defaultEnabled: true,
    apply: (actions) => actions.filter(a => a.type !== 'mouseleave'),
  },

  {
    id: 'REMOVE_HOVER_NO_EFFECT',
    category: 'noise',
    name: 'Remove Non-Interactive Hovers',
    description: 'Remove hover actions on non-interactive elements. Keep hovers on buttons, links, menus.',
    defaultEnabled: true,
    apply: (actions) => actions.filter(a => {
      if (a.type !== 'hover') return true;
      return isInteractiveElement(a);
    }),
  },

  {
    id: 'REMOVE_SCROLL',
    category: 'noise',
    name: 'Remove Scroll',
    description: 'Remove all scroll actions. Scrolling is a viewport concern, not a functional test concern.',
    defaultEnabled: true,
    apply: (actions) => actions.filter(a => a.type !== 'scroll'),
  },

  {
    id: 'REMOVE_FOCUS',
    category: 'noise',
    name: 'Remove Redundant Focus',
    description: 'Remove focus actions immediately followed by type/change/click on the same element.',
    defaultEnabled: true,
    apply: (actions) => {
      const toRemove = new Set<number>();
      for (let i = 0; i < actions.length - 1; i++) {
        if (actions[i].type !== 'focus') continue;
        const next = actions[i + 1];
        const timeDiff = next.timestamp - actions[i].timestamp;
        if (timeDiff <= 500 && sameElement(actions[i], next) &&
            (next.type === 'type' || next.type === 'change' || next.type === 'click')) {
          toRemove.add(i);
        }
      }
      return actions.filter((_, i) => !toRemove.has(i));
    },
  },

  {
    id: 'REMOVE_BLUR',
    category: 'noise',
    name: 'Remove Redundant Blur',
    description: 'Remove blur actions immediately preceded by type/change/click on the same element.',
    defaultEnabled: true,
    apply: (actions) => {
      const toRemove = new Set<number>();
      for (let i = 1; i < actions.length; i++) {
        if (actions[i].type !== 'blur') continue;
        const prev = actions[i - 1];
        const timeDiff = actions[i].timestamp - prev.timestamp;
        if (timeDiff <= 500 && sameElement(actions[i], prev) &&
            (prev.type === 'type' || prev.type === 'change' || prev.type === 'click')) {
          toRemove.add(i);
        }
      }
      return actions.filter((_, i) => !toRemove.has(i));
    },
  },

  {
    id: 'REMOVE_ORPHAN_FOCUS',
    category: 'noise',
    name: 'Remove Orphan Focus',
    description: 'Remove focus actions not followed by any type/change on the same element.',
    defaultEnabled: true,
    apply: (actions) => {
      const toRemove = new Set<number>();
      for (let i = 0; i < actions.length; i++) {
        if (actions[i].type !== 'focus') continue;
        const selector = actions[i].element?.selector;
        if (!selector) continue;
        let hasFollowUp = false;
        for (let j = i + 1; j < actions.length; j++) {
          if (actions[j].element?.selector === selector &&
              (actions[j].type === 'type' || actions[j].type === 'change')) {
            hasFollowUp = true;
            break;
          }
        }
        if (!hasFollowUp) toRemove.add(i);
      }
      return actions.filter((_, i) => !toRemove.has(i));
    },
  },

  {
    id: 'REMOVE_ORPHAN_BLUR',
    category: 'noise',
    name: 'Remove Orphan Blur',
    description: 'Remove blur actions not preceded by any type/change/click on the same element.',
    defaultEnabled: true,
    apply: (actions) => {
      const toRemove = new Set<number>();
      for (let i = 0; i < actions.length; i++) {
        if (actions[i].type !== 'blur') continue;
        const selector = actions[i].element?.selector;
        if (!selector) continue;
        let hasPreceding = false;
        for (let j = i - 1; j >= 0; j--) {
          if (actions[j].element?.selector === selector &&
              (actions[j].type === 'type' || actions[j].type === 'change' || actions[j].type === 'click')) {
            hasPreceding = true;
            break;
          }
        }
        if (!hasPreceding) toRemove.add(i);
      }
      return actions.filter((_, i) => !toRemove.has(i));
    },
  },

  // ---- Category: Deduplication ----

  {
    id: 'DEDUPE_CONSECUTIVE_CLICKS',
    category: 'dedup',
    name: 'Dedupe Consecutive Clicks',
    description: 'Keep only the first click when same element is clicked multiple times within 2 seconds.',
    defaultEnabled: true,
    apply: (actions) => {
      const toRemove = new Set<number>();
      for (let i = 1; i < actions.length; i++) {
        if (actions[i].type !== 'click') continue;
        const prev = actions[i - 1];
        if (prev.type !== 'click') continue;
        const timeDiff = actions[i].timestamp - prev.timestamp;
        if (timeDiff <= 2000 && sameElement(actions[i], prev)) {
          toRemove.add(i);
        }
      }
      return actions.filter((_, i) => !toRemove.has(i));
    },
  },

  {
    id: 'DEDUPE_CONSECUTIVE_NAVIGATIONS',
    category: 'dedup',
    name: 'Dedupe Consecutive Navigations',
    description: 'Keep only the final navigation in redirect chains (within 1 second).',
    defaultEnabled: true,
    apply: (actions) => {
      const toRemove = new Set<number>();
      for (let i = 0; i < actions.length - 1; i++) {
        if (actions[i].type !== 'navigate') continue;
        const next = actions[i + 1];
        if (next.type !== 'navigate') continue;
        const timeDiff = next.timestamp - actions[i].timestamp;
        if (timeDiff <= 1000) {
          toRemove.add(i);
        }
      }
      return actions.filter((_, i) => !toRemove.has(i));
    },
  },

  {
    id: 'DEDUPE_REPEATED_SCROLL',
    category: 'dedup',
    name: 'Dedupe Repeated Scroll',
    description: 'Collapse consecutive scroll actions into a single scroll with final position.',
    defaultEnabled: true,
    apply: (actions) => {
      const result: RecordedAction[] = [];
      for (let i = 0; i < actions.length; i++) {
        if (actions[i].type !== 'scroll') {
          result.push(actions[i]);
          continue;
        }
        // Find the end of the scroll sequence
        let lastScroll = i;
        while (lastScroll + 1 < actions.length && actions[lastScroll + 1].type === 'scroll') {
          lastScroll++;
        }
        result.push(actions[lastScroll]);
        i = lastScroll;
      }
      return result;
    },
  },

  // ---- Category: Consolidation ----

  {
    id: 'CONSOLIDATE_TYPE_EVENTS',
    category: 'consolidation',
    name: 'Consolidate Type Events',
    description: 'Collapse consecutive type actions on same element into one with the final value.',
    defaultEnabled: true,
    apply: (actions) => {
      const result: RecordedAction[] = [];
      for (let i = 0; i < actions.length; i++) {
        if (actions[i].type !== 'type') {
          result.push(actions[i]);
          continue;
        }
        // Find the end of the type sequence on the same element
        let lastType = i;
        while (lastType + 1 < actions.length &&
               actions[lastType + 1].type === 'type' &&
               sameElement(actions[i], actions[lastType + 1])) {
          lastType++;
        }
        result.push(actions[lastType]);
        i = lastType;
      }
      return result;
    },
  },

  {
    id: 'CONSOLIDATE_KEYPRESS_TO_TYPE',
    category: 'consolidation',
    name: 'Consolidate Keypress to Type',
    description: 'Merge sequential single-char keypress actions into a single type action.',
    defaultEnabled: true,
    apply: (actions) => {
      const result: RecordedAction[] = [];
      let i = 0;
      while (i < actions.length) {
        if (actions[i].type !== 'keypress' || !actions[i].data.key || actions[i].data.key!.length !== 1) {
          result.push(actions[i]);
          i++;
          continue;
        }
        // Check for modifier keys (skip sequences with modifiers other than Shift)
        const hasNonShiftModifier = actions[i].data.modifiers?.some(m => m !== 'Shift');
        if (hasNonShiftModifier) {
          result.push(actions[i]);
          i++;
          continue;
        }
        // Collect consecutive single-char keypresses on the same element
        let combined = actions[i].data.key!;
        const startAction = actions[i];
        let j = i + 1;
        while (j < actions.length &&
               actions[j].type === 'keypress' &&
               actions[j].data.key?.length === 1 &&
               !actions[j].data.modifiers?.some(m => m !== 'Shift') &&
               sameElement(startAction, actions[j])) {
          combined += actions[j].data.key!;
          j++;
        }
        if (j - i > 1) {
          // Create a consolidated type action
          const consolidated: RecordedAction = {
            ...startAction,
            type: 'type' as ActionType,
            data: { ...startAction.data, value: combined, key: undefined, modifiers: undefined },
            timestamp: actions[j - 1].timestamp,
          };
          result.push(consolidated);
        } else {
          result.push(actions[i]);
        }
        i = j;
      }
      return result;
    },
  },

  {
    id: 'MERGE_NAVIGATE_AND_LOAD',
    category: 'consolidation',
    name: 'Merge Navigate and Click',
    description: 'When navigate is immediately followed by click on same URL, merge into one navigate.',
    defaultEnabled: true,
    apply: (actions) => {
      const toRemove = new Set<number>();
      for (let i = 0; i < actions.length - 1; i++) {
        const curr = actions[i];
        const next = actions[i + 1];
        // navigate followed by click with matching URL
        if (curr.type === 'navigate' && next.type === 'click' &&
            curr.data.url && next.tabUrl && curr.data.url === next.tabUrl) {
          toRemove.add(i + 1);
        }
        // click followed by navigate to same URL
        if (curr.type === 'click' && next.type === 'navigate' &&
            curr.tabUrl && next.data.url && curr.tabUrl === next.data.url) {
          toRemove.add(i);
        }
      }
      return actions.filter((_, i) => !toRemove.has(i));
    },
  },

  {
    id: 'MERGE_CHECK_UNCHECK',
    category: 'consolidation',
    name: 'Merge Check/Uncheck Toggles',
    description: 'When check and uncheck occur on same element consecutively, keep only the final state.',
    defaultEnabled: true,
    apply: (actions) => {
      const result: RecordedAction[] = [];
      for (let i = 0; i < actions.length; i++) {
        const isToggle = actions[i].type === 'check' || actions[i].type === 'uncheck';
        if (!isToggle) {
          result.push(actions[i]);
          continue;
        }
        // Find the end of the toggle sequence on the same element
        let last = i;
        while (last + 1 < actions.length &&
               (actions[last + 1].type === 'check' || actions[last + 1].type === 'uncheck') &&
               sameElement(actions[i], actions[last + 1])) {
          last++;
        }
        result.push(actions[last]);
        i = last;
      }
      return result;
    },
  },

  // ---- Category: Redundancy Removal ----

  {
    id: 'REMOVE_CLICK_BEFORE_TYPE',
    category: 'redundancy',
    name: 'Remove Click Before Type',
    description: 'Remove click on input/textarea immediately followed by type on same element.',
    defaultEnabled: true,
    apply: (actions) => {
      const toRemove = new Set<number>();
      for (let i = 0; i < actions.length - 1; i++) {
        if (actions[i].type !== 'click') continue;
        if (!isInputElement(actions[i])) continue;
        const next = actions[i + 1];
        if (next.type === 'type' && sameElement(actions[i], next)) {
          toRemove.add(i);
        }
      }
      return actions.filter((_, i) => !toRemove.has(i));
    },
  },

  {
    id: 'REMOVE_RIGHTCLICK_BEFORE_ADDEXPECTED',
    category: 'redundancy',
    name: 'Remove Right-Click Before Assertion',
    description: 'Remove rightclick within 2 seconds before addExpected on same element (not just strictly adjacent).',
    defaultEnabled: true,
    apply: (actions) => {
      const toRemove = new Set<number>();
      for (let i = 0; i < actions.length; i++) {
        if (actions[i].type !== 'rightclick') continue;
        // Look ahead within a 2-second window for a matching addExpected
        for (let j = i + 1; j < actions.length; j++) {
          const timeDiff = actions[j].timestamp - actions[i].timestamp;
          if (timeDiff > 2000) break;
          if (actions[j].type === 'addExpected' && sameElement(actions[i], actions[j])) {
            toRemove.add(i);
            break;
          }
        }
      }
      return actions.filter((_, i) => !toRemove.has(i));
    },
  },

  {
    id: 'REMOVE_DRAGSTART_WITHOUT_DROP',
    category: 'redundancy',
    name: 'Remove Abandoned Drags',
    description: 'Remove dragstart actions not followed by a corresponding drop action.',
    defaultEnabled: true,
    apply: (actions) => {
      const toRemove = new Set<number>();
      for (let i = 0; i < actions.length; i++) {
        if (actions[i].type !== 'dragstart') continue;
        let hasMatchingDrop = false;
        for (let j = i + 1; j < actions.length; j++) {
          if (actions[j].type === 'drop') {
            hasMatchingDrop = true;
            break;
          }
          if (actions[j].type === 'dragstart') break;
        }
        if (!hasMatchingDrop) toRemove.add(i);
      }
      return actions.filter((_, i) => !toRemove.has(i));
    },
  },

  // ---- Category: Data Trimming ----

  {
    id: 'TRIM_LONG_SELECT_TEXT',
    category: 'trimming',
    name: 'Trim Long Selected Text',
    description: 'Truncate selectedText to 200 characters.',
    defaultEnabled: true,
    apply: (actions) => actions.map(a => {
      if (a.data.selectedText && a.data.selectedText.length > 200) {
        return { ...a, data: { ...a.data, selectedText: a.data.selectedText.substring(0, 200) } };
      }
      return a;
    }),
  },

  {
    id: 'REMOVE_DUPLICATE_ADDEXPECTED',
    category: 'trimming',
    name: 'Remove Duplicate Assertions',
    description: 'When multiple addExpected target same element with same assertionType, keep only the last.',
    defaultEnabled: true,
    apply: (actions) => {
      // Collect indices of addExpected actions grouped by selector+assertionType
      const groups = new Map<string, number[]>();
      actions.forEach((a, i) => {
        if (a.type !== 'addExpected') return;
        const key = `${a.element?.selector || ''}::${a.data.assertionType || ''}`;
        const indices = groups.get(key) || [];
        indices.push(i);
        groups.set(key, indices);
      });
      const toRemove = new Set<number>();
      for (const indices of groups.values()) {
        if (indices.length <= 1) continue;
        // Keep the last, remove earlier ones
        for (let k = 0; k < indices.length - 1; k++) {
          toRemove.add(indices[k]);
        }
      }
      return actions.filter((_, i) => !toRemove.has(i));
    },
  },

  {
    id: 'STRIP_COORDINATE_DATA',
    category: 'trimming',
    name: 'Strip Coordinate Data',
    description: 'Remove x/y coordinate data from all actions except drag/drop.',
    defaultEnabled: true,
    apply: (actions) => actions.map(a => {
      if (a.type === 'drag' || a.type === 'drop' || a.type === 'dragstart') return a;
      const { x, y, startX, startY, endX, endY, ...restData } = a.data;
      if (x !== undefined || y !== undefined || startX !== undefined) {
        return { ...a, data: restData };
      }
      return a;
    }),
  },

  {
    id: 'STRIP_SCROLL_COORDINATES',
    category: 'trimming',
    name: 'Strip Scroll Coordinates',
    description: 'Remove scrollX, scrollY, deltaY from all actions.',
    defaultEnabled: true,
    apply: (actions) => actions.map(a => {
      const { scrollX, scrollY, deltaY, ...restData } = a.data;
      if (scrollX !== undefined || scrollY !== undefined || deltaY !== undefined) {
        return { ...a, data: restData };
      }
      return a;
    }),
  },

  // ---- Category: Smart Filtering ----

  {
    id: 'REMOVE_NOOP_CHANGES',
    category: 'smart',
    name: 'Remove No-Op Changes',
    description: 'Remove change actions with empty/unchanged value from previous type/change on same element.',
    defaultEnabled: true,
    apply: (actions) => {
      const lastValues = new Map<string, string>();
      const toRemove = new Set<number>();
      for (let i = 0; i < actions.length; i++) {
        const a = actions[i];
        const selector = a.element?.selector;
        if (!selector) continue;

        if (a.type === 'type' || a.type === 'change') {
          const currentValue = a.data.value ?? '';
          if (a.type === 'change') {
            const previousValue = lastValues.get(selector);
            if (currentValue === '' || currentValue === previousValue) {
              toRemove.add(i);
              continue;
            }
          }
          lastValues.set(selector, currentValue);
        }
      }
      return actions.filter((_, i) => !toRemove.has(i));
    },
  },

  {
    id: 'COLLAPSE_RAPID_CLICKS',
    category: 'smart',
    name: 'Collapse Rapid Clicks',
    description: 'When 3+ clicks happen on different elements within 500ms, keep only the last.',
    defaultEnabled: false,
    apply: (actions) => {
      const toRemove = new Set<number>();
      let i = 0;
      while (i < actions.length) {
        if (actions[i].type !== 'click') { i++; continue; }
        // Collect consecutive rapid clicks on different elements
        const clickRun = [i];
        let j = i + 1;
        while (j < actions.length && actions[j].type === 'click' &&
               actions[j].timestamp - actions[j - 1].timestamp <= 500 &&
               !sameElement(actions[i], actions[j])) {
          clickRun.push(j);
          j++;
        }
        if (clickRun.length >= 3) {
          // Keep only the last click in the rapid sequence
          for (let k = 0; k < clickRun.length - 1; k++) {
            toRemove.add(clickRun[k]);
          }
        }
        i = j;
      }
      return actions.filter((_, idx) => !toRemove.has(idx));
    },
  },

  {
    id: 'REMOVE_SELECT_DESELECT',
    category: 'smart',
    name: 'Remove Empty Selections',
    description: 'Remove select actions with empty selectedText or followed immediately by click elsewhere.',
    defaultEnabled: true,
    apply: (actions) => {
      const toRemove = new Set<number>();
      for (let i = 0; i < actions.length; i++) {
        if (actions[i].type !== 'select') continue;
        // Empty selection
        if (!actions[i].data.selectedText) {
          toRemove.add(i);
          continue;
        }
        // Selection immediately followed by click on a different element
        if (i + 1 < actions.length && actions[i + 1].type === 'click' && !sameElement(actions[i], actions[i + 1])) {
          toRemove.add(i);
        }
      }
      return actions.filter((_, i) => !toRemove.has(i));
    },
  },
];

// ============================================
// ActionCompressor class
// ============================================

class ActionCompressor {
  private rules: CompressionRule[] = COMPRESSION_RULES;

  getRules(): CompressionRule[] {
    return this.rules.map(r => ({
      ...r,
      apply: r.apply, // keep the function reference
    }));
  }

  compress(actions: RecordedAction[], config?: CompressionConfig): CompressionResult {
    const stats: CompressionStats = {
      before: actions.length,
      after: 0,
      rulesApplied: [],
      removedByRule: {},
    };

    let result = [...actions];

    for (const rule of this.rules) {
      const enabled = config?.[rule.id] ?? rule.defaultEnabled;
      if (!enabled) continue;

      const beforeCount = result.length;
      result = rule.apply(result);
      const removed = beforeCount - result.length;

      if (removed > 0 || beforeCount !== result.length) {
        stats.rulesApplied.push(rule.id);
        stats.removedByRule[rule.id] = removed;
      }
    }

    stats.after = result.length;

    console.log(
      `[ActionCompressor] Compressed ${stats.before} → ${stats.after} actions ` +
      `(${stats.before - stats.after} removed, ${stats.rulesApplied.length} rules applied)`
    );

    return { compressed: result, stats };
  }
}

// Singleton
let compressor: ActionCompressor | null = null;

export function getActionCompressor(): ActionCompressor {
  if (!compressor) {
    compressor = new ActionCompressor();
  }
  return compressor;
}

export { ActionCompressor, COMPRESSION_RULES };
