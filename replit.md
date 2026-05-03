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

## Modules (22+)

1. **Dashboard** — Stats, revenue trend chart, AI daily summary (admin/teacher), live audit feed (admin)
2. **Students** — CRUD, bulk CSV import, admission tracking
3. **Classes** — Class management with teacher assignment
4. **Attendance** — Daily marking, QR code generation, RFID support
5. **Subjects & Marks** — Subject management, exam results entry
6. **Timetable** — Class schedule management
7. **Finance** — Fee types, invoices, payment transactions, overdue cron, PDF export
8. **Payroll** — Monthly staff salary management, bulk generate, approve/mark-paid workflow, individual payslip PDF download
9. **Fee Reminder Scheduler** — Configurable daily cron that auto-sends payment reminders to parents/staff based on invoice due-date offsets (before/after); manual "Send Now" trigger; persisted settings per tenant
10. **Parent Fee Statement** — Parents view full invoice history + per-invoice transaction breakdowns (expandable rows) + summary cards; download branded PDF statement per student; PARENT role can only view their own linked students (ownership enforced server-side)
11. **Parent Payment Requests** — Parents submit payment evidence (amount, method, txn ref, date) against outstanding invoices; finance staff review, approve (auto-creates transaction + updates invoice) or reject (with optional reason) from a dedicated Finance inbox tab; in-app notifications on both sides; duplicate pending request guard
12. **My Payment Submissions tab** — Parent Portal "My Payments" tab per student: status summary cards (pending/approved/rejected), rejection reason display, reviewer name + date, refresh button
13. **Bulk Invoice Generation** — Finance "Bulk Generate" button opens a dialog: pick class, fee type, optional month, due date, optional amount override; shows live eligible student count; batch-inserts invoices for all active students; skips duplicates (same feeType + month already invoiced); results screen shows created / skipped / total counts; full audit log entry
14. **Fee Collection Report** — Finance tab showing per-class collection gap analysis for any academic year; 5 KPI cards, grouped bar chart, expandable class→fee-type breakdown, class CSV export; "Students" button drills into a `ClassDetailModal` showing per-student invoice status with KPI strip, search/filter, expandable invoice rows
15. **Overdue Escalation** — `invoicesTable` gains `escalationLevel` (NORMAL/WARNING/CRITICAL), `escalatedAt`, `escalationNote` columns. WARNING threshold: 7 days overdue; CRITICAL: 30 days (both configurable). Three endpoints: `POST /api/finance/escalations/run` (scan + escalate + notify), `GET /api/finance/escalations` (list with level filter), `PATCH /api/finance/escalations/:id/acknowledge` (reset to NORMAL). Wired into the 6-hour overdue cron. Dedicated "Escalations" tab in Finance with KPI strip, Run Check button, color-coded table (red=CRITICAL, amber=WARNING), per-row acknowledge action, in-app notifications to parent + staff on escalation.
16. **Escalation Threshold Settings** — `escalation_settings` table (per-tenant, `warningDays`/`criticalDays`). `GET /api/finance/escalation-settings` auto-creates default row; `PUT` validates `warningDays < criticalDays`. Both escalation route and overdue cron load thresholds from DB via a 5-min TTL cache (`lib/escalation-thresholds.ts`); cache is invalidated immediately on save. Collapsible "Thresholds" panel in the Escalations tab: two number inputs with inline validation guards, description text updates live from fetched values.
11. **Notifications** — In-app notifications, bulk parent notifications, SSE real-time updates
10. **Audit Log** — Complete action history
11. **Documents** — Student document storage (URL-based)
12. **Report Card** — Student performance summary
13. **Calendar** — Event management
14. **Asset Management** — Hardware/equipment tracking
15. **Parent Portal** — Parents see their children's info
16. **Settings** — Profile view, password change with strength meter
17. **Password Reset** — Token-based (dev: token shown in UI/logs)
18. **Tenants** — Multi-tenant config, theme customization (SUPER_ADMIN only)
19. **Users/Staff** — User management with RBAC

## RBAC (Role-Based Access Control)

5 roles: `SUPER_ADMIN`, `TEACHER`, `ACCOUNTANT`, `PARENT`, `STUDENT`

Each role sees only the nav items and routes it can access (enforced both frontend `canAccessRoute()` and backend middlewares).

| Route      | SUPER_ADMIN | TEACHER | ACCOUNTANT | PARENT | STUDENT |
|------------|-------------|---------|------------|--------|---------|
| /payroll   | ✅          | ❌      | ✅         | ❌     | ❌      |
| /finance   | ✅          | ❌      | ✅         | ❌     | ❌      |
| /students  | ✅          | ✅      | ❌         | ❌     | ❌      |

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

## PDF Export Features

### Finance PDF (`GET /api/finance/export`)
Query params: `type` (invoices|transactions), `status`, `dateFrom`, `dateTo`
- Branded A4 layout with school name header
- Summary cards (totals, breakdowns)
- Paginated colour-coded data table
- `pdfkit` externalized in esbuild (avoids fontkit CJS bundling issues)

