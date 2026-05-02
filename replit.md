# Smart School ERP — Project Documentation

## Overview

A full-stack, production-ready School/Madrasa Management System (ERP) built as a pnpm monorepo.

**Stack:** Express 5 + React + Vite + TypeScript + PostgreSQL + Drizzle ORM + OpenAI AI

## Architecture

```
/
├── artifacts/
│   ├── api-server/          — Express 5 REST API (port 8080, served at /api)
│   └── school-erp/          — React + Vite SPA (port varies, served at /)
├── lib/
│   ├── db/                  — Drizzle ORM schemas + migrations
│   ├── api-spec/            — OpenAPI YAML contract
│   ├── api-zod/             — Auto-generated Zod validation schemas
│   └── api-client-react/    — Auto-generated React Query hooks
└── scripts/                 — Utility scripts
```

## Workflows

- **`artifacts/api-server: API Server`** — `pnpm --filter @workspace/api-server run dev` (builds with esbuild, then serves at :8080)
- **`artifacts/school-erp: web`** — `pnpm --filter @workspace/school-erp run dev` (Vite dev server)

## Environment Variables

- `DATABASE_URL` — PostgreSQL connection string (Replit DB, auto-set)
- `SESSION_SECRET` — JWT signing secret (auto-set or falls back to `"fallback-dev-secret"`)
- `AI_INTEGRATIONS_OPENAI_BASE_URL` — Replit AI Integrations proxy URL (auto-set)
- `AI_INTEGRATIONS_OPENAI_API_KEY` — Replit AI Integrations API key (auto-set)

## Demo Credentials

| Role        | Email                     | Password      |
|-------------|---------------------------|---------------|
| SUPER_ADMIN | admin@school.edu          | admin123      |
| TEACHER     | sarah.ahmed@school.edu    | teacher123    |
| ACCOUNTANT  | accountant@school.edu     | accountant123 |
| PARENT      | parent1@school.edu        | parent123     |
| PARENT      | parent2@school.edu        | parent123     |

## Modules (21+)

1. **Dashboard** — Stats, revenue trend chart, AI daily summary (admin/teacher), live audit feed (admin)
2. **Students** — CRUD, bulk CSV import, admission tracking
3. **Classes** — Class management with teacher assignment
4. **Attendance** — Daily marking, QR code generation, RFID support
5. **Subjects & Marks** — Subject management, exam results entry
6. **Timetable** — Class schedule management
7. **Finance** — Fee types, invoices, payment transactions, overdue cron
8. **Notifications** — In-app notifications, bulk parent notifications
9. **Audit Log** — Complete action history
10. **Documents** — Student document storage (URL-based)
11. **Report Card** — Student performance summary
12. **Calendar** — Event management
13. **Asset Management** — Hardware/equipment tracking
14. **Parent Portal** — Parents see their children's info
15. **Settings** — Profile view, password change with strength meter
16. **Password Reset** — Token-based (dev: token shown in UI/logs)
17. **Tenants** — Multi-tenant config, theme customization (SUPER_ADMIN only)
18. **Users/Staff** — User management with RBAC

## RBAC (Role-Based Access Control)

5 roles: `SUPER_ADMIN`, `TEACHER`, `ACCOUNTANT`, `PARENT`, `STUDENT`

Each role sees only the nav items and routes it can access (enforced both frontend `canAccessRoute()` and backend middlewares).

## AI Features

- **AI Daily Summary** (`GET /api/dashboard/ai-summary`) — GPT-5-mini generates a 3-4 sentence daily brief for admins/teachers based on live attendance, finance, and admission data. Shows on Dashboard.
- Uses Replit AI Integrations (no user API key needed).
- Model quirks: `gpt-5-mini` is a reasoning model — must use `max_completion_tokens` (not `max_tokens`), no `temperature` param, token budget must be ≥2000 to leave room for internal reasoning before visible output.

## PWA / Offline

- `vite-plugin-pwa` configured for service worker and offline caching
- Dexie.js offline sync engine (`lib/syncEngine.ts`) with mutation queue
- `useSyncEngine` React hook tracks online/offline state + pending sync count
- Offline indicator in Layout header auto-triggers sync on reconnect

## Database Seed Data

Pre-seeded via `executeSql`:
- 1 default tenant ("Smart School ERP", plan: PRO)
- 5 demo users (admin + teacher + accountant + 2 parents)
- 5 classes (Class One–Five, Section A, grade 1–5)
- 17 students across all classes
- 5 fee types (Tuition, Exam, Transport, Library, Sports)
- 20 invoices (10 PAID, 8 PENDING, 2 OVERDUE)
- 10 payment transactions (৳22,300 total)
- Attendance for today and yesterday for all 17 students

