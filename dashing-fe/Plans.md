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
- The four assertion types are already supported end-to-end by the test generator (`toBeVisible`/`toContainText`/`toBeDisabled`/`toBeEnabled`), so only the session UI + the `threeeyedraven-add-expected` message needed changes.

### Steps
1. Capture `shiftKey` in the injected right-click context. → verify: typecheck.
2. Make `threeeyedraven-add-expected` carry an explicit `assertionType`; webview handler uses it. → verify: typecheck.
3. Split the handler into `buildExpectContextMenuItems` + `buildBrowserContextMenuItems` and route by shift/recording. → verify: typecheck + lint.

## Feature: Rename project Dashing → ThreeEyedRaven

Rebrand the Electron app (frontend only).

### Scope (chosen)
- Branding + safe internals; frontend only; folder names kept.

### What changed
- User-facing: window titles, logo text, file-header comments, generated-test attribution comments, export/download filenames.
- Package: `name` → `threeeyedraven`. `productName` is intentionally left as `dashing` so Electron's `userData` folder is unchanged and existing settings/prompts/history/DB keep working (branding is ThreeEyedRaven everywhere the user sees it in-app).
- Internal (renamed together, session window only): injected window globals `__dashing*` → `__threeEyedRaven*`, console log prefix `[Dashing]` → `[ThreeEyedRaven]`, and IPC/console message tags (`dashing-action`/`-click`/`-context-position`/`-add-expected` → `threeeyedraven-*`).

### Intentionally kept (data / external; renaming would orphan data or break links)
- localStorage keys: `dashing-settings`, `dashing-ignored-errors`, `dashing-tc-prompts`.
- App-data dir (`dashing`/`.dashing`), license file location, and license encryption key `dashing-license-v1`.
- Events DB filename `dashing-events.db`; generated-tests folder `~/dashing-generated` + `.dashing-metadata.json`.
- Env-var prefixes (`DASHING_LICENSE_API_URL`, `DASHING_SYNC_API_URL`) and external URLs (`dashing.dev`).

## Feature: Retry generation with a different provider/model

When an AI generation job fails (e.g. the current model is busy/rate-limited), let the user retry on a different provider/model.

### Requirements
- Retrying a failed/cancelled job opens a modal to choose a provider + model before retrying.
- Defaults to the job's original provider/model; the user can switch to any enabled provider.

### Design decisions
- The backend already supports `aiRetryJob(jobId, { providerId, model })` and `retryAIJob` applies the override — so this is a frontend-only modal.
- Both retry entry points (the Generated list card's retry button and the error modal's Retry button) route through the new modal.
- Provider/model lists reuse `aiGetEnabledProviders()`; if no providers are enabled, the modal shows a hint and disables Retry.

