/**
 * Prompt Template for AI Code Optimization
 * 
 * This prompt instructs the LLM to optimize existing automation code
 * for better maintainability, performance, and reliability.
 */

import { Framework } from './codeGeneration';

export const CODE_OPTIMIZATION_PROMPT = {
  system: `You are an expert test automation engineer specializing in code review and optimization. Your task is to improve existing automation code while maintaining its functionality.

Focus on these optimization areas:
1. **Locator Improvements**: Use more stable selectors (data-testid > id > semantic > css)
2. **Wait Strategies**: Replace hard waits with explicit waits and proper assertions
3. **Code Structure**: Apply DRY principles, extract reusable functions
4. **Error Handling**: Add try-catch blocks and recovery mechanisms
5. **Readability**: Improve naming, add comments, format consistently
6. **Performance**: Reduce unnecessary actions, parallelize where possible
7. **Maintainability**: Apply Page Object Model where beneficial
8. **Assertions**: Strengthen assertions for better failure detection

Return the optimized code with inline comments explaining significant changes.`,

  userTemplate: (
    existingCode: string,
    framework: Framework,
    additionalContext?: string
  ): string => `
Optimize the following ${framework.charAt(0).toUpperCase() + framework.slice(1)} automation code:

## Existing Code
\`\`\`
${existingCode}
\`\`\`

${additionalContext ? `## Additional Context\n${additionalContext}\n` : ''}

Please optimize this code following best practices. Specifically:
${framework === 'playwright' ? getPlaywrightOptimizations() : getCypressOptimizations()}

Return the complete optimized code. Add brief inline comments (// OPTIMIZED: reason) where you made significant improvements.`,
};

function getPlaywrightOptimizations(): string {
  return `
- Replace CSS selectors with getByRole(), getByTestId(), getByLabel() where possible
- Use web-first assertions (expect(locator).toBeVisible() instead of waitForSelector + assertion)
- Use locator.filter() for more precise element selection
- Consider using test.step() to group related actions
- Use proper async/await patterns without unnecessary awaits
- Add meaningful assertion messages`;
}

function getCypressOptimizations(): string {
  return `
- Use cy.contains() for text-based selection
- Replace cy.wait(time) with cy.intercept() for API waits
- Use .within() for scoped element queries
- Chain assertions instead of multiple get() calls
- Use aliases for frequently accessed elements
- Add proper timeout configurations where needed`;
}

/**
 * Parse optimization response to extract code and changes
 */
export interface OptimizationResult {
  optimizedCode: string;
  changes: string[];
}

export function parseOptimizationResponse(response: string): OptimizationResult {
  // Remove markdown code blocks if present
  let code = response.replace(/```(?:typescript|javascript|ts|js)?\n?/g, '');
  code = code.replace(/```\n?/g, '');
  code = code.trim();

  // Extract optimization comments
  const changePattern = /\/\/\s*OPTIMIZED:\s*(.+)/g;
  const changes: string[] = [];
  let match;
  
  while ((match = changePattern.exec(code)) !== null) {
    changes.push(match[1].trim());
  }

  return {
    optimizedCode: code,
    changes,
  };
}

/**
 * Compare original and optimized code metrics
 */
export function compareCodeMetrics(original: string, optimized: string): {
  lineCountDiff: number;
  selectorImprovements: number;
  hardWaitsRemoved: number;
} {
  const originalLines = original.split('\n').filter(l => l.trim()).length;
  const optimizedLines = optimized.split('\n').filter(l => l.trim()).length;

  // Count selector improvements (getByRole, getByTestId, etc.)
  const improvedSelectors = (optimized.match(/getBy(Role|TestId|Label|Text|Placeholder)/g) || []).length -
    (original.match(/getBy(Role|TestId|Label|Text|Placeholder)/g) || []).length;

  // Count hard waits removed
  const originalWaits = (original.match(/wait\s*\(\s*\d+/g) || []).length;
  const optimizedWaits = (optimized.match(/wait\s*\(\s*\d+/g) || []).length;

  return {
    lineCountDiff: optimizedLines - originalLines,
    selectorImprovements: Math.max(0, improvedSelectors),
    hardWaitsRemoved: Math.max(0, originalWaits - optimizedWaits),
  };
}
