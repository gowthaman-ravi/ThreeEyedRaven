/**
 * TestCaseGenerator - Orchestrates test case generation from recorded sessions
 * 
 * Flow:
 * 1. Fetch actions from EventStore
 * 2. Analyze fields using FieldAnalyzer
 * 3. Generate test cases using RuleEngine
 * 4. Build Playwright code using PlaywrightBuilder
 * 5. Store in EventStore
 */

import { v4 as uuidv4 } from 'uuid';
import { RecordedAction } from '../../shared/types';
import { getEventStore } from '../eventStore';
import { FieldAnalyzer, AnalyzedField } from './fieldAnalyzer';
import { RuleEngine, TestCaseCategory, TestCasePriority } from './ruleEngine';
import { PlaywrightBuilder } from './playwrightBuilder';
import { NavigationPathFinder, TestStep } from './navigationPathFinder';

export type TestCaseStatus = 'pending' | 'passed' | 'failed' | 'skipped';

// TestStep is exported from navigationPathFinder.ts via index.ts barrel export

export interface GeneratedTestCase {
  id: string;
  sessionId: string;
  fieldId?: string;           // Optional for manual test cases
  fieldName?: string;         // Optional for manual test cases
  fieldSelector?: string;     // Optional for manual test cases
  category?: TestCaseCategory;
  name: string;
  description?: string;
  testValue?: string;
  expectedResult: string;
  priority: TestCasePriority;
  status: TestCaseStatus;
  notes?: string;
  playwrightCode?: string;
  prerequisiteSteps?: TestStep[];  // Actions to reach the field
  testActionStep?: TestStep;       // The actual test action
  source?: 'auto' | 'manual' | 'ai';  // Source of the test case
  steps?: string;                   // Manual test steps
  createdAt: number;
  updatedAt: number;
}

export interface GenerationResult {
  success: boolean;
  sessionId: string;
  testCases: GeneratedTestCase[];
  fieldsAnalyzed: number;
  error?: string;
}

export interface GenerationSummary {
  totalTestCases: number;
  byCategory: Record<TestCaseCategory, number>;
  byPriority: Record<TestCasePriority, number>;
  byField: { fieldName: string; count: number }[];
}

export class TestCaseGenerator {
  private fieldAnalyzer: FieldAnalyzer;
  private ruleEngine: RuleEngine;
  private playwrightBuilder: PlaywrightBuilder;
  private pathFinder: NavigationPathFinder;

  constructor() {
    this.fieldAnalyzer = new FieldAnalyzer();
    this.ruleEngine = new RuleEngine();
    this.playwrightBuilder = new PlaywrightBuilder();
    this.pathFinder = new NavigationPathFinder();
  }

