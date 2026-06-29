/**
 * POM-Aware Codegen — Node IO adapters
 *
 * Thin wrappers around fs/path/fast-glob, kept separate from the pure pomgen
 * modules so those stay unit-testable with injected fakes. Production wiring
 * passes these adapters in.
 */

import * as fs from 'fs';
import * as path from 'path';
import fg from 'fast-glob';
import { FileReader } from './config';
import { GlobFn } from './discovery';

export const nodeFileReader: FileReader = (p) => fs.readFileSync(p, 'utf8');

export const nodePathJoin = (...parts: string[]): string => path.join(...parts);

export const fastGlob: GlobFn = (patterns, options) =>
  fg.sync(patterns, {
    cwd: options.cwd,
    ignore: options.ignore,
    onlyFiles: true,
    dot: false,
  });
