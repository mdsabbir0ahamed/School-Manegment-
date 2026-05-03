# Smart School ERP

A production-ready, multi-tenant School Management System built as a pnpm monorepo. Manages students, staff, attendance, finance, payroll, and parent communications for educational institutions.

## Tech Stack

| Layer | Technology |
|---|---|
| API Server | Express 5 + TypeScript (Node.js 20) |
| Frontend | React 18 + Vite + TypeScript |
| Database | PostgreSQL (Drizzle ORM, schema-push migrations) |
| Auth | Custom JWT (HMAC-SHA256, no external lib) |
| PDF | PDFKit (A4 statements, A5 receipts, payslips) |
| Email | Nodemailer (DB-stored SMTP config with env-var fallback) |
| SMS / WhatsApp | Twilio REST API (no SDK) |
| AI | OpenAI GPT via Replit AI Integrations proxy |
| Real-Time | Server-Sent Events (SSE) |
| PWA / Offline | vite-plugin-pwa + Dexie.js offline sync queue |
| Monorepo | pnpm workspaces + TypeScript project references |

## Monorepo Structure

```
/
├── artifacts/
│   ├── api-server/          # Express 5 REST API (served at /api)
│   └── school-erp/          # React + Vite SPA (served at /)
├── lib/
│   ├── db/                  # Drizzle ORM schemas + push migrations
│   ├── api-spec/            # OpenAPI YAML contract (source of truth)
│   ├── api-zod/             # Auto-generated Zod validation schemas
│   └── api-client-react/    # Auto-generated React Query hooks
└── scripts/                 # Utility scripts
```

## Prerequisites

- Node.js 20+
- pnpm 9+
- PostgreSQL 15+ (or a Replit PostgreSQL instance)

## Environment Variables

Create a `.env` file at the repo root (or set these in your hosting environment):

```env
# Required
PORT=8080
DATABASE_URL=postgresql://user:password@host:5432/dbname
SESSION_SECRET=change-me-to-a-random-256-bit-secret

# Optional — AI daily summary (auto-set on Replit)
AI_INTEGRATIONS_OPENAI_BASE_URL=https://...
AI_INTEGRATIONS_OPENAI_API_KEY=your-key

# Optional — SMTP (can also be configured per-tenant via the UI)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=no-reply@example.com
SMTP_PASS=your-smtp-password
SMTP_FROM="School ERP" <no-reply@example.com>

# Optional — Twilio SMS/WhatsApp (can also be configured per-tenant via the UI)
TWILIO_ACCOUNT_SID=ACxxx
TWILIO_AUTH_TOKEN=your-token
TWILIO_FROM_PHONE=+1234567890
TWILIO_WHATSAPP_FROM=whatsapp:+1234567890
```

## Installation & Local Setup

```bash
# 1. Clone the repository
git clone <repo-url>
cd smart-school-erp

# 2. Install all workspace dependencies
pnpm install

# 3. Push database schema (creates all tables)
pnpm --filter @workspace/db run push

# 4. Seed demo data (optional — creates demo users, students, invoices)
# Run via the Replit database tool or psql with scripts/seed.sql

# 5. Start the API server (development)
pnpm --filter @workspace/api-server run dev

# 6. Start the frontend (separate terminal)
pnpm --filter @workspace/school-erp run dev
```

The API server starts on `PORT` (default 8080). The Vite dev server starts on a random port. A shared reverse proxy at port 80 routes `/api/*` to the API server and `/*` to the frontend.

## Database Migrations

This project uses Drizzle ORM with `drizzle-kit push` (schema-push, no migration files):

```bash
# Push schema changes to the database (development)
pnpm --filter @workspace/db run push

# Force push (bypasses safety checks — dev only)
pnpm --filter @workspace/db run push-force

# Rebuild generated DB type declarations (needed after schema changes)
pnpm run typecheck:libs
```

## TypeChecking

```bash
# Full typecheck (libs first, then all leaf packages)
pnpm run typecheck

# Libs only (composite build)
pnpm run typecheck:libs

# Single package
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/school-erp run typecheck
```

## API Code Generation

