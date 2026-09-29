import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { getUser } from "@/lib/supabase/server";

export default async function PrivateLayout({ children }: { children: ReactNode }) {
  const user = await getUser();
  if (!user) redirect("/login");
  return <AppShell email={user.email ?? null}>{children}</AppShell>;
}
