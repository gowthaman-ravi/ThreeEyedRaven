/**
 * PlaywrightGenerator - Main orchestrator for Playwright code generation
 * 
 * Coordinates the code generation pipeline:
 * 1. Fetch actions from EventStore
 * 2. Detect pages using PageDetector
 * 3. Generate files using TemplateEngine
 * 4. Write files using FileWriter
 */

import { RecordedAction } from '../../shared/types';
import { getEventStore } from '../eventStore';
import { PageDetector, DetectedPage, PageDetectionResult } from './pageDetector';
import { TemplateEngine, GeneratedFile } from './templateEngine';
import { FileWriter, WriteResult, ProjectMetadata } from './fileWriter';

export interface GenerateRequest {
  sessionId: string;
  testName: string;
  framework: 'playwright';
  language: 'typescript';
}

export interface GenerateResult {
  success: boolean;
  outputPath?: string;
  filesGenerated?: string[];
  pagesDetected?: string[];
  error?: string;
}

export interface PreviewResult {
  pages: {
    className: string;
    fileName: string;
    url: string;
    actionCount: number;
  }[];
  totalActions: number;
  estimatedFiles: number;
}

export class PlaywrightGenerator {
  private pageDetector: PageDetector;
  private templateEngine: TemplateEngine;
  private fileWriter: FileWriter;

  constructor() {
    this.pageDetector = new PageDetector();
    this.templateEngine = new TemplateEngine();
    this.fileWriter = new FileWriter();
  }

  /**
   * Preview what will be generated without writing files
   */
  async preview(sessionId: string): Promise<PreviewResult> {
    const actions = await this.fetchActions(sessionId);
    const detection = this.pageDetector.detect(actions);
    
    return {
      pages: detection.pages.map(p => ({
        className: p.className,
        fileName: p.fileName,
        url: p.url,
        actionCount: p.actions.length,
      })),
      totalActions: detection.totalActions,
      // Locators + Page class per page, plus test file, config, package.json, tsconfig
      estimatedFiles: detection.pages.length * 2 + 4,
    };
  }

  /**
   * Generate Playwright code for a session
   */
  async generate(request: GenerateRequest): Promise<GenerateResult> {
    try {
      // 1. Fetch actions
      console.log(`[PlaywrightGenerator] Fetching actions for session: ${request.sessionId}`);
      const actions = await this.fetchActions(request.sessionId);
      
      if (actions.length === 0) {
        return {
          success: false,
          error: 'No actions found for this session',
        };
      }

      // 2. Detect pages
      console.log(`[PlaywrightGenerator] Detecting pages from ${actions.length} actions`);
      const detection = this.pageDetector.detect(actions);
      
      if (detection.pages.length === 0) {
        return {
          success: false,
          error: 'Could not detect any pages from actions',
        };
      }

      console.log(`[PlaywrightGenerator] Detected ${detection.pages.length} pages`);

      // 3. Generate files
      const files = this.generateFiles(detection, request.testName);
      console.log(`[PlaywrightGenerator] Generated ${files.length} files`);

      // 4. Write files
      const baseUrl = this.extractBaseUrl(detection.pages);
      const writeResult = await this.fileWriter.writeProject(
        request.testName,
        files,
        {
          name: request.testName,
          sessionId: request.sessionId,
          framework: request.framework,
          language: request.language,
          pagesCount: detection.pages.length,
          actionsCount: detection.totalActions,
        }
      );

      if (!writeResult.success) {
        return {
          success: false,
          error: writeResult.error || 'Failed to write files',
        };
      }

      console.log(`[PlaywrightGenerator] Files written to: ${writeResult.outputPath}`);

      return {
        success: true,
        outputPath: writeResult.outputPath,
        filesGenerated: writeResult.filesWritten,
        pagesDetected: detection.pages.map(p => p.className),
      };
    } catch (error) {
      console.error('[PlaywrightGenerator] Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * List all generated projects
   */
  async listProjects(): Promise<ProjectMetadata[]> {
    return this.fileWriter.listProjects();
  }

  /**
   * Delete a generated project
   */
  async deleteProject(projectPath: string): Promise<boolean> {
    return this.fileWriter.deleteProject(projectPath);
  }

  /**
   * Get the base output directory
   */
  getOutputDir(): string {
    return this.fileWriter.getBaseDir();
  }

  /**
   * Fetch actions from EventStore
   */
  private async fetchActions(sessionId: string): Promise<RecordedAction[]> {
    const eventStore = getEventStore();
    return eventStore.getActionsBySession(sessionId, 2000);
  }

  /**
   * Generate all files for the project
   */
  private generateFiles(detection: PageDetectionResult, testName: string): GeneratedFile[] {
    const files: GeneratedFile[] = [];

    // Generate files for each page
    for (const page of detection.pages) {
      // Locators file
      files.push(this.templateEngine.generateLocatorsFile(page));
      
      // Page class file
      files.push(this.templateEngine.generatePageFile(page));
    }

    // Generate test file
    files.push(this.templateEngine.generateTestFile(detection.pages, testName));

    // Generate config files
    const baseUrl = this.extractBaseUrl(detection.pages);
    files.push(this.templateEngine.generatePlaywrightConfig(baseUrl));
    files.push(this.templateEngine.generatePackageJson(testName));
    files.push(this.templateEngine.generateTsConfig());

    return files;
  }

  /**
   * Extract base URL from pages
   */
  private extractBaseUrl(pages: DetectedPage[]): string {
    if (pages.length === 0) return 'http://localhost:3000';
    
    try {
      const url = new URL(pages[0].url);
      return `${url.protocol}//${url.host}`;
    } catch {
      return 'http://localhost:3000';
    }
  }
}

// Singleton instance
let generatorInstance: PlaywrightGenerator | null = null;

export function getPlaywrightGenerator(): PlaywrightGenerator {
  if (!generatorInstance) {
    generatorInstance = new PlaywrightGenerator();
  }
  return generatorInstance;
}

