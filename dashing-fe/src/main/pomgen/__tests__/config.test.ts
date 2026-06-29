import {
  DEFAULT_RAVEN_POM_CONFIG,
  RAVEN_POM_CONFIG_FILENAME,
  RAVEN_POM_CONFIG_VERSION,
  loadRavenPomConfig,
  parseRavenPomConfig,
  validatePomSettings,
} from '../config';

const minimalValid = { pages: { include: ['src/pages/**/*.ts'] } };

describe('parseRavenPomConfig — valid input & defaults', () => {
  it('accepts a minimal config and applies defaults', () => {
    const { config, errors } = parseRavenPomConfig(minimalValid);
    expect(errors).toEqual([]);
    expect(config).toBeDefined();
    expect(config!.version).toBe(RAVEN_POM_CONFIG_VERSION);
    expect(config!.framework).toBe('playwright');
    expect(config!.language).toBe('typescript');
    expect(config!.pages.include).toEqual(['src/pages/**/*.ts']);
    expect(config!.pages.exclude).toEqual([]);
    expect(config!.tests).toEqual({ include: [], exclude: [] });
    expect(config!.baseUrlPageMap).toEqual({});
    expect(config!.write).toEqual(DEFAULT_RAVEN_POM_CONFIG.write);
    expect(config!.llm).toEqual({ enabled: false });
  });

  it('parses a JSON string as well as an object', () => {
    const { config, errors } = parseRavenPomConfig(JSON.stringify(minimalValid));
    expect(errors).toEqual([]);
    expect(config!.pages.include).toEqual(['src/pages/**/*.ts']);
  });

  it('preserves provided optional fields', () => {
    const { config, errors } = parseRavenPomConfig({
      ...minimalValid,
      tests: { include: ['tests/**/*.spec.ts'], exclude: ['tests/wip/**'] },
      baseUrlPageMap: { '/login': 'LoginPage' },
      write: { branchPrefix: 'bot/pom' },
      llm: { enabled: true, baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5-coder' },
    });
    expect(errors).toEqual([]);
    expect(config!.tests).toEqual({ include: ['tests/**/*.spec.ts'], exclude: ['tests/wip/**'] });
    expect(config!.baseUrlPageMap).toEqual({ '/login': 'LoginPage' });
    expect(config!.write.branchPrefix).toBe('bot/pom');
    expect(config!.llm).toEqual({ enabled: true, baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5-coder' });
  });
});

describe('parseRavenPomConfig — validation failures', () => {
  it('rejects invalid JSON strings', () => {
    const { config, errors } = parseRavenPomConfig('{ not json');
    expect(config).toBeUndefined();
    expect(errors[0]).toMatch(/invalid JSON/);
  });

  it('rejects non-object roots', () => {
    expect(parseRavenPomConfig(42).errors).toContain('config root must be a JSON object');
    expect(parseRavenPomConfig([]).errors).toContain('config root must be a JSON object');
  });

  it('requires a non-empty pages.include', () => {
    expect(parseRavenPomConfig({}).errors).toContain(
      '"pages.include" is required and must be a non-empty array'
    );
    expect(parseRavenPomConfig({ pages: { include: [] } }).errors).toContain(
      '"pages.include" is required and must be a non-empty array'
    );
  });

  it('rejects wrong framework / language', () => {
    expect(parseRavenPomConfig({ ...minimalValid, framework: 'cypress' }).errors).toContain(
      '"framework" must be "playwright"'
    );
    expect(parseRavenPomConfig({ ...minimalValid, language: 'python' }).errors).toContain(
      '"language" must be "typescript"'
    );
  });

  it('rejects non-string glob entries', () => {
    const { errors } = parseRavenPomConfig({ pages: { include: ['ok', 5] } });
    expect(errors).toContain('"pages.include" must be an array of strings');
  });

  it('rejects non-string baseUrlPageMap values', () => {
    const { errors } = parseRavenPomConfig({ ...minimalValid, baseUrlPageMap: { '/x': 1 } });
    expect(errors).toContain('"baseUrlPageMap" values must be strings');
  });

  it('rejects an empty write.branchPrefix', () => {
    const { errors } = parseRavenPomConfig({ ...minimalValid, write: { branchPrefix: '  ' } });
    expect(errors).toContain('"write.branchPrefix" must be a non-empty string');
  });

  it('requires llm.baseUrl when llm.enabled is true', () => {
    const { errors } = parseRavenPomConfig({ ...minimalValid, llm: { enabled: true } });
    expect(errors).toContain('"llm.baseUrl" is required when "llm.enabled" is true');
  });

  it('collects multiple errors at once', () => {
    const { errors } = parseRavenPomConfig({ framework: 'x', pages: { include: [] } });
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });
});

describe('validatePomSettings', () => {
  it('defaults to disabled with no repoPath', () => {
    const { settings, errors } = validatePomSettings({});
    expect(errors).toEqual([]);
    expect(settings).toEqual({ enabled: false, repoPath: undefined });
  });

  it('accepts an enabled pointer with a repoPath', () => {
    const { settings, errors } = validatePomSettings({ enabled: true, repoPath: '/repo' });
    expect(errors).toEqual([]);
    expect(settings).toEqual({ enabled: true, repoPath: '/repo' });
  });

  it('requires repoPath when enabled', () => {
    const { errors } = validatePomSettings({ enabled: true });
    expect(errors).toContain('"repoPath" is required when POM mode is enabled');
  });

  it('rejects empty / wrong-typed repoPath', () => {
    expect(validatePomSettings({ repoPath: '' }).errors).toContain('"repoPath" must not be empty');
    expect(validatePomSettings({ repoPath: 3 }).errors).toContain('"repoPath" must be a string');
  });
});

describe('loadRavenPomConfig', () => {
  const join = (...parts: string[]) => parts.join('/');

  it('reads and parses the config file from the repo root', () => {
    const reader = (p: string) => {
      expect(p).toBe(`/repo/${RAVEN_POM_CONFIG_FILENAME}`);
      return JSON.stringify(minimalValid);
    };
    const { config, errors } = loadRavenPomConfig('/repo', reader, join);
    expect(errors).toEqual([]);
    expect(config!.pages.include).toEqual(['src/pages/**/*.ts']);
  });

  it('returns an error when the file cannot be read', () => {
    const reader = () => {
      throw new Error('ENOENT');
    };
    const { config, errors } = loadRavenPomConfig('/repo', reader, join);
    expect(config).toBeUndefined();
    expect(errors[0]).toMatch(/could not read .* ENOENT/);
  });
});
