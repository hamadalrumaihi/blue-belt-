import type { Metadata } from "next";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { CaptureAgentSection } from "./CaptureAgentSection";
import { SettingsForm } from "./SettingsForm";
import { TelegramSection } from "./TelegramSection";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <>
      <BrandHeader title="Settings" subtitle="Preferences are saved on this device" />
      <PageBody className="max-w-2xl">
        <SettingsForm />
        <div className="mt-4">
          <TelegramSection />
        </div>
        <div className="mt-4">
          <CaptureAgentSection />
        </div>
      </PageBody>
    </>
  );
}