The OpenAI spec in `lib/api-spec/` is the source of truth. After editing the YAML:

```bash
pnpm --filter @workspace/api-spec run codegen
```

This regenerates Zod schemas (`lib/api-zod/`) and React Query hooks (`lib/api-client-react/`).

## API Documentation

All routes are prefixed with `/api/`. Key endpoint groups:

### Auth
| Method | Path | Access | Description |
|---|---|---|---|
| POST | /auth/login | Public | Returns JWT access token |
| GET | /auth/me | Any | Current user info |
| PUT | /auth/password | Any | Change own password |
| POST | /auth/forgot-password | Public | Generate reset token |
| POST | /auth/reset-password | Public | Use token to reset |

### Students
| Method | Path | Access | Description |
|---|---|---|---|
| GET | /students | Admin/Teacher | List with filters |
| POST | /students | Admin | Create student |
| PUT | /students/:id | Admin | Update student |
| DELETE | /students/:id | Admin | Delete student |
| POST | /students/bulk-import | Admin | CSV bulk import |
| GET | /students/:id/fee-ledger | Staff | Full invoice + payment history |
| GET | /students/:id/qr | Any | QR code data |

### Finance
| Method | Path | Access | Description |
|---|---|---|---|
| GET/POST | /fee-types | Finance | Fee type management |
| GET/POST | /invoices | Finance | Invoice management |
| POST | /invoices/:id/notify | Finance | Send payment reminder |
| POST | /invoices/bulk-generate | Finance | Bulk generate by class |
| GET/POST | /transactions | Finance | Payment recording |
| POST | /transactions/bulk | Finance | Batch payment recording |
| GET | /finance/export | Finance | PDF export (invoices/transactions) |
| GET | /finance/health-analytics | Finance | Financial health KPIs |
| GET | /finance/statement-activity | Finance | Statement dispatch log |
| GET/PUT | /finance/statement-schedule | Super Admin | Monthly scheduler config |
| POST | /finance/statement-schedule/trigger | Super Admin | Force a scheduler run |
| GET | /finance/collection-report | Finance | Per-class collection gap report |
| GET | /finance/escalations | Finance | Overdue escalation list |
| POST | /finance/escalations/run | Finance | Run escalation check |
| PATCH | /finance/escalations/:id/acknowledge | Finance | Reset escalation level |

### Fee Statements (Parent & Admin)
| Method | Path | Access | Description |
|---|---|---|---|
| GET | /parent/fee-statement/:id | Parent/Finance | Invoice + transaction history |
| GET | /parent/fee-statement/:id/pdf | Parent/Finance | Download PDF statement |
| POST | /parent/fee-statement/:id/email | Finance | Email statement to parent |
| GET | /parent/fee-statement/:id/logs | Finance | Statement dispatch history |
| GET | /parent/fee-summary | Parent | Cross-child consolidated summary |

### Payroll
| Method | Path | Access | Description |
|---|---|---|---|
| GET/POST | /payroll | Finance | List / create payroll records |
| POST | /payroll/generate | Finance | Bulk generate for all staff |
| PUT | /payroll/:id | Finance | Update salary/allowances |
| PATCH | /payroll/:id/approve | Super Admin | Approve record |
| PATCH | /payroll/:id/mark-paid | Finance | Mark as paid |
| GET | /payroll/:id/payslip | Finance | Download payslip PDF |

### Receipts & Notifications
| Method | Path | Access | Description |
|---|---|---|---|
| GET | /finance/transactions/:id/receipt | Finance | Download PDF receipt |
| POST | /finance/transactions/:id/receipt/email | Finance | Email receipt to parent |
| GET/POST/DELETE | /notifications | Any | Notification management |
| POST | /notifications/bulk | Admin | Bulk parent notification |
| GET | /notifications/stream | Any | SSE real-time stream |

