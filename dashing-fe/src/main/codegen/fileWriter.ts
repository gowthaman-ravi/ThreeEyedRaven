/**
 * FileWriter - Writes generated files to local filesystem
 * 
 * Creates the POM folder structure and writes all generated files.
 * Output directory: ~/dashing-generated/{project-name}/
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { GeneratedFile } from './templateEngine';

export interface WriteResult {
  success: boolean;
  outputPath: string;
  filesWritten: string[];
  error?: string;
}

export interface ProjectMetadata {
  name: string;
  folderName: string;  // Actual folder name on disk
  sessionId: string;
  framework: string;
  language: string;
  createdAt: number;
  pagesCount: number;
  actionsCount: number;
  files: string[];
}

export class FileWriter {
  private readonly baseDir: string;

  constructor() {
    this.baseDir = path.join(os.homedir(), 'dashing-generated');
  }

  /**
   * Get the base directory for generated projects
   */
  getBaseDir(): string {
    return this.baseDir;
  }

  /**
   * Ensure the base directory exists
   */
  async ensureBaseDir(): Promise<void> {
    if (!fs.existsSync(this.baseDir)) {
      await fs.promises.mkdir(this.baseDir, { recursive: true });
    }
  }

  /**
   * Write all generated files for a project
   */
  async writeProject(
    projectName: string,
    files: GeneratedFile[],
    metadata: Omit<ProjectMetadata, 'files' | 'createdAt' | 'folderName'>
  ): Promise<WriteResult> {
    try {
      await this.ensureBaseDir();
      
      // Create safe project folder name
      const safeName = this.toSafeFolderName(projectName);
      const projectPath = path.join(this.baseDir, safeName);
      
      // If folder exists, add timestamp
      const finalPath = await this.getUniquePath(projectPath);
      
      // Get the actual folder name (may have timestamp added)
      const actualFolderName = path.basename(finalPath);
      
      // Create project directory
      await fs.promises.mkdir(finalPath, { recursive: true });
      
      // Create subdirectories
      await fs.promises.mkdir(path.join(finalPath, 'pages'), { recursive: true });
      await fs.promises.mkdir(path.join(finalPath, 'tests'), { recursive: true });
      
      // Write all files
      const filesWritten: string[] = [];
      
      for (const file of files) {
        const filePath = path.join(finalPath, file.path);
        const fileDir = path.dirname(filePath);
        
        // Ensure directory exists
        if (!fs.existsSync(fileDir)) {
          await fs.promises.mkdir(fileDir, { recursive: true });
        }
        
        await fs.promises.writeFile(filePath, file.content, 'utf-8');
        filesWritten.push(file.path);
      }
      
      // Write metadata file
      const fullMetadata: ProjectMetadata = {
        ...metadata,
        folderName: actualFolderName,
        files: filesWritten,
        createdAt: Date.now(),
      };
      
      await fs.promises.writeFile(
        path.join(finalPath, '.dashing-metadata.json'),
        JSON.stringify(fullMetadata, null, 2),
        'utf-8'
      );
      
      // Write README
      await this.writeReadme(finalPath, projectName, fullMetadata);
      
      return {
        success: true,
        outputPath: finalPath,
        filesWritten,
      };
    } catch (error) {
      return {
        success: false,
        outputPath: '',
        filesWritten: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * List all generated projects
   */
  async listProjects(): Promise<ProjectMetadata[]> {
    try {
      await this.ensureBaseDir();
      
      const entries = await fs.promises.readdir(this.baseDir, { withFileTypes: true });
      const projects: ProjectMetadata[] = [];
      
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        
        const metadataPath = path.join(this.baseDir, entry.name, '.dashing-metadata.json');
        
        if (fs.existsSync(metadataPath)) {
          try {
            const content = await fs.promises.readFile(metadataPath, 'utf-8');
            const metadata = JSON.parse(content) as ProjectMetadata;
            // Ensure folderName is set (for backwards compatibility)
            if (!metadata.folderName) {
              metadata.folderName = entry.name;
            }
            projects.push(metadata);
          } catch {
            // Skip invalid metadata files
          }
        } else {
          // Create basic metadata from folder
          const stat = await fs.promises.stat(path.join(this.baseDir, entry.name));
          projects.push({
            name: entry.name,
            folderName: entry.name,
            sessionId: '',
            framework: 'playwright',
            language: 'typescript',
            createdAt: stat.mtimeMs,
            pagesCount: 0,
            actionsCount: 0,
            files: [],
          });
        }
      }
      
      // Sort by creation date, newest first
      projects.sort((a, b) => b.createdAt - a.createdAt);
      
      return projects;
    } catch {
      return [];
    }
  }

  /**
   * Delete a generated project
   */
  async deleteProject(projectPath: string): Promise<boolean> {
    try {
      // Security check: ensure path is within base dir
      const normalizedPath = path.normalize(projectPath);
      if (!normalizedPath.startsWith(this.baseDir)) {
        throw new Error('Invalid project path');
      }
      
      await fs.promises.rm(projectPath, { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get project path by name
   */
  getProjectPath(projectName: string): string {
    return path.join(this.baseDir, this.toSafeFolderName(projectName));
  }

  /**
   * Check if a project exists
   */
  async projectExists(projectName: string): Promise<boolean> {
    const projectPath = this.getProjectPath(projectName);
    return fs.existsSync(projectPath);
  }

  /**
   * Convert project name to safe folder name
   */
  private toSafeFolderName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 100); // Limit length
  }

  /**
   * Get unique path by adding timestamp if needed
   */
  private async getUniquePath(basePath: string): Promise<string> {
    if (!fs.existsSync(basePath)) {
      return basePath;
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    return `${basePath}-${timestamp}`;
  }

  /**
   * Write README file
   */
  private async writeReadme(
    projectPath: string, 
    projectName: string,
    metadata: ProjectMetadata
  ): Promise<void> {
    const content = `# ${projectName}

Auto-generated Playwright tests by Dashing.

## Quick Start

\`\`\`bash
# Install dependencies
npm install

# Install Playwright browsers
npx playwright install

# Run tests
npm test

# Run tests with UI
npm run test:ui

# Run tests headed (see browser)
npm run test:headed
\`\`\`

## Project Structure

\`\`\`
${path.basename(projectPath)}/
├── pages/                    # Page Object Model classes
│   ├── *.locators.ts        # Locator definitions
│   └── *.ts                 # Page classes with methods
├── tests/                   # Test specifications
│   └── *.spec.ts
├── playwright.config.ts     # Playwright configuration
├── package.json
└── tsconfig.json
\`\`\`

## Generated Info

- **Session ID:** ${metadata.sessionId}
- **Framework:** ${metadata.framework}
- **Language:** ${metadata.language}
- **Pages:** ${metadata.pagesCount}
- **Actions:** ${metadata.actionsCount}
- **Generated:** ${new Date(metadata.createdAt).toLocaleString()}

## Customization

The generated code follows the Page Object Model pattern. You can:

1. Edit locators in \`pages/*.locators.ts\` files
2. Add custom methods to page classes in \`pages/*.ts\`
3. Extend tests in \`tests/*.spec.ts\`
4. Modify \`playwright.config.ts\` for different browsers/settings

---

*Generated by [Dashing](https://github.com/dashing-app/dashing)*
`;

    await fs.promises.writeFile(path.join(projectPath, 'README.md'), content, 'utf-8');
  }
}

