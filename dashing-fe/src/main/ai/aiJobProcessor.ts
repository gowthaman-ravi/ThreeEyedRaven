/**
 * AI Job Processor
 * 
 * Manages background processing of AI generation jobs with support for
 * cancellation, progress tracking, and automatic resume on startup.
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { getEventStore, AIGenerationJob } from '../eventStore';
import { getAIGenerator, AIGenerationResult } from './aiGenerator';
import { getAIService, AIProviderId } from './aiService';

export interface CreateJobOptions {
  sessionId: string;
  sessionName: string;
  type: 'test-cases' | 'code-new' | 'code-optimize';
  providerId?: string;
  model?: string;
  framework?: string;
  language?: string;
  selectedActionIds: string[];
  existingCode?: string;
  /** Custom system instructions for test-case generation (persona only). */
  customInstructions?: string;
}

export interface JobStatusEvent {
  jobId: string;
  status: AIGenerationJob['status'];
  progress?: number;
  completedBatches?: number;
  totalBatches?: number;
  result?: unknown;
  error?: string;
  debugFilePath?: string;
  promptFilePath?: string;
  actionsFilePath?: string;
}

class AIJobProcessor extends EventEmitter {
  private activeJobs: Map<string, AbortController> = new Map();
  private processingQueue: Set<string> = new Set();
  private isProcessing = false;

  constructor() {
    super();
  }

  /**
   * Create a new AI generation job and queue it for processing
   */
  async createJob(options: CreateJobOptions): Promise<string> {
    const eventStore = getEventStore();
    const aiService = getAIService();
    
    // Get provider and model (use provided or get active)
    let providerId = options.providerId;
    let model = options.model;
    
    if (!providerId) {
      const activeProvider = aiService.getActiveProvider();
      if (!activeProvider) {
        throw new Error('No AI provider configured. Please configure an AI provider in Settings.');
      }
      providerId = activeProvider.id;
      model = activeProvider.selectedModel;
    }
    
    if (!model) {
      const provider = aiService.getProvider(providerId as AIProviderId);
      model = provider?.selectedModel || '';
    }

    const jobId = uuidv4();
    
    await eventStore.createAIJob({
      id: jobId,
      sessionId: options.sessionId,
      sessionName: options.sessionName,
      type: options.type,
      providerId,
      model,
      options: {
        framework: options.framework,
        language: options.language,
        selectedActionIds: options.selectedActionIds,
        existingCode: options.existingCode,
        customInstructions: options.customInstructions,
      },
    });

    console.log(`[AIJobProcessor] Created job ${jobId} for session ${options.sessionId}`);

    // Start processing the job
    this.queueJob(jobId);

    return jobId;
  }

  /**
   * Queue a job for processing
   */
  private queueJob(jobId: string): void {
    if (!this.processingQueue.has(jobId)) {
      this.processingQueue.add(jobId);
      this.processNextJob();
    }
  }

  /**
   * Process the next job in the queue
   */
  private async processNextJob(): Promise<void> {
    if (this.isProcessing) return;

    const nextJobId = this.processingQueue.values().next().value;
    if (!nextJobId) return;

    this.isProcessing = true;
    this.processingQueue.delete(nextJobId);

    try {
      await this.processJob(nextJobId);
    } catch (error) {
      console.error(`[AIJobProcessor] Error processing job ${nextJobId}:`, error);
    } finally {
      this.isProcessing = false;
      // Process next job if any
      if (this.processingQueue.size > 0) {
        setImmediate(() => this.processNextJob());
      }
    }
  }