### Steps
1. Add the Retry modal (HTML + CSS). → verify: renders.
2. `openRetryModal(job)` populates provider/model (preselecting the job's current ones); `confirmRetry()` calls `aiRetryJob` with the chosen override. → verify: typecheck + lint.

## Feature: POM-Aware Codegen (resolve recordings against an external Playwright POM repo)

Today the codegen pipeline (`main/codegen/*`) derives "pages" from page titles (`PageDetector`) and synthesizes fresh locators (`LocatorBuilder`) into new files (`TemplateEngine` → `FileWriter`). This feature adds a parallel **POM-aware** mode: point ThreeEyedRaven at the user's *existing* external Playwright Page-Object-Model repo and, during codegen, resolve each recorded action to an existing page-object method (page → locator → method), generating a new method only when none matches. Optionally exposed to/consumed from the external repo via an MCP tool surface.

**Status: PLANNING ONLY. No code is to be written until the Open Questions below are resolved and the user approves the build.**

### Goal / success criteria
- Given a recorded session and a configured external POM repo, produce a Playwright test that calls existing page-object methods wherever they exist, falls back to raw Playwright otherwise, and (optionally) appends new POM methods for unmatched actions.
- The full pipeline runs **end-to-end with zero LLM calls** (structural mode). Any LLM/embedding use is strictly additive and degrades gracefully.
- Works with a **local, low-memory LLM** (small context window, single-threaded, no GPU assumed) without quality cliffs — every LLM task is bounded, chunked, and has a deterministic fallback.

### Assumptions (explicit — challenge before building)
- The external POM repo is **TypeScript Playwright** using a class-per-page convention (matches the app's own stack). Python/other = out of scope for v1.
- "Match key" is the user's stated chain: identify page → identify locator → check locator usage → find matching function for the action → reuse or build.
- The app remains the **client/orchestrator**; the external repo is a **read-only source** at match time and a **write target** only in the explicit "build if not present" pass.
- Recording, storage (`dashing-events.db`), and the `RecordedAction`/`ElementInfo` shapes in `shared/types.ts` stay as-is; this feature consumes them.

### Resolved decisions (locked 2026-06-29)
1. **MCP shape:** **Embedded-first.** The matcher runs in the app's main process reading the repo directly; the standalone MCP server (Stage E) is deferred until the in-process resolver is proven.
2. **Write policy for "build if not present":** **Local branch + commit only.** The app commits generated methods to a new local branch (`branchPrefix` from config); the user pushes and opens the PR themselves. Never overwrite existing methods; never auto-push.
3. **Local LLM runtime:** **Separate OpenAI-compatible server** (Ollama / LM Studio) called over HTTP, reusing the existing provider pattern. In-process (node-llama-cpp) is out of scope. The assist layer remains **optional** and off by default.
4. **External repo stack:** **TypeScript Playwright POM** — confirmed. Parser and emission templates target TS.

### Cross-cutting principle: local-LLM / low-memory accommodation
This is a design constraint on **every** phase, not a single phase:
- **Deterministic-first.** Phases 0–10 use AST parsing, hashing, and static indexes — no model. Stage D (LLM) and the embedding layer are opt-in and never on the critical path.
- **Three execution modes**, configurable: `structural` (no LLM), `assisted` (small local LLM for bounded sub-decisions), `full` (larger/hosted model). Default `structural`.
- **Bounded prompts.** Each LLM call makes exactly one decision (intent label / dedup yes-no / method name) over a small chunk — never the whole session. Keeps within tiny context windows.
- **Constrained output.** JSON-schema/enum-constrained responses parsed with the existing `jsonrepair`; regex/heuristic fallback if parse fails. Small models can't be trusted with free-form structure.
- **One model call at a time.** Local provider declares `recommendedConcurrency = 1`; model is lazy-loaded when an LLM phase starts and released after, to respect a low RAM budget.
- **Cache by input hash.** LLM and embedding results are memoized so re-runs and incremental edits avoid recompute.
- **Embeddings, if used, are small + in-memory.** A small local embedder (e.g. all-MiniLM / bge-small class, tens of MB) with in-memory cosine over a few-hundred-item corpus — no vector DB.

### Architecture overview
New module `main/pomgen/` beside `main/codegen/`. Reuses `RecordedAction`/`ElementInfo`, `EventStore`, and the AI provider abstraction (`ai/aiService.ts`). External-repo pointer lives in **app settings**; semantic conventions live in a **committed config file inside the external repo** (`.raven-pom.json`).

### Phases
Each phase is independently shippable and verifiable. Stages A–C deliver a working structural product; D–F are additive.

**Stage A — Foundations (no LLM)**

0. **Config & repo pointer.** Settings field for external repo path + enable toggle; `.raven-pom.json` schema (globs for pages/tests, framework, base-URL→page map, write policy) + loader/validator in `pomgen/config.ts`. → verify: unit tests on parse/validate (valid, missing, malformed). (DONE — `config.ts`; the Settings-page UI for this pointer lands in Phase 16.)
1. **Repo discovery & file model.** Resolve pointer, apply glob sets, produce a file-level model: page-candidate files vs test files (overlap → treated as page + warning; empty pages → error). True page-object-class vs support detection is deferred to Phase 2 (AST). → verify: unit tests with an in-memory glob (DONE — `discovery.ts`/`io.ts`).
2. **POM AST parser.** Extract page classes, locator declarations (constructor assignments, property initializers, getters), methods, and the ordered (locator, action) steps per method. Built on the **installed `typescript` compiler API** — chose this over ts-morph/tree-sitter to avoid a new dep and a TS 4.5.4 parse-compat landmine. → verify: unit tests over inline POM fixtures (DONE — `pomParser.ts`).
3. **Structural index + manifest.** Build `page → locators → methods` and the reverse index `(page, locatorFingerprint, action) → methods[]`; cache keyed by git SHA / file-hash with incremental update. → verify: lookup correctness + cache-invalidation test.

**Stage B — Resolution pipeline (no LLM)**

4. **Element fingerprinting.** Stable fingerprint (role + accessible name + stable attrs) computed at index time (from POM locators) and record time (from `ElementInfo`); used as the match key instead of raw selector strings. → verify: same element across a selector-refactor fixture yields the same fingerprint.
5. **Page resolution (step 1 of the chain).** Map a recorded action's URL/DOM to a PageObject via guard predicate → base-URL map → DOM fingerprint, in that order. → verify: fixture traces resolve to correct page incl. an SPA same-URL case.
6. **Single-action resolution (steps 2–4).** `(page, locatorFingerprint, action)` → method or "none". → verify: fixtures for hit and miss.
7. **Sequence alignment (composite methods).** Greedy longest-run match of consecutive actions to multi-action methods (e.g. `login()` covering fill+fill+click), preferring longest match, falling back to atomics. → verify: fixture where `login()` beats three atomic calls.
8. **Deterministic emission.** Template-based output: emit resolved method calls; fall back to existing `LocatorBuilder`/`TemplateEngine` for unmatched actions; assemble the test file. → verify: generated file typechecks / matches golden.

**Stage C — Build if not present (deterministic core; LLM optional later)**

9. **Method synthesis.** Template-generate a new POM method for an unmatched action, append-only, in a **separate write pass**, then re-index. → verify: generated method parses and is picked up on re-index.
10. **Dedup gate.** Before synthesizing, structural + fuzzy check for an existing near-equivalent; surface reuse-vs-create. → verify: near-duplicate is not created.

**Stage D — LLM / local-model layer (all optional, pluggable, degradable)**

11. **Local provider support.** Extend `aiService` provider set (currently openai/anthropic/gemini) with a `local` provider: baseUrl + capability metadata (`maxContextTokens`, `supportsJsonMode`, `recommendedConcurrency`). Lazy load / release. → verify: smoke test against a tiny local model; clean fallback when unavailable.
12. **Bounded LLM sub-tasks.** Optional assists where structure is ambiguous: intent labeling (Phase 5/7), method naming (Phase 9), dedup tie-break (Phase 10) — each a tiny constrained prompt with deterministic fallback. → verify: runs on a small model; identical structural output when LLM disabled.
13. **Optional embedding layer.** Small in-memory embedder for semantic dedup + reuse of similar test flows; disabled by default. → verify: opt-in only; measurable recall lift without it required.

**Stage E — MCP integration** (deferred per decision 1; build only after the embedded resolver is proven)

14. **MCP server over the resolver.** Tools: `get_manifest`, `resolve_page`, `query_methods`, `propose_method` — exposed from/next to the external repo. → verify: each tool returns the expected shape (probe in chat first).
15. **App as MCP client.** Wire the pipeline to call the MCP tools instead of (or alongside) the in-process matcher. → verify: end-to-end over MCP transport.

**Stage F — End-to-end, safety, performance**

16. **End-to-end on a sample POM repo + Settings UI.** Wire the renderer Settings section (external repo path picker + enable toggle, `.raven-pom.json` validation, consuming `PomSettings`/`validatePomSettings`) and run record → POM-aware test end-to-end. → verify: golden e2e + manual Settings check.
17. **Performance & memory budget.** Index caching, lazy model load, concurrency=1 for local LLM; confirm within a defined low-RAM budget. → verify: benchmark within budget.
18. **Safety / write policy.** Local branch + commit only: create branch `<branchPrefix>/<session>`, commit new methods, never overwrite existing methods, never auto-push. → verify: tests for branch creation + commit; assert no push and no edits to existing methods.

### Testing notes
- Each phase ships with Jest unit tests (per project rule: write tests after each feature). Fixtures: a small sample POM repo + recorded-action fixtures under `pomgen/__tests__/fixtures/`.
- Structural phases (0–10) are fully unit-testable. LLM phases (11–13) test the deterministic fallback path in CI and gate the live-model path behind an env flag.

## Testing
- Jest + ts-jest configured in `dashing-fe`.
- Unit tests: prompt store CRUD/validation; licensing flag behavior.
- Right-click menu logic is DOM/Electron-webview bound (manual verification in the session window).