## Real-Time Notifications (SSE)

The notification bell in the sidebar uses Server-Sent Events (SSE) for zero-latency updates:

- **Backend:** `GET /api/notifications/stream` — authenticated long-lived SSE connection
  - Sends `event: init` with current unread count on connect
  - Sends `event: update` when a notification is created, read, or deleted
  - 25-second heartbeat to keep proxies alive
  - Connection registry in `artifacts/api-server/src/lib/sse-manager.ts`
- **Frontend:** `useNotificationSSE` hook (`artifacts/school-erp/src/hooks/useNotificationSSE.ts`)
  - Uses `fetch` streaming (supports `Authorization` header, unlike native `EventSource`)
  - Exponential backoff reconnect (1s → 30s max)
  - Badge updates instantly when bulk or individual notifications are sent/read

Triggers that broadcast SSE updates:
- `POST /notifications/bulk` — notifies each target parent
- `PUT /notifications/read-all` — resets unread count to 0
- `PUT /notifications/:id/read` — decrements count
- `DELETE /notifications/:id` — decrements count

## API Routes

All routes prefixed with `/api/`:

- `GET  /healthz` — Health check
- `POST /auth/login` — JWT login
- `GET  /auth/me` — Current user
- `PUT  /auth/password` — Change password
- `POST /auth/forgot-password` — Generate reset token (dev: returns token in response)
- `POST /auth/reset-password` — Use token to reset password
- `GET  /tenants/config` — Public tenant theme config
- `GET/POST/PUT/DELETE /tenants` — Tenant CRUD (SUPER_ADMIN)
- `GET/POST/PUT/DELETE /users` — Staff management
- `GET/POST/PUT/DELETE /classes` — Class management
- `GET/POST/PUT/DELETE /students` — Student management
- `POST /students/bulk-import` — CSV bulk import
- `GET/POST /attendance` — Attendance marking
- `GET/POST/PUT/DELETE /subjects` — Subject management
- `GET/POST/DELETE /exam-results` — Exam result management
- `GET/POST/PUT/DELETE /timetable` — Timetable slots
- `GET/POST /fee-types` — Fee types
- `GET/POST /invoices` — Invoices
- `GET/POST /transactions` — Payment transactions
- `GET /dashboard/stats` — Dashboard KPIs
- `GET /dashboard/attendance-summary` — Today's attendance by class
- `GET /dashboard/revenue-trend` — 6-month revenue chart data
- `GET /dashboard/recent-activity` — Recent events feed
- `GET /dashboard/ai-summary` — AI-powered daily brief
- `GET/POST/DELETE /notifications` — Notifications + bulk parent notify
- `POST /notifications/bulk` — Bulk parent notification
- `GET /audit-logs` — Audit trail
- `GET/POST /calendar-events` — Calendar events
- `GET/POST/DELETE /students/:id/documents` — Student documents
- `GET/POST/DELETE /hardware` — Asset management
- `GET /parent/children` — Parent's children
- `GET /students/:id/qr` — Student QR code data

## Key Files

- `artifacts/api-server/src/app.ts` — Express app setup
- `artifacts/api-server/src/routes/index.ts` — Central router
- `artifacts/api-server/src/lib/auth.ts` — Custom JWT (HMAC-SHA256, no jsonwebtoken dep)
- `artifacts/api-server/src/lib/overdue-cron.ts` — Overdue invoice cron (every 6h)
- `artifacts/api-server/src/routes/ai-summary/index.ts` — AI daily summary route
- `artifacts/school-erp/src/App.tsx` — All frontend routes
- `artifacts/school-erp/src/lib/auth.tsx` — Auth context, ROLE_CONFIG, canAccessRoute
- `artifacts/school-erp/src/lib/tenant.tsx` — Tenant context, theme injection
- `artifacts/school-erp/src/lib/syncEngine.ts` — Dexie offline sync engine
- `artifacts/school-erp/src/hooks/useSyncEngine.ts` — Sync state hook
- `artifacts/school-erp/src/components/Layout.tsx` — Sidebar, offline indicator, notification bell
- `lib/db/src/schema/index.ts` — All Drizzle schema exports

## Common Commands

```bash
# Start API server
pnpm --filter @workspace/api-server run dev

# Start frontend
pnpm --filter @workspace/school-erp run dev

# TypeCheck all
pnpm run typecheck

# DB schema push
pnpm --filter @workspace/db run push

# Regenerate API client
pnpm --filter @workspace/api-spec run codegen
```
