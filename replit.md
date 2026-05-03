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
17. **Dashboard Finance Intelligence Row** — Two cards displayed below the stats grid, visible to SUPER_ADMIN + ACCOUNTANT only:
    - **Finance KPI Card** (`GET /api/dashboard/finance-kpi`, `requireFinance`): collection rate % (green ≥80%, amber ≥50%, red <50%) with animated progress bar, collected this month vs billed, total outstanding (pending + partial invoices), and a 6-month AreaChart sparkline. Auto-refreshes every 5 min.
    - **Escalation Banner** (`GET /api/dashboard/escalation-summary`, `requireFinance`): criticalCount, warningCount, totalEscalated, totalAtRisk split by level. Amber/red border when alerts exist, green "All Clear" when none; CRITICAL pill, WARNING pill, ৳ at-risk, "View Escalations →" link to /finance; auto-refreshes every 60 s. Both endpoints return 403 to parent/teacher roles.
18. **Student Fee Ledger + Inline Payment Recording** — `GET /api/students/:id/fee-ledger` (all staff; PARENT → 403). Two-tab `ViewDialog` (Profile + Fee Ledger): 4 KPI cards, year filter, scrollable invoice table with expandable payment rows. SUPER_ADMIN + ACCOUNTANT see a "Pay" button per unpaid invoice that opens a `RecordPaymentDialog` inline — amount (pre-filled with outstanding, capped with validation), method (CASH/BANK_TRANSFER/MOBILE_BANKING/CHEQUE), payment date, optional reference and notes. Calls existing `POST /api/transactions` (`requireFinance`); on success invalidates the ledger query and shows a toast. Dialog widened to `max-w-3xl`.
19. **Bulk Payment Recording** — `POST /api/transactions/bulk` (`requireFinance`): accepts `invoiceIds[]`, `method`, `paidAt`, optional `transactionId`/`notes`. For each invoice, calculates outstanding and records a full-payment transaction, marks invoice PAID; skips already-paid/cancelled. Returns `{ processed, totalAmount, results[] }` with a bulk audit log entry. Finance page Invoices tab: checkbox column added for PENDING/OVERDUE rows (header checkbox selects/deselects all); selected count highlighted in blue. Floating action bar appears when ≥1 row selected showing invoice count + total outstanding + "Clear" and "Batch Pay" buttons. `BatchPaymentDialog` shows scrollable invoice list with outstanding amounts, method picker, date picker, optional batch reference and notes; invalidates invoice and transaction queries on success.
20. **Payment Receipt PDF Generator + Email Delivery** — `GET /api/finance/transactions/:id/receipt` streams an A5 PDF receipt (PDFKit); `POST /api/finance/transactions/:id/receipt/email` generates the same PDF into a Buffer and emails it to the parent using nodemailer (`lib/mailer.ts` — reads DB SMTP config first, falls back to env vars, then to log-only). Email resolution: linked parent user account email → student.parentEmail → 422 if neither found. Sends HTML email with payment summary table + PDF attachment; creates an in-app notification to the parent user on success. Finance Transactions tab: "Receipt" 7th column has two inline actions — indigo "PDF" (download) and green "Email" (send to parent); each shows a spinner only for its own row; toast reports `deliveryMode` ("email" vs "in-app-only") and `sentTo` address.
21. **SMTP Settings Panel (Tenants page)** — Six new nullable columns on `tenantsTable`: `smtpHost`, `smtpPort` (integer, default 587), `smtpUser`, `smtpPass`, `smtpFrom`, `smtpSecure` (boolean). Three new endpoints (SUPER_ADMIN only): `GET /api/tenants/smtp-settings` (returns config with password masked as `smtpPassSet: bool`), `PUT /api/tenants/smtp-settings` (saves settings, skips password update if blank), `POST /api/tenants/smtp-settings/test` (creates live transporter and sends test email to provided address, returns SMTP errors verbatim). `lib/mailer.ts` now exports `sendMailWithConfig(cfg, payload)` using an explicit SmtpConfig object; `sendMail` retains env-var fallback. Email receipt endpoint prefers DB config, falls back to env vars. Tenants page: collapsible "Email Settings (SMTP)" card below the tenant table — status badge (Configured/Not configured), status banner, 6 form fields (host, port, user, password with show/hide toggle, from address, TLS switch), one-click quick-fill buttons for Gmail / Outlook 365 / SendGrid, Save button, and a separate "Send Test Email" section.
28. **Admin Fee Statement PDF + Email to Parent + Statement History Log** — Extends the admin student view (Students page → View dialog) with two quick-action buttons in the dialog header (SUPER_ADMIN/ACCOUNTANT only): "Statement PDF" downloads the existing `GET /parent/fee-statement/:studentId/pdf` directly from the header without switching tabs; "Email to Parent" calls a new `POST /parent/fee-statement/:studentId/email` endpoint (requireFinance guard) that resolves the recipient via linked parent user account → student.parentEmail → 422 if neither found, generates the full A4 PDF into a Buffer (invoice history + payment history tables), sends an HTML email with the PDF attached using the same SMTP priority chain (DB config → env vars → log-only), returns `{ sent, sentTo, deliveryMode }`. The "Email to Parent" button is disabled (with tooltip) when no parent email is on file. Both buttons show spinner while in-flight. New `fee_statement_logs` DB table (`id`, `studentId`, `triggeredByUserId`, `action` enum [PDF_DOWNLOAD/EMAIL_SENT], `sentTo`, `deliveryMode`, `createdAt`) records every PDF download (fire-and-forget before pipe) and every email send (awaited after mailer call). New `GET /parent/fee-statement/:studentId/logs` endpoint (requireFinance) joins with usersTable to return triggeredBy name + role. ViewDialog gains a third "Statement History" tab (SUPER_ADMIN/ACCOUNTANT only) rendering a scrollable `StatementHistoryTab` component — each entry shows a colour-coded icon (indigo=PDF, green=Email), action label, delivery-mode badge, who triggered it (name + role), destination email for EMAIL_SENT entries, and timestamp. Empty-state illustrated with Clock icon. `feeStatementLogsTable` exported from `@workspace/db` schema; `desc` added to drizzle-orm imports.
27. **Financial Health Dashboard (Finance → Health tab)** — School-wide financial analytics for SUPER_ADMIN/ACCOUNTANT. Backend: `GET /api/finance/health-analytics` in `health-analytics.ts` — 5 parallel raw SQL queries: (1) monthly trend for last 12 calendar months (billed, collected, outstanding, collectionRate, invoiceCount), padded to a full 12-month window; (2) top 15 debtors by outstanding balance with overdueCount/pendingCount; (3) fee-type breakdown (billed, collected, outstanding, collectionRate per fee type); (4) aging buckets (Not yet due / 1-30 / 31-60 / 61-90 / 90+ days) with count+outstanding per bucket; (5) overall snapshot KPIs. Frontend `HealthTab` component: 4 KPI cards (Overall Collection Rate with colour-coding ≥90% green/≥70% yellow/else red, Total Outstanding, Invoices Paid, Total Billed); ComposedChart bar+line for monthly trend (Billed vs Collected bars on left axis, Collection Rate % line on right axis); horizontal BarChart for aging buckets colour-coded light→dark red by severity with a legend below; PieChart donut for fee-type breakdown with scrollable legend + collection rate per type; horizontal BarChart for top-10 debtors with heat-mapped fill (light→dark red by magnitude) + full table of top 15 with overdue/pending badges. Refresh button re-fetches with 2-min stale time. Registered in routes/index.ts.
26. **Family Fee Summary Dashboard (Parent Portal)** — New cross-child consolidated summary panel at the top of the Parent Portal page. Backend: `GET /api/parent/fee-summary` — authenticates parent, loads all linked students, fetches all PENDING/OVERDUE invoices + fee types + class names in parallel, builds per-child breakdown (outstanding, overdueCount, nextDueDate/Amount/InvoiceNumber) and an `upcomingDues` list (top 8 open invoices sorted by due date across all children), returns `{ aggregate, children, upcomingDues, generatedAt }`. Frontend: `FamilySummaryBanner` component — `fetchAuthed` helper for the pre-`authedFetch` placement; 4 KPI cards (Total Outstanding, Overdue Invoices, Total Paid, Total Invoiced); all-clear green banner or overdue red alert; per-child status strip (avatar, name, class, outstanding/overdue/cleared badge) shown only when multiple children; "Upcoming & Overdue Payments" list with colour-coded due-date labels (overdue, today, tomorrow, ≤7d, further); `dueDateLabel(daysUntil)` helper; component is rendered in the main page above per-child `StudentCard` sections whenever ≥1 student is linked and the parent is authenticated.
25. **Daily Parent Fee Digest (SMS/WhatsApp)** — A separate daily digest that sends each parent ONE consolidated message listing ALL their PENDING/OVERDUE invoices, instead of per-invoice alerts. Two new DB columns on `reminderSettingsTable`: `digestSmsEnabled`, `digestWhatsappEnabled` (default false) + `digestLastRunAt` timestamp + `digestLastRunCount` integer. DB pushed, libs rebuilt. `sendParentDigest(force?)` function exported from `reminder-cron.ts`: loads digest settings → skips if already ran today (or not enabled); fetches tenant Twilio config; fetches all PENDING/OVERDUE invoices; joins students/parentStudentsTable to resolve parent phone (linked parent account `phoneNumber` first, then `students.parentPhone` fallback); groups by phone number into one message per parent listing all students/invoices with amounts + due dates + OVERDUE badge; sends via `sendSms()`/`sendWhatsapp()`; updates `digestLastRunAt`/`digestLastRunCount`; returns `{ sent, skipped }`. Wired into `startReminderCron()` — runs in parallel with `runReminderCron()` on startup and every hour (both skip gracefully if already ran today). New endpoint `POST /api/reminder-settings/digest/trigger` for forced manual run. PUT endpoint extended with `digestSmsEnabled`/`digestWhatsappEnabled`. Finance page Reminders tab: new "Daily Fee Digest" card below the SMS Reminders card — two side-by-side digest toggles; last digest run timestamp and count shown; "Send Digest Now" button appears inline when either digest channel is enabled; green result banner on success.
24. **Fee Reminder SMS/WhatsApp (Scheduler Extension)** — Extended the Fee Reminder Scheduler to also deliver reminders via SMS and WhatsApp alongside the existing in-app notifications. Two new boolean columns on `reminderSettingsTable`: `smsEnabled` and `whatsappEnabled` (both default false). DB pushed. `sendInvoiceReminder()` in `overdue-cron.ts` updated: fetches invoice + reminder settings in parallel; resolves parent phone via linked parent `usersTable.phoneNumber` (priority) → email-matched parent → `students.parentPhone`; calls `sendSms()`/`sendWhatsapp()` from `sms.ts` directly with the tenant's Twilio config (fetched once, only when SMS/WA enabled); logs delivery per-invoice; return type extended with `smsSent: boolean`; response message reflects all channels used. GET `/api/reminder-settings` automatically returns `smsEnabled`/`whatsappEnabled` (via `...settings` spread). PUT `/api/reminder-settings` saves them alongside `isEnabled`/`reminderDays`. Finance page Reminders tab: new "SMS & WhatsApp Reminders" card (between Reminder Windows and the action buttons) with two side-by-side toggle rows (SMS Reminders, WhatsApp Reminders); an amber hint appears when either is enabled pointing to Tenants → SMS settings; Save button payload extended with `smsEnabled`/`whatsappEnabled`; Reset clears all four local states; "How it works" step 3 updated to mention text messages. The "Send Now" manual trigger also fires SMS/WhatsApp for the matched invoices.
23. **Attendance Absence Alerts (SMS/WhatsApp)** — When any student is marked ABSENT (via single `POST /attendance`, bulk `POST /attendance/bulk`, or `PUT /attendance/:id` status update), the system fires an SMS and/or WhatsApp message to the parent immediately. Two new boolean columns on `tenantsTable`: `attendanceSmsEnabled`, `attendanceWhatsappEnabled` — controlled independently from payment SMS toggles so schools can choose which events trigger messages. `lib/notify-parent.ts` shared helper: `notifyParentBySms(studentId, message, trigger)` (single, lazy phone resolution) and `notifyParentsBulk(studentIds[], makeMessage, trigger)` (batch-optimized: one tenant fetch, two parallel SQL queries to resolve all parent phones via `inArray`, then `Promise.allSettled` dispatches). Both resolve phone via: linked parent `usersTable.phoneNumber` (takes priority) → `studentsTable.parentPhone`. Notifications fire non-blocking (`.catch(() => undefined)`) so attendance marking never fails due to Twilio errors. In-app `WARNING` notifications also sent to linked parent user accounts on each absence. Attendance toggles exposed on `GET /api/tenants/sms-settings` and saved via `PUT`. TenantsPage SMS panel gains an "Attendance Alerts" section with two side-by-side toggles (Absence SMS + Absence WhatsApp), visually separated from the payment-receipt toggles by a divider. The "How It Works" explainer box updated to describe both payment and attendance triggers.
22. **SMS & WhatsApp Notifications (Twilio)** — Six new nullable columns on `tenantsTable`: `twilioAccountSid`, `twilioAuthToken`, `twilioFromPhone`, `twilioWhatsappFrom`, `smsEnabled` (bool), `whatsappEnabled` (bool). `lib/sms.ts` exports `sendSms(to, body, cfg)` and `sendWhatsapp(to, body, cfg)` — both call Twilio REST API via `fetch` with Basic auth (no SDK). Three new endpoints (SUPER_ADMIN only): `GET /api/tenants/sms-settings` (returns config with `twilioAuthTokenSet: bool` mask), `PUT /api/tenants/sms-settings` (saves, skips auth token if blank), `POST /api/tenants/sms-settings/test` (sends real test SMS or WhatsApp to a given phone, reports Twilio SID). Payment receipt email endpoint extended: after email delivery, resolves parent phone (linked parent user `phoneNumber` → `students.parentPhone`), fires SMS + WhatsApp in parallel if tenant has Twilio configured + respective channel enabled + phone from field set. In-app notification now lists all channels used. Response enriched with `phoneUsed` and `smsChannels[]`. Tenants page: collapsible "SMS & WhatsApp (Twilio)" panel with status badge, Configured/Not configured banner, Account SID field, Auth Token (masked, show/hide toggle), separate SMS card (toggle + From Number) and WhatsApp card (toggle + From Number with sandbox note), "How It Works" explainer box, Save button, and a test section with phone input + channel selector (SMS / WhatsApp).
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
