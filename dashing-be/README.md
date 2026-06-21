# Dashing API

Backend API server for Dashing QA Tool - handles session synchronization, user management, and provides data for AI insights.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Dashing API                             │
├─────────────────────────────────────────────────────────────┤
│  Framework:     Express.js (TypeScript)                     │
│  Database:      PostgreSQL                                  │
│  ORM:           Prisma                                      │
│  Auth:          API Keys + License Keys                     │
│  Validation:    Zod                                         │
└─────────────────────────────────────────────────────────────┘
```

## Quick Start

### Prerequisites

- Node.js 18+
- Docker & Docker Compose (for PostgreSQL)

### Setup

1. **Start the database:**
   ```bash
   docker-compose up -d
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Generate Prisma client:**
   ```bash
   npm run db:generate
   ```

4. **Run database migrations:**
   ```bash
   npm run db:migrate
   ```

5. **Start the development server:**
   ```bash
   npm run dev
   ```

The API will be available at `http://localhost:3001`

## API Endpoints

### Health Check
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Overall health status |
| `GET` | `/health/ready` | Readiness check |
| `GET` | `/health/live` | Liveness check |

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/auth/validate-license` | Validate a license key |
| `POST` | `/auth/activate` | Activate a license |
| `POST` | `/auth/deactivate` | Deactivate a license |

### Sessions (Protected - requires API key)
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/sessions` | Create/update session |
| `GET` | `/sessions` | List sessions |
| `GET` | `/sessions/:id` | Get session details |
| `PATCH` | `/sessions/:id` | Update session |
| `DELETE` | `/sessions/:id` | Delete session |

### Actions (Protected)
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/sessions/:id/actions` | Batch upload actions |
| `GET` | `/sessions/:id/actions` | Get session actions |
| `GET` | `/sessions/:id/actions/stats` | Get action statistics |

### Errors (Protected)
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/sessions/:id/errors` | Batch upload errors |
| `GET` | `/sessions/:id/errors` | Get session errors |
| `GET` | `/sessions/:id/errors/stats` | Get error statistics |

## Authentication

### API Key Authentication

Include the `X-API-Key` header in all protected requests:

```bash
curl -X GET http://localhost:3001/sessions \
  -H "X-API-Key: your-api-key"
```

### License Key Validation

```bash
curl -X POST http://localhost:3001/auth/validate-license \
  -H "Content-Type: application/json" \
  -d '{"licenseKey": "DASH-XXXX-XXXX-XXXX"}'
```

## Database

### View database with Prisma Studio

```bash
npm run db:studio
```

This opens a GUI at `http://localhost:5555` to browse and edit data.

### Create a migration

```bash
npm run db:migrate
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server with hot reload |
| `npm run build` | Build for production |
| `npm start` | Start production server |
| `npm run db:generate` | Generate Prisma client |
| `npm run db:migrate` | Run database migrations |
| `npm run db:push` | Push schema changes (dev only) |
| `npm run db:studio` | Open Prisma Studio |

## Environment Variables

See `.env.example` for all available options.

## Project Structure

```
dashing-api/
├── src/
│   ├── api/
│   │   ├── routes/         # API route handlers
│   │   └── middleware/     # Express middleware
│   ├── services/           # Business logic
│   ├── db/                 # Database utilities
│   ├── utils/              # Helper functions
│   ├── workers/            # Background job processors
│   └── index.ts            # Entry point
├── prisma/
│   └── schema.prisma       # Database schema
├── docker-compose.yml      # Local development services
└── package.json
```

## Connecting from Electron App

Configure the Electron app's Cloud Sync settings:

1. **API URL:** `http://localhost:3001` (or your deployed URL)
2. **API Key:** Generate one using Prisma Studio or the `/auth/generate-api-key` endpoint


## Create an organization with an API key using Prisma Studio
cd /Users/gravindran/Documents/SideProjects/dashing/dashing-api
npm run db:studio


## License

ISC

