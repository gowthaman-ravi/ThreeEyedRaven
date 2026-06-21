/**
 * AI Completion Service
 * 
 * Provides a unified interface for making completion requests to
 * OpenAI, Anthropic, and Gemini with auto-fallback support.
 */

import { getAIService, AIProviderId, AIProviderConfig } from './aiService';
import { RecordedAction } from '../../shared/types';

export interface AICompletionRequest {
  prompt: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
  onChunk?: (chunk: string, accumulated: string) => void;
}

export interface AICompletionResponse {
  content: string;
  provider: AIProviderId;
  model: string;
  tokensUsed?: number;
  inputTokens?: number;
  outputTokens?: number;
  streamed?: boolean;
}

export interface BatchResult<T> {
  results: T[];
  batchCount: number;
  totalTokensUsed: number;
}

const DEFAULT_MAX_TOKENS = 16384;
const DEFAULT_TEMPERATURE = 0.7;
const ESTIMATED_CHARS_PER_TOKEN = 4;
const MAX_TOKENS_PER_BATCH = 100000; // Conservative limit for context window

class AICompletionService {
  /**
   * Estimate token count for a string
   */
  estimateTokens(text: string): number {
    return Math.ceil(text.length / ESTIMATED_CHARS_PER_TOKEN);
  }

  /**
   * Split actions into batches based on estimated token count
   */
  splitIntoBatches(actions: RecordedAction[], maxTokensPerBatch: number = MAX_TOKENS_PER_BATCH): RecordedAction[][] {
    const batches: RecordedAction[][] = [];
    let currentBatch: RecordedAction[] = [];
    let currentTokens = 0;

    for (const action of actions) {
      const actionTokens = this.estimateTokens(JSON.stringify(action));
      
      if (currentTokens + actionTokens > maxTokensPerBatch && currentBatch.length > 0) {
        batches.push(currentBatch);
        currentBatch = [];
        currentTokens = 0;
      }
      
      currentBatch.push(action);
      currentTokens += actionTokens;
    }

    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }

