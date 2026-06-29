/**
 * POM-Aware Codegen — Configuration (Phase 0)
 *
 * Two pieces of config:
 *  1. App settings (the *pointer*): where the external POM repo lives + an enable
 *     toggle. Stored on the app side (renderer settings). See `PomSettings`.
 *  2. The committed `.raven-pom.json` (the *conventions*): lives inside the
 *     external repo, versioned with the code it describes. See `RavenPomConfig`.
 *
 * This module is pure and dependency-free: it parses and validates config and
 * applies defaults. File reading is injected so the core stays unit-testable.
 */

/** Frameworks/languages supported in v1. */
export const SUPPORTED_FRAMEWORK = 'playwright' as const;
export const SUPPORTED_LANGUAGE = 'typescript' as const;

/** Current `.raven-pom.json` schema version. */
export const RAVEN_POM_CONFIG_VERSION = 1;

/** Filename the loader looks for at the repo root. */
export const RAVEN_POM_CONFIG_FILENAME = '.raven-pom.json';

/** Glob include/exclude set. */
export interface GlobSet {
  include: string[];
  exclude: string[];
}

/** Write policy for the "build if not present" pass (decision: local branch + commit only). */
export interface PomWriteConfig {
  /** Branch name prefix; branch becomes `<branchPrefix>/<session>`. */
  branchPrefix: string;
}

/** Optional local-LLM assist layer (off by default; OpenAI-compatible server). */
export interface PomLlmConfig {
  enabled: boolean;
  /** e.g. http://localhost:11434/v1 for an Ollama/LM Studio style server. */
  baseUrl?: string;
  model?: string;
}

/** The committed `.raven-pom.json`, fully normalized with defaults applied. */
export interface RavenPomConfig {
  version: number;
  framework: typeof SUPPORTED_FRAMEWORK;
  language: typeof SUPPORTED_LANGUAGE;
  /** Where page-object classes live. `include` must be non-empty. */
  pages: GlobSet;
  /** Where tests live (optional; may be empty). */
  tests: GlobSet;
  /** Optional URL-pattern → PageObject class-name hints for page resolution. */
  baseUrlPageMap: Record<string, string>;
  write: PomWriteConfig;
  llm: PomLlmConfig;
}

/** The app-side pointer to the external repo (stored in app settings). */
export interface PomSettings {
  enabled: boolean;
  /** Absolute path to the external POM repo, or undefined if not yet set. */
  repoPath?: string;
}

/** Defaults applied to any omitted `.raven-pom.json` field. */
export const DEFAULT_RAVEN_POM_CONFIG: RavenPomConfig = {
  version: RAVEN_POM_CONFIG_VERSION,
  framework: SUPPORTED_FRAMEWORK,
  language: SUPPORTED_LANGUAGE,
  pages: { include: [], exclude: [] },
  tests: { include: [], exclude: [] },
  baseUrlPageMap: {},
  write: { branchPrefix: 'raven/codegen' },
  llm: { enabled: false },
};

/** Result of parsing: either a normalized config or a list of human-readable errors. */
export interface ParseResult {
  config?: RavenPomConfig;
  errors: string[];
}

// ---- internal validation helpers -------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Validate an optional string[] field; pushes errors, returns a cleaned array. */
function readStringArray(value: unknown, field: string, errors: string[]): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((s) => typeof s === 'string')) {
    errors.push(`"${field}" must be an array of strings`);
    return [];
  }
  return value as string[];
}

/** Validate a glob set: `include` required non-empty for `pages`, optional otherwise. */
function readGlobSet(
  value: unknown,
  field: string,
  requireInclude: boolean,
  errors: string[]
): GlobSet {
  if (value === undefined) {
    if (requireInclude) errors.push(`"${field}.include" is required and must be a non-empty array`);
    return { include: [], exclude: [] };
  }
  if (!isPlainObject(value)) {
    errors.push(`"${field}" must be an object with "include"/"exclude" arrays`);
    return { include: [], exclude: [] };
  }
  const include = readStringArray(value.include, `${field}.include`, errors);
  const exclude = readStringArray(value.exclude, `${field}.exclude`, errors);
  if (requireInclude && include.length === 0) {
    errors.push(`"${field}.include" is required and must be a non-empty array`);
  }
  return { include, exclude };
}

// ---- public API ------------------------------------------------------------

/**
 * Parse and validate raw `.raven-pom.json` content (a JSON string or an
 * already-parsed object). Returns a normalized config or a list of errors.
 */
