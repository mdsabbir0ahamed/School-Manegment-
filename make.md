# Smart School ERP — Developer Guide

## Quick Start

```bash
# 1. Install dependencies
pnpm install

# 2. Push DB schema (first time or after schema changes)
pnpm --filter @workspace/db run push

# 3. Start both services (via Replit workflows, or manually):
pnpm --filter @workspace/api-server run dev   # API at :8080 → /api
pnpm --filter @workspace/school-erp run dev   # Frontend at :5173 → /
```

Log in at `/login` with:
- **Admin:** `admin@school.edu` / `admin123`
- **Teacher:** `sarah.ahmed@school.edu` / `teacher123`
- **Accountant:** `accountant@school.edu` / `accountant123`
- **Parent:** `parent1@school.edu` / `parent123`

---

## Project Layout

```
/
├── artifacts/
│   ├── api-server/               Express 5 REST API
│   │   ├── src/
│   │   │   ├── app.ts            Express app (CORS, JSON, routes)
│   │   │   ├── index.ts          Server entry (port binding)
│   │   │   ├── routes/           All route modules
│   │   │   │   ├── index.ts      Central router (registers all sub-routers)
│   │   │   │   ├── auth/         Login, me, password, reset
│   │   │   │   ├── students/     CRUD + bulk CSV import
│   │   │   │   ├── attendance/   Daily marking
│   │   │   │   ├── finance/      Fee types, invoices, transactions, PDF export
│   │   │   │   ├── payroll/      Staff salaries, approve flow, payslip PDF
│   │   │   │   ├── notifications/CRUD + bulk send + SSE stream
│   │   │   │   ├── dashboard/    KPIs, charts, AI summary
│   │   │   │   └── ...           (classes, subjects, timetable, audit, etc.)
│   │   │   ├── middlewares/
│   │   │   │   ├── requireAuth.ts  JWT verification → req.userId, req.userRole
│   │   │   │   └── requireRole.ts  Role guards (requireAdmin, requireFinance, …)
│   │   │   └── lib/
│   │   │       ├── auth.ts         Custom HMAC-SHA256 JWT (no jsonwebtoken)
│   │   │       ├── audit.ts        Audit log helper
│   │   │       ├── sse-manager.ts  In-memory SSE client registry
│   │   │       └── overdue-cron.ts Marks overdue invoices every 6 hours
│   │   └── build.mjs             esbuild config (pdfkit externalized)
│   │
│   └── school-erp/               React + Vite SPA
│       └── src/
│           ├── App.tsx           Route declarations (wouter)
│           ├── pages/            One file per page/module
│           ├── components/
│           │   └── Layout.tsx    Sidebar, nav, offline indicator, notif bell
│           ├── lib/
│           │   ├── auth.tsx      Auth context + ROLE_CONFIG + canAccessRoute
│           │   ├── tenant.tsx    Tenant/theme context
│           │   └── syncEngine.ts Dexie offline mutation queue
│           └── hooks/
│               ├── useNotificationSSE.ts  Fetch-based SSE with backoff
│               └── useSyncEngine.ts       Online/offline sync state
│
├── lib/
│   ├── db/                       Drizzle ORM
│   │   └── src/schema/           One file per domain (finance, payroll, …)
│   ├── api-spec/                 OpenAPI YAML + Orval codegen config
│   ├── api-zod/                  Generated Zod schemas (do not edit)
│   └── api-client-react/         Generated React Query hooks (do not edit)
│
└── scripts/                      Shared utility scripts
```

---

## Common Tasks

### Add a New API Route

1. Create `artifacts/api-server/src/routes/<module>/index.ts`
2. Import and register in `artifacts/api-server/src/routes/index.ts`:
   ```typescript
   import myRouter from "./my-module/index.js";
   router.use(myRouter);
   ```
3. Use `requireAuth` + a role guard on each endpoint:
   ```typescript
   router.get("/my-resource", requireAuth, requireAdmin, async (req, res) => { … });
   ```
4. Call `audit()` on every mutating operation.

### Add a New DB Table

1. Create `lib/db/src/schema/<table>.ts` following existing patterns.
2. Export it from `lib/db/src/schema/index.ts`.
3. Run schema push:
   ```bash
   pnpm --filter @workspace/db run push
   ```

### Add a New Frontend Page

1. Create `artifacts/school-erp/src/pages/<Name>Page.tsx`.
2. Add a route in `artifacts/school-erp/src/App.tsx`:
   ```tsx
   import MyPage from "@/pages/MyPage";
   // inside Router():
   <Route path="/my-page">
     <ProtectedRoute component={MyPage} route="/my-page" />
   </Route>
   ```
3. Add the route to the appropriate roles in `artifacts/school-erp/src/lib/auth.tsx`
   (`allowedRoutes` array for each role that should access it).
4. Add a nav item in `artifacts/school-erp/src/components/Layout.tsx`
   (`ALL_NAV_ITEMS` array).

### Regenerate API Client After Spec Change

```bash
pnpm --filter @workspace/api-spec run codegen
```
This updates `lib/api-zod/` and `lib/api-client-react/` from `lib/api-spec/openapi.yaml`.

### Typecheck Everything

```bash
pnpm run typecheck
```
Builds composite libs first, then checks all leaf packages. Trust this over editor state.

### Push DB Schema

```bash
pnpm --filter @workspace/db run push
# Force (for destructive changes):
pnpm --filter @workspace/db run push-force
```

