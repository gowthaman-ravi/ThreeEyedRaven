/**
 * AI Generator Service
 * 
 * Orchestrates the full AI generation flow for test cases and code,
 * including data masking, batching, and completion handling.
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { getDataMaskingService, MaskingDictionary } from './dataMasking';
import { getAICompletionService } from './aiCompletion';
import {
  TEST_CASE_PLAN_PROMPT,
  TEST_CASE_DETAIL_PROMPT,
  buildTestCaseContext,
  parseTestCaseResponse,
  parseTestCasePlanResponse,
  AIGeneratedTestCase,
  getLastDebugFilePath,
} from './prompts/testCaseGeneration';
import {
  CODE_GENERATION_PROMPT,
  CODE_PLAN_PROMPT,
  CODE_DETAIL_PROMPT,
  buildCodeHeader,
  validateGeneratedCode,
  Framework,
  Language,
} from './prompts/codeGeneration';
import {
  CODE_OPTIMIZATION_PROMPT,
  parseOptimizationResponse,
} from './prompts/codeOptimization';
import { RecordedAction } from '../../shared/types';
import { getEventStore } from '../eventStore';
import { getActionCompressor } from './actionCompressor';

export interface AIGenerationOptions {
  sessionId: string;
  selectedActionIds: string[];
  type: 'test-cases' | 'code-new' | 'code-optimize';
  framework?: Framework;
  language?: Language;
  existingCode?: string;
  testName?: string;
  onProgress?: (progress: { completedBatches: number; totalBatches: number }) => Promise<void>;
}

export interface AITestCaseResult {
  id: string;
  name: string;
  description: string;
  steps: string;
  expectedResult: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  selected?: boolean;
}

export interface AICodeResult {
  code: string;
  framework: Framework;
  language: Language;
  changes?: string[];
}

export interface AIGenerationResult {
  success: boolean;
  type: 'test-cases' | 'code-new' | 'code-optimize';
  testCases?: AITestCaseResult[];
  code?: AICodeResult;
  error?: string;
  debugFilePath?: string;
  promptFilePath?: string;
  actionsFilePath?: string;
  tokensUsed?: number;
  inputTokens?: number;
  outputTokens?: number;
  maskedCount?: number;
}

interface SavedPromptFiles {
  promptFilePath: string;
  actionsFilePath: string;
}

function savePromptAndActions(
  jobType: string,
  systemPrompt: string,
  userPrompt: string,
  actions: Array<Record<string, unknown>>
): SavedPromptFiles | null {
  try {
    const debugDir = path.join(app.getPath('userData'), 'ai-debug');
    if (!fs.existsSync(debugDir)) {
      fs.mkdirSync(debugDir, { recursive: true });
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const promptFilename = `prompt-${jobType}-${timestamp}.txt`;
    const actionsFilename = `actions-${jobType}-${timestamp}.json`;
    
    const promptFilePath = path.join(debugDir, promptFilename);
    const actionsFilePath = path.join(debugDir, actionsFilename);
    
    const promptContent = `=== AI Generation Prompt ===
Job Type: ${jobType}
Generated: ${new Date().toISOString()}

=== System Prompt ===
${systemPrompt}

=== User Prompt ===
${userPrompt}

=== End of Prompt ===
`;
    
    fs.writeFileSync(promptFilePath, promptContent, 'utf-8');
    fs.writeFileSync(actionsFilePath, JSON.stringify(actions, null, 2), 'utf-8');
    
    console.log(`[AIGenerator] Saved prompt to: ${promptFilePath}`);
    console.log(`[AIGenerator] Saved actions to: ${actionsFilePath}`);
    
    return { promptFilePath, actionsFilePath };
  } catch (error) {
    console.error('[AIGenerator] Failed to save prompt and actions:', error);
    return null;
  }
}

class AIGenerator {
  /**
   * Generate test cases from actions using AI
   */
  async generateTestCases(options: AIGenerationOptions): Promise<AIGenerationResult> {
    try {
      console.log(`[AIGenerator] Generating test cases for session ${options.sessionId}`);
      
      // Get the selected actions
      const allActions = await this.getActions(options.sessionId);
      const selectedActions = options.selectedActionIds.length > 0
        ? allActions.filter(a => options.selectedActionIds.includes(a.id))
        : allActions;

      if (selectedActions.length === 0) {
        return {
          success: false,
          type: 'test-cases',
          error: 'No actions selected for test case generation',
        };
      }

      // Sort chronologically so compression rules (e.g. rightclick→addExpected) work correctly
      selectedActions.sort((a, b) => a.timestamp - b.timestamp);

      // Compress actions to reduce token usage
      const compressor = getActionCompressor();
      const { compressed, stats: compressionStats } = compressor.compress(selectedActions);
      console.log(`[AIGenerator] Action compression: ${compressionStats.before} → ${compressionStats.after} actions`);

      // Mask sensitive data
      const maskingService = getDataMaskingService();
      const { maskedActions, dictionary } = maskingService.maskActions(compressed);
      const maskedCount = Object.keys(dictionary).length;

      // Build context
      const context = buildTestCaseContext({
        sessionName: options.testName || 'Test Session',
        pageUrls: [...new Set(maskedActions.map(a => a.tabUrl))],
        actionCount: maskedActions.length,
        formFieldsDetected: this.extractFormFields(maskedActions),
      });

      const completionService = getAICompletionService();
      const simplifiedActions = this.simplifyActionsForPrompt(maskedActions);
      const actionsJson = JSON.stringify(simplifiedActions, null, 2);
      
      let totalTokensUsed = 0;
      let totalInputTokens = 0;
      let totalOutputTokens = 0;

      // Save prompt and actions for debugging
      const savedFiles = savePromptAndActions(
        'test-cases',
        TEST_CASE_PLAN_PROMPT.system,
        TEST_CASE_PLAN_PROMPT.userTemplate(actionsJson, context),
        simplifiedActions
      );

      // ---- Pass 1: Planning ----
      console.log('[AIGenerator] Pass 1: Planning test cases...');
      if (options.onProgress) {
        await options.onProgress({ completedBatches: 0, totalBatches: 1 });
      }

      const planPrompt = TEST_CASE_PLAN_PROMPT.userTemplate(actionsJson, context);
      const planResponse = await completionService.completeWithFallback({
        prompt: planPrompt,
        systemPrompt: TEST_CASE_PLAN_PROMPT.system,
        temperature: 0.7,
      });
      totalTokensUsed += planResponse.tokensUsed || 0;
      totalInputTokens += planResponse.inputTokens || 0;
      totalOutputTokens += planResponse.outputTokens || 0;

      const unmaskedPlan = maskingService.unmaskText(planResponse.content, dictionary);
      const testCasePlan = parseTestCasePlanResponse(unmaskedPlan);

      if (testCasePlan.length === 0) {
        const debugPath = getLastDebugFilePath();
        console.error('[AIGenerator] No test cases planned - AI response may have been malformed');
        return {
          success: false,
          type: 'test-cases',
          error: 'Failed to plan test cases. Try again',
          debugFilePath: debugPath || undefined,
          promptFilePath: savedFiles?.promptFilePath,
          actionsFilePath: savedFiles?.actionsFilePath,
          tokensUsed: totalTokensUsed,
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
        };
      }

      console.log(`[AIGenerator] Pass 1 complete: ${testCasePlan.length} test cases planned`);

      // ---- Pass 2: Detail generation in chunks of 5 ----
      const CHUNK_SIZE = 5;
      const chunks: string[][] = [];
      for (let i = 0; i < testCasePlan.length; i += CHUNK_SIZE) {
        chunks.push(testCasePlan.slice(i, i + CHUNK_SIZE).map(tc => tc.name));
      }

      let allTestCases: AIGeneratedTestCase[] = [];
      const totalSteps = chunks.length + 1; // +1 for planning pass

      for (let i = 0; i < chunks.length; i++) {
        console.log(`[AIGenerator] Pass 2: Detailing chunk ${i + 1}/${chunks.length} (${chunks[i].length} test cases)`);
        
        if (options.onProgress) {
          await options.onProgress({
            completedBatches: i + 1, // +1 because planning was step 0
            totalBatches: totalSteps,
          });
        }

        const detailPrompt = TEST_CASE_DETAIL_PROMPT.userTemplate(actionsJson, context, chunks[i]);
        const detailResponse = await completionService.completeWithFallback({
          prompt: detailPrompt,
          systemPrompt: TEST_CASE_DETAIL_PROMPT.system,
          temperature: 0.7,
          stream: true,
          onChunk: (chunk, accumulated) => {
            console.log(`[AIGenerator] Streaming detail chunk ${i + 1}: ${accumulated.length} chars received`);
          },
        });
        totalTokensUsed += detailResponse.tokensUsed || 0;
        totalInputTokens += detailResponse.inputTokens || 0;
        totalOutputTokens += detailResponse.outputTokens || 0;

        const unmaskedDetail = maskingService.unmaskText(detailResponse.content, dictionary);
        const chunkTestCases = parseTestCaseResponse(unmaskedDetail);
        allTestCases = [...allTestCases, ...chunkTestCases];
      }

      // Report final progress
      if (options.onProgress) {
        await options.onProgress({ completedBatches: totalSteps, totalBatches: totalSteps });
      }

      // Check if we got any test cases
      if (allTestCases.length === 0) {
        const debugPath = getLastDebugFilePath();
        console.error('[AIGenerator] No test cases generated from detail pass');
        return {
          success: false,
          type: 'test-cases',
          error: 'Failed to generate test case details. Try again',
          debugFilePath: debugPath || undefined,
          promptFilePath: savedFiles?.promptFilePath,
          actionsFilePath: savedFiles?.actionsFilePath,
          tokensUsed: totalTokensUsed,
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
        };
      }

      // Convert to result format with IDs
      const testCaseResults: AITestCaseResult[] = allTestCases.map(tc => ({
        id: uuidv4(),
        name: tc.name,
        description: tc.description,
        steps: tc.steps,
        expectedResult: tc.expectedResult,
        priority: tc.priority,
        selected: true,
      }));

      console.log(`[AIGenerator] Generated ${testCaseResults.length} test cases (planned: ${testCasePlan.length})`);

      return {
        success: true,
        type: 'test-cases',
        testCases: testCaseResults,
        promptFilePath: savedFiles?.promptFilePath,
        actionsFilePath: savedFiles?.actionsFilePath,
        tokensUsed: totalTokensUsed,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        maskedCount,
      };
    } catch (error) {
      console.error('[AIGenerator] Test case generation failed:', error);
      return {
        success: false,
        type: 'test-cases',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Generate new automation code from actions using AI
   */
  async generateCode(options: AIGenerationOptions): Promise<AIGenerationResult> {
    try {
      console.log(`[AIGenerator] Generating code for session ${options.sessionId}`);
      
      const framework = options.framework || 'playwright';
      const language = options.language || 'typescript';
      const testName = options.testName || 'Generated Test';

      // Get the selected actions
      const allActions = await this.getActions(options.sessionId);
      const selectedActions = options.selectedActionIds.length > 0
        ? allActions.filter(a => options.selectedActionIds.includes(a.id))
        : allActions;

      if (selectedActions.length === 0) {
        return {
          success: false,
          type: 'code-new',
          error: 'No actions selected for code generation',
        };
      }

      // Sort chronologically so compression rules work correctly
      selectedActions.sort((a, b) => a.timestamp - b.timestamp);

      // Compress actions to reduce token usage
      const compressor = getActionCompressor();
      const { compressed, stats: compressionStats } = compressor.compress(selectedActions);
      console.log(`[AIGenerator] Action compression: ${compressionStats.before} → ${compressionStats.after} actions`);

      // Mask sensitive data
      const maskingService = getDataMaskingService();
      const { maskedActions, dictionary } = maskingService.maskActions(compressed);
      const maskedCount = Object.keys(dictionary).length;

      // For code generation, we use two-pass for larger action sets
      const simplifiedActions = this.simplifyActionsForPrompt(maskedActions);
      const actionsJson = JSON.stringify(simplifiedActions, null, 2);
      const completionService = getAICompletionService();
      let totalTokensUsed = 0;
      let totalInputTokens = 0;
      let totalOutputTokens = 0;

      // Save prompt and actions
      const savedFiles = savePromptAndActions(
        'code-new',
        CODE_PLAN_PROMPT.system,
        CODE_PLAN_PROMPT.userTemplate(actionsJson, framework, language, testName),
        simplifiedActions
      );

      // Estimate if we need two-pass (>30 actions or >20K estimated tokens)
      const estimatedTokens = completionService.estimateTokens(actionsJson);
      const useTwoPass = maskedActions.length > 30 || estimatedTokens > 20000;

      let code: string;

      if (useTwoPass) {
        // ---- Pass 1: Plan the code structure ----
        console.log('[AIGenerator] Code Pass 1: Planning code structure...');
        const planPrompt = CODE_PLAN_PROMPT.userTemplate(actionsJson, framework, language, testName);
        const planResponse = await completionService.completeWithFallback({
          prompt: planPrompt,
          systemPrompt: CODE_PLAN_PROMPT.system,
          temperature: 0.5,
        });
        totalTokensUsed += planResponse.tokensUsed || 0;
        totalInputTokens += planResponse.inputTokens || 0;
        totalOutputTokens += planResponse.outputTokens || 0;

        // Parse the plan
        let blockNames: string[] = [];
        try {
          const jsonMatch = planResponse.content.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (Array.isArray(parsed)) {
              blockNames = parsed.map((b: { name?: string }) => b.name || '').filter(Boolean);
            }
          }
        } catch {
          console.warn('[AIGenerator] Failed to parse code plan, falling back to single-pass');
        }

        if (blockNames.length > 0) {
          // ---- Pass 2: Generate code in chunks ----
          const CHUNK_SIZE = 3;
          const codeChunks: string[] = [];

          for (let i = 0; i < blockNames.length; i += CHUNK_SIZE) {
            const chunk = blockNames.slice(i, i + CHUNK_SIZE);
            console.log(`[AIGenerator] Code Pass 2: Generating blocks ${i + 1}-${Math.min(i + CHUNK_SIZE, blockNames.length)}/${blockNames.length}`);

            const detailPrompt = CODE_DETAIL_PROMPT.userTemplate(actionsJson, framework, language, testName, chunk);
            const detailResponse = await completionService.completeWithFallback({
              prompt: detailPrompt,
              systemPrompt: CODE_DETAIL_PROMPT.system,
              maxTokens: 8192,
              temperature: 0.5,
              stream: true,
              onChunk: (_chunk, accumulated) => {
                console.log(`[AIGenerator] Streaming code chunk: ${accumulated.length} chars received`);
              },
            });
            totalTokensUsed += detailResponse.tokensUsed || 0;
            totalInputTokens += detailResponse.inputTokens || 0;
            totalOutputTokens += detailResponse.outputTokens || 0;

            const unmaskedCode = maskingService.unmaskText(detailResponse.content, dictionary);
            const validation = validateGeneratedCode(unmaskedCode, framework);
            codeChunks.push(validation.cleaned);
          }

          code = codeChunks.join('\n\n');
          console.log(`[AIGenerator] Two-pass code generation: ${blockNames.length} blocks in ${Math.ceil(blockNames.length / CHUNK_SIZE)} chunks`);
        } else {
          // Fallback to single-pass if plan parsing failed
          const prompt = CODE_GENERATION_PROMPT.userTemplate(actionsJson, framework, language, testName);
          const response = await completionService.completeWithFallback({
            prompt,
            systemPrompt: CODE_GENERATION_PROMPT.system,
            maxTokens: 8192,
            temperature: 0.5,
          });
          totalTokensUsed += response.tokensUsed || 0;
          totalInputTokens += response.inputTokens || 0;
          totalOutputTokens += response.outputTokens || 0;
          code = maskingService.unmaskText(response.content, dictionary);
          const validation = validateGeneratedCode(code, framework);
          code = validation.cleaned;
        }
      } else {
        // Single-pass for smaller action sets
        const prompt = CODE_GENERATION_PROMPT.userTemplate(actionsJson, framework, language, testName);
        const response = await completionService.completeWithFallback({
          prompt,
          systemPrompt: CODE_GENERATION_PROMPT.system,
          maxTokens: 8192,
          temperature: 0.5,
        });
        totalTokensUsed += response.tokensUsed || 0;
        totalInputTokens += response.inputTokens || 0;
        totalOutputTokens += response.outputTokens || 0;
        code = maskingService.unmaskText(response.content, dictionary);
        const validation = validateGeneratedCode(code, framework);
        if (!validation.valid) {
          console.warn('[AIGenerator] Code validation issues:', validation.issues);
        }
        code = validation.cleaned;
      }

      // Add header
      const header = buildCodeHeader(framework, language, testName);
      code = header + code;

      console.log(`[AIGenerator] Generated ${code.split('\n').length} lines of code`);

      return {
        success: true,
        type: 'code-new',
        code: {
          code,
          framework,
          language,
        },
        promptFilePath: savedFiles?.promptFilePath,
        actionsFilePath: savedFiles?.actionsFilePath,
        tokensUsed: totalTokensUsed,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        maskedCount,
      };
    } catch (error) {
      console.error('[AIGenerator] Code generation failed:', error);
      return {
        success: false,
        type: 'code-new',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Optimize existing code using AI
   */
  async optimizeCode(options: AIGenerationOptions): Promise<AIGenerationResult> {
    try {
      console.log(`[AIGenerator] Optimizing code for session ${options.sessionId}`);
      
      const framework = options.framework || 'playwright';
      const language = options.language || 'typescript';
      const existingCode = options.existingCode;

      if (!existingCode) {
        return {
          success: false,
          type: 'code-optimize',
          error: 'No existing code provided for optimization',
        };
      }

      // Mask sensitive data in the existing code
      const maskingService = getDataMaskingService();
      
      // Create a fake action to use the masking logic on the code
      const maskedCode = this.maskCodeString(existingCode, maskingService);
      const dictionary: MaskingDictionary = {};

      // Get additional context from selected actions if provided
      let additionalContext = '';
      if (options.selectedActionIds.length > 0) {
        const allActions = await this.getActions(options.sessionId);
        const selectedActions = allActions.filter(a => options.selectedActionIds.includes(a.id));
        if (selectedActions.length > 0) {
          const compressor = getActionCompressor();
          const { stats: compressionStats } = compressor.compress(selectedActions);
          additionalContext = `This code was generated from ${compressionStats.after} recorded user actions (compressed from ${compressionStats.before}), including navigation, clicks, and form inputs.`;
        }
      }

      const prompt = CODE_OPTIMIZATION_PROMPT.userTemplate(maskedCode.masked, framework, additionalContext);

      // Save prompt and code (for optimization, we save the code instead of actions)
      const savedFiles = savePromptAndActions(
        'code-optimize',
        CODE_OPTIMIZATION_PROMPT.system,
        prompt,
        [{ existingCode: maskedCode.masked }]
      );

      const completionService = getAICompletionService();
      const response = await completionService.completeWithFallback({
        prompt,
        systemPrompt: CODE_OPTIMIZATION_PROMPT.system,
        maxTokens: 8192,
        temperature: 0.3,
      });

      // Unmask the response
      const optimizedCode = this.unmaskCodeString(response.content, maskedCode.dictionary);

      // Parse the optimization response
      const optimizationResult = parseOptimizationResponse(optimizedCode);

      console.log(`[AIGenerator] Optimized code with ${optimizationResult.changes.length} changes`);

      return {
        success: true,
        type: 'code-optimize',
        code: {
          code: optimizationResult.optimizedCode,
          framework,
          language,
          changes: optimizationResult.changes,
        },
        promptFilePath: savedFiles?.promptFilePath,
        actionsFilePath: savedFiles?.actionsFilePath,
        tokensUsed: response.tokensUsed,
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        maskedCount: Object.keys(dictionary).length,
      };
    } catch (error) {
      console.error('[AIGenerator] Code optimization failed:', error);
      return {
        success: false,
        type: 'code-optimize',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get all actions for a session (batched fetch, chronological order)
   */
  private async getActions(sessionId: string): Promise<RecordedAction[]> {
    const eventStore = getEventStore();
    return eventStore.getAllActionsBySession(sessionId);
  }

  /**
   * Simplify actions for the prompt (remove unnecessary data)
   */
  private simplifyActionsForPrompt(actions: RecordedAction[]): Array<Record<string, unknown>> {
    return actions.map(action => ({
      type: action.type,
      timestamp: action.timestamp,
      url: action.tabUrl,
      element: action.element ? {
        tagName: action.element.tagName,
        selector: action.element.selector,
        text: action.element.text?.substring(0, 100),
        id: action.element.id,
        type: action.element.attributes?.type,
        name: action.element.attributes?.name,
        placeholder: action.element.attributes?.placeholder,
      } : undefined,
      data: {
        value: action.data.value,
        key: action.data.key,
        url: action.data.url,
        selectedText: action.data.selectedText,
        assertionType: action.data.assertionType,
        expectedText: action.data.expectedText,
      },
    }));
  }

  /**
   * Extract form field names from actions
   */
  private extractFormFields(actions: RecordedAction[]): string[] {
    const fields = new Set<string>();
    
    for (const action of actions) {
      if (action.type === 'type' || action.type === 'change') {
        const name = action.element?.attributes?.name || 
                    action.element?.attributes?.placeholder ||
                    action.element?.id;
        if (name) {
          fields.add(name);
        }
      }
    }

    return [...fields];
  }

  /**
   * Mask sensitive data in a code string
   */
  private maskCodeString(code: string, maskingService: typeof getDataMaskingService extends () => infer T ? T : never): {
    masked: string;
    dictionary: MaskingDictionary;
  } {
    // Use patterns to mask directly in the code
    const dictionary: MaskingDictionary = {};
    let masked = code;
    let counter = 0;

    // Mask email addresses
    masked = masked.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, (match) => {
      const placeholder = `__MASKED_EMAIL_${++counter}__`;
      dictionary[placeholder] = match;
      return placeholder;
    });

    // Mask strings that look like passwords in code (single or double quoted)
    // This is a simple heuristic - look for password-like variable assignments
    masked = masked.replace(/(password|pwd|secret|api_key|apiKey)\s*[:=]\s*['"]([^'"]+)['"]/gi, (match, key, value) => {
      const placeholder = `__MASKED_PASSWORD_${++counter}__`;
      dictionary[placeholder] = value;
      return `${key}${match.includes(':') ? ':' : '='}'${placeholder}'`;
    });

    return { masked, dictionary };
  }

  /**
   * Unmask code string
   */
  private unmaskCodeString(code: string, dictionary: MaskingDictionary): string {
    let unmasked = code;
    
    for (const [placeholder, original] of Object.entries(dictionary)) {
      const escapedPlaceholder = placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      unmasked = unmasked.replace(new RegExp(escapedPlaceholder, 'g'), original);
    }

    return unmasked;
  }
}

// Singleton instance
let aiGenerator: AIGenerator | null = null;

export function getAIGenerator(): AIGenerator {
  if (!aiGenerator) {
    aiGenerator = new AIGenerator();
  }
  return aiGenerator;
}

export { AIGenerator };
