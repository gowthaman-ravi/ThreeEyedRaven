import { parseRavenPomConfig } from '../config';
import { GlobFn, discoverRepoFiles } from '../discovery';

// A small in-memory glob so discovery logic is tested without disk.
function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&'); // escape regex specials (not * or /)
  const body = escaped
    .replace(/\*\*\//g, '(?:.*/)?')
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*');
  return new RegExp('^' + body + '$');
}

function stubGlob(all: string[]): GlobFn {
  const matches = (file: string, pattern: string) => globToRegExp(pattern).test(file);
  return (patterns, options) => {
    const ignore = options.ignore ?? [];
    return all.filter(
      (f) => patterns.some((p) => matches(f, p)) && !ignore.some((p) => matches(f, p))
    );
  };
}

function cfg(overrides: Record<string, unknown> = {}) {
  const { config, errors } = parseRavenPomConfig({
    pages: { include: ['src/pages/**/*.ts'] },
    ...overrides,
  });
  expect(errors).toEqual([]);
  return config!;
}

const REPO = '/repo';

describe('discoverRepoFiles', () => {
  it('finds page files and applies excludes', () => {
    const glob = stubGlob([
      'src/pages/LoginPage.ts',
      'src/pages/sub/DashboardPage.ts',
      'src/pages/base/BasePage.ts',
      'src/util/helpers.ts',
    ]);
    const config = cfg({ pages: { include: ['src/pages/**/*.ts'], exclude: ['src/pages/base/**'] } });
    const { model, errors } = discoverRepoFiles(REPO, config, glob);
    expect(errors).toEqual([]);
    expect(model!.pageFiles).toEqual(['src/pages/LoginPage.ts', 'src/pages/sub/DashboardPage.ts']);
    expect(model!.testFiles).toEqual([]);
    expect(model!.repoPath).toBe(REPO);
  });

  it('finds test files when tests globs are configured', () => {
    const glob = stubGlob(['src/pages/LoginPage.ts', 'tests/login.spec.ts', 'tests/wip/x.spec.ts']);
    const config = cfg({ tests: { include: ['tests/**/*.spec.ts'], exclude: ['tests/wip/**'] } });
    const { model } = discoverRepoFiles(REPO, config, glob);
    expect(model!.pageFiles).toEqual(['src/pages/LoginPage.ts']);
    expect(model!.testFiles).toEqual(['tests/login.spec.ts']);
  });

  it('treats files matching both sets as pages and warns', () => {
    const glob = stubGlob(['src/pages/LoginPage.ts', 'src/pages/Shared.ts']);
    const config = cfg({
      pages: { include: ['src/pages/**/*.ts'] },
      tests: { include: ['src/pages/Shared.ts'] },
    });
    const { model } = discoverRepoFiles(REPO, config, glob);
    expect(model!.pageFiles).toContain('src/pages/Shared.ts');
    expect(model!.testFiles).not.toContain('src/pages/Shared.ts');
    expect(model!.warnings[0]).toMatch(/matched both page and test globs/);
  });

  it('dedupes and sorts results', () => {
    const glob: GlobFn = () => ['b.ts', 'a.ts', 'b.ts'];
    const { model } = discoverRepoFiles(REPO, cfg(), glob);
    expect(model!.pageFiles).toEqual(['a.ts', 'b.ts']);
  });

  it('errors when no page files match', () => {
    const glob = stubGlob(['tests/login.spec.ts']);
    const { model, errors } = discoverRepoFiles(REPO, cfg(), glob);
    expect(model).toBeUndefined();
    expect(errors).toContain('no page-object files matched "pages.include"');
  });

  it('surfaces glob failures as errors instead of throwing', () => {
    const glob: GlobFn = () => {
      throw new Error('EACCES');
    };
    const { model, errors } = discoverRepoFiles(REPO, cfg(), glob);
    expect(model).toBeUndefined();
    expect(errors[0]).toMatch(/failed to scan page globs: EACCES/);
  });
});