---

## Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| Custom JWT (HMAC-SHA256) | Avoids `jsonwebtoken` native dependency issues in ESM builds |
| `pdfkit` externalized in esbuild | `fontkit` uses `@swc/helpers` in CJS mode — bundling breaks; runtime load works |
| SSE via `fetch` (not `EventSource`) | `EventSource` doesn't support `Authorization` header |
| Drizzle `push` workflow | Prototyping-speed schema sync; switch to `generate`+`migrate` for production |
| OpenAPI-first contract | Single source of truth: spec → Zod schemas → React Query hooks via Orval |
| `@workspace/` package prefix | Avoids npm name collisions; signals internal packages |

---

## RBAC Summary

| Module       | SUPER_ADMIN | TEACHER | ACCOUNTANT | PARENT | STUDENT |
|--------------|:-----------:|:-------:|:----------:|:------:|:-------:|
| Dashboard    | ✅          | ✅      | ✅         | ✅     | ✅      |
| Students     | ✅          | ✅      | ❌         | ❌     | ❌      |
| Attendance   | ✅          | ✅      | ❌         | ❌     | ❌      |
| Subjects     | ✅          | ✅      | ❌         | ❌     | ❌      |
| Timetable    | ✅          | ✅      | ❌         | ❌     | ❌      |
| QR Codes     | ✅          | ✅      | ❌         | ❌     | ❌      |
| Finance      | ✅          | ❌      | ✅         | ❌     | ❌      |
| Payroll      | ✅          | ❌      | ✅         | ❌     | ❌      |
| Documents    | ✅          | ✅      | ❌         | ❌     | ❌      |
| Report Card  | ✅          | ✅      | ❌         | ❌     | ❌      |
| Calendar     | ✅          | ✅      | ✅         | ✅     | ❌      |
| Notifications| ✅          | ✅      | ✅         | ✅     | ❌      |
| Asset Mgmt   | ✅          | ✅      | ❌         | ❌     | ❌      |
| Users/Staff  | ✅          | ❌      | ❌         | ❌     | ❌      |
| Audit Log    | ✅          | ❌      | ❌         | ❌     | ❌      |
| Tenants      | ✅          | ❌      | ❌         | ❌     | ❌      |
| Parent Portal| ❌          | ❌      | ❌         | ✅     | ❌      |

---

## Payroll Workflow

```
[Bulk Generate]
      │
      ▼
   DRAFT  ──(edit salary/allowances)──▶  DRAFT
      │
      │  [Admin: Approve]
      ▼
  APPROVED
      │
      │  [Finance: Mark Paid]
      ▼
    PAID  ──▶  Download Payslip PDF
```

- Only DRAFT records can be deleted or edited.
- Payslip PDF available at any status.
- Bulk Generate skips staff who already have a record for that month.

---

## Finance PDF Export

`GET /api/finance/export?type=invoices&status=PAID&dateFrom=2025-01-01&dateTo=2025-12-31`

| Param      | Values                                     |
|------------|--------------------------------------------|
| `type`     | `invoices` (default) or `transactions`     |
| `status`   | `PAID`, `PENDING`, `OVERDUE`, `CANCELLED`  |
| `dateFrom` | ISO date string (`YYYY-MM-DD`)             |
| `dateTo`   | ISO date string (`YYYY-MM-DD`)             |

---

## Environment Variables

| Variable                          | Description                              | Required |
|-----------------------------------|------------------------------------------|----------|
| `DATABASE_URL`                    | PostgreSQL connection string             | Yes      |
| `SESSION_SECRET`                  | JWT signing secret                       | No*      |
| `AI_INTEGRATIONS_OPENAI_BASE_URL` | Replit AI proxy URL                      | No**     |
| `AI_INTEGRATIONS_OPENAI_API_KEY`  | Replit AI proxy key                      | No**     |

\* Falls back to `"fallback-dev-secret"` in development — set for production.  
\** AI daily summary silently skipped if not set.

---

## Fee Reminder Scheduler

The scheduler lives entirely in the API server — no external cron service needed.

| File | Purpose |
|------|---------|
| `lib/db/src/schema/reminder-settings.ts` | `reminder_settings` table (isEnabled, reminderDays JSON, lastRunAt) |
| `artifacts/api-server/src/lib/reminder-cron.ts` | Core logic: `runReminderCron(force?)` + `startReminderCron()` |
| `artifacts/api-server/src/routes/finance/reminder-settings.ts` | REST API: GET, PUT, POST /trigger |

**To change the check interval** (currently 1 hour with once-per-day guard):

```typescript
// reminder-cron.ts
const ONE_HOUR = 60 * 60 * 1000;
setInterval(() => runReminderCron(), ONE_HOUR);
```

**To add a new day-offset option**, update `OFFSET_OPTIONS` in `FinancePage.tsx` — the backend accepts any integer from -30 to 60 and stores as JSON.

**To test locally** without waiting for invoices with matching due dates, use the trigger endpoint:

```bash
curl -X POST http://localhost:80/api/reminder-settings/trigger \
  -H "Authorization: Bearer <token>"
```

---

## Deployment

The app is deployed via Replit's built-in deployment. The shared reverse proxy routes:
- `/api/*` → API server (port 8080)
- `/*` → React SPA (static build)

```bash
# Production build (API)
pnpm --filter @workspace/api-server run build

# Production build (Frontend)
pnpm --filter @workspace/school-erp run build
```
