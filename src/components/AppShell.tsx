import type { ReactNode } from "react";
import { DesktopSidebar } from "./DesktopSidebar";
import { MobileBottomNav } from "./MobileBottomNav";

export function AppShell({ email, children }: { email: string | null; children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-page">
      <DesktopSidebar email={email} />
      <div className="lg:pl-64">
        {children}
      </div>
      <MobileBottomNav />
    </div>
  );
}

/** Standard page body with mobile bottom-nav clearance. */
export function PageBody({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <main className={`mx-auto w-full max-w-6xl px-4 pb-28 pt-4 lg:px-8 lg:pb-12 lg:pt-6 ${className}`}>{children}</main>;
}
