/**
 * Code Generation Module
 * 
 * Exports all code generation functionality for Playwright tests.
 */

export { LocatorBuilder, LocatorResult } from './locatorBuilder';
export { PageDetector, DetectedPage, PageDetectionResult } from './pageDetector';
export { TemplateEngine, GeneratedFile, LocatorEntry, PageMethod } from './templateEngine';
export { FileWriter, WriteResult, ProjectMetadata } from './fileWriter';
export { 
  PlaywrightGenerator, 
  getPlaywrightGenerator,
  GenerateRequest, 
  GenerateResult, 
  PreviewResult 
} from './playwrightGenerator';

