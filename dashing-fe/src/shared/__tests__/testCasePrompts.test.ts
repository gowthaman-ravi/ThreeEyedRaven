import {
  DEFAULT_PROMPT,
  DEFAULT_PROMPT_ID,
  DEFAULT_TC_INSTRUCTIONS,
  MAX_USER_PROMPTS,
  TestCasePrompt,
  addPrompt,
  countUserPrompts,
  deletePrompt,
  getInstructionsById,
  updatePrompt,
  validatePromptInput,
  withDefaultPrompt,
} from '../testCasePrompts';

let counter = 0;
const idFactory = () => `id-${++counter}`;
beforeEach(() => {
  counter = 0;
});

describe('withDefaultPrompt', () => {
  it('always includes the default prompt first', () => {
    const result = withDefaultPrompt([]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(DEFAULT_PROMPT_ID);
    expect(result[0].isDefault).toBe(true);
  });

  it('drops any duplicate/persisted default entries and keeps user prompts', () => {
    const stored: TestCasePrompt[] = [
      { ...DEFAULT_PROMPT },
      { id: 'u1', name: 'Mine', instructions: 'Focus on auth', isDefault: false },
    ];
    const result = withDefaultPrompt(stored);
    expect(result).toHaveLength(2);
    expect(result.filter(p => p.isDefault)).toHaveLength(1);
    expect(result[1].id).toBe('u1');
  });
});

describe('validatePromptInput', () => {
  it('rejects empty name', () => {
    expect(validatePromptInput({ name: '  ', instructions: 'x' }).valid).toBe(false);
  });

  it('rejects empty instructions', () => {
    expect(validatePromptInput({ name: 'x', instructions: '   ' }).valid).toBe(false);
  });

  it('rejects names longer than 60 chars', () => {
    expect(validatePromptInput({ name: 'a'.repeat(61), instructions: 'x' }).valid).toBe(false);
  });

  it('accepts a valid prompt', () => {
    expect(validatePromptInput({ name: 'Good', instructions: 'Do things' }).valid).toBe(true);
  });
});

describe('addPrompt', () => {
  it('adds a trimmed user prompt', () => {
    const start = withDefaultPrompt([]);
    const { prompts, error, id } = addPrompt(start, { name: '  Sec  ', instructions: '  test  ' }, idFactory);
    expect(error).toBeUndefined();
    expect(id).toBe('id-1');
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toMatchObject({ name: 'Sec', instructions: 'test', isDefault: false });
  });

  it('rejects invalid input without mutating', () => {
    const start = withDefaultPrompt([]);
    const result = addPrompt(start, { name: '', instructions: '' }, idFactory);
    expect(result.error).toBeDefined();
    expect(result.prompts).toBe(start);
  });

  it('enforces the MAX_USER_PROMPTS cap', () => {
    let prompts = withDefaultPrompt([]);
    for (let i = 0; i < MAX_USER_PROMPTS; i++) {
      prompts = addPrompt(prompts, { name: `P${i}`, instructions: 'x' }, idFactory).prompts;
    }
    expect(countUserPrompts(prompts)).toBe(MAX_USER_PROMPTS);
    const result = addPrompt(prompts, { name: 'Overflow', instructions: 'x' }, idFactory);
    expect(result.error).toMatch(/up to/);
    expect(countUserPrompts(result.prompts)).toBe(MAX_USER_PROMPTS);
  });
});

describe('updatePrompt', () => {
  it('updates a user prompt', () => {
    const added = addPrompt(withDefaultPrompt([]), { name: 'Old', instructions: 'old' }, idFactory);
    const result = updatePrompt(added.prompts, added.id!, { name: 'New', instructions: 'new' });
    expect(result.error).toBeUndefined();
    expect(result.prompts.find(p => p.id === added.id)).toMatchObject({ name: 'New', instructions: 'new' });
  });

  it('refuses to edit the default prompt', () => {
    const start = withDefaultPrompt([]);
    const result = updatePrompt(start, DEFAULT_PROMPT_ID, { name: 'Hacked', instructions: 'nope' });
    expect(result.error).toMatch(/default prompt/i);
    expect(result.prompts).toBe(start);
  });
});

describe('deletePrompt', () => {
  it('deletes a user prompt', () => {
    const added = addPrompt(withDefaultPrompt([]), { name: 'Tmp', instructions: 'x' }, idFactory);
    const result = deletePrompt(added.prompts, added.id!);
    expect(result.error).toBeUndefined();
    expect(result.prompts).toHaveLength(1);
  });

  it('refuses to delete the default prompt', () => {
    const start = withDefaultPrompt([]);
    const result = deletePrompt(start, DEFAULT_PROMPT_ID);
    expect(result.error).toMatch(/default prompt/i);
    expect(result.prompts).toBe(start);
  });
});

describe('getInstructionsById', () => {
  it('falls back to default instructions for unknown/empty ids', () => {
    const start = withDefaultPrompt([]);
    expect(getInstructionsById(start, undefined)).toBe(DEFAULT_TC_INSTRUCTIONS);
    expect(getInstructionsById(start, 'missing')).toBe(DEFAULT_TC_INSTRUCTIONS);
    expect(getInstructionsById(start, DEFAULT_PROMPT_ID)).toBe(DEFAULT_TC_INSTRUCTIONS);
  });

  it('returns the matching prompt instructions', () => {
    const added = addPrompt(withDefaultPrompt([]), { name: 'P', instructions: 'custom guidance' }, idFactory);
    expect(getInstructionsById(added.prompts, added.id)).toBe('custom guidance');
  });
});
