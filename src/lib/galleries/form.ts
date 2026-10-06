import type { Json } from "@/lib/supabase/database.types";
import { trimOrNull } from "@/lib/utils";
import { isUuid } from "@/lib/validation";
import { isAllowedGalleryUrl } from "./state";

/**
 * Pure parsing for the gallery form (new / edit). No I/O: the action loads
 * the studio's extra gallery hosts and passes them in, so a custom Pic-Time
 * domain allow-listed in Settings validates the same way here and in tests.
 */
export const GALLERY_NAME_MAX = 120;
export const GALLERY_PROJECT_ID_MAX = 80;
export const GALLERY_NOTES_MAX = 1000;
export const GALLERY_URL_MAX = 2048;

export type GalleryFormValues = {
  name: string;
  pictime_url: string | null;
  pictime_project_id: string | null;
  booking_id: string | null;
  client_id: string | null;
  event_id: string | null;
  notes: string | null;
};

export type GalleryFormParse = { values: GalleryFormValues; fieldErrors: Record<string, string> };

/** `photo_studio.settings.galleryHosts`: extra https hosts the owner allows for gallery links. */
export function galleryHostsOf(settings: Json | null | undefined): string[] {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return [];
  const raw = (settings as Record<string, unknown>).galleryHosts;
  if (!Array.isArray(raw)) return [];
  return raw.filter((h): h is string => typeof h === "string" && /^[a-z0-9.-]+$/i.test(h.trim())).map((h) => h.trim().toLowerCase());
}

function optionalUuid(fd: FormData, key: string, label: string, fieldErrors: Record<string, string>): string | null {
  const v = trimOrNull(fd.get(key));
  if (!v) return null;
  if (!isUuid(v)) {
    fieldErrors[key] = `${label} is not a valid id.`;
    return null;
  }
  return v;
}

export function parseGalleryForm(fd: FormData, opts: { extraHosts?: readonly string[] } = {}): GalleryFormParse {
  const fieldErrors: Record<string, string> = {};
  const name = trimOrNull(fd.get("name")) ?? "";
  if (!name) fieldErrors.name = "Give the gallery a name (usually the Pic-Time project name).";
  else if (name.length > GALLERY_NAME_MAX) fieldErrors.name = `Keep the name under ${GALLERY_NAME_MAX} characters.`;

  const url = trimOrNull(fd.get("pictime_url"));
  if (url && (url.length > GALLERY_URL_MAX || !isAllowedGalleryUrl(url, opts.extraHosts ?? []))) {
    fieldErrors.pictime_url = "Use the https link to the gallery on pic-time.com (or a gallery domain allowed in Settings).";
  }

  const projectId = trimOrNull(fd.get("pictime_project_id"));
  if (projectId && projectId.length > GALLERY_PROJECT_ID_MAX) fieldErrors.pictime_project_id = `Keep the project id under ${GALLERY_PROJECT_ID_MAX} characters.`;

  const notes = trimOrNull(fd.get("notes"));
  if (notes && notes.length > GALLERY_NOTES_MAX) fieldErrors.notes = `Keep notes under ${GALLERY_NOTES_MAX} characters.`;

  const booking_id = optionalUuid(fd, "booking_id", "Booking", fieldErrors);
  const client_id = optionalUuid(fd, "client_id", "Client", fieldErrors);
  const event_id = optionalUuid(fd, "event_id", "Event", fieldErrors);

  return {
    fieldErrors,
    values: { name, pictime_url: url, pictime_project_id: projectId, booking_id, client_id, event_id, notes },
  };
}
