/**
 * Test-case generation prompts (shared by main and renderer).
 *
 * A "prompt" here is the system instructions / persona used to steer the AI
 * when generating test cases. The structural parts of the prompt (action
 * injection and the strict JSON output format) are kept in the generator and
 * are NOT user-editable, so generation/parsing can never break.
 */

/** The built-in default instructions used for AI test-case generation. */
export const DEFAULT_TC_INSTRUCTIONS = `You are an expert QA engineer and test case designer. Analyze the recorded user actions from a web application session and design comprehensive test cases.

Focus on:
1. Happy path scenarios (what the user successfully did)
2. Negative/error scenarios (what could go wrong)
3. Boundary conditions for any input fields
4. Validation and format scenarios
5. Security-related scenarios where applicable

Prioritize test cases based on business impact.`;

/** Stable id of the built-in default prompt. */
export const DEFAULT_PROMPT_ID = 'default';

/** Maximum number of user-defined prompts allowed (in addition to the default). */
export const MAX_USER_PROMPTS = 10;

export interface TestCasePrompt {
  id: string;
  name: string;
  instructions: string;
  /** True only for the built-in default prompt (read-only, non-deletable). */
  isDefault: boolean;
}

/** The built-in default prompt object. */
export const DEFAULT_PROMPT: TestCasePrompt = {
  id: DEFAULT_PROMPT_ID,
  name: 'Default',
  instructions: DEFAULT_TC_INSTRUCTIONS,
  isDefault: true,
};

export interface PromptInput {
  name: string;
  instructions: string;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/** Validate a user-supplied prompt name + instructions. */
export function validatePromptInput(input: PromptInput): ValidationResult {
  const name = (input.name || '').trim();
  const instructions = (input.instructions || '').trim();

  if (!name) {
    return { valid: false, error: 'Prompt name is required.' };
  }
  if (name.length > 60) {
    return { valid: false, error: 'Prompt name must be 60 characters or fewer.' };
  }
  if (!instructions) {
    return { valid: false, error: 'Prompt instructions are required.' };
  }
  return { valid: true };
}

/** Count how many prompts in the list are user-defined (non-default). */
export function countUserPrompts(prompts: TestCasePrompt[]): number {
  return prompts.filter(p => !p.isDefault).length;
}

/**
 * Ensure the list always starts with the built-in default prompt and never
 * contains a duplicate of it. Returns a new array.
 */
export function withDefaultPrompt(prompts: TestCasePrompt[]): TestCasePrompt[] {
  const userPrompts = (prompts || []).filter(p => p && !p.isDefault && p.id !== DEFAULT_PROMPT_ID);
  return [DEFAULT_PROMPT, ...userPrompts];
}

export interface MutationResult {
  prompts: TestCasePrompt[];
  error?: string;
  /** The id of the prompt created/updated, when successful. */
  id?: string;
}

/**
 * Add a new user prompt. Returns the original list unchanged with an error
 * message if validation fails or the cap is reached.
 */
export function addPrompt(
  prompts: TestCasePrompt[],
  input: PromptInput,
  idFactory: () => string,
): MutationResult {
  const validation = validatePromptInput(input);
  if (!validation.valid) {
    return { prompts, error: validation.error };
  }
  if (countUserPrompts(prompts) >= MAX_USER_PROMPTS) {
    return { prompts, error: `You can add up to ${MAX_USER_PROMPTS} prompts.` };
  }

  const newPrompt: TestCasePrompt = {
    id: idFactory(),
    name: input.name.trim(),
    instructions: input.instructions.trim(),
    isDefault: false,
  };
  return { prompts: [...prompts, newPrompt], id: newPrompt.id };
}

/**
 * Update an existing user prompt. The default prompt cannot be edited.
 */
export function updatePrompt(
  prompts: TestCasePrompt[],
  id: string,
  input: PromptInput,
): MutationResult {
  const target = prompts.find(p => p.id === id);
  if (!target) {
    return { prompts, error: 'Prompt not found.' };
  }
  if (target.isDefault) {
    return { prompts, error: 'The default prompt cannot be edited.' };
  }

  const validation = validatePromptInput(input);
  if (!validation.valid) {
    return { prompts, error: validation.error };
  }

  const updated = prompts.map(p =>
    p.id === id
      ? { ...p, name: input.name.trim(), instructions: input.instructions.trim() }
      : p,
  );
  return { prompts: updated, id };
}

/**
 * Delete a user prompt. The default prompt cannot be deleted.
 */
export function deletePrompt(prompts: TestCasePrompt[], id: string): MutationResult {
  const target = prompts.find(p => p.id === id);
  if (!target) {
    return { prompts, error: 'Prompt not found.' };
  }
  if (target.isDefault) {
    return { prompts, error: 'The default prompt cannot be deleted.' };
  }
  return { prompts: prompts.filter(p => p.id !== id), id };
}

/**
 * Resolve the instructions for a prompt id, falling back to the default
 * instructions if the id is missing/unknown.
 */
export function getInstructionsById(prompts: TestCasePrompt[], id: string | undefined): string {
  if (!id) return DEFAULT_TC_INSTRUCTIONS;
  const found = prompts.find(p => p.id === id);
  return found ? found.instructions : DEFAULT_TC_INSTRUCTIONS;
}