### Settings
| Method | Path | Access | Description |
|---|---|---|---|
| GET/PUT | /reminder-settings | Finance | Fee reminder scheduler config |
| POST | /reminder-settings/trigger | Finance | Force reminder run |
| POST | /reminder-settings/digest/trigger | Finance | Force digest run |
| GET/PUT | /tenants/smtp-settings | Super Admin | SMTP email config |
| POST | /tenants/smtp-settings/test | Super Admin | Send test email |
| GET/PUT | /tenants/sms-settings | Super Admin | Twilio SMS/WhatsApp config |
| POST | /tenants/sms-settings/test | Super Admin | Send test SMS |
| GET/PUT | /finance/escalation-settings | Super Admin | Escalation day thresholds |

## RBAC (Role-Based Access Control)

| Role | Dashboard | Students | Attendance | Finance | Payroll | Parent Portal |
|---|---|---|---|---|---|---|
| SUPER_ADMIN | Full | Full | Full | Full | Full | — |
| TEACHER | View | View | Mark own classes | — | — | — |
| ACCOUNTANT | Finance KPIs | — | — | Full | View/Pay | — |
| PARENT | — | — | — | — | — | Own children only |
| STUDENT | — | — | — | — | — | — |

## Background Jobs (Cron)

| Job | Frequency | Purpose |
|---|---|---|
| Overdue Invoice Cron | Every 6 hours | Marks invoices OVERDUE, runs escalation check |
| Fee Reminder Cron | Every hour (once/day) | Sends in-app/SMS/WhatsApp reminders by due-date offset |
| Parent Digest Cron | Every hour (once/day) | Sends consolidated PENDING/OVERDUE invoice digest per parent |
| Statement Scheduler Cron | Every hour (fires on configured day+hour) | Emails monthly fee statements to all active students |

## PDF Documents

| Document | Route | Format | Description |
|---|---|---|---|
| Finance Export | GET /finance/export | A4 | Invoices or transactions table |
| Fee Statement | GET /parent/fee-statement/:id/pdf | A4 | Full invoice + payment history |
| Payment Receipt | GET /finance/transactions/:id/receipt | A5 | Single transaction receipt |
| Payslip | GET /payroll/:id/payslip | A4 | Individual staff payslip |

## Demo Credentials

| Role | Email | Password |
|---|---|---|
| SUPER_ADMIN | admin@school.edu | admin123 |
| TEACHER | sarah.ahmed@school.edu | teacher123 |
| ACCOUNTANT | accountant@school.edu | accountant123 |
| PARENT | parent1@school.edu | parent123 |
| STUDENT | student1@school.edu | student123 |

> The STUDENT user `student1@school.edu` is pre-linked to student record **Rafiq Islam (STU-001, Class One)**. After logging in they land on the Student Portal at `/student`.

## Key Source Files

| File | Purpose |
|---|---|
| `artifacts/api-server/src/app.ts` | Express app setup, middleware |
| `artifacts/api-server/src/routes/index.ts` | Central router — all route registrations |
| `artifacts/api-server/src/lib/auth.ts` | Custom JWT (HMAC-SHA256) |
| `artifacts/api-server/src/lib/mailer.ts` | Nodemailer + DB SMTP config |
| `artifacts/api-server/src/lib/sms.ts` | Twilio SMS + WhatsApp via fetch |
| `artifacts/api-server/src/lib/overdue-cron.ts` | Overdue + escalation cron |
| `artifacts/api-server/src/lib/reminder-cron.ts` | Fee reminder + digest cron |
| `artifacts/api-server/src/lib/statement-scheduler-cron.ts` | Monthly statement email cron |
| `artifacts/school-erp/src/lib/auth.tsx` | Auth context, ROLE_CONFIG, canAccessRoute |
| `artifacts/school-erp/src/lib/tenant.tsx` | Tenant theme context |
| `artifacts/school-erp/src/lib/syncEngine.ts` | Dexie.js offline sync engine |
| `lib/db/src/schema/index.ts` | All Drizzle schema exports |

## Deployment

This project is deployed on Replit. The shared reverse proxy routes traffic by path:
- `/api/*` → API server (port 8080)
- `/*` → React SPA (Vite build)

For production, the Vite build is static and the API server runs as a Node.js process. Both share the same PostgreSQL instance. Environment variables are managed via Replit Secrets.
