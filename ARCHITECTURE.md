# ThreeEyedRaven — Architecture

```mermaid
flowchart TB
    subgraph Electron["Electron App (ThreeEyedRaven)"]
        subgraph Renderers["Renderer Processes"]
            Dashboard["Dashboard Window\ndashboard.ts\n─────────────\n• Session list & history\n• Settings & prompts\n• AI generation UI\n• Test case viewer"]
            Session["Session Window\nsession.ts\n─────────────\n• Live browser (WebView)\n• Action recording\n• Right-click context menu\n• Error capture"]
        end

        subgraph Preload["Preload — contextBridge IPC"]
            DashPre["dashboardPreload.ts"]
            SessPre["sessionPreload.ts"]
        end

        subgraph Main["Main Process"]
            Index["index.ts\nipcMain handlers"]
            SessMgr["sessionManager.ts\nrecording state"]
            EventStore[("eventStore.ts\nSQLite\ndashing-events.db")]

            subgraph AI["AI Subsystem  main/ai/"]
                AISvc["aiService.ts\nprovider routing"]
                AIJob["aiJobProcessor.ts"]
                AIGen["aiGenerator.ts"]
                AIComp["aiCompletion.ts"]
            end

            subgraph Codegen["Standard Codegen  main/codegen/"]
                PageDet["pageDetector.ts"]
                LocBld["locatorBuilder.ts"]
                TplEng["templateEngine.ts"]
                FileWr["fileWriter.ts"]
            end

            subgraph POMGen["POM-Aware Codegen  main/pomgen/"]
                POMCfg["config.ts\n.raven-pom.json loader"]
                POMDisc["discovery.ts\nglob → file model"]
                POMParse["pomParser.ts\nTypeScript AST"]
                POMRes["resolution pipeline\n(phases 4–10, planned)"]
            end

            LicMgr["licensing/\nlicenseManager.ts\nfeatures.ts"]
            SyncSvc["sync/\nsyncService.ts"]
            Enc["encryption.ts"]
        end
    end

    subgraph Backend["Backend  dashing-be  :3001"]
        Express["Express.js"]
        Routes["/auth  /sessions\n/actions  /errors"]
        Prisma["Prisma ORM"]
        PG[("PostgreSQL")]
    end

    subgraph AIProviders["AI Providers"]
        OpenAI["OpenAI"]
        Anthropic["Anthropic"]
        Gemini["Google Gemini"]
        LocalLLM["Local LLM\nOllama / LM Studio"]
    end

    subgraph Outputs["Outputs"]
        TestFiles["~/dashing-generated/\nPlaywright .ts test files"]
        ExtRepo["External POM Repo\nnew branch + commit\n(TypeScript Playwright)"]
    end

    LicServer["dashing.dev\nLicense Server"]

    %% Renderer ↔ Preload ↔ Main
    Dashboard <-->|contextBridge| DashPre
    Session   <-->|contextBridge| SessPre
    DashPre   <-->|ipcMain / ipcRenderer| Index
    SessPre   <-->|ipcMain / ipcRenderer| Index

    %% Main internal
    Index --> SessMgr
    Index --> AI
    Index --> Codegen
    Index --> POMGen
    SessMgr --> EventStore
    AIJob   --> EventStore

    %% AI flow
    AIJob --> AIGen --> AISvc
    AIComp --> AISvc
    AISvc --> OpenAI
    AISvc --> Anthropic
    AISvc --> Gemini
    AISvc --> LocalLLM

    %% Codegen flow
    PageDet --> LocBld --> TplEng --> FileWr --> TestFiles

    %% POMGen flow
    POMCfg --> POMDisc --> POMParse --> POMRes
    POMRes -->|fallback to| Codegen
    POMRes --> ExtRepo

    %% Cloud
    SyncSvc <-->|HTTP + API Key| Express
    Express --> Routes --> Prisma --> PG

    %% Licensing
    LicMgr <-->|HTTPS| LicServer
    LicMgr --> Enc
```

## Component summary

| Layer | Technology | Responsibility |
|---|---|---|
| **Renderer — Dashboard** | TypeScript + HTML/CSS | Session management, settings, AI job UI, test history |
| **Renderer — Session** | TypeScript + Electron WebView | Live browser recording, DOM action capture, context menus |
| **Preload** | Electron contextBridge | Secure IPC bridge (no `remote`, no `nodeIntegration`) |
| **Main Process** | TypeScript / Node | Orchestrates all subsystems via `ipcMain` |
| **eventStore** | SQLite (`better-sqlite3`) | Persists recorded actions, errors, sessions, AI jobs |
| **AI subsystem** | `aiService` + provider adapters | Routes generation jobs to OpenAI / Anthropic / Gemini / local LLM |
| **Standard Codegen** | AST + templates | Derives pages + locators from recordings → Playwright `.ts` files |
| **POM-Aware Codegen** | TypeScript Compiler API | Resolves recorded actions against an existing external POM repo; emits method calls or appends new methods on a local branch |
| **Licensing** | Custom + dashing.dev | Feature gating; encryption of license keys |
| **Sync** | HTTP client | Uploads sessions/actions/errors to the backend for cloud history |
| **Backend (dashing-be)** | Express + Prisma + PostgreSQL | Cloud sync API; license activation; multi-user session storage |
| **AI Providers** | OpenAI / Anthropic / Gemini / Local | LLM completions for test-case generation |
```
