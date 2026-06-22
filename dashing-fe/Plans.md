# Plans

## Feature: Custom Test-Case Generation Prompts

Let users view and manage the instruction prompts used for AI test-case generation.

### Requirements
- A "Prompts" section in Settings.
- One built-in **Default** prompt that is read-only and cannot be deleted.
- Users can add up to **10** custom prompts (name + instructions).
- Users pick which prompt to use when generating test cases (dropdown in the AI generation modal).

### Design decisions
- A "prompt" is the **system instructions / persona** only (e.g. "You are an expert QA engineer... focus on X"). The app keeps the action-injection and the strict JSON output templates intact so generation/parsing can never break.
- Prompts are stored in renderer `localStorage` under `dashing-tc-prompts`.
- The chosen prompt's instructions are threaded to the main process via the AI job options (`customInstructions`) and used as the persona for both the plan and detail passes.

### Steps
1. `shared/testCasePrompts.ts` — `DEFAULT_TC_INSTRUCTIONS`, `TestCasePrompt` type, `MAX_USER_PROMPTS`, pure helpers (`validatePromptInput`, `addPrompt`, `updatePrompt`, `deletePrompt`, `getInstructionsById`). → verify: unit tests pass.
2. `main/ai/prompts/testCaseGeneration.ts` — `buildPlanSystemPrompt(instructions?)`, `buildDetailSystemPrompt(instructions?)` composing custom persona + fixed structural directive. → verify: default output matches prior system strings.
3. Thread `customInstructions` through `aiGenerator` → `aiJobProcessor` → `eventStore` job options → `index.ts` → `preload`. → verify: typecheck.
4. Renderer: Prompts settings section (list/add/edit/delete, default read-only, 10 cap) + prompt dropdown in the generate modal; pass instructions on generate. → verify: build + manual.

## Feature: Hide Licensing & Sync (temporarily)

Hide licensing/sync UI and enable all features by default, without removing the code.

### Requirements
- All features enabled by default (no tier gating).
- Remove "Pro" tags in the SideNav and Settings.
- Hide Licensing and Cloud Sync UI (kept in code, re-enabled later).

### Design decisions
- Single source of truth flag `LICENSING_ENABLED` in `shared/config.ts` (currently `false`).
- When disabled: `isFeatureEnabled` → true, `getCurrentTier` → `enterprise`, `getStatus` → enterprise-licensed.
- Renderer hides the License & Sync settings card/subview, the History "Sync All" button, and any `.pro-badge` via the flag; the SideNav "PRO" tag is removed from markup.

### Steps
1. `shared/config.ts` flag; consume in `features.ts` / `licenseManager.ts`. → verify: unit test.
2. Renderer `applyLicensingVisibility()` hides licensing/sync elements when flag off. → verify: build + manual.

## Feature: Right-click menu split + explicit Expect assertions

Overload the session-window right-click so QA actions and browser actions live in separate menus.

### Requirements
- Normal right-click → the QA ("current") menu.
- Shift + right-click → the regular Chrome/browser options.
- Remove copy/paste/inspect/etc. from the QA menu now that they live under Shift+right-click.
- Split "Add as Expected" into four explicit options:
  1. Expect to be Visible (`visible`)
  2. Expect to Contain Text (`hasText`)
  3. Expect to be Disabled (`disabled`)
  4. Expect to be Enabled (`enabled`)

### Design decisions
- The recording webview already uses a styled HTML overlay menu (not the native menu); both menus are rendered through it. Shift+right-click reuses the overlay with the browser action set.
- Shift state is captured inside the injected webview `contextmenu` handler (`e.shiftKey`) and read by the host when building the menu (the native webview `context-menu` event can't report modifiers synchronously).
- Menu routing: shift OR not-recording → browser menu; recording + no shift → the four Expect options (+ a "Shift+Right-click for browser options" hint).
- The four assertion types are already supported end-to-end by the test generator (`toBeVisible`/`toContainText`/`toBeDisabled`/`toBeEnabled`), so only the session UI + the `dashing-add-expected` message needed changes.

### Steps
1. Capture `shiftKey` in the injected right-click context. → verify: typecheck.
2. Make `dashing-add-expected` carry an explicit `assertionType`; webview handler uses it. → verify: typecheck.
3. Split the handler into `buildExpectContextMenuItems` + `buildBrowserContextMenuItems` and route by shift/recording. → verify: typecheck + lint.

## Testing
- Jest + ts-jest configured in `dashing-fe`.
- Unit tests: prompt store CRUD/validation; licensing flag behavior.
- Right-click menu logic is DOM/Electron-webview bound (manual verification in the session window).
