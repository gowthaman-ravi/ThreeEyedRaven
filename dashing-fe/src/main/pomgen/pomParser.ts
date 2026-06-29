/**
 * POM-Aware Codegen — Page-Object AST parser (Phase 2)
 *
 * Extracts, from a TypeScript Playwright page-object source file:
 *  - page classes
 *  - locator declarations (property initializers, constructor assignments, getters)
 *  - methods, with the ordered (locator, action) steps in each body
 *
 * Built on the installed `typescript` compiler API (no ts-morph) so it stays
 * compatible with the repo's pinned TypeScript and adds no dependency.
 *
 * Pure: takes source text, never touches disk. Production reads files via `io.ts`
 * and feeds the text in.
 */

import * as ts from 'typescript';

/** Playwright locator factory methods we recognize on `page` / `this.page`. */
const LOCATOR_STRATEGIES = new Set([
  'locator',
  'getByRole',
  'getByText',
  'getByLabel',
  'getByPlaceholder',
  'getByTestId',
  'getByAltText',
  'getByTitle',
]);

/** Playwright action methods we treat as recordable steps. */
const ACTION_METHODS = new Set([
  'click',
  'dblclick',
  'fill',
  'type',
  'press',
  'pressSequentially',
  'check',
  'uncheck',
  'setChecked',
  'selectOption',
  'hover',
  'focus',
  'blur',
  'clear',
  'setInputFiles',
  'dragTo',
  'tap',
  'scrollIntoViewIfNeeded',
]);

export type SelectorStrategy =
  | 'locator'
  | 'getByRole'
  | 'getByText'
  | 'getByLabel'
  | 'getByPlaceholder'
  | 'getByTestId'
  | 'getByAltText'
  | 'getByTitle';

export interface LocatorDecl {
  /** Property name, e.g. "usernameField". */
  name: string;
  strategy: SelectorStrategy;
  /** First string-literal argument, e.g. "#username" or "Log in" (if literal). */
  arg?: string;
  /** Raw initializer text, kept for fingerprinting/debugging in later phases. */
  expressionText: string;
}

export interface ActionStep {
  /** The `this.<name>` member the action is performed on (e.g. "usernameField", or "page"). */
  locatorName: string;
  /** The Playwright action method, e.g. "fill" | "click". */
  action: string;
}

export interface MethodDecl {
  name: string;
  params: string[];
  /** Ordered locator-actions found in the method body. */
  steps: ActionStep[];
}

export interface PageClass {
  name: string;
  filePath: string;
  locators: LocatorDecl[];
  methods: MethodDecl[];
}

export interface ParsePomResult {
  pages: PageClass[];
  warnings: string[];
}

// ---- AST helpers -----------------------------------------------------------

/** True for `page` identifier or `this.page`. */
function isPageLike(node: ts.Expression): boolean {
  if (ts.isIdentifier(node) && node.text === 'page') return true;
  if (
    ts.isPropertyAccessExpression(node) &&
    node.name.text === 'page' &&
    node.expression.kind === ts.SyntaxKind.ThisKeyword
  ) {
    return true;
  }
  return false;
}

function firstStringArg(call: ts.CallExpression): string | undefined {
  for (const arg of call.arguments) {
    if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
      return arg.text;
    }
  }
  return undefined;
}

/**
 * Find the locator-factory call closest to `page` inside an expression subtree.
 * e.g. for `page.locator('a').filter(...)` returns the `page.locator('a')` call.
 */
function findLocatorCall(
  node: ts.Node,
  sf: ts.SourceFile
): { strategy: SelectorStrategy; arg?: string; expressionText: string } | undefined {
  let found:
    | { strategy: SelectorStrategy; arg?: string; expressionText: string }
    | undefined;

  const visit = (n: ts.Node) => {
    if (found) return;
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const callee = n.expression;
      if (LOCATOR_STRATEGIES.has(callee.name.text) && isPageLike(callee.expression)) {
        found = {
          strategy: callee.name.text as SelectorStrategy,
          arg: firstStringArg(n),
          expressionText: node.getText(sf),
        };
        return;
      }
    }
    n.forEachChild(visit);
  };

  visit(node);
  return found;
}

