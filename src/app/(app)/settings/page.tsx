import type { Metadata } from "next";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { SettingsForm } from "./SettingsForm";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <>
      <BrandHeader title="Settings" subtitle="Preferences are saved on this device" />
      <PageBody className="max-w-2xl">
        <SettingsForm />
      </PageBody>
    </>
  );
}