  /**
   * Generate test cases for a session
   */
  async generateForSession(sessionId: string): Promise<GenerationResult> {
    try {
      console.log(`[TestCaseGenerator] Generating test cases for session: ${sessionId}`);
      
      // 1. Fetch actions
      const actions = await this.fetchActions(sessionId);
      if (actions.length === 0) {
        return {
          success: false,
          sessionId,
          testCases: [],
          fieldsAnalyzed: 0,
          error: 'No actions found for this session',
        };
      }

      // 2. Analyze fields
      const analysis = this.fieldAnalyzer.analyze(actions);
      if (analysis.fields.length === 0) {
        return {
          success: false,
          sessionId,
          testCases: [],
          fieldsAnalyzed: 0,
          error: 'No form fields found in recorded actions',
        };
      }

      console.log(`[TestCaseGenerator] Analyzed ${analysis.fields.length} fields`);

      // 3. Generate test cases with navigation paths
      const testCases = this.generateTestCasesFromFields(sessionId, analysis.fields, actions);
      console.log(`[TestCaseGenerator] Generated ${testCases.length} test cases`);

      // 4. Store in EventStore
      await this.storeTestCases(testCases);

      return {
        success: true,
        sessionId,
        testCases,
        fieldsAnalyzed: analysis.fields.length,
      };
    } catch (error) {
      console.error('[TestCaseGenerator] Error:', error);
      return {
        success: false,
        sessionId,
        testCases: [],
        fieldsAnalyzed: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get test cases for a session
   */
  async getTestCases(sessionId: string): Promise<GeneratedTestCase[]> {
    const eventStore = getEventStore();
    const rawCases = await eventStore.getTestCases(sessionId);
    
    // Cast string types from DB to the proper union types
    return rawCases.map(tc => ({
      ...tc,
      category: tc.category as TestCaseCategory | undefined,
      priority: tc.priority as TestCasePriority,
      status: tc.status as TestCaseStatus,
      prerequisiteSteps: tc.prerequisiteSteps as TestStep[] | undefined,
      testActionStep: tc.testActionStep as TestStep | undefined,
      source: tc.source as 'auto' | 'manual' | 'ai' | undefined,
      steps: tc.steps,
    }));
  }

  /**
   * Update test case status
   */
  async updateTestCaseStatus(
    testCaseId: string, 
    status: TestCaseStatus, 
    notes?: string
  ): Promise<boolean> {
    const eventStore = getEventStore();
    return eventStore.updateTestCaseStatus(testCaseId, status, notes);
  }

  /**
   * Get generation summary
   */
  getSummary(testCases: GeneratedTestCase[]): GenerationSummary {
    const byCategory: Record<TestCaseCategory, number> = {
      boundary: 0,
      negative: 0,
      security: 0,
      format: 0,
      required: 0,
      accessibility: 0,
    };

    const byPriority: Record<TestCasePriority, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    };

    const fieldCounts = new Map<string, number>();

    for (const tc of testCases) {
      byCategory[tc.category]++;
      byPriority[tc.priority]++;
      
      const current = fieldCounts.get(tc.fieldName) || 0;
      fieldCounts.set(tc.fieldName, current + 1);
    }

    const byField = Array.from(fieldCounts.entries())
      .map(([fieldName, count]) => ({ fieldName, count }))
      .sort((a, b) => b.count - a.count);

    return {
      totalTestCases: testCases.length,
      byCategory,
      byPriority,
      byField,
    };
  }

  /**
   * Export test cases as Markdown checklist
   */
  exportAsMarkdown(testCases: GeneratedTestCase[], sessionName: string): string {
    const lines: string[] = [
      `# Test Cases: ${sessionName}`,
      '',
      `Generated: ${new Date().toLocaleString()}`,
      `Total: ${testCases.length} test cases`,
      '',
      '---',
      '',
    ];

    // Group by field
    const byField = new Map<string, GeneratedTestCase[]>();
    for (const tc of testCases) {
      const existing = byField.get(tc.fieldName) || [];
      existing.push(tc);
      byField.set(tc.fieldName, existing);
    }

    for (const [fieldName, cases] of byField) {
      lines.push(`## ${fieldName}`);
      lines.push('');
      
      for (const tc of cases) {
        const statusEmoji = this.getStatusEmoji(tc.status);
        const priorityBadge = this.getPriorityBadge(tc.priority);
        
        lines.push(`- [${tc.status === 'passed' ? 'x' : ' '}] **${tc.name}** ${priorityBadge}`);
        lines.push(`  - ${tc.description}`);
        lines.push(`  - Test Value: \`${tc.testValue}\``);
        lines.push(`  - Expected: ${tc.expectedResult}`);
        if (tc.notes) {
          lines.push(`  - Notes: ${tc.notes}`);
        }
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  /**
   * Export test cases as Playwright test file
   */
  exportAsPlaywright(testCases: GeneratedTestCase[], sessionName: string): string {
    return this.playwrightBuilder.buildTestFile(testCases, sessionName);
  }

  /**
   * Export test cases as CSV
   * Columns: Title, Description, Steps, Expected Result, Priority, Category
   */
  exportAsCsv(testCases: GeneratedTestCase[]): string {
    const headers = ['Title', 'Description', 'Steps', 'Expected Result', 'Priority', 'Category', 'Status', 'Field Name', 'Notes'];
    const rows: string[][] = [];

    for (const tc of testCases) {
      // Build steps from actual recorded actions
      const steps = this.buildStepsString(tc);
      
      rows.push([
        this.escapeCsvField(tc.name),
        this.escapeCsvField(tc.description || ''),
        this.escapeCsvField(steps),
        this.escapeCsvField(tc.expectedResult || ''),
        this.escapeCsvField(tc.priority),
        this.escapeCsvField(tc.category),
        this.escapeCsvField(tc.status),
        this.escapeCsvField(tc.fieldName),
        this.escapeCsvField(tc.notes || ''),
      ]);
    }

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');

    return csvContent;
  }

  /**
   * Build human-readable steps string from prerequisite steps
   */
  private buildStepsString(tc: GeneratedTestCase): string {
    const stepLines: string[] = [];
    
    // Add prerequisite steps
    if (tc.prerequisiteSteps && tc.prerequisiteSteps.length > 0) {
      for (const step of tc.prerequisiteSteps) {
        stepLines.push(`${step.order}. ${step.description}`);
      }
    } else {
      // Fallback if no prerequisite steps (for legacy data)
      stepLines.push(`1. Navigate to the page`);
    }
    
    // Add test action step
    if (tc.testActionStep) {
      stepLines.push(`${tc.testActionStep.order}. ${tc.testActionStep.description}`);
    } else {
      // Fallback
      const nextStep = stepLines.length + 1;
      stepLines.push(`${nextStep}. Enter value: "${tc.testValue || 'N/A'}" in "${tc.fieldName}" field`);
    }
    
    return stepLines.join('\n');
  }

  /**
   * Export test cases as Excel (XLSX) using a simple XML-based format
   */
  async exportAsExcel(testCases: GeneratedTestCase[], sessionName: string): Promise<Uint8Array> {
    // Create a simple XLSX using XML strings (no external library needed)
    const worksheetData = this.buildExcelWorksheet(testCases, sessionName);
    return this.createXlsxBuffer(worksheetData);
  }

  private escapeCsvField(field: string): string {
    // Escape double quotes and wrap in quotes if contains comma, newline, or quote
    if (field.includes(',') || field.includes('\n') || field.includes('"')) {
      return `"${field.replace(/"/g, '""')}"`;
    }
    return field;
  }

  private buildExcelWorksheet(testCases: GeneratedTestCase[], _sessionName: string): string[][] {
    const rows: string[][] = [];
    
    // Header row
    rows.push(['Title', 'Description', 'Steps', 'Expected Result', 'Priority', 'Category', 'Status', 'Field Name', 'Notes']);
    
    // Data rows
    for (const tc of testCases) {
      // Build steps from actual recorded actions
      const steps = this.buildStepsString(tc);
      
      rows.push([
        tc.name,
        tc.description || '',
        steps,
        tc.expectedResult || '',
        tc.priority,
        tc.category,
        tc.status,
        tc.fieldName,
        tc.notes || '',
      ]);
    }
    
    return rows;
  }

  private async createXlsxBuffer(data: string[][]): Promise<Uint8Array> {
    // Create a minimal valid XLSX file structure
    // XLSX is a ZIP file with XML content
    
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    
    // [Content_Types].xml
    zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>`);

    // _rels/.rels
    zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`);

    // xl/_rels/workbook.xml.rels
    zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`);

    // xl/workbook.xml
    zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Test Cases" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`);

    // Build shared strings (all unique strings in the worksheet)
    const allStrings: string[] = [];
    const stringIndex = new Map<string, number>();
    
    for (const row of data) {
      for (const cell of row) {
        const str = cell || '';
        if (!stringIndex.has(str)) {
          stringIndex.set(str, allStrings.length);
          allStrings.push(str);
        }
      }
    }

    // xl/sharedStrings.xml
    const sharedStringsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${allStrings.length}" uniqueCount="${allStrings.length}">
${allStrings.map(s => `  <si><t>${this.escapeXml(s)}</t></si>`).join('\n')}
</sst>`;
    zip.file('xl/sharedStrings.xml', sharedStringsXml);

    // xl/worksheets/sheet1.xml
    const sheetDataRows: string[] = [];
    for (let r = 0; r < data.length; r++) {
      const row = data[r];
      const cells: string[] = [];
      for (let c = 0; c < row.length; c++) {
        const colLetter = this.getColumnLetter(c);
        const cellRef = `${colLetter}${r + 1}`;
        const strIdx = stringIndex.get(row[c] || '');
        cells.push(`<c r="${cellRef}" t="s"><v>${strIdx}</v></c>`);
      }
      sheetDataRows.push(`<row r="${r + 1}">${cells.join('')}</row>`);
    }

    const worksheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
${sheetDataRows.join('\n')}
  </sheetData>
</worksheet>`;
    zip.file('xl/worksheets/sheet1.xml', worksheetXml);

    // Generate the ZIP file
    const buffer = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    return buffer;
  }

  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private getColumnLetter(index: number): string {
    let letter = '';
    while (index >= 0) {
      letter = String.fromCharCode((index % 26) + 65) + letter;
      index = Math.floor(index / 26) - 1;
    }
    return letter;
  }

  /**
   * Fetch actions from EventStore
   */
  private async fetchActions(sessionId: string): Promise<RecordedAction[]> {
    const eventStore = getEventStore();
    return eventStore.getActionsBySession(sessionId, 5000);
  }

  /**
   * Generate test cases from analyzed fields with navigation paths
   */
  private generateTestCasesFromFields(
    sessionId: string, 
    fields: AnalyzedField[],
    allActions: RecordedAction[]
  ): GeneratedTestCase[] {
    const testCases: GeneratedTestCase[] = [];
    const now = Date.now();

    // Find all user-defined expected assertions (addExpected actions)
    const expectedAssertions = allActions.filter(a => a.type === 'addExpected');
    console.log(`[TestCaseGenerator] Found ${expectedAssertions.length} user-defined expected assertions`);

    for (const field of fields) {
      // Get the navigation path to this field
      const navigationPath = this.pathFinder.findPathToField(
        allActions,
        field.firstActionTimestamp,
        field.selector
      );

      // Find ALL expected assertions that were added after interacting with this field
      // (within a reasonable time window - 30 seconds)
      const fieldExpectedAssertions = this.findAllRelatedExpectedAssertions(
        field,
        expectedAssertions,
        allActions
      );

      const rules = this.ruleEngine.getRulesForField(field);
      
      for (const rule of rules) {
        // Create the test action step
        const testValue = rule.getTestValue(field);
        const testActionStep: TestStep = {
          order: navigationPath.steps.length + 1,
          action: 'type',
          description: `Enter "${testValue}" in "${field.name}" field`,
          selector: field.selector,
          xpath: field.xpath,
          value: testValue,
          playwrightCode: `await page.locator('${field.selector}').fill('${testValue.replace(/'/g, "\\'")}');`,
        };

        // Always use rule-based expected result as primary
        const ruleExpectedResult = rule.getExpectedResult(field);
        
        // Build the combined expected result - include both rule-based AND all user-defined
        let expectedResult = ruleExpectedResult;
        let additionalAssertionCodes: string[] = [];
        
        if (fieldExpectedAssertions.length > 0) {
          // Add all user-defined assertions as additional expectations
          const userExpecteds = fieldExpectedAssertions.map(a => this.buildExpectedResultFromAssertion(a));
          expectedResult = `${ruleExpectedResult}; Additionally: ${userExpecteds.join('; ')}`;
          additionalAssertionCodes = fieldExpectedAssertions.map(a => this.buildAssertionCode(a));
        }

        // Build full Playwright code with prerequisites
        const fullPlaywrightCode = this.buildFullPlaywrightTestWithMultipleAssertions(
          rule.name,
          navigationPath.steps,
          testActionStep,
          ruleExpectedResult,
          additionalAssertionCodes
        );

        const testCase: GeneratedTestCase = {
          id: uuidv4(),
          sessionId,
          fieldId: field.id,
          fieldName: field.name,
          fieldSelector: field.selector,
          category: rule.category,
          name: rule.name,
          description: rule.description,
          testValue,
          expectedResult,
          priority: rule.priority,
          status: 'pending',
          playwrightCode: fullPlaywrightCode,
          prerequisiteSteps: navigationPath.steps,
          testActionStep,
          createdAt: now,
          updatedAt: now,
        };
        
        testCases.push(testCase);
      }
    }

    // Sort by priority (critical first)
    const priorityOrder: Record<TestCasePriority, number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
    };

    testCases.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    return testCases;
  }

  /**
   * Find ALL expected assertions that relate to a specific field
   * (recorded shortly after the field interaction)
   */
  private findAllRelatedExpectedAssertions(
    field: AnalyzedField,
    expectedAssertions: RecordedAction[],
    _allActions: RecordedAction[]
  ): RecordedAction[] {
    // Look for expected assertions that were added within 30 seconds after
    // the last action on this field
    const lastFieldAction = field.actions[field.actions.length - 1];
    if (!lastFieldAction) return [];

    const timeWindowMs = 30000; // 30 seconds
    const relatedAssertions: RecordedAction[] = [];
    
    for (const assertion of expectedAssertions) {
      const timeDiff = assertion.timestamp - lastFieldAction.timestamp;
      if (timeDiff > 0 && timeDiff < timeWindowMs) {
        // Check if the assertion is on the same page
        if (assertion.tabUrl === lastFieldAction.tabUrl) {
          relatedAssertions.push(assertion);
        }
      }
    }
    
    return relatedAssertions;
  }

  /**
   * Build expected result string from user-defined assertion
   */
  private buildExpectedResultFromAssertion(assertion: RecordedAction): string {
    const data = assertion.data;
    const element = assertion.element;
    const assertionType = data.assertionType || 'visible';
    
    switch (assertionType) {
      case 'visible':
        return `Element "${element?.selector || 'unknown'}" should be visible`;
      case 'hidden':
        return `Element "${element?.selector || 'unknown'}" should be hidden`;
      case 'hasText':
        return `Element should contain text: "${data.expectedText || element?.text || ''}"`;
      case 'hasValue':
        return `Field should have value: "${data.expectedValue || ''}"`;
      case 'enabled':
        return `Element should be enabled`;
      case 'disabled':
        return `Element should be disabled`;
      case 'checked':
        return `Checkbox/radio should be checked`;
      default:
        return `Element "${element?.selector || 'unknown'}" should be ${assertionType}`;
    }
  }

  /**
   * Build Playwright assertion code from user-defined assertion
   */
  private buildAssertionCode(assertion: RecordedAction): string {
    const data = assertion.data;
    const element = assertion.element;
    const selector = element?.selector || '';
    const assertionType = data.assertionType || 'visible';
    
    const locator = `page.locator('${selector}')`;
    
    switch (assertionType) {
      case 'visible':
        return `await expect(${locator}).toBeVisible();`;
      case 'hidden':
        return `await expect(${locator}).toBeHidden();`;
      case 'hasText': {
        const text = (data.expectedText || element?.text || '').replace(/'/g, "\\'");
        return `await expect(${locator}).toContainText('${text}');`;
      }
      case 'hasValue': {
        const value = (data.expectedValue || '').replace(/'/g, "\\'");
        return `await expect(${locator}).toHaveValue('${value}');`;
      }
      case 'enabled':
        return `await expect(${locator}).toBeEnabled();`;
      case 'disabled':
        return `await expect(${locator}).toBeDisabled();`;
      case 'checked':
        return `await expect(${locator}).toBeChecked();`;
      default:
        return `await expect(${locator}).toBeVisible();`;
    }
  }

  /**
   * Build Playwright test body code (without test wrapper) with prerequisites
   * The test wrapper is added by PlaywrightBuilder.buildTestFile
   */
  private buildFullPlaywrightTest(
    _testName: string,
    prerequisiteSteps: TestStep[],
    testActionStep: TestStep,
    expectedResult: string,
    assertionCode?: string | null
  ): string {
    const lines: string[] = [];
    
    // Add prerequisite steps
    if (prerequisiteSteps.length > 0) {
      lines.push('// Prerequisites - Navigate to the field');
      for (const step of prerequisiteSteps) {
        lines.push(step.playwrightCode);
      }
      lines.push('');
    }
    
    // Add test action
    lines.push('// Test Action');
    lines.push(testActionStep.playwrightCode);
    lines.push('');
    
    // Add assertion
    lines.push('// Assertion');
    lines.push(`// Expected: ${expectedResult}`);
    lines.push('// TODO: Add appropriate assertion based on expected behavior');
    
    // Add user-defined assertion if available (in addition to rule-based)
    if (assertionCode) {
      lines.push('');
      lines.push('// User-defined assertion (marked via "Add as Expected"):');
      lines.push(assertionCode);
    }
    
    return lines.join('\n');
  }

  /**
   * Build Playwright test body code with multiple user-defined assertions
   */
  private buildFullPlaywrightTestWithMultipleAssertions(
    _testName: string,
    prerequisiteSteps: TestStep[],
    testActionStep: TestStep,
    expectedResult: string,
    additionalAssertionCodes: string[]
  ): string {
    const lines: string[] = [];
    
    // Add prerequisite steps
    if (prerequisiteSteps.length > 0) {
      lines.push('// Prerequisites - Navigate to the field');
      for (const step of prerequisiteSteps) {
        lines.push(step.playwrightCode);
      }
      lines.push('');
    }
    
    // Add test action
    lines.push('// Test Action');
    lines.push(testActionStep.playwrightCode);
    lines.push('');
    
    // Add assertion
    lines.push('// Assertion');
    lines.push(`// Expected: ${expectedResult}`);
    lines.push('// TODO: Add appropriate assertion based on expected behavior');
    
    // Add all user-defined assertions (in addition to rule-based)
    if (additionalAssertionCodes.length > 0) {
      lines.push('');
      lines.push('// User-defined assertions (marked via "Add as Expected"):');
      for (const assertionCode of additionalAssertionCodes) {
        lines.push(assertionCode);
      }
    }
    
    return lines.join('\n');
  }

  /**
   * Store test cases in EventStore
   */
  private async storeTestCases(testCases: GeneratedTestCase[]): Promise<void> {
    const eventStore = getEventStore();
    
    for (const tc of testCases) {
      await eventStore.addTestCase(tc);
    }
  }

  private getStatusEmoji(status: TestCaseStatus): string {
    switch (status) {
      case 'passed': return '✅';
      case 'failed': return '❌';
      case 'skipped': return '⏭️';
      default: return '⏳';
    }
  }

  private getPriorityBadge(priority: TestCasePriority): string {
    switch (priority) {
      case 'critical': return '🔴 CRITICAL';
      case 'high': return '🟠 HIGH';
      case 'medium': return '🟡 MEDIUM';
      case 'low': return '🟢 LOW';
    }
  }
}

// Singleton instance
let generatorInstance: TestCaseGenerator | null = null;

export function getTestCaseGenerator(): TestCaseGenerator {
  if (!generatorInstance) {
    generatorInstance = new TestCaseGenerator();
  }
  return generatorInstance;
}