/** Walk leftwards through an expression to find the `this.<name>` it is rooted at. */
function findThisMemberBase(expr: ts.Expression): string | undefined {
  let node: ts.Expression = expr;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (ts.isPropertyAccessExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ThisKeyword) return node.name.text;
      node = node.expression;
    } else if (ts.isCallExpression(node)) {
      node = node.expression;
    } else if (ts.isElementAccessExpression(node)) {
      node = node.expression;
    } else if (ts.isNonNullExpression(node) || ts.isParenthesizedExpression(node)) {
      node = node.expression;
    } else {
      return undefined;
    }
  }
}

/** Extract ordered (locator, action) steps from a function/method body. */
function extractSteps(body: ts.Node | undefined, sf: ts.SourceFile): ActionStep[] {
  if (!body) return [];
  const hits: { pos: number; step: ActionStep }[] = [];

  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const action = n.expression.name.text;
      if (ACTION_METHODS.has(action)) {
        const base = findThisMemberBase(n.expression.expression);
        if (base) hits.push({ pos: n.getStart(sf), step: { locatorName: base, action } });
      }
    }
    n.forEachChild(visit);
  };
  visit(body);

  hits.sort((a, b) => a.pos - b.pos);
  return hits.map((h) => h.step);
}

function paramNames(params: ts.NodeArray<ts.ParameterDeclaration>, sf: ts.SourceFile): string[] {
  return params.map((p) => p.name.getText(sf));
}

// ---- class extraction ------------------------------------------------------

function parseClass(cls: ts.ClassDeclaration, filePath: string, sf: ts.SourceFile): PageClass | undefined {
  const name = cls.name?.text;
  if (!name) return undefined;

  const locators = new Map<string, LocatorDecl>();
  const methods: MethodDecl[] = [];

  const addLocator = (memberName: string, init: ts.Node) => {
    if (locators.has(memberName)) return;
    const loc = findLocatorCall(init, sf);
    if (loc) {
      locators.set(memberName, { name: memberName, strategy: loc.strategy, arg: loc.arg, expressionText: loc.expressionText });
    }
  };

  for (const member of cls.members) {
    // Property: either a function (method) or a locator initializer
    if (ts.isPropertyDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
      const init = member.initializer;
      if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
        methods.push({
          name: member.name.text,
          params: paramNames(init.parameters, sf),
          steps: extractSteps(init.body, sf),
        });
      } else if (init) {
        addLocator(member.name.text, init);
      }
      continue;
    }

    // Getter returning a locator
    if (ts.isGetAccessorDeclaration(member) && member.name && ts.isIdentifier(member.name) && member.body) {
      addLocator(member.name.text, member.body);
      continue;
    }

    // Regular method
    if (ts.isMethodDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
      methods.push({
        name: member.name.text,
        params: paramNames(member.parameters, sf),
        steps: extractSteps(member.body, sf),
      });
      continue;
    }

    // Constructor: harvest `this.<name> = <locator>` assignments
    if (ts.isConstructorDeclaration(member) && member.body) {
      for (const stmt of member.body.statements) {
        if (!ts.isExpressionStatement(stmt)) continue;
        const e = stmt.expression;
        if (
          ts.isBinaryExpression(e) &&
          e.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          ts.isPropertyAccessExpression(e.left) &&
          e.left.expression.kind === ts.SyntaxKind.ThisKeyword
        ) {
          addLocator(e.left.name.text, e.right);
        }
      }
    }
  }

  return { name, filePath, locators: Array.from(locators.values()), methods };
}

// ---- public API ------------------------------------------------------------

/** Parse a single page-object source file. */
export function parsePomSource(filePath: string, source: string): ParsePomResult {
  const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, /*setParentNodes*/ true);
  const pages: PageClass[] = [];
  const warnings: string[] = [];

  const collect = (node: ts.Node) => {
    if (ts.isClassDeclaration(node)) {
      const page = parseClass(node, filePath, sf);
      if (page) {
        if (page.locators.length === 0 && page.methods.length === 0) {
          warnings.push(`${filePath}: class "${page.name}" has no recognized locators or methods`);
        }
        pages.push(page);
      }
    }
    node.forEachChild(collect);
  };
  collect(sf);

  return { pages, warnings };
}

/** Parse many files, aggregating pages and warnings. */
export function parsePomSources(files: { filePath: string; source: string }[]): ParsePomResult {
  const pages: PageClass[] = [];
  const warnings: string[] = [];
  for (const f of files) {
    const r = parsePomSource(f.filePath, f.source);
    pages.push(...r.pages);
    warnings.push(...r.warnings);
  }
  return { pages, warnings };
}
