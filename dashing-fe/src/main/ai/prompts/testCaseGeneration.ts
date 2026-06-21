/**
 * Prompt Template for AI Test Case Generation
 * 
 * This prompt instructs the LLM to analyze recorded user actions
 * and generate comprehensive test cases.
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { jsonrepair } from 'jsonrepair';

// Store the last saved debug file path for error reporting
let lastDebugFilePath = '';

export function getLastDebugFilePath(): string {
  return lastDebugFilePath;
}

/**
 * Save malformed AI response to a file for debugging
 */
function saveMalformedResponse(response: string, error: Error): string {
  try {
    const debugDir = path.join(app.getPath('userData'), 'ai-debug');
    if (!fs.existsSync(debugDir)) {
      fs.mkdirSync(debugDir, { recursive: true });
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `malformed-response-${timestamp}.txt`;
    const filepath = path.join(debugDir, filename);
    
    const content = `=== AI Response Debug File ===
Generated: ${new Date().toISOString()}
Error: ${error.message}

=== Raw Response (${response.length} characters) ===
${response}

=== End of Response ===
`;
    
    fs.writeFileSync(filepath, content, 'utf-8');
    lastDebugFilePath = filepath;
    console.log(`[TestCasePrompt] Saved malformed response to: ${filepath}`);
    return filepath;
  } catch (saveError) {
    console.error('[TestCasePrompt] Failed to save malformed response:', saveError);
    return '';
  }
}

export const TEST_CASE_GENERATION_PROMPT = {
  system: `You are an expert QA engineer and test case designer. Your task is to analyze user actions from a web application session and generate comprehensive test cases.

You should:
1. Identify key user workflows and interactions
2. Generate positive test cases (happy paths)
3. Generate negative test cases (error scenarios, edge cases)
4. Consider boundary conditions for input fields
5. Include security-related test cases where applicable
6. Prioritize test cases based on business impact

For each test case, provide:
- A clear, descriptive name
- Detailed description of what is being tested
- Step-by-step test steps
- Expected results
- Priority (critical, high, medium, low)

Output your response as a JSON array of test cases.`,

  userTemplate: (actionsJson: string, context: string): string => `
Analyze the following recorded user actions and generate test cases:

## Session Context
${context}

## Recorded Actions
\`\`\`json
${actionsJson}
\`\`\`

Generate test cases based on these actions. Consider:
- What the user is trying to accomplish
- What could go wrong in each step
- Edge cases for any input fields
- Validation scenarios
- Error handling scenarios

Return your response as a valid JSON array with this exact structure:
\`\`\`json
[
  {
    "name": "Test case name",
    "description": "What this test case verifies",
    "steps": "Step 1: Navigate to...\\nStep 2: Click on...\\nStep 3: Enter...",
    "expectedResult": "The expected outcome",
    "priority": "critical|high|medium|low"
  }
]
\`\`\`

Only return the JSON array, no additional text.`,
};

/**
 * Build the context string from session/action metadata
 */
export function buildTestCaseContext(metadata: {
  sessionName?: string;
  pageUrls?: string[];
  actionCount?: number;
  formFieldsDetected?: string[];
}): string {
  const lines: string[] = [];

  if (metadata.sessionName) {
    lines.push(`Session: ${metadata.sessionName}`);
  }
  if (metadata.pageUrls?.length) {
    lines.push(`Pages visited: ${metadata.pageUrls.join(', ')}`);
  }
  if (metadata.actionCount) {
    lines.push(`Total actions recorded: ${metadata.actionCount}`);
  }
  if (metadata.formFieldsDetected?.length) {
    lines.push(`Form fields detected: ${metadata.formFieldsDetected.join(', ')}`);
  }

  return lines.join('\n');
}

/**
 * Parse the LLM response into structured test cases
 */
export interface AIGeneratedTestCase {
  name: string;
  description: string;
  steps: string;
  expectedResult: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
}

/**
 * Attempt to recover complete JSON objects from a truncated array string.
 * Finds all complete `{ ... }` blocks at the top level of the array.
 */
function recoverPartialJsonArray(truncated: string): unknown[] {
  const results: unknown[] = [];
  let depth = 0;
  let objectStart = -1;

  for (let i = 0; i < truncated.length; i++) {
    const ch = truncated[i];
    if (ch === '"') {
      // Skip string contents
      i++;
      while (i < truncated.length && truncated[i] !== '"') {
        if (truncated[i] === '\\') i++; // skip escaped char
        i++;
      }
      continue;
    }
    if (ch === '{') {
      if (depth === 0) objectStart = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && objectStart !== -1) {
        const objectStr = truncated.substring(objectStart, i + 1);
        try {
          results.push(JSON.parse(objectStr));
        } catch {
          try {
            results.push(JSON.parse(jsonrepair(objectStr)));
          } catch {
            // Skip this object
          }
        }
        objectStart = -1;
      }
    }
  }

  return results;
}

