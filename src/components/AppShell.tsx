import type { ReactNode } from "react";
import { DesktopSidebar } from "./DesktopSidebar";
import { MobileBottomNav } from "./MobileBottomNav";

export function AppShell({ email, collaboratorOnly = false, children }: { email: string | null; collaboratorOnly?: boolean; children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-page">
      <DesktopSidebar email={email} collaboratorOnly={collaboratorOnly} />
      <div className="lg:pl-64">
        {children}
      </div>
      <MobileBottomNav collaboratorOnly={collaboratorOnly} />
    </div>
  );
}

/** Standard page body with mobile bottom-nav clearance. */
export function PageBody({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <main className={`mx-auto w-full max-w-6xl px-4 pb-28 pt-4 lg:px-8 lg:pb-12 lg:pt-6 ${className}`}>{children}</main>;
}
