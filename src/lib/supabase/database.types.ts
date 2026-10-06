/**
 * Hand-maintained Supabase types for every table and RPC the app touches.
 * Mirrors supabase/migrations (baseline through studio_platform). When the schema changes,
 * update the matching Row type here and the migration together; `npm run
 * typecheck` catches drift between the two in application code.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

// ---------------------------------------------------------------------------
// Core watcher tables
// ---------------------------------------------------------------------------

export type PhotoEventRow = {
  id: string;
  owner_id: string;
  name: string;
  venue: string | null;
  country: string | null;
  event_date: string | null;
  platform: string;
  source_url: string | null;
  timezone: string;
  active: boolean;
  /** 'watcher' = brackets read from a public page; 'manual' = entered by hand (no usable URL). */
  tracking_mode: "watcher" | "manual";
  /** The event's own age groups / weight divisions (DivisionRules JSON); null = platform defaults. */
  division_rules: Json | null;
  created_at: string;
  updated_at: string;
};

export type PhotoAthleteRow = {
  id: string;
  owner_id: string;
  event_id: string | null;
  name: string;
  /** Generated: lower-cased, whitespace-collapsed name (duplicate detection). */
  name_key: string | null;
  phone: string | null;
  email: string | null;
  division: string | null;
  academy: string | null;
  platform: string;
  source_url: string | null;
  notes: string | null;
  belt: string | null;
  weight: string | null;
  gender: string | null;
  age_category: string | null;
  package_name: string | null;
  internal_notes: string | null;
  /** Last time any refresh finished (success or failure). */
  last_checked_at: string | null;
  /** Last refresh attempt (same as last_checked_at; kept explicit for the UI). */
  last_attempt_at: string | null;
  /** Last time the source was fetched AND parsed successfully. */
  last_success_at: string | null;
  consecutive_failures: number;
  last_watch_status: string | null;
  /** Fine-grained failure code (see WatchFailureCode). */
  last_watch_code: string | null;
  last_watch_message: string | null;
  last_watch_strategy: string | null;
  last_source_status: number | null;
  last_final_url: string | null;
  last_elapsed_ms: number | null;
  /** Bumped by photo_apply_refresh on every successful persist (optimistic concurrency). */
  refresh_version: number;
  /** captured_at of the newest capture applied to this athlete; gates out-of-order captures. */
  last_capture_at: string | null;
  active: boolean;
  /** Local competitions: real age on the event date and real weight drive the division checks. */
  birth_date: string | null;
  birth_year: number | null;
  weight_kg: number | null;
  created_at: string;
  updated_at: string;
};

export type IdentityConfidence = "exact" | "probable" | "ambiguous";

export type PhotoMatchRow = {
  id: string;
  owner_id: string;
  athlete_id: string;
  external_match_id: string | null;
  opponent: string | null;
  mat: string | null;
  scheduled_at: string | null;
  estimated_at: string | null;
  status: string;
  match_order: number | null;
  source_url: string | null;
  last_checked_at: string | null;
  last_changed_at: string | null;
  raw_snapshot: Json;
  identity_confidence: IdentityConfidence;
  /** Owner manual correction (Phase C): source values above stay untouched. */
  override_mat: string | null;
  override_scheduled_at: string | null;
  override_by: string | null;
  override_at: string | null;
  override_reason: string | null;
  override_until: string | null;
  /** Entered by hand (manual tracking); the watcher never changes or removes it. */
  is_manual: boolean;
  round: string | null;
  result: string | null;
  next_round: string | null;
  created_at: string;
  updated_at: string;
};

export type PhotoMatchHistoryRow = {
  id: number;
  owner_id: string;
  match_id: string;
  change_type: string;
  old_value: Json | null;
  new_value: Json | null;
  detected_at: string;
};

// ---------------------------------------------------------------------------
// Settings + collaboration foundation
// ---------------------------------------------------------------------------

export type PhotoUserSettingsRow = {
  owner_id: string;
  settings: Json;
  created_at: string;
  updated_at: string;
};

export type PhotoEventSettingsRow = {
  event_id: string;
  owner_id: string;
  settings: Json;
  created_at: string;
  updated_at: string;
};

export type EventMemberRole = "owner" | "photographer" | "assistant";

export type PhotoEventMemberRow = {
  event_id: string;
  user_id: string;
  role: EventMemberRole;
  invited_by: string | null;
  created_at: string;
};

/** Phase 4: per-client photo/video coverage assignment and completion. */
export type PhotoCoverageRow = {
  id: string;
  owner_id: string;
  event_id: string;
  athlete_id: string;
  photographer_id: string | null;
  videographer_id: string | null;
  photos_done_at: string | null;
  photos_done_by: string | null;
  videos_done_at: string | null;
  videos_done_by: string | null;
  created_at: string;
  updated_at: string;
};

