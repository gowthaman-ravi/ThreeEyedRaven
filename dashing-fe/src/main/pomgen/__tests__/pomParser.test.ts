import { PageClass, parsePomSource, parsePomSources } from '../pomParser';

function onePage(source: string): PageClass {
  const { pages } = parsePomSource('LoginPage.ts', source);
  expect(pages).toHaveLength(1);
  return pages[0];
}

describe('parsePomSource — locator declarations', () => {
  it('extracts constructor-assigned locators with strategies and args', () => {
    const page = onePage(`
      import { Page, Locator } from '@playwright/test';
      export class LoginPage {
        readonly page: Page;
        readonly usernameField: Locator;
        readonly passwordField: Locator;
        readonly submitButton: Locator;
        constructor(page: Page) {
          this.page = page;
          this.usernameField = page.locator('#username');
          this.passwordField = page.getByLabel('Password');
          this.submitButton = page.getByRole('button', { name: 'Log in' });
        }
      }
    `);
    expect(page.name).toBe('LoginPage');
    const byName = Object.fromEntries(page.locators.map((l) => [l.name, l]));
    expect(byName.usernameField).toMatchObject({ strategy: 'locator', arg: '#username' });
    expect(byName.passwordField).toMatchObject({ strategy: 'getByLabel', arg: 'Password' });
    expect(byName.submitButton).toMatchObject({ strategy: 'getByRole', arg: 'button' });
    // `this.page = page` must NOT be picked up as a locator
    expect(byName.page).toBeUndefined();
  });

  it('extracts property-initializer locators (this.page form)', () => {
    const page = onePage(`
      export class P {
        readonly email = this.page.getByTestId('email');
        readonly banner = this.page.locator('.banner').first();
        constructor(private page) {}
      }
    `);
    const byName = Object.fromEntries(page.locators.map((l) => [l.name, l]));
    expect(byName.email).toMatchObject({ strategy: 'getByTestId', arg: 'email' });
    // chained .first() still resolves to the page.locator(...) factory
    expect(byName.banner).toMatchObject({ strategy: 'locator', arg: '.banner' });
  });

  it('extracts getter-style locators', () => {
    const page = onePage(`
      export class P {
        constructor(private page) {}
        get saveButton() { return this.page.getByRole('button', { name: 'Save' }); }
      }
    `);
    expect(page.locators).toContainEqual(
      expect.objectContaining({ name: 'saveButton', strategy: 'getByRole', arg: 'button' })
    );
  });
});

describe('parsePomSource — methods & action steps', () => {
  const source = `
    export class LoginPage {
      constructor(private page) {}
      readonly usernameField = this.page.locator('#u');
      readonly passwordField = this.page.locator('#p');
      readonly submitButton = this.page.getByRole('button', { name: 'Log in' });
      readonly rememberRow = this.page.locator('.remember');

      async enterUsername(value: string) {
        await this.usernameField.fill(value);
      }

      async login(user: string, pass: string) {
        await this.usernameField.fill(user);
        await this.passwordField.fill(pass);
        await this.submitButton.click();
      }

      async toggleRemember() {
        await this.rememberRow.getByRole('checkbox').check();
      }

      titleText() {
        return this.usernameField.inputValue();
      }
    }
  `;

  it('captures method params', () => {
    const page = onePage(source);
    const login = page.methods.find((m) => m.name === 'login')!;
    expect(login.params).toEqual(['user', 'pass']);
  });

  it('captures ordered (locator, action) steps for a composite method', () => {
    const page = onePage(source);
    const login = page.methods.find((m) => m.name === 'login')!;
    expect(login.steps).toEqual([
      { locatorName: 'usernameField', action: 'fill' },
      { locatorName: 'passwordField', action: 'fill' },
      { locatorName: 'submitButton', action: 'click' },
    ]);
  });

  it('resolves the base locator through a chained locator action', () => {
    const page = onePage(source);
    const toggle = page.methods.find((m) => m.name === 'toggleRemember')!;
    expect(toggle.steps).toEqual([{ locatorName: 'rememberRow', action: 'check' }]);
  });

  it('ignores non-action calls (e.g. inputValue)', () => {
    const page = onePage(source);
    const title = page.methods.find((m) => m.name === 'titleText')!;
    expect(title.steps).toEqual([]);
  });

  it('treats arrow-function class properties as methods', () => {
    const page = onePage(`
      export class P {
        constructor(private page) {}
        readonly field = this.page.locator('#x');
        doThing = async (v) => { await this.field.fill(v); };
      }
    `);
    const m = page.methods.find((x) => x.name === 'doThing')!;
    expect(m.params).toEqual(['v']);
    expect(m.steps).toEqual([{ locatorName: 'field', action: 'fill' }]);
    // the arrow property is a method, not a locator
    expect(page.locators.map((l) => l.name)).toEqual(['field']);
  });
});

describe('parsePomSource — edge cases', () => {
  it('handles multiple classes in one file', () => {
    const { pages } = parsePomSource('multi.ts', `
      export class A { constructor(private page){} a = this.page.locator('#a'); }
      export class B { constructor(private page){} b = this.page.locator('#b'); }
    `);
    expect(pages.map((p) => p.name)).toEqual(['A', 'B']);
  });

  it('warns for a class with no recognized locators or methods', () => {
    const { pages, warnings } = parsePomSource('empty.ts', `export class Empty {}`);
    expect(pages).toHaveLength(1);
    expect(warnings[0]).toMatch(/has no recognized locators or methods/);
  });

  it('aggregates across files with parsePomSources', () => {
    const { pages } = parsePomSources([
      { filePath: 'A.ts', source: `export class A { constructor(private page){} a = this.page.locator('#a'); }` },
      { filePath: 'B.ts', source: `export class B { constructor(private page){} b = this.page.locator('#b'); }` },
    ]);
    expect(pages.map((p) => `${p.filePath}:${p.name}`)).toEqual(['A.ts:A', 'B.ts:B']);
  });
});