  /**
   * Process a single job
   */
  private async processJob(jobId: string): Promise<void> {
    const eventStore = getEventStore();
    const job = await eventStore.getAIJob(jobId);

    if (!job) {
      console.error(`[AIJobProcessor] Job ${jobId} not found`);
      return;
    }

    if (job.status !== 'pending') {
      console.log(`[AIJobProcessor] Job ${jobId} is not pending (status: ${job.status})`);
      return;
    }

    // Create abort controller for this job
    const abortController = new AbortController();
    this.activeJobs.set(jobId, abortController);

    try {
      // Update status to in_progress
      await eventStore.updateAIJobStatus(jobId, 'in_progress');
      this.emitStatusUpdate(jobId, 'in_progress');

      console.log(`[AIJobProcessor] Starting job ${jobId} (${job.type})`);

      // Run the generation
      const result = await this.runGeneration(job, abortController.signal);

      // Check if cancelled during processing
      if (abortController.signal.aborted) {
        console.log(`[AIJobProcessor] Job ${jobId} was cancelled`);
        return;
      }

      if (result.success) {
        // Store the result
        await eventStore.updateAIJobStatus(jobId, 'completed', {
          result: JSON.stringify(result),
          tokensUsed: result.tokensUsed,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          promptFilePath: result.promptFilePath,
          actionsFilePath: result.actionsFilePath,
        });

        console.log(`[AIJobProcessor] Job ${jobId} completed successfully`);
        this.emitStatusUpdate(jobId, 'completed', { 
          result,
          promptFilePath: result.promptFilePath,
          actionsFilePath: result.actionsFilePath,
        });
      } else {
        await eventStore.updateAIJobStatus(jobId, 'failed', {
          error: result.error || 'Unknown error',
          debugFilePath: result.debugFilePath,
          promptFilePath: result.promptFilePath,
          actionsFilePath: result.actionsFilePath,
          tokensUsed: result.tokensUsed,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
        });

        console.error(`[AIJobProcessor] Job ${jobId} failed: ${result.error}`);
        if (result.debugFilePath) {
          console.log(`[AIJobProcessor] Debug file saved: ${result.debugFilePath}`);
        }
        this.emitStatusUpdate(jobId, 'failed', { 
          error: result.error, 
          debugFilePath: result.debugFilePath,
          promptFilePath: result.promptFilePath,
          actionsFilePath: result.actionsFilePath,
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Check if this was a cancellation
      if (abortController.signal.aborted) {
        await eventStore.updateAIJobStatus(jobId, 'cancelled');
        console.log(`[AIJobProcessor] Job ${jobId} cancelled`);
        this.emitStatusUpdate(jobId, 'cancelled');
      } else {
        await eventStore.updateAIJobStatus(jobId, 'failed', {
          error: errorMessage,
        });
        console.error(`[AIJobProcessor] Job ${jobId} failed with error: ${errorMessage}`);
        this.emitStatusUpdate(jobId, 'failed', { error: errorMessage });
      }
    } finally {
      this.activeJobs.delete(jobId);
    }
  }

  /**
   * Run the actual AI generation
   */
  private async runGeneration(
    job: AIGenerationJob,
    signal: AbortSignal
  ): Promise<AIGenerationResult> {
    const aiGenerator = getAIGenerator();
    const eventStore = getEventStore();

    // Wrap the generation with abort signal checking
    const checkAbort = () => {
      if (signal.aborted) {
        throw new Error('Generation cancelled by user');
      }
    };

    checkAbort();

    const options = {
      sessionId: job.sessionId,
      selectedActionIds: job.options.selectedActionIds || [],
      type: job.type,
      framework: job.options.framework as 'playwright' | 'cypress' | undefined,
      language: job.options.language as 'typescript' | 'javascript' | undefined,
      existingCode: job.options.existingCode,
      customInstructions: job.options.customInstructions,
      testName: job.sessionName,
      // Pass progress callback for batch updates
      onProgress: async (progress: { completedBatches: number; totalBatches: number }) => {
        checkAbort();
        const percent = Math.round((progress.completedBatches / progress.totalBatches) * 100);
        await eventStore.updateAIJobProgress(job.id, {
          completedBatches: progress.completedBatches,
          totalBatches: progress.totalBatches,
          progress: percent,
        });
        this.emitStatusUpdate(job.id, 'in_progress', {
          progress: percent,
          completedBatches: progress.completedBatches,
          totalBatches: progress.totalBatches,
        });
      },
    };

    let result: AIGenerationResult;

    switch (job.type) {
      case 'test-cases':
        result = await aiGenerator.generateTestCases(options);
        break;
      case 'code-new':
        result = await aiGenerator.generateCode(options);
        break;
      case 'code-optimize':
        result = await aiGenerator.optimizeCode(options);
        break;
      default:
        throw new Error(`Unknown job type: ${job.type}`);
    }

    checkAbort();
    return result;
  }

  /**
   * Cancel an in-progress job
   */
  async cancelJob(jobId: string): Promise<boolean> {
    const controller = this.activeJobs.get(jobId);
    
    if (controller) {
      console.log(`[AIJobProcessor] Cancelling job ${jobId}`);
      controller.abort();
      
      // Update status in database
      const eventStore = getEventStore();
      await eventStore.updateAIJobStatus(jobId, 'cancelled');
      this.emitStatusUpdate(jobId, 'cancelled');
      
      return true;
    }

    // Check if job is in queue but not yet processing
    if (this.processingQueue.has(jobId)) {
      this.processingQueue.delete(jobId);
      
      const eventStore = getEventStore();
      await eventStore.updateAIJobStatus(jobId, 'cancelled');
      this.emitStatusUpdate(jobId, 'cancelled');
      
      console.log(`[AIJobProcessor] Removed job ${jobId} from queue`);
      return true;
    }

    return false;
  }

  /**
   * Retry a failed or cancelled job
   */
  async retryJob(jobId: string, updates?: {
    providerId?: string;
    model?: string;
  }): Promise<void> {
    const eventStore = getEventStore();
    
    // Reset the job status
    await eventStore.retryAIJob(jobId, updates);
    
    console.log(`[AIJobProcessor] Retrying job ${jobId}`);
    
    // Queue it for processing
    this.queueJob(jobId);
  }

  /**
   * Resume any pending or in_progress jobs on startup
   */
  async resumePendingJobs(): Promise<void> {
    const eventStore = getEventStore();
    const jobs = await eventStore.getResumableAIJobs();

    if (jobs.length === 0) {
      console.log('[AIJobProcessor] No jobs to resume');
      return;
    }

    console.log(`[AIJobProcessor] Resuming ${jobs.length} pending jobs`);

    // Reset in_progress jobs to pending (they were interrupted)
    for (const job of jobs) {
      if (job.status === 'in_progress') {
        await eventStore.updateAIJobStatus(job.id, 'pending');
      }
      this.queueJob(job.id);
    }
  }

  /**
   * Get list of active job IDs
   */
  getActiveJobIds(): string[] {
    return Array.from(this.activeJobs.keys());
  }

  /**
   * Check if a job is currently being processed
   */
  isJobActive(jobId: string): boolean {
    return this.activeJobs.has(jobId) || this.processingQueue.has(jobId);
  }

  /**
   * Emit a status update event
   */
  private emitStatusUpdate(
    jobId: string,
    status: AIGenerationJob['status'],
    data?: Partial<JobStatusEvent>
  ): void {
    const event: JobStatusEvent = {
      jobId,
      status,
      ...data,
    };
    this.emit('jobStatus', event);
  }
}

// Singleton instance
let jobProcessor: AIJobProcessor | null = null;

export function getAIJobProcessor(): AIJobProcessor {
  if (!jobProcessor) {
    jobProcessor = new AIJobProcessor();
  }
  return jobProcessor;
}

export { AIJobProcessor };