export function parseTestCaseResponse(response: string): AIGeneratedTestCase[] {
  try {
    // Try to extract a complete JSON array
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    // Also look for truncated arrays (opening [ but no closing ])
    const truncatedMatch = !jsonMatch ? response.match(/\[[\s\S]*/) : null;

    const jsonString = jsonMatch?.[0] || truncatedMatch?.[0];

    if (!jsonString) {
      console.error('[TestCasePrompt] No JSON array found in response');
      saveMalformedResponse(response, new Error('No JSON array found in response'));
      return [];
    }

    let parsed: unknown;
    let wasTruncated = false;
    
    // First, try standard JSON.parse
    try {
      parsed = JSON.parse(jsonString);
    } catch (parseError) {
      // Try JSON repair
      console.log('[TestCasePrompt] Standard JSON.parse failed, attempting to repair JSON...');
      try {
        const repairedJson = jsonrepair(jsonString);
        parsed = JSON.parse(repairedJson);
        console.log('[TestCasePrompt] JSON repair successful');
      } catch {
        // If repair also fails, try partial recovery
        console.log('[TestCasePrompt] JSON repair failed, attempting partial recovery...');
        const recovered = recoverPartialJsonArray(jsonString);
        if (recovered.length > 0) {
          console.log(`[TestCasePrompt] Recovered ${recovered.length} complete test case(s) from truncated response`);
          parsed = recovered;
          wasTruncated = true;
          saveMalformedResponse(response, new Error(`Truncated response - recovered ${recovered.length} items`));
        } else {
          throw parseError;
        }
      }
    }
    
    if (!Array.isArray(parsed)) {
      console.error('[TestCasePrompt] Parsed response is not an array');
      saveMalformedResponse(response, new Error('Parsed response is not an array'));
      return [];
    }

    if (wasTruncated) {
      console.warn(`[TestCasePrompt] Response was truncated. Recovered ${parsed.length} test case(s).`);
    }

    // Validate and normalize each test case
    return parsed
      .filter((tc: Record<string, unknown>) => tc && typeof tc === 'object' && tc.name)
      .map((tc: Record<string, unknown>, index: number) => ({
        name: (tc.name as string) || `Test Case ${index + 1}`,
        description: (tc.description as string) || '',
        steps: (tc.steps as string) || '',
        expectedResult: (tc.expectedResult as string) || (tc.expected_result as string) || '',
        priority: validatePriority(tc.priority as string),
      }));
  } catch (error) {
    console.error('[TestCasePrompt] Failed to parse response:', error);
    const savedPath = saveMalformedResponse(response, error instanceof Error ? error : new Error(String(error)));
    if (savedPath) {
      console.log(`[TestCasePrompt] Debug file saved. Check: ${savedPath}`);
    }
    return [];
  }
}

function validatePriority(priority: string): 'critical' | 'high' | 'medium' | 'low' {
  const normalized = (priority || '').toLowerCase();
  if (['critical', 'high', 'medium', 'low'].includes(normalized)) {
    return normalized as 'critical' | 'high' | 'medium' | 'low';
  }
  return 'medium';
}

// ============================================
// Two-Pass Prompts
// ============================================

export interface TestCasePlan {
  name: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
}

export const TEST_CASE_PLAN_PROMPT = {
  system: `You are an expert QA engineer. Your task is to analyze recorded user actions and identify all the test cases that should be written. You are ONLY listing test case names and priorities — do NOT write descriptions, steps, or expected results yet.

Focus on:
1. Happy path scenarios (what the user successfully did)
2. Negative/error scenarios (what could go wrong)
3. Boundary conditions for any input fields
4. Security-related scenarios where applicable

Output a JSON array of objects with only "name" and "priority" fields.`,

  userTemplate: (actionsJson: string, context: string): string => `
Analyze these recorded user actions and list ALL test cases that should be written.

## Session Context
${context}

## Recorded Actions
\`\`\`json
${actionsJson}
\`\`\`

Return ONLY a JSON array with this exact structure (no descriptions, no steps):
\`\`\`json
[
  { "name": "Test case name", "priority": "critical|high|medium|low" }
]
\`\`\`

Only return the JSON array, no additional text.`,
};

export function parseTestCasePlanResponse(response: string): TestCasePlan[] {
  try {
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.error('[TestCasePlan] No JSON array found in response');
      return [];
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      try {
        parsed = JSON.parse(jsonrepair(jsonMatch[0]));
      } catch {
        console.error('[TestCasePlan] Failed to parse plan response');
        return [];
      }
    }

    if (!Array.isArray(parsed)) return [];

    return parsed.map((tc: Record<string, unknown>, index: number) => ({
      name: (tc.name as string) || `Test Case ${index + 1}`,
      priority: validatePriority(tc.priority as string),
    }));
  } catch (error) {
    console.error('[TestCasePlan] Failed to parse plan response:', error);
    return [];
  }
}

export const TEST_CASE_DETAIL_PROMPT = {
  system: `You are an expert QA engineer. You have already identified a set of test cases to write. Now you need to write the FULL details for specific test cases from that list.

For each test case, provide:
- name (must match exactly as given)
- description: what is being tested
- steps: step-by-step test procedure
- expectedResult: what should happen
- priority (must match exactly as given)

Output a JSON array of complete test case objects.`,

  userTemplate: (actionsJson: string, context: string, testCaseNames: string[]): string => `
Write the full details for the following test cases, based on the recorded user actions below.

## Test Cases to Detail
${testCaseNames.map((name, i) => `${i + 1}. ${name}`).join('\n')}

## Session Context
${context}

## Recorded Actions
\`\`\`json
${actionsJson}
\`\`\`

Return a JSON array with this exact structure:
\`\`\`json
[
  {
    "name": "Exact test case name from above",
    "description": "What this test case verifies",
    "steps": "Step 1: Navigate to...\\nStep 2: Click on...\\nStep 3: Enter...",
    "expectedResult": "The expected outcome",
    "priority": "critical|high|medium|low"
  }
]
\`\`\`

Only return the JSON array, no additional text.`,
};
