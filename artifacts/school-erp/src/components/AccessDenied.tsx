import { ShieldX } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

interface AccessDeniedProps {
  message?: string;
}

export default function AccessDenied({ message }: AccessDeniedProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[400px] gap-4 p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
        <ShieldX className="h-8 w-8 text-destructive" />
      </div>
      <div className="space-y-1.5">
        <h2 className="text-lg font-semibold">Access Denied</h2>
        <p className="text-sm text-muted-foreground max-w-xs">
          {message ?? "You don't have permission to view this page. Contact your administrator if you need access."}
        </p>
      </div>
      <Link href="/dashboard">
        <Button variant="outline" size="sm">Back to Dashboard</Button>
      </Link>
    </div>
  );
}
