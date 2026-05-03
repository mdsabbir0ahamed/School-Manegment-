# Smart School ERP — User Manual

Welcome to Smart School ERP — your all-in-one school management platform. This guide will help you get started quickly, no technical knowledge required.

---

## Table of Contents

1. [Getting Started — Logging In](#1-getting-started--logging-in)
2. [Super Admin Guide](#2-super-admin-guide)
3. [Finance & Accounts Guide (Accountant)](#3-finance--accounts-guide-accountant)
4. [Teacher Guide](#4-teacher-guide)
5. [Parent Guide](#5-parent-guide)
6. [Notifications](#6-notifications)
7. [Getting Help](#7-getting-help)

---

## 1. Getting Started — Logging In

1. Open your school's ERP link in any browser (Chrome, Firefox, Edge, or Safari).
2. On the login page, enter your **Email Address** and **Password**.
3. Click **Sign in**.

You will be taken directly to your personalised dashboard based on your role.

> If you forget your password, click **Forgot password?** on the login page, enter your email, and follow the instructions sent to you.

### Who sees what?

| Role | What they can access |
|---|---|
| Super Admin | Everything — all modules, all settings |
| Accountant | Finance, Payroll, Student fee information |
| Teacher | Students, Attendance, Exam Marks, Timetable |
| Parent | Their own children's information, fees, and payment history |

---

## 2. Super Admin Guide

As Super Admin, you have full control over the school's ERP.

### 2.1 Dashboard

When you log in, the Dashboard shows you:
- **Total Students**, **Today's Attendance Rate**, **Monthly Revenue**, and **Pending Invoices** at a glance.
- **Finance KPI card** — collection rate and outstanding balance with a 6-month trend chart.
- **Escalation Banner** — alerts you when invoices have gone critically overdue.
- **AI Daily Summary** — an automatically generated 3–4 sentence brief on today's school activity.
- **Recent Activity Feed** — a live log of recent system events.

### 2.2 Managing Students

**To admit a new student:**
1. Click **Students** in the left sidebar.
2. Click the **+ Add Student** button (top right).
3. Fill in the student's name, class, date of birth, parent contact, and admission date.
4. Click **Save**. The student is now enrolled.

**To edit or remove a student:**
- Find the student using the search bar or class filter.
- Click the **pencil (edit)** icon to update their details.
- Click the **trash (delete)** icon to remove them (use with caution — this cannot be undone).

**Bulk Import:**
- Click **Bulk Import (CSV)** to upload many students at once using a spreadsheet file.

**Student View Dialog:**
- Click the **eye icon** on any student row to open the full profile.
- The Profile tab shows all personal details.
- The **Fee Ledger tab** shows all invoices and payment history.
- The **Statement History tab** shows when fee statements were downloaded or emailed.
- Use the **Statement PDF** button to download a PDF instantly.
- Use the **Email to Parent** button to send the statement directly to the parent.

### 2.3 Managing Classes

1. Click **Classes** in the sidebar.
2. Click **+ New Class** to create a class (name, section, grade level, assign a teacher).
3. Edit or delete existing classes using the action icons on each row.

### 2.4 Managing Staff / Users

1. Click **Users** in the sidebar.
2. Click **+ Add User** to create a staff account (name, email, password, role).
3. Roles: SUPER_ADMIN, TEACHER, ACCOUNTANT, PARENT.
4. You can reset a staff member's password from the edit dialog.

### 2.5 Timetable & Subjects

- **Subjects** — Add and manage all taught subjects from the Subjects page.
- **Timetable** — Assign time slots to classes and subjects from the Timetable page.

### 2.6 Tenants & School Settings

Click **Tenants** in the sidebar to:
- Update your school's name and contact information.
- Customise the colour theme (primary colour, accent colour).
- Configure **SMTP Email** settings (host, port, username, password) so the system can send emails on your behalf.
- Configure **Twilio SMS & WhatsApp** settings for text message alerts to parents.
- Toggle **Attendance SMS alerts** — parents receive a text when their child is marked absent.

### 2.7 Payroll Management

1. Click **Payroll** in the sidebar.
2. Click **Bulk Generate** and select a month/year to auto-create payroll records for all active staff.
3. Review and edit individual records (salary, allowances, deductions).
4. Click **Approve** on each record to confirm it (DRAFT → APPROVED).
5. Once payments are made, click **Mark Paid** (APPROVED → PAID).
6. Download individual **Payslip PDFs** using the download icon on each row.

### 2.8 Asset / Hardware Management

Click **Hardware** in the sidebar to track school equipment (computers, projectors, etc.) — add items, log their status, and manage assignments.

### 2.9 Audit Log

Click **Audit Log** to see a complete history of all actions taken in the system — who did what and when.

---

## 3. Finance & Accounts Guide (Accountant)

### 3.1 Finance Overview

Click **Finance** in the sidebar to access all financial tools, organised into tabs:

| Tab | Purpose |
|---|---|
| Invoices | View, create, and manage all student invoices |
| Transactions | Record and review all payments |
| Reminders | Configure automatic payment reminder notifications |
| Payment Requests | Review and approve/reject parent payment submissions |
| Discounts | Manage student fee discounts |
| Expenses | Record school expenses |
| P&L | Profit & Loss overview |
| Budgets | Budget planning and tracking |
| Fee Schedules | Automatic invoice generation rules |
| Collection Report | Per-class fee collection gap analysis |
| Escalations | Overdue invoice escalation management |
| Health | Financial health KPIs and analytics |
| Statement Activity | Log of all fee statement downloads and emails |

### 3.2 Generating Invoices

**Single invoice:**
1. Click the **+ Create Invoice** button in the Invoices tab.
2. Select the student, fee type, month, amount, and due date.
3. Click **Create Invoice**.

**Bulk invoice generation:**
1. Click **Bulk Generate** (top right of Finance page).
2. Select a class, fee type, month, and due date.
3. The system shows how many eligible students will be invoiced.
4. Click **Generate** — invoices are created for all active students in that class (existing ones are skipped automatically).

### 3.3 Recording Payments

**Single payment:**
1. In the Invoices tab, find the invoice and click its **Pay** button.
2. Enter the amount, payment method (Cash, Bank Transfer, Mobile Banking, Cheque), date, and optional reference.
3. Click **Record Payment**. The invoice status updates automatically.

**Batch payment:**
1. Tick the checkboxes on multiple PENDING/OVERDUE invoices.
2. A floating bar appears at the bottom — click **Batch Pay**.
3. Choose the payment method and date, then confirm.

### 3.4 Payment Receipts

- In the Transactions tab, each row has a **PDF** button (downloads a branded receipt) and an **Email** button (sends the receipt directly to the parent's email).

### 3.5 Fee Statements

From the **Students** page, open any student's View dialog:
- Click **Statement PDF** in the dialog header to download a complete fee statement.
- Click **Email to Parent** to send it directly (the button is greyed out if no parent email is on file).

### 3.6 Automatic Fee Reminders

In the Finance page → **Reminders** tab:
- Toggle the scheduler **On/Off**.
- Select which days relative to the due date to send reminders (e.g., 3 days before, on the day, 3 days after).
- Enable **SMS Reminders** or **WhatsApp Reminders** if Twilio is configured.
- Click **Save Changes**.
- Click **Send Now** to trigger an immediate manual run.

**Daily Digest:** Enable the **Daily Fee Digest** to send each parent a single consolidated SMS/WhatsApp message listing all their outstanding invoices — once per day.

### 3.7 Monthly Statement Scheduler

In the Finance page → **Statement Activity** tab → **Scheduler Settings** card:
- Toggle the scheduler **On/Off**.
- Set the **Day of Month** (1–28) and **Hour** when statements should be sent automatically.
- On the configured day and hour, the system emails a PDF fee statement to every active student's parent.
- Click **Run Now** to trigger an immediate batch send for testing.

### 3.8 Payment Requests (Parent Submissions)

Parents can submit payment evidence from their portal. You will see these in the **Payment Requests** tab:
- Click **Approve** to verify and auto-record the transaction.
- Click **Reject** and optionally enter a reason to decline.
- The parent receives an in-app notification of your decision.

### 3.9 Overdue Escalations

In the **Escalations** tab:
- The system automatically flags invoices as **WARNING** (7+ days overdue) or **CRITICAL** (30+ days overdue).
- Click **Run Check** to trigger an immediate scan.
- Click **Acknowledge** on any escalation to reset it after following up with the parent.
- Escalation thresholds can be changed in the collapsible **Thresholds** panel.

### 3.10 Financial Health Dashboard

The **Health** tab shows school-wide analytics:
- **Collection Rate**, **Total Outstanding**, **Invoices Paid** KPI cards.
- Monthly revenue trend chart.
- Aging buckets (how overdue invoices are spread across time).
- Fee-type breakdown (which fees are collected well vs poorly).
- Top debtors list.

### 3.11 Collection Report

The **Collection Report** tab shows per-class collection performance for any academic year:
- Select the year and view all classes with their collection gaps.
- Click **Students** on any class row to drill down to individual student payment status.
- Click **Export CSV** to download a class's data.

---

## 4. Teacher Guide

### 4.1 Taking Attendance

1. Click **Attendance** in the sidebar.
2. The current date is selected by default. Choose your class from the dropdown.
3. For each student, click **Present**, **Absent**, **Late**, or **Excused**.
4. Click **Save Attendance**.

> When a student is marked Absent, their parent automatically receives an SMS or WhatsApp notification (if configured by the admin).

### 4.2 QR Code Attendance

Each student has a unique QR code. Use the QR scanner on the Attendance page to mark attendance instantly by scanning.

### 4.3 Entering Exam Marks

1. Click **Exam Results** in the sidebar.
2. Select the class, subject, and exam type.
3. Enter each student's marks.
4. Click **Save**.

### 4.4 Viewing the Timetable

Click **Timetable** to see the weekly class schedule for all your assigned classes.

### 4.5 Calendar

Click **Calendar** to view and manage school events (holidays, exams, meetings).

---

## 5. Parent Guide

After logging in, you see the **Parent Portal**, which shows all your children's information.

### 5.1 Family Summary

At the top of the Parent Portal, the **Family Summary** shows:
- Total outstanding balance across all your children.
- Number of overdue invoices.
- Total paid and total invoiced amounts.
- Upcoming payment deadlines across all children.

### 5.2 Per-Child View

For each child, you can see:
- **Basic profile** — class, admission date, status.
- **Fee Ledger** — all invoices with their status (Paid, Pending, Overdue) and payment history. Click any invoice row to expand and see individual payment records.
- **Fee Statement** — download a full PDF statement of your child's fee history.

### 5.3 Submitting Payment Evidence

If you have paid fees outside the system (bank transfer, mobile banking, etc.):
1. Open the fee ledger for your child.
2. Click **Submit Payment** on the relevant invoice.
3. Enter the amount, payment method, transaction reference, and date.
4. Click **Submit**. The school finance team will review and confirm it.

You will receive a notification when your submission is approved or rejected.

### 5.4 My Payment Submissions

The **My Payments** tab on each child's card shows:
- All your pending, approved, and rejected payment submissions.
- If rejected, the reason given by the finance team.

### 5.5 Notifications

The **bell icon** in the top-right corner shows all your notifications — payment reminders, approval/rejection alerts, and school announcements. Click any notification to mark it as read.

---

## 6. Notifications

All users receive **in-app notifications** through the bell icon (top-right of the screen). The badge count updates in real-time.

**Types of notifications:**
- Payment reminders (before/on/after invoice due dates)
- Payment receipt confirmations
- Payment request approvals and rejections
- Overdue escalation alerts (finance staff)
- Absence alerts (parents, when their child is marked absent)

**Email notifications** are sent for:
- Payment receipts (after a payment is recorded)
- Fee statements (when emailed manually or by the monthly scheduler)

**SMS / WhatsApp notifications** are sent for:
- Payment reminders (if enabled by the admin)
- Daily fee digest (if enabled by the admin)
- Absence alerts (if enabled by the admin)

---

## 7. Getting Help

If you encounter a problem:

1. **Check this manual** — most common tasks are covered above.
2. **Contact your school administrator** — they can reset passwords, adjust settings, and troubleshoot access issues.
3. **For technical issues** — the system administrator can check the Audit Log for a full history of recent actions and identify what went wrong.

> This manual covers the Smart School ERP as currently deployed. Some features may be enabled or disabled by your school administrator.