export function parseRavenPomConfig(raw: string | unknown): ParseResult {
  const errors: string[] = [];

  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch (e) {
      return { errors: [`invalid JSON: ${(e as Error).message}`] };
    }
  }

  if (!isPlainObject(obj)) {
    return { errors: ['config root must be a JSON object'] };
  }

  // version
  let version = RAVEN_POM_CONFIG_VERSION;
  if (obj.version !== undefined) {
    if (typeof obj.version !== 'number') errors.push('"version" must be a number');
    else version = obj.version;
  }

  // framework / language (fixed to supported values in v1)
  let framework = SUPPORTED_FRAMEWORK;
  if (obj.framework !== undefined) {
    if (obj.framework !== SUPPORTED_FRAMEWORK) {
      errors.push(`"framework" must be "${SUPPORTED_FRAMEWORK}"`);
    } else {
      framework = obj.framework;
    }
  }
  let language = SUPPORTED_LANGUAGE;
  if (obj.language !== undefined) {
    if (obj.language !== SUPPORTED_LANGUAGE) {
      errors.push(`"language" must be "${SUPPORTED_LANGUAGE}"`);
    } else {
      language = obj.language;
    }
  }

  // pages (required) / tests (optional)
  const pages = readGlobSet(obj.pages, 'pages', true, errors);
  const tests = readGlobSet(obj.tests, 'tests', false, errors);

  // baseUrlPageMap (optional Record<string,string>)
  let baseUrlPageMap: Record<string, string> = {};
  if (obj.baseUrlPageMap !== undefined) {
    if (!isPlainObject(obj.baseUrlPageMap)) {
      errors.push('"baseUrlPageMap" must be an object of string→string');
    } else {
      const entries = Object.entries(obj.baseUrlPageMap);
      if (!entries.every(([, v]) => typeof v === 'string')) {
        errors.push('"baseUrlPageMap" values must be strings');
      } else {
        baseUrlPageMap = obj.baseUrlPageMap as Record<string, string>;
      }
    }
  }

  // write.branchPrefix (optional)
  let write: PomWriteConfig = { ...DEFAULT_RAVEN_POM_CONFIG.write };
  if (obj.write !== undefined) {
    if (!isPlainObject(obj.write)) {
      errors.push('"write" must be an object');
    } else if (obj.write.branchPrefix !== undefined) {
      if (typeof obj.write.branchPrefix !== 'string' || obj.write.branchPrefix.trim() === '') {
        errors.push('"write.branchPrefix" must be a non-empty string');
      } else {
        write = { branchPrefix: obj.write.branchPrefix };
      }
    }
  }

  // llm (optional)
  let llm: PomLlmConfig = { ...DEFAULT_RAVEN_POM_CONFIG.llm };
  if (obj.llm !== undefined) {
    if (!isPlainObject(obj.llm)) {
      errors.push('"llm" must be an object');
    } else {
      const next: PomLlmConfig = { enabled: false };
      if (obj.llm.enabled !== undefined) {
        if (typeof obj.llm.enabled !== 'boolean') errors.push('"llm.enabled" must be a boolean');
        else next.enabled = obj.llm.enabled;
      }
      if (obj.llm.baseUrl !== undefined) {
        if (typeof obj.llm.baseUrl !== 'string') errors.push('"llm.baseUrl" must be a string');
        else next.baseUrl = obj.llm.baseUrl;
      }
      if (obj.llm.model !== undefined) {
        if (typeof obj.llm.model !== 'string') errors.push('"llm.model" must be a string');
        else next.model = obj.llm.model;
      }
      if (next.enabled && !next.baseUrl) {
        errors.push('"llm.baseUrl" is required when "llm.enabled" is true');
      }
      llm = next;
    }
  }

  if (errors.length > 0) return { errors };

  return {
    errors: [],
    config: { version, framework, language, pages, tests, baseUrlPageMap, write, llm },
  };
}

/** Validate the app-side settings pointer. */
export function validatePomSettings(value: unknown): { settings?: PomSettings; errors: string[] } {
  const errors: string[] = [];
  if (!isPlainObject(value)) return { errors: ['settings must be an object'] };

  let enabled = false;
  if (value.enabled !== undefined) {
    if (typeof value.enabled !== 'boolean') errors.push('"enabled" must be a boolean');
    else enabled = value.enabled;
  }

  let repoPath: string | undefined;
  if (value.repoPath !== undefined) {
    if (typeof value.repoPath !== 'string') errors.push('"repoPath" must be a string');
    else if (value.repoPath.trim() === '') errors.push('"repoPath" must not be empty');
    else repoPath = value.repoPath;
  }

  if (enabled && !repoPath) errors.push('"repoPath" is required when POM mode is enabled');

  if (errors.length > 0) return { errors };
  return { errors: [], settings: { enabled, repoPath } };
}

/** Minimal file reader contract (injected so the loader is testable without disk). */
export type FileReader = (path: string) => string;

/**
 * Load and parse `.raven-pom.json` from a repo directory.
 * `join` and `readFile` are injected; defaults use node's fs/path at call sites.
 */
export function loadRavenPomConfig(
  repoPath: string,
  readFile: FileReader,
  join: (...parts: string[]) => string
): ParseResult {
  const path = join(repoPath, RAVEN_POM_CONFIG_FILENAME);
  let raw: string;
  try {
    raw = readFile(path);
  } catch (e) {
    return { errors: [`could not read ${RAVEN_POM_CONFIG_FILENAME} at ${path}: ${(e as Error).message}`] };
  }
  return parseRavenPomConfig(raw);
}
