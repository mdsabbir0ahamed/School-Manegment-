import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth, canAccessRoute } from "@/lib/auth";
import { ThemeProvider } from "@/lib/theme";
import { TenantProvider } from "@/lib/tenant";
import Layout from "@/components/Layout";
import AccessDenied from "@/components/AccessDenied";
import LoginPage from "@/pages/LoginPage";
import ForgotPasswordPage from "@/pages/ForgotPasswordPage";
import DashboardPage from "@/pages/DashboardPage";
import StudentsPage from "@/pages/StudentsPage";
import AttendancePage from "@/pages/AttendancePage";
import FinancePage from "@/pages/FinancePage";
import ClassesPage from "@/pages/ClassesPage";
import UsersPage from "@/pages/UsersPage";
import SettingsPage from "@/pages/SettingsPage";
import AuditLogPage from "@/pages/AuditLogPage";
import SubjectsMarksPage from "@/pages/SubjectsMarksPage";
import TimetablePage from "@/pages/TimetablePage";
import NotificationsPage from "@/pages/NotificationsPage";
import ParentPortalPage from "@/pages/ParentPortalPage";
import CalendarPage from "@/pages/CalendarPage";
import StudentDocumentsPage from "@/pages/StudentDocumentsPage";
import AttendanceQRPage from "@/pages/AttendanceQRPage";
import ReportCardPage from "@/pages/ReportCardPage";
import AssetManagementPage from "@/pages/AssetManagementPage";
import TenantsPage from "@/pages/TenantsPage";
import PayrollPage from "@/pages/PayrollPage";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

function ProtectedRoute({
  component: Component,
  route,
}: {
  component: React.ComponentType;
  route: string;
}) {
  const { token, user } = useAuth();
  if (!token) return <Redirect to="/login" />;
  const allowed = canAccessRoute(user?.role, route);
  return (
    <Layout>
      {allowed ? <Component /> : <AccessDenied />}
    </Layout>
  );
}

function Router() {
  const { token } = useAuth();
  return (
    <Switch>
      <Route path="/login">
        {token ? <Redirect to="/dashboard" /> : <LoginPage />}
      </Route>
      <Route path="/forgot-password" component={ForgotPasswordPage} />
      <Route path="/dashboard">
        <ProtectedRoute component={DashboardPage} route="/dashboard" />
      </Route>
      <Route path="/students">
        <ProtectedRoute component={StudentsPage} route="/students" />
      </Route>
      <Route path="/attendance">
        <ProtectedRoute component={AttendancePage} route="/attendance" />
      </Route>
      <Route path="/finance">
        <ProtectedRoute component={FinancePage} route="/finance" />
      </Route>
      <Route path="/classes">
        <ProtectedRoute component={ClassesPage} route="/classes" />
      </Route>
      <Route path="/users">
        <ProtectedRoute component={UsersPage} route="/users" />
      </Route>
      <Route path="/settings">
        <ProtectedRoute component={SettingsPage} route="/settings" />
      </Route>
      <Route path="/audit">
        <ProtectedRoute component={AuditLogPage} route="/audit" />
      </Route>
      <Route path="/subjects">
        <ProtectedRoute component={SubjectsMarksPage} route="/subjects" />
      </Route>
      <Route path="/timetable">
        <ProtectedRoute component={TimetablePage} route="/timetable" />
      </Route>
      <Route path="/notifications">
        <ProtectedRoute component={NotificationsPage} route="/notifications" />
      </Route>
      <Route path="/parent">
        <ProtectedRoute component={ParentPortalPage} route="/parent" />
      </Route>
      <Route path="/calendar">
        <ProtectedRoute component={CalendarPage} route="/calendar" />
      </Route>
      <Route path="/documents">
        <ProtectedRoute component={StudentDocumentsPage} route="/documents" />
      </Route>
      <Route path="/qr">
        <ProtectedRoute component={AttendanceQRPage} route="/qr" />
      </Route>
      <Route path="/report-card">
        <ProtectedRoute component={ReportCardPage} route="/report-card" />
      </Route>
      <Route path="/assets">
        <ProtectedRoute component={AssetManagementPage} route="/assets" />
      </Route>
      <Route path="/tenants">
        <ProtectedRoute component={TenantsPage} route="/tenants" />
      </Route>
      <Route path="/payroll">
        <ProtectedRoute component={PayrollPage} route="/payroll" />
      </Route>
      <Route path="/">
        {token ? <Redirect to="/dashboard" /> : <Redirect to="/login" />}
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ThemeProvider>
          <TenantProvider>
            <AuthProvider>
              <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
                <Router />
              </WouterRouter>
              <Toaster />
            </AuthProvider>
          </TenantProvider>
        </ThemeProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
