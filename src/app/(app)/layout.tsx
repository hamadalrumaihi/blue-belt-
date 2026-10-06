import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { SettingsSync } from "@/components/SettingsSync";
import { resolveViewerMode } from "@/lib/collaborator";
import { isStudioRole, resolveViewer } from "@/lib/roles";

/**
 * The private studio. Owners and staff only: a client account (portal
 * sign-in) is sent to its own portal, never shown an empty studio.
 */
export default async function PrivateLayout({ children }: { children: ReactNode }) {
  const viewer = await resolveViewer();
  if (!viewer) redirect("/login");
  if (!isStudioRole(viewer.role)) redirect("/client");
  const mode = await resolveViewerMode();
  const collaboratorOnly = viewer.role === "staff" || mode.collaboratorOnly;
  return (
    <AppShell email={viewer.email} collaboratorOnly={collaboratorOnly}>
      <SettingsSync />
      {children}
    </AppShell>
  );
}
