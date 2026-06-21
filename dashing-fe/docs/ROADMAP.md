# Dashing - QA Intelligence Platform Roadmap

> **Version:** 1.0  
> **Last Updated:** February 20, 2026  
> **Status:** Living Document

---

## Table of Contents

1. [Vision & Overview](#vision--overview)
2. [Architecture](#architecture)
3. [Completed Phases](#completed-phases)
4. [Phase 4: Local API Server](#phase-4-local-api-server)
5. [Phase 5: Real-Time Features](#phase-5-real-time-features)
6. [Phase 6: Test Code Generation](#phase-6-test-code-generation)
7. [Phase 7: Test Case Generation](#phase-7-test-case-generation)
8. [Phase 8: Coverage Analysis & Suggestions](#phase-8-coverage-analysis--suggestions)
9. [Phase 9: JIRA Integration](#phase-9-jira-integration)
10. [Feature Tier Matrix](#feature-tier-matrix)
11. [Implementation Priority](#implementation-priority)
12. [Technical Specifications](#technical-specifications)
13. [Data Models](#data-models)
14. [API Contracts](#api-contracts)
15. [Comparison with Alternatives](#comparison-with-alternatives)

---

## Vision & Overview

### What is Dashing?

Dashing is a **QA Intelligence Platform** that transforms manual testing into actionable automation. It bridges the gap between exploratory testing and automated regression by:

1. **Recording** user actions during manual QA sessions
2. **Capturing** errors, network failures, and console logs in real-time
3. **Generating** test code from recorded sessions
4. **Suggesting** test cases and coverage gaps
5. **Integrating** with project management tools (JIRA)

### Target Users

- **Primary:** QA Engineers performing manual/exploratory testing
- **Secondary:** SDETs looking to bootstrap automation from manual testing
- **Tertiary:** Engineering managers tracking test coverage

### Value Proposition

| Traditional QA | With Dashing |
|---------------|--------------|
| Manual testing = lost knowledge | Manual testing → Documented sessions |
| No visibility into QA activities | Real-time error capture & insights |
| Automation requires starting from scratch | Generate Playwright/Cypress from sessions |
| Test coverage is guesswork | AI-powered coverage analysis |
| Siloed QA and development | JIRA integration bridges the gap |

---

## Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          DASHING ECOSYSTEM                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     ELECTRON APP (Local)                             │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌────────────┐  │   │
│  │  │ Dashboard   │  │ Session     │  │ Action      │  │ Error      │  │   │
│  │  │ Window      │  │ Windows     │  │ Recorder    │  │ Capture    │  │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └────────────┘  │   │
│  │                           │                                          │   │
│  │  ┌─────────────────────────────────────────────────────────────┐    │   │
│  │  │                    LOCAL STORAGE (SQLite)                    │    │   │
│  │  │  Sessions | Actions | Errors | Sync Queue | Settings        │    │   │
│  │  └─────────────────────────────────────────────────────────────┘    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                                    │ Cloud Sync (Pro/Enterprise)            │
│                                    ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     BACKEND API (Cloud)                              │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌────────────┐  │   │
│  │  │ Session     │  │ Sync        │  │ AI Engine   │  │ Integration│  │   │
│  │  │ Storage     │  │ Service     │  │ (OpenAI)    │  │ Hub        │  │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └────────────┘  │   │
│  │                           │                                          │   │
│  │  ┌─────────────────────────────────────────────────────────────┐    │   │
│  │  │                    POSTGRESQL (Supabase)                     │    │   │
│  │  │  Organizations | Users | Sessions | Actions | Errors         │    │   │
│  │  └─────────────────────────────────────────────────────────────┘    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Component Overview

| Component | Technology | Purpose |
|-----------|------------|---------|
| Electron App | Electron + TypeScript | Desktop application for QA |
| Dashboard | HTML/CSS/TS | Session management, settings, reports |
| Session Windows | Webview | Browser instances for testing |
| Local Storage | SQLite (sql.js) | Persistent local data |
| Backend API | Node.js + Express | Cloud sync, AI processing |
| Database | PostgreSQL (Supabase) | Multi-tenant data storage |
| AI Engine | OpenAI API | Test generation, suggestions |

---

## Completed Phases

### Phase 1: Core Recording (✅ Complete)

| Feature | Description | Status |
|---------|-------------|--------|
| Multi-window sessions | Create sessions with multiple browser windows | ✅ |
| Tab management | Multiple tabs per window | ✅ |
| Action recording | Click, type, scroll, navigate, hover, drag, etc. | ✅ |
| Element capture | CSS selectors, XPath, attributes | ✅ |
| Session state | Start, pause, resume, end sessions | ✅ |

**Technical Details:**
- Actions are captured via injected JavaScript in webviews
- Debouncing/throttling prevents duplicate events
- Element selectors prioritize: data-testid > id > CSS > XPath

### Phase 2: Error Capture (✅ Complete)

| Feature | Description | Status |
|---------|-------------|--------|
| HTTP errors | 4xx, 5xx response capture | ✅ |
| Console errors | JavaScript runtime errors | ✅ |
| Network failures | Connection failures, timeouts | ✅ |
| Error filtering | Ignore Electron/webpack internal errors | ✅ |
| Ignored patterns | User can ignore specific error patterns | ✅ |

**Technical Details:**
- HTTP errors captured via `webRequest.onCompleted` with status >= 400
- Console errors captured via `console-message` event
- Errors are deduplicated and filtered to remove framework noise

### Phase 3A: Licensing (✅ Complete)

| Feature | Description | Status |
|---------|-------------|--------|
| License tiers | Free, Pro, Enterprise | ✅ |
| Feature gating | Tier-based feature access | ✅ |
| License validation | Online/offline validation | ✅ |
| Grace period | 7-day offline grace period | ✅ |

**Tier Definitions:**
```typescript
const TIERS = {
  free: {
    maxActiveSessions: 2,
    maxWindowsPerSession: 3,
    features: ['BASIC_RECORDING', 'ERROR_CAPTURE', 'LOCAL_STORAGE']
  },
  pro: {
    maxActiveSessions: 10,
    maxWindowsPerSession: 10,
    features: ['CLOUD_SYNC', 'CODE_GENERATION', 'COVERAGE_REPORTS']
  },
  enterprise: {
    maxActiveSessions: -1, // unlimited
    maxWindowsPerSession: -1,
    features: ['AI_INSIGHTS', 'JIRA_INTEGRATION', 'TEAM_ANALYTICS']
  }
};
```

### Phase 3B: Cloud Sync (✅ Complete)

| Feature | Description | Status |
|---------|-------------|--------|
| Session sync | Upload sessions to cloud | ✅ |
| Action sync | Batch upload actions | ✅ |
| Error sync | Batch upload errors | ✅ |
| Sync queue | Persistent queue with retry | ✅ |
| Auto-sync | Sync on session end | ✅ |
| Config persistence | Save API URL/key to disk | ✅ |

**API Endpoints:**
- `POST /sessions` - Create/update session
- `POST /sessions/:id/actions` - Batch upload actions
- `POST /sessions/:id/errors` - Batch upload errors

### Phase 3C: Sync Enhancements (✅ Complete)

| Feature | Description | Status |
|---------|-------------|--------|
| Auto-sync on end | Sync when session ends | ✅ |
| Sync status badges | Visual sync status on cards | ✅ |
| Sync All button | Batch sync all history | ✅ |
| Progress indicator | Real-time sync progress | ✅ |

---

## Phase 4: Local API Server

### Overview

Expose session data via a local REST API for integration with external tools, scripts, and CI/CD pipelines.

### Objective

Allow developers and automation engineers to programmatically access Dashing data without going through the cloud.

### Sub-Phases

#### Phase 4A: Basic REST API (Priority: MEDIUM)

**Endpoints:**

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/sessions` | List all sessions |
| GET | `/api/sessions/:id` | Get session details |
| GET | `/api/sessions/:id/actions` | Get actions for session |
| GET | `/api/sessions/:id/errors` | Get errors for session |
| POST | `/api/sessions/:id/export` | Export session to file |
| GET | `/api/health` | Health check |

**Implementation:**
```typescript
// Local Express server running inside Electron
import express from 'express';

const localApiServer = express();
const LOCAL_API_PORT = 7890;

localApiServer.get('/api/sessions', async (req, res) => {
  const sessions = await eventStore.getAllSessions();
  res.json({ success: true, data: sessions });
});

localApiServer.get('/api/sessions/:id/actions', async (req, res) => {
  const actions = await eventStore.getActionsBySession(req.params.id);
  res.json({ success: true, data: actions });
});

// Start server
localApiServer.listen(LOCAL_API_PORT, '127.0.0.1', () => {
  console.log(`Local API server running on http://localhost:${LOCAL_API_PORT}`);
});
```

**Configuration:**
```typescript
interface LocalApiConfig {
  enabled: boolean;
  port: number;           // Default: 7890
  allowedOrigins: string[]; // CORS origins
  requireAuth: boolean;   // API key authentication
  apiKey?: string;
}
```

**Effort:** 1 week  
**Tier:** Pro

---

#### Phase 4B: Export Formats (Priority: LOW)

**Supported Formats:**

| Format | Use Case | Extension |
|--------|----------|-----------|
| JSON | Raw data export | `.json` |
| CSV | Spreadsheet import | `.csv` |
| HAR | Network analysis | `.har` |
| JUnit XML | CI/CD integration | `.xml` |

**API:**
```typescript
// POST /api/sessions/:id/export
interface ExportRequest {
  format: 'json' | 'csv' | 'har' | 'junit';
  includeActions: boolean;
  includeErrors: boolean;
  includeScreenshots: boolean;
}

interface ExportResponse {
  success: boolean;
  filePath: string;
  fileSize: number;
  format: string;
}
```

**Effort:** 1 week  
**Tier:** Pro

---

## Phase 5: Real-Time Features

### Overview

Enable real-time communication between the Electron app, backend, and external tools using WebSockets.

### Sub-Phases

#### Phase 5A: WebSocket Connection (Priority: LOW)

**Objective:** Establish persistent WebSocket connection for real-time updates.

**Use Cases:**
1. Real-time sync status updates
2. Live session streaming to dashboard
3. Multi-user collaboration (future)
4. Push notifications from backend

**Implementation:**
```typescript
// Client (Electron)
import { io, Socket } from 'socket.io-client';

class RealtimeService {
  private socket: Socket | null = null;
  
  connect(apiUrl: string, apiKey: string): void {
    this.socket = io(apiUrl, {
      auth: { apiKey },
      transports: ['websocket'],
    });
    
    this.socket.on('connect', () => {
      console.log('[Realtime] Connected');
    });
    
    this.socket.on('sync:status', (data) => {
      // Update sync status in UI
    });
    
    this.socket.on('session:update', (data) => {
      // Handle remote session updates
    });
  }
  
  emit(event: string, data: unknown): void {
    this.socket?.emit(event, data);
  }
  
  disconnect(): void {
    this.socket?.disconnect();
  }
}
```

**Server Events:**

| Event | Direction | Description |
|-------|-----------|-------------|
| `session:created` | Server → Client | New session created |
| `session:updated` | Server → Client | Session data updated |
| `session:ended` | Server → Client | Session completed |
| `sync:status` | Server → Client | Sync status changed |
| `action:recorded` | Client → Server | New action recorded |
| `error:captured` | Client → Server | New error captured |

**Effort:** 1 week  
**Tier:** Enterprise

---

#### Phase 5B: Live Session Streaming (Priority: LOW)

**Objective:** Stream session data in real-time for monitoring dashboards.

**Use Cases:**
1. Manager dashboard showing live QA activity
2. Remote pair testing
3. Live debugging assistance

**Implementation:**
```typescript
// Stream actions as they occur
socket.emit('action:stream', {
  sessionId: session.id,
  action: recordedAction,
  timestamp: Date.now(),
});

// Server broadcasts to subscribers
io.to(`session:${sessionId}`).emit('action:received', action);
```

**Effort:** 2 weeks  
**Tier:** Enterprise

---

#### Phase 5C: AI Insights Dashboard (Priority: MEDIUM)

**Objective:** Display AI-generated insights from recorded sessions.

**Insight Types:**

| Insight | Description | Source |
|---------|-------------|--------|
| **Test Coverage** | Areas tested vs. total application | Session analysis |
| **Common Paths** | Most frequently tested user journeys | Cross-session analysis |
| **Error Hotspots** | Pages/features with most errors | Error aggregation |
| **Testing Gaps** | Untested areas based on app structure | AI analysis |
| **Risk Assessment** | High-risk areas needing more testing | Pattern recognition |
| **Automation Candidates** | Flows suitable for automation | Repetition analysis |

**Dashboard Layout:**
```
┌─────────────────────────────────────────────────────────────────────┐
│ 📊 AI Insights Dashboard                                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│ ┌─────────────────────────┐  ┌─────────────────────────────────┐   │
│ │ COVERAGE OVERVIEW       │  │ ERROR HOTSPOTS                  │   │
│ │ ████████████░░░░ 75%    │  │ 🔴 /checkout/payment - 12 errors│   │
│ │                         │  │ 🟡 /api/users - 5 errors        │   │
│ │ Auth:     ██████████ 95%│  │ 🟢 /dashboard - 1 error         │   │
│ │ Checkout: ████████░░ 80%│  │                                 │   │
│ │ Profile:  ██████░░░░ 60%│  │                                 │   │
│ │ Search:   ████░░░░░░ 40%│  │                                 │   │
│ └─────────────────────────┘  └─────────────────────────────────┘   │
│                                                                     │
│ ┌─────────────────────────┐  ┌─────────────────────────────────┐   │
│ │ COMMON USER PATHS       │  │ AUTOMATION CANDIDATES           │   │
│ │                         │  │                                 │   │
│ │ 1. Login → Dashboard    │  │ ✅ Login Flow (tested 47x)      │   │
│ │ 2. Search → Product     │  │ ✅ Add to Cart (tested 32x)     │   │
│ │ 3. Cart → Checkout      │  │ ⚠️ Checkout (needs more tests)  │   │
│ └─────────────────────────┘  └─────────────────────────────────┘   │
│                                                                     │
│ ┌───────────────────────────────────────────────────────────────┐  │
│ │ 💡 AI RECOMMENDATIONS                                         │  │
│ │                                                               │  │
│ │ 1. High Priority: Test payment failure scenarios              │  │
│ │ 2. Medium: Add tests for password reset flow                  │  │
│ │ 3. Low: Consider testing with different user roles            │  │
│ └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Data Aggregation:**
```typescript
interface AIInsights {
  coverageOverview: {
    overall: number;
    byFeature: { feature: string; coverage: number }[];
  };
  errorHotspots: {
    path: string;
    errorCount: number;
    severity: 'high' | 'medium' | 'low';
  }[];
  commonPaths: {
    path: string[];
    frequency: number;
  }[];
  automationCandidates: {
    flow: string;
    testCount: number;
    stability: number;
    recommendation: string;
  }[];
  recommendations: {
    priority: 'high' | 'medium' | 'low';
    category: string;
    suggestion: string;
    reasoning: string;
  }[];
}
```

**Effort:** 3 weeks  
**Tier:** Enterprise

---

## Phase 6: Test Code Generation

### Overview

Generate executable test code (Playwright, Cypress, etc.) from recorded sessions. This bridges manual testing with automation.

### Sub-Phases

#### Phase 6A: Basic Playwright Export (Priority: 🔥 HIGH)

**Objective:** Generate basic Playwright test files from recorded sessions.

**Input:**
```typescript
interface RecordedAction {
  type: 'click' | 'type' | 'navigate' | 'scroll' | 'hover' | 'dblclick' | ...;
  timestamp: number;
  element?: {
    selector: string;
    xpath: string;
    tagName: string;
    id?: string;
    className?: string;
    textContent?: string;
    attributes: Record<string, string>;
  };
  data?: {
    url?: string;
    text?: string;
    key?: string;
    x?: number;
    y?: number;
    deltaY?: number;
  };
}
```

**Output:**
```typescript
import { test, expect } from '@playwright/test';

test('User Login Flow', async ({ page }) => {
  // Navigate to login page
  await page.goto('https://app.example.com/login');
  
  // Fill email field
  await page.fill('#email', 'user@example.com');
  
  // Fill password field  
  await page.fill('#password', '********');
  
  // Click login button
  await page.click('button[type="submit"]');
  
  // Wait for navigation
  await expect(page).toHaveURL(/.*dashboard/);
});
```

**Implementation:**
1. Create `src/main/codegen/playwrightGenerator.ts`
2. Add "Export to Playwright" button on history cards
3. Generate `.spec.ts` file with proper structure
4. Handle different action types → Playwright commands

**Selector Strategy:**
```typescript
enum SelectorStrategy {
  DATA_TESTID = 'data-testid',  // Preferred: [data-testid="login-btn"]
  ROLE = 'role',                 // Accessibility: getByRole('button')
  ID = 'id',                     // #login-button
  CSS = 'css',                   // button.primary
  XPATH = 'xpath'                // //button[@type="submit"]
}
```

**Effort:** 1 week  
**Tier:** Pro

---

#### Phase 6B: AI-Enhanced Code Generation (Priority: HIGH)

**Objective:** Use AI to generate smarter, more maintainable tests.

**AI Enhancements:**
1. **Smart Assertions** - Infer what should be asserted based on actions
2. **Wait Strategy** - Add appropriate waits based on action patterns
3. **Selector Optimization** - Replace brittle selectors with robust ones
4. **Test Case Splitting** - Break long sessions into logical test cases
5. **Data Parameterization** - Extract test data into fixtures
6. **Negative Test Generation** - Generate error case tests

**AI Prompt Template:**
```
Given the following recorded user actions from a QA testing session:
[actions JSON]

Generate a Playwright test file that:
1. Uses accessible selectors (getByRole, getByLabel) where possible
2. Includes appropriate assertions after key actions
3. Handles dynamic content with proper waits
4. Follows Playwright best practices
5. Includes descriptive test names and comments

Also suggest:
- Edge cases that should be tested
- Potential assertions that should be added
- Improvements to selector reliability
```

**Output Example:**
```typescript
import { test, expect } from '@playwright/test';
import { loginCredentials } from './fixtures/users';

test.describe('Authentication Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(process.env.BASE_URL);
  });

  test('successful login redirects to dashboard', async ({ page }) => {
    // Fill login form using accessible selectors
    await page.getByLabel('Email').fill(loginCredentials.validUser.email);
    await page.getByLabel('Password').fill(loginCredentials.validUser.password);
    
    // Submit form
    await page.getByRole('button', { name: 'Sign In' }).click();
    
    // Verify successful login
    await expect(page).toHaveURL('/dashboard');
    await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
  });
});
```

**Effort:** 2 weeks  
**Tier:** Enterprise

---

#### Phase 6C: Multi-Framework Support (Priority: MEDIUM)

**Objective:** Support multiple test frameworks beyond Playwright.

**Supported Frameworks:**

| Framework | Language | Output Format | Priority |
|-----------|----------|---------------|----------|
| Playwright | TypeScript | `.spec.ts` | 🥇 Primary |
| Cypress | TypeScript | `.cy.ts` | 🥈 Secondary |
| Selenium | Python | `test_*.py` | 🥉 Tertiary |
| Puppeteer | JavaScript | `.test.js` | 🥉 Tertiary |
| TestCafe | TypeScript | `.test.ts` | 🥉 Tertiary |

**Architecture:**
```typescript
interface TestGenerator {
  framework: string;
  fileExtension: string;
  generate(actions: RecordedAction[], options: GeneratorOptions): string;
}

class PlaywrightGenerator implements TestGenerator { ... }
class CypressGenerator implements TestGenerator { ... }
class SeleniumGenerator implements TestGenerator { ... }

// Factory pattern for generator selection
function getGenerator(framework: string): TestGenerator {
  switch (framework) {
    case 'playwright': return new PlaywrightGenerator();
    case 'cypress': return new CypressGenerator();
    case 'selenium': return new SeleniumGenerator();
    default: throw new Error(`Unknown framework: ${framework}`);
  }
}
```

**Effort:** 1 week  
**Tier:** Pro

---

## Phase 7: Test Case Generation

### Overview

AI-powered test case generation based on:
- Recorded sessions (what was tested)
- Known patterns (common test scenarios)
- JIRA tickets (requirements-based)

### Sub-Phases

#### Phase 7A: Template Test Case Library (Priority: 🔥 HIGH)

**Objective:** Provide pre-built test case templates for common scenarios.

**Template Categories:**

| Category | Test Cases |
|----------|------------|
| **Authentication** | Login, Logout, Password Reset, Session Timeout, Remember Me, OAuth |
| **Forms** | Validation, Required Fields, Input Masks, File Upload, Multi-step |
| **CRUD** | Create, Read, Update, Delete, Pagination, Sorting, Filtering |
| **E-commerce** | Cart, Checkout, Payment, Shipping, Coupons, Returns |
| **Search** | Basic Search, Filters, Autocomplete, No Results, Special Characters |
| **Security** | SQL Injection, XSS, CSRF, Rate Limiting, Input Sanitization |
| **Accessibility** | Keyboard Navigation, Screen Reader, Color Contrast, Focus Order |

**Template Structure:**
```typescript
interface TestCaseTemplate {
  id: string;
  category: string;
  name: string;
  description: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  testType: 'functional' | 'security' | 'accessibility' | 'performance';
  steps: TestStep[];
  expectedResults: string[];
  prerequisites?: string[];
  tags: string[];
}

interface TestStep {
  order: number;
  action: string;
  expectedBehavior: string;
  inputData?: string;
}
```

**Example Template:**
```json
{
  "id": "auth-001",
  "category": "Authentication",
  "name": "Valid Login with Correct Credentials",
  "description": "Verify user can login with valid email and password",
  "priority": "critical",
  "testType": "functional",
  "steps": [
    { "order": 1, "action": "Navigate to login page", "expectedBehavior": "Login form is displayed" },
    { "order": 2, "action": "Enter valid email", "expectedBehavior": "Email is accepted", "inputData": "valid_email" },
    { "order": 3, "action": "Enter valid password", "expectedBehavior": "Password is masked", "inputData": "valid_password" },
    { "order": 4, "action": "Click login button", "expectedBehavior": "Form is submitted" }
  ],
  "expectedResults": [
    "User is redirected to dashboard",
    "User name is displayed in header",
    "Session cookie is created"
  ],
  "tags": ["login", "authentication", "smoke"]
}
```

**Effort:** 1 week  
**Tier:** Pro

---

#### Phase 7B: Session-Derived Test Cases (Priority: HIGH) ✅ COMPLETED

**Status:** Implemented with full navigation path tracking.

**Implementation:**
- `NavigationPathFinder`: Extracts the complete action sequence leading to each form field
- `TestStep` interface: Captures action, description, selector, xpath, value, and Playwright code
- `prerequisiteSteps`: Array of steps to navigate to the field
- `testActionStep`: The actual test action step
- Full Playwright code generation with real recorded selectors
- CSV/Excel export with actual recorded steps (not generic placeholders)

**Objective:** Generate test cases from recorded sessions automatically.

**Process:**
1. Analyze recorded session actions
2. Identify distinct user flows (login, checkout, etc.)
3. Generate test cases for each flow
4. Suggest additional edge cases

**Flow Detection:**
```typescript
interface DetectedFlow {
  name: string;
  startAction: RecordedAction;
  endAction: RecordedAction;
  actions: RecordedAction[];
  flowType: 'authentication' | 'navigation' | 'form' | 'crud' | 'unknown';
  confidence: number;
}

function detectFlows(actions: RecordedAction[]): DetectedFlow[] {
  // Pattern matching for common flows:
  // - Login: navigate to /login → fill email → fill password → click submit
  // - Checkout: add to cart → view cart → checkout → payment
  // - Form submission: fill multiple fields → submit
}
```

**Output:**
```
┌─────────────────────────────────────────────────────────────────┐
│ 📋 Generated Test Cases from Session: "User Registration"       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ ✅ TESTED (Detected in session):                                │
│    TC-001: Navigate to registration page                        │
│    TC-002: Fill registration form with valid data               │
│    TC-003: Submit form and verify success                       │
│                                                                 │
│ ⚠️ SUGGESTED (Edge cases):                                      │
│    TC-004: Registration with existing email                     │
│    TC-005: Registration with invalid email format               │
│    TC-006: Registration with weak password                      │
│    TC-007: Registration with mismatched passwords               │
│    TC-008: Registration with empty required fields              │
│    TC-009: Registration form accessibility                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Effort:** 2 weeks  
**Tier:** Pro

---

#### Phase 7C: AI Edge Case Generation (Priority: MEDIUM)

**Objective:** Use AI to generate comprehensive edge cases.

**Input Context:**
- Recorded session actions
- Detected flow type
- Element information (form fields, buttons, etc.)
- Application domain

**AI Prompt:**
```
Given the following user flow recorded during testing:
[flow description]

For the form with fields: [field list with types]

Generate comprehensive edge case test scenarios including:
1. Boundary value tests
2. Negative tests (invalid inputs)
3. Security tests (injection, XSS)
4. Error handling scenarios
5. Accessibility considerations
6. Performance edge cases (large inputs, rapid actions)

Format as structured test cases with steps and expected results.
```

**Effort:** 2 weeks  
**Tier:** Enterprise

---

## Phase 8: Coverage Analysis & Suggestions

### Overview

Analyze testing sessions to identify coverage gaps and provide actionable suggestions.

### Sub-Phases

#### Phase 8A: Post-Session Coverage Report (Priority: 🔥 HIGH)

**Objective:** Generate coverage reports after each testing session.

**Report Sections:**

1. **Session Summary**
   - Duration
   - Actions performed
   - Errors encountered
   - Pages visited

2. **Feature Coverage**
   - Features tested vs. known features
   - Coverage percentage per area
   - Untested areas highlighted

3. **Action Distribution**
   - Click vs. type vs. navigate breakdown
   - Page heat map

4. **Recommendations**
   - Missing test scenarios
   - Suggested next tests
   - Priority based on risk

**Report Schema:**
```typescript
interface CoverageReport {
  sessionId: string;
  generatedAt: number;
  
  summary: {
    duration: number;
    totalActions: number;
    uniquePages: number;
    errorsFound: number;
  };
  
  featureCoverage: {
    feature: string;
    coveragePercent: number;
    testedScenarios: string[];
    missingScenarios: string[];
  }[];
  
  actionBreakdown: {
    type: string;
    count: number;
    percentage: number;
  }[];
  
  recommendations: {
    priority: 'high' | 'medium' | 'low';
    area: string;
    suggestion: string;
    reason: string;
  }[];
  
  overallCoverage: number;
}
```

**Effort:** 2 weeks  
**Tier:** Pro

---

#### Phase 8B: Interactive QA Checklist (Priority: HIGH)

**Objective:** Provide dynamic checklists that track testing progress.

**Features:**
1. **Auto-population** - Generate checklist from JIRA ticket or template
2. **Live tracking** - Check off items as tests are performed
3. **Progress indicator** - Visual progress bar
4. **Sharing** - Export/share checklist with team
5. **History** - Track completion over time

**Checklist Schema:**
```typescript
interface QAChecklist {
  id: string;
  name: string;
  ticketId?: string;
  createdAt: number;
  assignedTo: string;
  
  categories: {
    name: string;
    items: {
      id: string;
      description: string;
      status: 'pending' | 'passed' | 'failed' | 'skipped';
      sessionId?: string;  // Links to testing session
      notes?: string;
      completedAt?: number;
    }[];
  }[];
  
  progress: {
    total: number;
    completed: number;
    passed: number;
    failed: number;
  };
}
```

**UI Layout:**
```
┌─────────────────────────────────────────────────────────────────┐
│ ✅ QA Checklist: PROJ-1234 - User Authentication                │
│ Progress: ████████████░░░░░░░░ 60% (12/20)                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ FUNCTIONAL TESTS                                    8/12        │
│ ────────────────────────────────────────────────────────────── │
│ [✅] Valid login                          Session: abc123       │
│ [✅] Invalid credentials error            Session: abc123       │
│ [✅] Empty field validation               Session: abc123       │
│ [❌] Password reset flow                  FAILED - Bug found    │
│ [  ] Remember me functionality                                  │
│ [  ] Session timeout                                            │
│ ...                                                             │
│                                                                 │
│ SECURITY TESTS                                      2/5         │
│ ────────────────────────────────────────────────────────────── │
│ [✅] SQL injection prevention                                   │
│ [✅] XSS prevention                                             │
│ [  ] Rate limiting                                              │
│ [  ] Brute force protection                                     │
│ [  ] Session hijacking prevention                               │
│                                                                 │
│ [Save Progress] [Export Report] [Link to JIRA]                  │
└─────────────────────────────────────────────────────────────────┘
```

**Effort:** 1 week  
**Tier:** Pro

---

#### Phase 8C: Real-Time Suggestions (Priority: MEDIUM)

**Objective:** Provide suggestions during active testing sessions.

**Suggestion Types:**

| Type | Trigger | Example |
|------|---------|---------|
| Missing test | User tested happy path | "Try invalid email format" |
| Security check | User filling form | "Test for SQL injection" |
| Edge case | User entered value | "Try boundary value: 0" |
| Accessibility | User clicked button | "Verify keyboard navigation" |
| Error handling | User submitted form | "Test network failure scenario" |

**Implementation:**
- Non-intrusive notification system
- Configurable suggestion frequency
- Learn from dismissed suggestions

**Effort:** 2 weeks  
**Tier:** Enterprise

---

## Phase 9: JIRA Integration

### Overview

Bi-directional integration with JIRA for seamless QA workflow.

### Sub-Phases

#### Phase 9A: JIRA Connection (Priority: MEDIUM)

**Objective:** Establish secure connection to JIRA instance.

**Authentication:**
- OAuth 2.0 for Jira Cloud
- Personal Access Token for Jira Server

**Configuration:**
```typescript
interface JiraConfig {
  instanceUrl: string;      // https://company.atlassian.net
  authType: 'oauth' | 'pat';
  accessToken: string;
  refreshToken?: string;
  projectKey: string;       // PROJ
  issueTypes: string[];     // Story, Bug, Task
}
```

**Effort:** 1 week  
**Tier:** Enterprise

---

#### Phase 9B: Ticket → Test Cases (Priority: MEDIUM)

**Objective:** Generate test cases from JIRA ticket details.

**Process:**
1. Fetch ticket details (summary, description, acceptance criteria)
2. Parse requirements using NLP/AI
3. Generate test cases covering requirements
4. Allow QA to review and customize

**AI Prompt:**
```
Given the following JIRA ticket:

Title: [ticket title]
Description: [description]
Acceptance Criteria:
[acceptance criteria]

Generate comprehensive test cases that:
1. Cover all acceptance criteria
2. Include happy path scenarios
3. Include edge cases and error scenarios
4. Include security considerations if applicable
5. Include accessibility checks

Format as structured test cases with:
- Test case ID
- Description
- Pre-conditions
- Test steps
- Expected results
- Priority
```

**Effort:** 2 weeks  
**Tier:** Enterprise

---

#### Phase 9C: Session ↔ Ticket Linking (Priority: LOW)

**Objective:** Link testing sessions to JIRA tickets.

**Features:**
1. Associate session with ticket ID
2. Auto-update ticket with testing status
3. Create bug tickets from errors
4. Add coverage report as attachment

**Workflow:**
```
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│  JIRA Ticket    │      │ Dashing Session │      │   JIRA Update   │
│  PROJ-1234      │─────▶│ Testing begins  │─────▶│ Status: Testing │
└─────────────────┘      └─────────────────┘      └─────────────────┘
                                  │
                                  ▼
                         ┌─────────────────┐
                         │ Error Found     │
                         │ HTTP 500        │
                         └────────┬────────┘
                                  │
                                  ▼
                         ┌─────────────────┐
                         │ Create Bug      │
                         │ PROJ-1235       │
                         │ Linked to 1234  │
                         └─────────────────┘
```

**Effort:** 1 week  
**Tier:** Enterprise

---

## Feature Tier Matrix

| Feature | Free | Pro | Enterprise |
|---------|:----:|:---:|:----------:|
| **Recording & Capture** |
| Session recording | ✅ | ✅ | ✅ |
| Action recording | ✅ | ✅ | ✅ |
| Error capture | ✅ | ✅ | ✅ |
| Multi-window sessions | ✅ (3 max) | ✅ (10 max) | ✅ (unlimited) |
| Active sessions | 2 max | 10 max | Unlimited |
| **Storage & Sync** |
| Local storage | ✅ | ✅ | ✅ |
| Cloud sync | ❌ | ✅ | ✅ |
| Data retention | 30 days | 1 year | Unlimited |
| **Local API & Export** |
| Local REST API | ❌ | ✅ | ✅ |
| JSON/CSV export | ✅ | ✅ | ✅ |
| HAR/JUnit export | ❌ | ✅ | ✅ |
| **Real-Time Features** |
| WebSocket connection | ❌ | ❌ | ✅ |
| Live session streaming | ❌ | ❌ | ✅ |
| AI insights dashboard | ❌ | ❌ | ✅ |
| **Code Generation** |
| Basic Playwright export | ❌ | ✅ | ✅ |
| Multi-framework export | ❌ | ✅ | ✅ |
| AI-enhanced generation | ❌ | ❌ | ✅ |
| **Test Intelligence** |
| Test case templates | ❌ | ✅ | ✅ |
| Session-derived test cases | ❌ | ✅ | ✅ |
| AI edge case generation | ❌ | ❌ | ✅ |
| **Coverage Analysis** |
| Coverage reports | ❌ | ✅ | ✅ |
| QA checklists | ❌ | ✅ | ✅ |
| Real-time suggestions | ❌ | ❌ | ✅ |
| **Integrations** |
| JIRA integration | ❌ | ❌ | ✅ |
| Slack/Teams | ❌ | ❌ | ✅ |
| CI/CD webhooks | ❌ | ❌ | ✅ |
| **Team Features** |
| Team analytics | ❌ | ❌ | ✅ |
| Shared test libraries | ❌ | ❌ | ✅ |
| Role-based access | ❌ | ❌ | ✅ |

---

## Implementation Priority

### Immediate (Next 2-4 weeks)

| Phase | Feature | Effort | Value |
|-------|---------|--------|-------|
| 6A | Basic Playwright export | 1 week | 🔥 High |
| 7A | Test case template library | 1 week | 🔥 High |
| 8B | Interactive QA checklist | 1 week | 🔥 High |

### Short-term (1-2 months)

| Phase | Feature | Effort | Value |
|-------|---------|--------|-------|
| 4A | Local API Server | 1 week | High |
| 8A | Coverage reports | 2 weeks | High |
| 7B | Session-derived test cases | 2 weeks | ✅ Done |
| 6B | AI-enhanced code gen | 2 weeks | High |
| 6C | Multi-framework support | 1 week | Medium |
| 4B | Export formats (JSON, CSV, HAR) | 1 week | Medium |

### Medium-term (3-6 months)

| Phase | Feature | Effort | Value |
|-------|---------|--------|-------|
| 5C | AI Insights Dashboard | 3 weeks | High |
| 9A | JIRA connection | 1 week | Medium |
| 9B | Ticket → Test cases | 2 weeks | Medium |
| 8C | Real-time suggestions | 2 weeks | Medium |
| 7C | AI edge case generation | 2 weeks | Medium |
| 5A | WebSocket connection | 1 week | Low |
| 5B | Live session streaming | 2 weeks | Low |
| 9C | Session ↔ Ticket linking | 1 week | Low |

---

## Technical Specifications

### Recording Enhancement Requirements

To support better code generation, enhance action recording:

| Current | Enhancement | Purpose |
|---------|-------------|---------|
| CSS selector | Add `data-testid` detection | More stable selectors |
| XPath | Add accessible role/name | Playwright best practices |
| Click coordinates | Add element bounds | Visual debugging |
| Type action | Add field label association | Accessible selectors |
| Navigation | Add expected page title | Better assertions |
| - | Screenshot on action (optional) | Visual test generation |
| - | Network request context | API test generation |

### AI Integration

**Provider:** OpenAI API (GPT-4)

**Use Cases:**
1. Code generation enhancement
2. Test case generation
3. Coverage gap analysis
4. Edge case suggestion
5. Selector optimization

**Cost Estimation:**
- ~1000 tokens per session analysis
- ~500 tokens per test case generation
- Estimated $0.01-0.05 per session

---

## Data Models

### Core Models (Current)

```typescript
// Session
interface Session {
  id: string;
  name: string;
  status: 'recording' | 'paused' | 'ended';
  startedAt: number;
  endedAt?: number;
  windows: SessionWindow[];
  actionCount: number;
  errorCount: number;
}

// Window
interface SessionWindow {
  id: string;
  sessionId: string;
  label: string;
  createdAt: number;
  closedAt?: number;
  tabs: SessionTab[];
}

// Action
interface RecordedAction {
  id: string;
  sessionId: string;
  windowId: string;
  tabId: string;
  type: ActionType;
  timestamp: number;
  element?: ElementInfo;
  data?: ActionData;
}

// Error
interface TabError {
  id: string;
  sessionId: string;
  windowId: string;
  type: ErrorType;
  message: string;
  source?: string;
  stackTrace?: string;
  timestamp: number;
  statusCode?: number;
}
```

### New Models (Planned)

```typescript
// Test Case
interface TestCase {
  id: string;
  sessionId?: string;
  templateId?: string;
  ticketId?: string;
  name: string;
  description: string;
  steps: TestStep[];
  expectedResults: string[];
  priority: Priority;
  status: 'draft' | 'ready' | 'executed';
  coverage: string[];
  generatedAt: number;
}

// Coverage Report
interface CoverageReport {
  id: string;
  sessionId: string;
  features: FeatureCoverage[];
  overall: number;
  recommendations: Recommendation[];
  generatedAt: number;
}

// QA Checklist
interface Checklist {
  id: string;
  name: string;
  ticketId?: string;
  categories: ChecklistCategory[];
  progress: Progress;
  createdAt: number;
  updatedAt: number;
}
```

---

## API Contracts

### Code Generation API

```typescript
// POST /api/generate/code
interface GenerateCodeRequest {
  sessionId: string;
  framework: 'playwright' | 'cypress' | 'selenium';
  options: {
    selectorStrategy: 'testid' | 'role' | 'css' | 'xpath';
    includeAssertions: boolean;
    splitTestCases: boolean;
    useAI: boolean;
  };
}

interface GenerateCodeResponse {
  success: boolean;
  files: {
    name: string;
    content: string;
    language: string;
  }[];
  metadata: {
    actionsProcessed: number;
    testsGenerated: number;
    aiEnhancements?: string[];
  };
}
```

### Test Case Generation API

```typescript
// POST /api/generate/testcases
interface GenerateTestCasesRequest {
  source: 'session' | 'template' | 'ticket';
  sourceId: string;
  options: {
    includeEdgeCases: boolean;
    includeSecurity: boolean;
    includeAccessibility: boolean;
  };
}

interface GenerateTestCasesResponse {
  success: boolean;
  testCases: TestCase[];
  suggestions: Suggestion[];
}
```

### JIRA Integration API

```typescript
// GET /api/jira/ticket/:id
interface JiraTicketResponse {
  id: string;
  key: string;
  summary: string;
  description: string;
  acceptanceCriteria: string[];
  status: string;
  assignee: string;
}

// POST /api/jira/ticket/:id/testcases
interface GenerateFromTicketRequest {
  ticketId: string;
  options: GenerateTestCasesOptions;
}
```

---

## Comparison with Alternatives

### Dashing vs. Playwright Codegen

| Aspect | Dashing | Playwright Codegen |
|--------|---------|-------------------|
| Primary use | Manual QA enhancement | Automated test creation |
| User | QA engineers | Developers/SDETs |
| Learning curve | None | Requires code knowledge |
| Error capture | ✅ Real-time | ❌ Only in assertions |
| Session management | ✅ Multi-window | ❌ Single browser |
| Coverage analysis | ✅ AI-powered | ❌ Not included |
| Test suggestions | ✅ AI-powered | ❌ Not included |
| JIRA integration | ✅ (Enterprise) | ❌ Not included |
| Output | Code + Reports | Code only |

### Dashing vs. Selenium IDE

| Aspect | Dashing | Selenium IDE |
|--------|---------|--------------|
| Architecture | Electron + Cloud | Browser extension |
| Recording | ✅ Advanced | ✅ Basic |
| Code export | ✅ Multiple frameworks | ✅ Limited |
| AI features | ✅ Enterprise | ❌ None |
| Error capture | ✅ Comprehensive | ❌ None |
| Team features | ✅ Enterprise | ❌ None |

### Synergy Opportunity

Dashing + Playwright = Complete QA workflow:
1. **Explore** with Dashing (manual testing)
2. **Generate** tests from sessions
3. **Automate** with Playwright
4. **Maintain** with AI-powered updates

---

## Appendix

### Glossary

| Term | Definition |
|------|------------|
| Session | A testing session containing multiple windows and tabs |
| Action | A recorded user interaction (click, type, scroll, etc.) |
| Flow | A sequence of actions forming a user journey |
| Coverage | The extent of features/scenarios tested |
| Edge Case | Boundary or unusual test scenarios |

### References

- [Playwright Documentation](https://playwright.dev)
- [Cypress Documentation](https://docs.cypress.io)
- [JIRA REST API](https://developer.atlassian.com/cloud/jira/platform/rest/v3/)
- [OpenAI API](https://platform.openai.com/docs/api-reference)

---

*This document is maintained as part of the Dashing project. For questions or contributions, contact the development team.*