/** Row shape of public.photo_collaborator_board (operational fields only). */
export type CollaboratorBoardRow = {
  athlete_id: string;
  athlete_name: string;
  division: string | null;
  belt: string | null;
  source_url: string | null;
  assigned_photo: boolean;
  assigned_video: boolean;
  photos_done_at: string | null;
  videos_done_at: string | null;
  match_id: string | null;
  mat: string | null;
  opponent: string | null;
  scheduled_at: string | null;
  estimated_at: string | null;
  status: string | null;
  match_order: number | null;
};

/** Row shape of public.photo_collaborator_events. */
export type CollaboratorEventRow = {
  event_id: string;
  name: string;
  venue: string | null;
  event_date: string | null;
  timezone: string;
  platform: string;
  role: EventMemberRole;
};

/** Phase 3: operational incident tracking (first/last seen, open/resolved). */
export type PhotoIncidentRow = {
  id: string;
  owner_id: string;
  incident_key: string;
  kind: string;
  event_id: string | null;
  source_host: string | null;
  athlete_count: number;
  status: "open" | "resolved";
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
  occurrences: number;
  /** Owner marked it "Done" in the app (20261006120000). Absent until that migration is applied. */
  acknowledged_at?: string | null;
  created_at: string;
  updated_at: string;
};

/** Phase A: capture ledger (one row per capture of a source page, per owner). */
export type CaptureTransport = "import" | "handoff" | "agent" | "worker" | "http";
export type CaptureCompleteness = "complete" | "partial" | "unknown";
export type CaptureStatus = "received" | "applied" | "rejected";

export type PhotoCaptureRow = {
  id: string;
  owner_id: string;
  capture_id: string;
  source_key: string;
  source_url: string;
  final_url: string | null;
  transport: CaptureTransport;
  captured_at: string;
  received_at: string;
  applied_at: string | null;
  status: CaptureStatus;
  reject_code: string | null;
  content_hash: string;
  bytes: number;
  completeness: CaptureCompleteness;
  athlete_count: number | null;
  outcome: Json;
  diagnostics: Json;
  created_at: string;
  updated_at: string;
};

/** Phase B: machine-intake credentials (token hash only) with agent heartbeat. */
export type PhotoCaptureCredentialRow = {
  id: string;
  owner_id: string;
  name: string;
  /** capture (Windows agent) | orders (Zapier / Pic-Time intake). */
  kind: "capture" | "orders";
  token_hash: string;
  token_prefix: string;
  scope_source_keys: string[] | null;
  scope_event_id: string | null;
  expires_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
  use_count: number;
  last_heartbeat_at: string | null;
  agent_version: string | null;
  agent_status: Json;
  created_at: string;
  updated_at: string;
};

// ---------------------------------------------------------------------------
// Telegram notifications
// ---------------------------------------------------------------------------