### Payslip PDF (`GET /api/payroll/:id/payslip`)
- Individual payslip for each staff member
- Earnings + deductions side-by-side layout
- Net salary highlighted banner
- Status-aware (DRAFT/APPROVED/PAID with paid date)

## Fee Reminder Scheduler

Configurable daily cron that auto-sends in-app payment reminders. Persisted in `reminder_settings` table (one row per tenant).

**How it runs:**
- Starts on server boot; checks every hour but only fires once per calendar day
- For each configured day offset, computes `today - offset` as the target due date
- Finds all PENDING/OVERDUE invoices with that exact due date
- Sends an in-app notification to each linked parent + all finance staff
- Updates `lastRunAt` and `lastRunCount` in DB

**Default windows:** 3 days before, 1 day before, on due date, 1 day after, 3 days after, 7 days after

**Manual trigger:** `POST /api/reminder-settings/trigger` bypasses the daily-limit check — useful for testing or urgent batches.

**Settings UI:** Finance page → "Reminders" tab — toggle enable/disable, click day-offset chips, Save Changes, or Send Now.

## Payroll Workflow

1. **Generate** — Click "Bulk Generate" to create DRAFT records for all staff in a month
2. **Edit** — Adjust individual salaries, allowances, deductions
3. **Approve** — Admin approves each record (DRAFT → APPROVED)
4. **Mark Paid** — Finance marks as paid (APPROVED → PAID); records `paidAt` timestamp
5. **Payslip** — Download individual PDF payslip at any status

## API Routes

All routes prefixed with `/api/`:

- `GET  /healthz` — Health check
- `POST /auth/login` — JWT login
- `GET  /auth/me` — Current user
- `PUT  /auth/password` — Change password
- `POST /auth/forgot-password` — Generate reset token
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
- `POST /invoices/:id/notify` — Send payment reminder
- `GET/POST /transactions` — Payment transactions
- `GET /finance/export` — PDF export (invoices or transactions)
- `GET /payroll` — List payroll records (filter: month, year, status)
- `POST /payroll` — Create single payroll record
- `POST /payroll/generate` — Bulk generate for all staff in a month
- `PUT /payroll/:id` — Update salary/allowances/deductions
- `PATCH /payroll/:id/approve` — Approve payroll (SUPER_ADMIN)
- `PATCH /payroll/:id/mark-paid` — Mark as paid
- `DELETE /payroll/:id` — Delete DRAFT record
- `GET /payroll/:id/payslip` — Download payslip PDF
- `GET /parent/fee-statement/:studentId` — Full invoice + transaction history (PARENT ownership enforced)
- `GET /parent/fee-statement/:studentId/pdf` — Download branded PDF statement
- `GET /reminder-settings` — Get fee reminder scheduler config
- `PUT /reminder-settings` — Update enabled flag and day-offset windows
- `POST /reminder-settings/trigger` — Manually force a reminder run
- `GET /dashboard/stats` — Dashboard KPIs
- `GET /dashboard/attendance-summary` — Today's attendance by class
- `GET /dashboard/revenue-trend` — 6-month revenue chart data
- `GET /dashboard/recent-activity` — Recent events feed
- `GET /dashboard/ai-summary` — AI-powered daily brief
- `GET/POST/DELETE /notifications` — Notifications + bulk parent notify
- `POST /notifications/bulk` — Bulk parent notification
- `GET /notifications/stream` — SSE real-time stream
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
- `artifacts/api-server/src/routes/finance/export.ts` — Finance PDF export
- `artifacts/api-server/src/routes/payroll/index.ts` — Payroll CRUD + payslip PDF
- `artifacts/api-server/build.mjs` — esbuild config (pdfkit/fontkit externalized)
- `artifacts/school-erp/src/App.tsx` — All frontend routes
- `artifacts/school-erp/src/lib/auth.tsx` — Auth context, ROLE_CONFIG, canAccessRoute
- `artifacts/school-erp/src/lib/tenant.tsx` — Tenant context, theme injection
- `artifacts/school-erp/src/lib/syncEngine.ts` — Dexie offline sync engine
- `artifacts/school-erp/src/hooks/useSyncEngine.ts` — Sync state hook
- `artifacts/school-erp/src/hooks/useNotificationSSE.ts` — SSE hook
- `artifacts/school-erp/src/components/Layout.tsx` — Sidebar, offline indicator, notification bell
- `artifacts/school-erp/src/pages/PayrollPage.tsx` — Payroll management UI
- `lib/db/src/schema/index.ts` — All Drizzle schema exports
- `lib/db/src/schema/payroll.ts` — Payroll DB tables

## Common Commands

```bash
# Start API server (handled by Replit workflow)
pnpm --filter @workspace/api-server run dev

# Start frontend (handled by Replit workflow)
pnpm --filter @workspace/school-erp run dev

# TypeCheck all packages
pnpm run typecheck

# Push DB schema changes
pnpm --filter @workspace/db run push

# Regenerate API client from OpenAPI spec
pnpm --filter @workspace/api-spec run codegen

# Build API server only
pnpm --filter @workspace/api-server run build
```
