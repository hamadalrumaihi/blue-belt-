import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { SettingsSync } from "@/components/SettingsSync";
import { resolveViewerMode } from "@/lib/collaborator";
import { getUser } from "@/lib/supabase/server";

export default async function PrivateLayout({ children }: { children: ReactNode }) {
  const user = await getUser();
  if (!user) redirect("/login");
  const { collaboratorOnly } = await resolveViewerMode();
  return (
    <AppShell email={user.email ?? null} collaboratorOnly={collaboratorOnly}>
      <SettingsSync />
      {children}
    </AppShell>
  );
}