export type PhotoTelegramLinkRow = {
  id: string;
  owner_id: string;
  chat_id: number | null;
  chat_title: string | null;
  link_code: string | null;
  link_code_expires_at: string | null;
  linked_at: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type PhotoNotificationSubscriptionRow = {
  id: string;
  owner_id: string;
  event_id: string | null;
  channel: "telegram";
  kinds: string[];
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type DeliveryStatus = "pending" | "sending" | "sent" | "failed" | "skipped";

export type PhotoNotificationDeliveryRow = {
  id: number;
  owner_id: string;
  channel: string;
  alert_key: string;
  kind: string;
  athlete_id: string | null;
  match_id: string | null;
  payload: Json;
  status: DeliveryStatus;
  attempts: number;
  last_error: string | null;
  next_attempt_at: string | null;
  sent_at: string | null;
  /** Phase D: lease-based claim by the delivery runner. */
  leased_until: string | null;
  lease_owner: string | null;
  /** match | orders | system — the message prefix. */
  category: string | null;
  created_at: string;
  updated_at: string;
};

// ---------------------------------------------------------------------------
// Bookings + payments (prepared; feature-flagged)
// ---------------------------------------------------------------------------

export type PaymentStatus = "pending" | "paid" | "failed" | "refunded" | "disputed" | "cancelled";

export type PhotoBookingRow = {
  id: string;
  owner_id: string;
  event_id: string | null;
  athlete_name: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  academy: string | null;
  division: string | null;
  package_name: string;
  amount_qr: number;
  currency: string;
  status: PaymentStatus;
  provider: string;
  provider_invoice_id: string | null;
  payment_url: string | null;
  paid_at: string | null;
  refunded_at: string | null;
  disputed_at: string | null;
  payment_status_updated_at: string | null;
  watcher_athlete_id: string | null;
  notes: string | null;
  metadata: Json;
  /** Studio lifecycle (see src/lib/bookings/state.ts). `status` above stays the provider payment status. */
  booking_type: BookingType;
  booking_status: BookingStatus;
  client_id: string | null;
  organization_id: string | null;
  service_id: string | null;
  lead_id: string | null;
  session_at: string | null;
  session_end_at: string | null;
  location: string | null;
  payment_mode: PaymentMode;
  payment_method: PaymentMethod | null;
  amount_paid_qr: number;
  manual_paid_at: string | null;
  details: Json;
  contract_document_id: string | null;
  gallery_id: string | null;
  assigned_photographer_id: string | null;
  assigned_videographer_id: string | null;
  quoted_at: string | null;
  confirmed_at: string | null;
  coverage_done_at: string | null;
  delivered_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  public_ref: string | null;
  created_at: string;
  updated_at: string;
};

export type PhotoPaymentAttemptRow = {
  id: string;
  owner_id: string;
  booking_id: string | null;
  provider: string;
  provider_invoice_id: string | null;
  provider_payment_id: string | null;
  status: PaymentStatus;
  amount: number;
  currency: string;
  raw: Json;
  created_at: string;
  updated_at: string;
};

export type PhotoPaymentEventRow = {
  id: number;
  owner_id: string | null;
  order_id: string | null;
  booking_id: string | null;
  provider: string;
  provider_event_id: string | null;
  event_type: string;
  payload: Json;
  signature_valid: boolean | null;
  processed_at: string | null;
  processing_result: string | null;
  attempts: number;
  received_at: string;
};

export type PhotoOrderRow = {
  id: string;
  owner_id: string;
  pictime_order_id: string | null;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  gallery_name: string | null;
  amount_qr: number;
  currency: string;
  status: string;
  provider: string | null;
  provider_invoice_id: string | null;
  payment_url: string | null;
  paid_at: string | null;
  approved_in_pictime_at: string | null;
  metadata: Json;
  /** Phase E: intake provenance and payment situation (separate from the lifecycle `status`). */
  source: string;
  external_ref: string | null;
  payment_method: string;
  payment_state: string;
  payment_reference: string | null;
  payment_reported_state: string | null;
  items: Json;
  placed_at: string | null;
  received_at: string | null;
  buyer_note: string | null;
  athlete_name_hint: string | null;
  raw: Json;
  payment_confirmed_at: string | null;
  payment_confirmed_by: string | null;
  fulfilled_at: string | null;
  /** Set while one caller is creating this order's MyFatoorah invoice (see invoicing.ts). */
  invoice_claimed_at: string | null;
  /** Studio links (optional): the CRM person and the gallery this order belongs to. */
  client_id: string | null;
  gallery_id: string | null;
  created_at: string;
  updated_at: string;
};

// ---------------------------------------------------------------------------
// Studio platform (roles, CRM, documents, galleries, payment records)
// ---------------------------------------------------------------------------

export type ProfileRole = "owner" | "staff" | "client";

export type PhotoProfileRow = {
  user_id: string;
  role: ProfileRole;
  display_name: string | null;
  created_at: string;
  updated_at: string;
};

export type PhotoStudioRow = {
  owner_id: string;
  business_name: string;
  tagline: string | null;
  about: string | null;
  city: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  instagram: string | null;
  public_booking: boolean;
  settings: Json;
  created_at: string;
  updated_at: string;
};

export type PersonKind = "person" | "parent" | "coach" | "club_contact";

export type PhotoPersonRow = {
  id: string;
  owner_id: string;
  user_id: string | null;
  full_name: string;
  email: string | null;
  /** Generated: lower-cased trimmed e-mail (unique per owner). */
  email_key: string | null;
  phone: string | null;
  phone_key: string | null;
  instagram: string | null;
  whatsapp: string | null;
  kind: PersonKind;
  source: string;
  tags: string[];
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type OrganizationKind = "club" | "academy" | "team" | "federation" | "other";

export type PhotoOrganizationRow = {
  id: string;
  owner_id: string;
  name: string;
  kind: OrganizationKind;
  primary_contact_id: string | null;
  email: string | null;
  phone: string | null;
  instagram: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type BookingType = "tournament_athlete" | "club" | "training_session" | "private_session" | "custom";
export type BookingStatus = "inquiry" | "quoted" | "awaiting_contract" | "awaiting_payment" | "confirmed" | "in_progress" | "delivered" | "completed" | "cancelled";
export type PaymentMode = "instant" | "link_later" | "manual" | "quote";
export type PaymentMethod = "myfatoorah" | "cash" | "bank_transfer" | "fawran" | "other";

export type PhotoServiceRow = {
  id: string;
  owner_id: string;
  code: string;
  name: string;
  booking_type: BookingType;
  description: string | null;
  /** null = quote on request. */
  price_qr: number | null;
  deposit_qr: number | null;
  currency: string;
  duration_minutes: number | null;
  includes_photo: boolean;
  includes_video: boolean;
  active: boolean;
  public: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type LeadStatus = "new" | "contacted" | "quoted" | "converted" | "lost";

export type PhotoLeadRow = {
  id: string;
  owner_id: string;
  person_id: string | null;
  organization_id: string | null;
  event_id: string | null;
  booking_type: BookingType | null;
  status: LeadStatus;
  source: string;
  message: string | null;
  details: Json;
  booking_id: string | null;
  created_at: string;
  updated_at: string;
};

export type DocumentKind = "services_agreement" | "event_agreement" | "session_agreement" | "print_release" | "model_release" | "club_agreement" | "custom";
export type DocumentStatus = "draft" | "sent" | "viewed" | "signed" | "declined" | "expired";

export type PhotoDocumentTemplateRow = {
  id: string;
  owner_id: string;
  kind: DocumentKind;
  name: string;
  body: string;
  version: number;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type PhotoDocumentRow = {
  id: string;
  owner_id: string;
  template_id: string | null;
  template_version: number | null;
  kind: string;
  title: string;
  booking_id: string | null;
  client_id: string | null;
  organization_id: string | null;
  body: string;
  body_hash: string | null;
  status: DocumentStatus;
  access_token_hash: string | null;
  sent_at: string | null;
  viewed_at: string | null;
  signed_at: string | null;
  declined_at: string | null;
  expires_at: string | null;
  signer_name: string | null;
  signer_email: string | null;
  signer_phone: string | null;
  signature_evidence: Json | null;
  created_at: string;
  updated_at: string;
};

export type GalleryStatus = "pending" | "created" | "ready" | "delivered";

export type PhotoGalleryRow = {
  id: string;
  owner_id: string;
  booking_id: string | null;
  client_id: string | null;
  event_id: string | null;
  name: string;
  pictime_url: string | null;
  pictime_project_id: string | null;
  status: GalleryStatus;
  created_in_pictime_at: string | null;
  ready_at: string | null;
  delivered_at: string | null;
  notified_at: string | null;
  visitor_count: number;
  last_visitor_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type PhotoPaymentRecordRow = {
  id: string;
  owner_id: string;
  booking_id: string | null;
  order_id: string | null;
  kind: "provider" | "manual";
  method: PaymentMethod;
  amount_qr: number;
  currency: string;
  paid_at: string;
  note: string | null;
  recorded_by: string | null;
  provider: string | null;
  provider_payment_id: string | null;
  created_at: string;
};

export type PhotoClientNotificationPrefRow = {
  owner_id: string;
  kind: string;
  enabled: boolean;
  updated_at: string;
};

export type AuditActorKind = "owner" | "staff" | "client" | "system" | "public";

export type PhotoAuditLogRow = {
  id: number;
  owner_id: string;
  actor_id: string | null;
  actor_kind: AuditActorKind;
  entity: string;
  entity_id: string | null;
  action: string;
  data: Json;
  created_at: string;
};

// ---------------------------------------------------------------------------
// Pricing research + quote suggestions (owner only; RLS via photo_is_owner_user)
// ---------------------------------------------------------------------------

export type PhotoPriceReferenceRow = {
  id: string;
  owner_id: string;
  provider: string;
  source_url: string | null;
  /** YYYY-MM-DD: when the owner last checked this price. */
  checked_on: string;
  location: string | null;
  service_type: BookingType;
  price_from: number;
  price_to: number | null;
  currency: string;
  /** Free-form scope (see src/lib/pricing/form.ts PriceReferenceIncludes). */
  includes: Json;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type QuoteStatus = "draft" | "applied" | "discarded";

export type PhotoQuoteRow = {
  id: string;
  owner_id: string;
  booking_id: string | null;
  status: QuoteStatus;
  /** Job inputs (see src/lib/pricing/form.ts QuoteInputs). */
  inputs: Json;
  /** The breakdown (see src/lib/pricing/suggest.ts QuoteSuggestion). */
  calculation: Json;
  suggested_from: number | null;
  suggested_to: number | null;
  chosen_amount_qr: number | null;
  currency: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

/** Client-portal views (SECURITY DEFINER): only client-safe columns. */
export type ClientPersonView =Pick<PhotoPersonRow, "id" | "owner_id" | "full_name" | "email" | "phone" | "instagram" | "whatsapp" | "created_at">;
export type ClientBookingView = Pick<
  PhotoBookingRow,
  | "id"
  | "owner_id"
  | "client_id"
  | "public_ref"
  | "booking_type"
  | "booking_status"
  | "athlete_name"
  | "customer_name"
  | "customer_email"
  | "customer_phone"
  | "academy"
  | "division"
  | "package_name"
  | "amount_qr"
  | "currency"
  | "status"
  | "payment_url"
  | "paid_at"
  | "event_id"
  | "session_at"
  | "session_end_at"
  | "location"
  | "payment_mode"
  | "payment_method"
  | "amount_paid_qr"
  | "manual_paid_at"
  | "details"
  | "contract_document_id"
  | "gallery_id"
  | "confirmed_at"
  | "delivered_at"
  | "completed_at"
  | "cancelled_at"
  | "created_at"
  | "updated_at"
>;
export type ClientGalleryView = Pick<PhotoGalleryRow, "id" | "owner_id" | "booking_id" | "client_id" | "name" | "pictime_url" | "status" | "ready_at" | "delivered_at" | "created_at">;
export type ClientPaymentView = Pick<PhotoPaymentRecordRow, "id" | "owner_id" | "booking_id" | "kind" | "method" | "amount_qr" | "currency" | "paid_at" | "created_at">;

// ---------------------------------------------------------------------------
// RPC payloads
// ---------------------------------------------------------------------------

/** Argument shape of public.photo_apply_refresh. */
export type ApplyRefreshArgs = {
  p_athlete_id: string;
  p_expected_version: number;
  p_checked_at: string;
  p_ok: boolean;
  p_status: string;
  p_code: string | null;
  p_message: string | null;
  p_diag?: Json;
  p_updates?: Json;
  p_inserts?: Json;
  p_history?: Json;
  p_touch_ids?: string[];
};

export type ApplyRefreshResult =
  | { ok: true; version: number; matches: PhotoMatchRow[]; inserted_ids: string[] }
  | { ok: false; code: "CONFLICT"; version: number; matches: PhotoMatchRow[] }
  | { ok: false; code: "STALE"; version: number; matches: PhotoMatchRow[] }
  | { ok: false; code: "NOT_FOUND" };

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

type GeneratedCols = "id" | "owner_id" | "created_at" | "updated_at";

export type Database = {
  public: {
    Tables: {
      photo_events: {
        Row: PhotoEventRow;
        Insert: Optional<PhotoEventRow, GeneratedCols | "venue" | "country" | "event_date" | "source_url" | "timezone" | "active" | "tracking_mode" | "division_rules">;
        Update: Partial<PhotoEventRow>;
        Relationships: [];
      };
      photo_athletes: {
        Row: PhotoAthleteRow;
        Insert: Optional<
          PhotoAthleteRow,
          | GeneratedCols
          | "name_key"
          | "event_id"
          | "phone"
          | "email"
          | "division"
          | "academy"
          | "platform"
          | "source_url"
          | "notes"
          | "belt"
          | "weight"
          | "gender"
          | "age_category"
          | "package_name"
          | "internal_notes"
          | "last_checked_at"
          | "last_attempt_at"
          | "last_success_at"
          | "consecutive_failures"
          | "last_watch_status"
          | "last_watch_code"
          | "last_watch_message"
          | "last_watch_strategy"
          | "last_source_status"
          | "last_final_url"
          | "last_elapsed_ms"
          | "refresh_version"
          | "last_capture_at"
          | "active"
          | "birth_date"
          | "birth_year"
          | "weight_kg"
        >;
        Update: Partial<Omit<PhotoAthleteRow, "name_key">>;
        Relationships: [];
      };
      photo_matches: {
        Row: PhotoMatchRow;
        Insert: Optional<
          PhotoMatchRow,
          | GeneratedCols
          | "external_match_id"
          | "opponent"
          | "mat"
          | "scheduled_at"
          | "estimated_at"
          | "status"
          | "match_order"
          | "source_url"
          | "last_checked_at"
          | "last_changed_at"
          | "raw_snapshot"
          | "identity_confidence"
          | "is_manual"
          | "round"
          | "result"
          | "next_round"
          | "override_mat"
          | "override_scheduled_at"
          | "override_by"
          | "override_at"
          | "override_reason"
          | "override_until"
        >;
        Update: Partial<PhotoMatchRow>;
        Relationships: [];
      };
      photo_match_history: {
        Row: PhotoMatchHistoryRow;
        Insert: Optional<PhotoMatchHistoryRow, "id" | "owner_id" | "old_value" | "new_value" | "detected_at">;
        Update: Partial<PhotoMatchHistoryRow>;
        Relationships: [];
      };
      photo_user_settings: {
        Row: PhotoUserSettingsRow;
        Insert: Optional<PhotoUserSettingsRow, "owner_id" | "settings" | "created_at" | "updated_at">;
        Update: Partial<PhotoUserSettingsRow>;
        Relationships: [];
      };
      photo_event_settings: {
        Row: PhotoEventSettingsRow;
        Insert: Optional<PhotoEventSettingsRow, "owner_id" | "settings" | "created_at" | "updated_at">;
        Update: Partial<PhotoEventSettingsRow>;
        Relationships: [];
      };
      photo_event_members: {
        Row: PhotoEventMemberRow;
        Insert: Optional<PhotoEventMemberRow, "invited_by" | "created_at">;
        Update: Partial<PhotoEventMemberRow>;
        Relationships: [];
      };
      photo_coverage: {
        Row: PhotoCoverageRow;
        Insert: Optional<
          PhotoCoverageRow,
          GeneratedCols | "photographer_id" | "videographer_id" | "photos_done_at" | "photos_done_by" | "videos_done_at" | "videos_done_by"
        >;
        Update: Partial<PhotoCoverageRow>;
        Relationships: [];
      };
      photo_incidents: {
        Row: PhotoIncidentRow;
        Insert: Optional<
          PhotoIncidentRow,
          GeneratedCols | "event_id" | "source_host" | "athlete_count" | "status" | "first_seen_at" | "last_seen_at" | "resolved_at" | "occurrences"
        >;
        Update: Partial<PhotoIncidentRow>;
        Relationships: [];
      };
      photo_capture_credentials: {
        Row: PhotoCaptureCredentialRow;
        Insert: Optional<
          PhotoCaptureCredentialRow,
          GeneratedCols | "kind" | "scope_source_keys" | "scope_event_id" | "revoked_at" | "last_used_at" | "use_count" | "last_heartbeat_at" | "agent_version" | "agent_status"
        >;
        Update: Partial<PhotoCaptureCredentialRow>;
        Relationships: [];
      };
      photo_captures: {
        Row: PhotoCaptureRow;
        Insert: Optional<
          PhotoCaptureRow,
          GeneratedCols | "final_url" | "transport" | "received_at" | "applied_at" | "status" | "reject_code" | "bytes" | "completeness" | "athlete_count" | "outcome" | "diagnostics"
        >;
        Update: Partial<PhotoCaptureRow>;
        Relationships: [];
      };
      photo_telegram_links: {
        Row: PhotoTelegramLinkRow;
        Insert: Optional<PhotoTelegramLinkRow, GeneratedCols | "chat_id" | "chat_title" | "link_code" | "link_code_expires_at" | "linked_at" | "enabled">;
        Update: Partial<PhotoTelegramLinkRow>;
        Relationships: [];
      };
      photo_notification_subscriptions: {
        Row: PhotoNotificationSubscriptionRow;
        Insert: Optional<PhotoNotificationSubscriptionRow, GeneratedCols | "event_id" | "kinds" | "enabled">;
        Update: Partial<PhotoNotificationSubscriptionRow>;
        Relationships: [];
      };
      photo_notification_deliveries: {
        Row: PhotoNotificationDeliveryRow;
        Insert: Optional<
          PhotoNotificationDeliveryRow,
          GeneratedCols | "athlete_id" | "match_id" | "payload" | "status" | "attempts" | "last_error" | "next_attempt_at" | "sent_at" | "leased_until" | "lease_owner" | "category"
        >;
        Update: Partial<PhotoNotificationDeliveryRow>;
        Relationships: [];
      };
      photo_bookings: {
        Row: PhotoBookingRow;
        Insert: Optional<
          PhotoBookingRow,
          | GeneratedCols
          | "event_id"
          | "academy"
          | "division"
          | "currency"
          | "status"
          | "provider"
          | "provider_invoice_id"
          | "payment_url"
          | "paid_at"
          | "refunded_at"
          | "disputed_at"
          | "payment_status_updated_at"
          | "watcher_athlete_id"
          | "notes"
          | "metadata"
          | "booking_type"
          | "booking_status"
          | "client_id"
          | "organization_id"
          | "service_id"
          | "lead_id"
          | "session_at"
          | "session_end_at"
          | "location"
          | "payment_mode"
          | "payment_method"
          | "amount_paid_qr"
          | "manual_paid_at"
          | "details"
          | "contract_document_id"
          | "gallery_id"
          | "assigned_photographer_id"
          | "assigned_videographer_id"
          | "quoted_at"
          | "confirmed_at"
          | "coverage_done_at"
          | "delivered_at"
          | "completed_at"
          | "cancelled_at"
          | "cancel_reason"
          | "public_ref"
        >;
        Update: Partial<PhotoBookingRow>;
        Relationships: [];
      };
      photo_payment_attempts: {
        Row: PhotoPaymentAttemptRow;
        Insert: Optional<
          PhotoPaymentAttemptRow,
          "id" | "created_at" | "updated_at" | "booking_id" | "provider" | "provider_invoice_id" | "provider_payment_id" | "status" | "amount" | "currency" | "raw"
        >;
        Update: Partial<PhotoPaymentAttemptRow>;
        Relationships: [];
      };
      photo_payment_events: {
        Row: PhotoPaymentEventRow;
        Insert: Optional<
          PhotoPaymentEventRow,
          "id" | "owner_id" | "order_id" | "booking_id" | "provider_event_id" | "payload" | "signature_valid" | "processed_at" | "processing_result" | "attempts" | "received_at"
        >;
        Update: Partial<PhotoPaymentEventRow>;
        Relationships: [];
      };
      photo_orders: {
        Row: PhotoOrderRow;
        Insert: Optional<
          PhotoOrderRow,
          | GeneratedCols
          | "pictime_order_id"
          | "customer_email"
          | "customer_phone"
          | "gallery_name"
          | "currency"
          | "status"
          | "provider"
          | "provider_invoice_id"
          | "payment_url"
          | "paid_at"
          | "approved_in_pictime_at"
          | "metadata"
          | "source"
          | "external_ref"
          | "payment_method"
          | "payment_state"
          | "payment_reference"
          | "payment_reported_state"
          | "items"
          | "placed_at"
          | "received_at"
          | "buyer_note"
          | "athlete_name_hint"
          | "raw"
          | "payment_confirmed_at"
          | "payment_confirmed_by"
          | "fulfilled_at"
          | "invoice_claimed_at"
          | "client_id"
          | "gallery_id"
        >;
        Update: Partial<PhotoOrderRow>;
        Relationships: [];
      };
      photo_profiles: {
        Row: PhotoProfileRow;
        Insert: Optional<PhotoProfileRow, "role" | "display_name" | "created_at" | "updated_at">;
        Update: Partial<PhotoProfileRow>;
        Relationships: [];
      };
      photo_studio: {
        Row: PhotoStudioRow;
        Insert: Optional<PhotoStudioRow, "owner_id" | "business_name" | "tagline" | "about" | "city" | "email" | "phone" | "whatsapp" | "instagram" | "public_booking" | "settings" | "created_at" | "updated_at">;
        Update: Partial<PhotoStudioRow>;
        Relationships: [];
      };
      photo_people: {
        Row: PhotoPersonRow;
        Insert: Optional<PhotoPersonRow, GeneratedCols | "user_id" | "email" | "email_key" | "phone" | "phone_key" | "instagram" | "whatsapp" | "kind" | "source" | "tags" | "notes">;
        Update: Partial<Omit<PhotoPersonRow, "email_key">>;
        Relationships: [];
      };
      photo_organizations: {
        Row: PhotoOrganizationRow;
        Insert: Optional<PhotoOrganizationRow, GeneratedCols | "kind" | "primary_contact_id" | "email" | "phone" | "instagram" | "notes">;
        Update: Partial<PhotoOrganizationRow>;
        Relationships: [];
      };
      photo_services: {
        Row: PhotoServiceRow;
        Insert: Optional<PhotoServiceRow, GeneratedCols | "description" | "price_qr" | "deposit_qr" | "currency" | "duration_minutes" | "includes_photo" | "includes_video" | "active" | "public" | "sort_order">;
        Update: Partial<PhotoServiceRow>;
        Relationships: [];
      };
      photo_leads: {
        Row: PhotoLeadRow;
        Insert: Optional<PhotoLeadRow, GeneratedCols | "person_id" | "organization_id" | "event_id" | "booking_type" | "status" | "source" | "message" | "details" | "booking_id">;
        Update: Partial<PhotoLeadRow>;
        Relationships: [];
      };
      photo_document_templates: {
        Row: PhotoDocumentTemplateRow;
        Insert: Optional<PhotoDocumentTemplateRow, GeneratedCols | "version" | "active">;
        Update: Partial<PhotoDocumentTemplateRow>;
        Relationships: [];
      };
      photo_documents: {
        Row: PhotoDocumentRow;
        Insert: Optional<
          PhotoDocumentRow,
          | GeneratedCols
          | "template_id"
          | "template_version"
          | "booking_id"
          | "client_id"
          | "organization_id"
          | "body_hash"
          | "status"
          | "access_token_hash"
          | "sent_at"
          | "viewed_at"
          | "signed_at"
          | "declined_at"
          | "expires_at"
          | "signer_name"
          | "signer_email"
          | "signer_phone"
          | "signature_evidence"
        >;
        Update: Partial<PhotoDocumentRow>;
        Relationships: [];
      };
      photo_galleries: {
        Row: PhotoGalleryRow;
        Insert: Optional<
          PhotoGalleryRow,
          GeneratedCols | "booking_id" | "client_id" | "event_id" | "pictime_url" | "pictime_project_id" | "status" | "created_in_pictime_at" | "ready_at" | "delivered_at" | "notified_at" | "visitor_count" | "last_visitor_at" | "notes"
        >;
        Update: Partial<PhotoGalleryRow>;
        Relationships: [];
      };
      photo_payment_records: {
        Row: PhotoPaymentRecordRow;
        Insert: Optional<PhotoPaymentRecordRow, "id" | "owner_id" | "created_at" | "booking_id" | "order_id" | "currency" | "paid_at" | "note" | "recorded_by" | "provider" | "provider_payment_id">;
        Update: Partial<PhotoPaymentRecordRow>;
        Relationships: [];
      };
      photo_client_notification_prefs: {
        Row: PhotoClientNotificationPrefRow;
        Insert: Optional<PhotoClientNotificationPrefRow, "owner_id" | "enabled" | "updated_at">;
        Update: Partial<PhotoClientNotificationPrefRow>;
        Relationships: [];
      };
      photo_audit_log: {
        Row: PhotoAuditLogRow;
        Insert: Optional<PhotoAuditLogRow, "id" | "created_at" | "actor_id" | "actor_kind" | "entity_id" | "data">;
        Update: Partial<PhotoAuditLogRow>;
        Relationships: [];
      };
      photo_price_references: {
        Row: PhotoPriceReferenceRow;
        Insert: Optional<PhotoPriceReferenceRow, GeneratedCols | "source_url" | "checked_on" | "location" | "price_to" | "currency" | "includes" | "notes">;
        Update: Partial<PhotoPriceReferenceRow>;
        Relationships: [];
      };
      photo_quotes: {
        Row: PhotoQuoteRow;
        Insert: Optional<PhotoQuoteRow, GeneratedCols | "booking_id" | "status" | "suggested_from" | "suggested_to" | "chosen_amount_qr" | "currency" | "notes">;
        Update: Partial<PhotoQuoteRow>;
        Relationships: [];
      };
    };
    Views: {
      photo_client_people_v: { Row: ClientPersonView; Relationships: [] };
      photo_client_bookings_v: { Row: ClientBookingView; Relationships: [] };
      photo_client_galleries_v: { Row: ClientGalleryView; Relationships: [] };
      photo_client_payments_v: { Row: ClientPaymentView; Relationships: [] };
    };
    Functions: {
      photo_apply_refresh: {
        Args: ApplyRefreshArgs;
        Returns: Json;
      };
      photo_ensure_owner_policies: {
        Args: { p_table: string };
        Returns: undefined;
      };
      photo_is_event_member: {
        Args: { p_event_id: string };
        Returns: boolean;
      };
      photo_collaborator_events: {
        Args: Record<string, never>;
        Returns: CollaboratorEventRow[];
      };
      photo_collaborator_board: {
        Args: { p_event_id: string };
        Returns: CollaboratorBoardRow[];
      };
      photo_set_coverage_done: {
        Args: { p_athlete_id: string; p_kind: string; p_done: boolean };
        Returns: PhotoCoverageRow;
      };
      photo_claim_notification_deliveries: {
        Args: { p_channel: string; p_limit: number; p_lease_seconds: number; p_worker: string; p_owner_id?: string | null };
        Returns: PhotoNotificationDeliveryRow[];
      };
      photo_apply_payment_transition: {
        Args: { p_booking_id: string; p_expected_status: string; p_columns: Json; p_attempt?: Json | null; p_event_row_id?: number | null; p_processing_result?: string | null; p_delivery?: Json | null };
        Returns: Json;
      };
      photo_record_order: {
        Args: { p_owner_id: string; p_order: Json; p_delivery?: Json | null };
        Returns: Json;
      };
      photo_apply_coverage_command: {
        Args: { p_command_id: string; p_athlete_id: string; p_kind: string; p_done: boolean; p_expected_done_at: string | null; p_force?: boolean };
        Returns: Json;
      };
      photo_my_role: {
        Args: Record<string, never>;
        Returns: string;
      };
      photo_is_my_person: {
        Args: { p_person_id: string };
        Returns: boolean;
      };
      photo_is_studio_user: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      photo_is_owner_user: {
        Args: Record<string, never>;
        Returns: boolean;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