    console.log(`[AICompletion] Split ${actions.length} actions into ${batches.length} batches`);
    return batches;
  }

  /**
   * Make a completion request to the active provider
   */
  async complete(request: AICompletionRequest): Promise<AICompletionResponse> {
    const aiService = getAIService();
    const provider = aiService.getActiveProvider();

    if (!provider) {
      throw new Error('No AI provider configured. Please set up an AI provider in Settings > Integrations.');
    }

    return this.completeWithProvider(provider, request);
  }

  /**
   * Make a completion request with auto-fallback to next provider on failure
   */
  async completeWithFallback(request: AICompletionRequest): Promise<AICompletionResponse> {
    const aiService = getAIService();
    let provider = aiService.getActiveProvider();
    const errors: string[] = [];

    while (provider) {
      try {
        return await this.completeWithProvider(provider, request);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`[AICompletion] Provider ${provider.id} failed:`, errorMsg);
        errors.push(`${provider.id}: ${errorMsg}`);
        
        // Try next fallback provider
        if (aiService.getSettings().autoFallback) {
          provider = aiService.getNextFallbackProvider(provider.id);
          if (provider) {
            console.log(`[AICompletion] Falling back to ${provider.id}`);
          }
        } else {
          break;
        }
      }
    }

    throw new Error(`All AI providers failed:\n${errors.join('\n')}`);
  }

  /**
   * Make a completion request to a specific provider
   */
  private async completeWithProvider(
    provider: AIProviderConfig,
    request: AICompletionRequest
  ): Promise<AICompletionResponse> {
    const aiService = getAIService();
    const apiKey = aiService.getApiKey(provider.id);

    if (!apiKey) {
      throw new Error(`No API key found for ${provider.name}`);
    }

    const maxTokens = request.maxTokens ?? DEFAULT_MAX_TOKENS;
    const temperature = request.temperature ?? DEFAULT_TEMPERATURE;
    if (request.stream && request.onChunk) {
      const chunkCallback = request.onChunk;
      switch (provider.id) {
        case 'openai':
          return this.streamOpenAI(apiKey, provider.selectedModel, request.prompt, request.systemPrompt, maxTokens, temperature, chunkCallback);
        case 'anthropic':
          return this.streamAnthropic(apiKey, provider.selectedModel, request.prompt, request.systemPrompt, maxTokens, temperature, chunkCallback);
        case 'gemini':
          console.log('[AICompletion] Gemini streaming not supported, using non-streaming');
          return this.completeGemini(apiKey, provider.selectedModel, request.prompt, request.systemPrompt, maxTokens, temperature);
        default:
          throw new Error(`Unknown provider: ${provider.id}`);
      }
    }

    switch (provider.id) {
      case 'openai':
        return this.completeOpenAI(apiKey, provider.selectedModel, request.prompt, request.systemPrompt, maxTokens, temperature);
      case 'anthropic':
        return this.completeAnthropic(apiKey, provider.selectedModel, request.prompt, request.systemPrompt, maxTokens, temperature);
      case 'gemini':
        return this.completeGemini(apiKey, provider.selectedModel, request.prompt, request.systemPrompt, maxTokens, temperature);
      default:
        throw new Error(`Unknown provider: ${provider.id}`);
    }
  }

  /**
   * OpenAI completion
   */
  private async completeOpenAI(
    apiKey: string,
    model: string,
    prompt: string,
    systemPrompt?: string,
    maxTokens?: number,
    temperature?: number
  ): Promise<AICompletionResponse> {
    const messages: Array<{ role: string; content: string }> = [];
    
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens,
        temperature,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || `OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    return {
      content: data.choices[0]?.message?.content || '',
      provider: 'openai',
      model,
      tokensUsed: data.usage?.total_tokens,
      inputTokens: data.usage?.prompt_tokens,
      outputTokens: data.usage?.completion_tokens,
    };
  }

  /**
   * Anthropic completion
   */
  private async completeAnthropic(
    apiKey: string,
    model: string,
    prompt: string,
    systemPrompt?: string,
    maxTokens?: number,
    temperature?: number
  ): Promise<AICompletionResponse> {
    const body: Record<string, unknown> = {
      model,
      max_tokens: maxTokens || 4096,
      messages: [{ role: 'user', content: prompt }],
    };

    if (systemPrompt) {
      body.system = systemPrompt;
    }
    if (temperature !== undefined) {
      body.temperature = temperature;
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || `Anthropic API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.content?.[0]?.text || '';
    const inputTokens = data.usage?.input_tokens || 0;
    const outputTokens = data.usage?.output_tokens || 0;
    return {
      content,
      provider: 'anthropic',
      model,
      tokensUsed: inputTokens + outputTokens,
      inputTokens,
      outputTokens,
    };
  }

  /**
   * Gemini completion
   */
  private async completeGemini(
    apiKey: string,
    model: string,
    prompt: string,
    systemPrompt?: string,
    maxTokens?: number,
    temperature?: number
  ): Promise<AICompletionResponse> {
    const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];

    // Gemini handles system prompts differently - prepend to first message
    const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
    contents.push({
      role: 'user',
      parts: [{ text: fullPrompt }],
    });

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature,
      },
    };

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || `Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return {
      content,
      provider: 'gemini',
      model,
      tokensUsed: data.usageMetadata?.totalTokenCount,
      inputTokens: data.usageMetadata?.promptTokenCount,
      outputTokens: data.usageMetadata?.candidatesTokenCount,
    };
  }

  /**
   * OpenAI streaming completion
   */
  private async streamOpenAI(
    apiKey: string,
    model: string,
    prompt: string,
    systemPrompt: string | undefined,
    maxTokens: number,
    temperature: number,
    onChunk: (chunk: string, accumulated: string) => void
  ): Promise<AICompletionResponse> {
    const messages: Array<{ role: string; content: string }> = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens,
        temperature,
        stream: true,
        stream_options: { include_usage: true },
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || `OpenAI API error: ${response.status}`);
    }

    return this.processSSEStream(response, 'openai', model, (event: string) => {
      try {
        if (event === '[DONE]') return null;
        const parsed = JSON.parse(event);
        return parsed.choices?.[0]?.delta?.content || null;
      } catch {
        return null;
      }
    }, (event: string) => {
      try {
        if (event === '[DONE]') return null;
        const parsed = JSON.parse(event);
        if (parsed.usage) {
          return {
            inputTokens: parsed.usage.prompt_tokens,
            outputTokens: parsed.usage.completion_tokens,
            totalTokens: parsed.usage.total_tokens,
          };
        }
        return null;
      } catch {
        return null;
      }
    }, onChunk);
  }

  /**
   * Anthropic streaming completion
   */
  private async streamAnthropic(
    apiKey: string,
    model: string,
    prompt: string,
    systemPrompt: string | undefined,
    maxTokens: number,
    temperature: number,
    onChunk: (chunk: string, accumulated: string) => void
  ): Promise<AICompletionResponse> {
    const body: Record<string, unknown> = {
      model,
      max_tokens: maxTokens || 4096,
      messages: [{ role: 'user', content: prompt }],
      stream: true,
    };

    if (systemPrompt) {
      body.system = systemPrompt;
    }
    if (temperature !== undefined) {
      body.temperature = temperature;
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || `Anthropic API error: ${response.status}`);
    }

    return this.processSSEStream(response, 'anthropic', model, (event: string) => {
      try {
        const parsed = JSON.parse(event);
        if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
          return parsed.delta.text;
        }
        return null;
      } catch {
        return null;
      }
    }, (event: string) => {
      try {
        const parsed = JSON.parse(event);
        if (parsed.type === 'message_start' && parsed.message?.usage) {
          return { inputTokens: parsed.message.usage.input_tokens, outputTokens: 0, totalTokens: 0 };
        }
        if (parsed.type === 'message_delta' && parsed.usage) {
          return { inputTokens: 0, outputTokens: parsed.usage.output_tokens, totalTokens: 0 };
        }
        return null;
      } catch {
        return null;
      }
    }, onChunk);
  }

  /**
   * Process an SSE stream and extract text chunks
   */
  private async processSSEStream(
    response: Response,
    provider: AIProviderId,
    model: string,
    extractChunk: (eventData: string) => string | null,
    extractUsage: (eventData: string) => { inputTokens: number; outputTokens: number; totalTokens: number } | null,
    onChunk: (chunk: string, accumulated: string) => void
  ): Promise<AICompletionResponse> {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body available for streaming');
    }

    const decoder = new TextDecoder();
    let accumulated = '';
    let buffer = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let totalTokens = 0;

    try {
      let streamDone = false;
      while (!streamDone) {
        const { done, value } = await reader.read();
        if (done) { streamDone = true; break; }

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE events
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const eventData = line.slice(6).trim();
          if (!eventData) continue;

          const chunk = extractChunk(eventData);
          if (chunk) {
            accumulated += chunk;
            onChunk(chunk, accumulated);
          }

          const usage = extractUsage(eventData);
          if (usage) {
            inputTokens += usage.inputTokens;
            outputTokens += usage.outputTokens;
            totalTokens += usage.totalTokens;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    const tokensUsed = totalTokens || (inputTokens + outputTokens) || undefined;

    return {
      content: accumulated,
      provider,
      model,
      tokensUsed,
      inputTokens: inputTokens || undefined,
      outputTokens: outputTokens || undefined,
      streamed: true,
    };
  }
}

// Singleton instance
let aiCompletionService: AICompletionService | null = null;

export function getAICompletionService(): AICompletionService {
  if (!aiCompletionService) {
    aiCompletionService = new AICompletionService();
  }
  return aiCompletionService;
}

export { AICompletionService };
