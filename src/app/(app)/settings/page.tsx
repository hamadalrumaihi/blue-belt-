import type { Metadata } from "next";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { CaptureAgentSection } from "./CaptureAgentSection";
import { OrdersIntakeSection } from "./OrdersIntakeSection";
import { SettingsForm } from "./SettingsForm";
import { StudioSection } from "./StudioSection";
import { TelegramSection } from "./TelegramSection";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <>
      <BrandHeader title="Settings" subtitle="Display preferences stay on this device; Telegram, capture and order settings are saved to your account" />
      <PageBody className="max-w-2xl">
        <SettingsForm />
        <div className="mt-4">
          <StudioSection />
        </div>
        <div className="mt-4">
          <TelegramSection />
        </div>
        <div className="mt-4">
          <CaptureAgentSection />
        </div>
        <div className="mt-4">
          <OrdersIntakeSection />
        </div>
      </PageBody>
    </>
  );
}
