/**
 * Hand-maintained Supabase types for every table and RPC the app touches.
 * Mirrors supabase/migrations (baseline + v1 + v2). When the schema changes,
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
  active: boolean;
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

export type DeliveryStatus = "pending" | "sent" | "failed" | "skipped";

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
  created_at: string;
  updated_at: string;
};

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
        Insert: Optional<PhotoEventRow, GeneratedCols | "venue" | "country" | "event_date" | "source_url" | "timezone" | "active">;
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
          | "active"
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
          GeneratedCols | "athlete_id" | "match_id" | "payload" | "status" | "attempts" | "last_error" | "next_attempt_at" | "sent_at"
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
        >;
        Update: Partial<PhotoOrderRow>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
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
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
