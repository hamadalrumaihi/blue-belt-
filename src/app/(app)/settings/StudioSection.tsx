import { DEFAULT_STUDIO, loadStudio } from "@/lib/studio/queries";
import { isServiceClientConfigured } from "@/lib/supabase/service";
import { StudioSettings } from "./StudioSettings";

/** Server half of the "Public site" card: the owner's studio row (or defaults until first save). */
export async function StudioSection() {
  const studio = await loadStudio();
  return <StudioSettings studio={studio ? { ...studio } : null} defaults={DEFAULT_STUDIO} publicSiteReady={isServiceClientConfigured()} />;
}
