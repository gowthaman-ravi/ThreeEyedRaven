/**
 * POM-Aware Codegen — Repo discovery & file model (Phase 1)
 *
 * Resolves the configured glob sets against the external repo and produces a
 * file-level model: which files are page-object candidates and which are tests.
 *
 * NOTE: this is file-level classification only. Deciding which page-candidate
 * files actually contain page-object *classes* (vs. helpers/support) is an AST
 * concern handled in Phase 2 — globs alone can't tell them apart.
 *
 * The glob function is injected (see `io.ts` for the fast-glob adapter) so this
 * module stays pure and unit-testable without touching disk.
 */

import { RavenPomConfig } from './config';

export interface GlobOptions {
  cwd: string;
  ignore?: string[];
}

/** Returns repo-relative file paths matching `patterns`, honoring `ignore`. */
export type GlobFn = (patterns: string[], options: GlobOptions) => string[];

export interface RepoFileModel {
  repoPath: string;
  /** Repo-relative, unique, sorted. Candidates for page-object classes. */
  pageFiles: string[];
  /** Repo-relative, unique, sorted. */
  testFiles: string[];
  warnings: string[];
}

export interface DiscoverResult {
  model?: RepoFileModel;
  errors: string[];
}

function uniqueSorted(xs: string[]): string[] {
  return Array.from(new Set(xs)).sort();
}

/**
 * Discover page-candidate and test files in `repoPath` per the config globs.
 * Returns errors (rather than throwing) for empty page matches or glob failures.
 */
export function discoverRepoFiles(
  repoPath: string,
  config: RavenPomConfig,
  glob: GlobFn
): DiscoverResult {
  const warnings: string[] = [];

  let pageFiles: string[];
  try {
    pageFiles = uniqueSorted(
      glob(config.pages.include, { cwd: repoPath, ignore: config.pages.exclude })
    );
  } catch (e) {
    return { errors: [`failed to scan page globs: ${(e as Error).message}`] };
  }

  let testFiles: string[] = [];
  if (config.tests.include.length > 0) {
    try {
      testFiles = uniqueSorted(
        glob(config.tests.include, { cwd: repoPath, ignore: config.tests.exclude })
      );
    } catch (e) {
      return { errors: [`failed to scan test globs: ${(e as Error).message}`] };
    }
  }

  // A file matched by both glob sets is treated as a page object; warn and
  // drop it from the test list so it is not double-counted.
  const pageSet = new Set(pageFiles);
  const overlap = testFiles.filter((f) => pageSet.has(f));
  if (overlap.length > 0) {
    warnings.push(
      `${overlap.length} file(s) matched both page and test globs; treating as pages: ${overlap.join(', ')}`
    );
    testFiles = testFiles.filter((f) => !pageSet.has(f));
  }

  if (pageFiles.length === 0) {
    return { errors: ['no page-object files matched "pages.include"'] };
  }

  return { errors: [], model: { repoPath, pageFiles, testFiles, warnings } };
}
