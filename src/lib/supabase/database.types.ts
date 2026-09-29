/**
 * Hand-maintained Supabase types for the four Tournament Watcher tables.
 * Regenerate with `supabase gen types typescript` if the schema changes.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

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
  last_checked_at: string | null;
  last_watch_status: string | null;
  last_watch_message: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

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

type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

export type Database = {
  public: {
    Tables: {
      photo_events: {
        Row: PhotoEventRow;
        Insert: Optional<
          PhotoEventRow,
          | "id"
          | "owner_id"
          | "venue"
          | "country"
          | "event_date"
          | "source_url"
          | "timezone"
          | "active"
          | "created_at"
          | "updated_at"
        >;
        Update: Partial<PhotoEventRow>;
        Relationships: [];
      };
      photo_athletes: {
        Row: PhotoAthleteRow;
        Insert: Optional<
          PhotoAthleteRow,
          | "id"
          | "owner_id"
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
          | "last_watch_status"
          | "last_watch_message"
          | "active"
          | "created_at"
          | "updated_at"
        >;
        Update: Partial<PhotoAthleteRow>;
        Relationships: [];
      };
      photo_matches: {
        Row: PhotoMatchRow;
        Insert: Optional<
          PhotoMatchRow,
          | "id"
          | "owner_id"
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
          | "created_at"
          | "updated_at"
        >;
        Update: Partial<PhotoMatchRow>;
        Relationships: [];
      };
      photo_match_history: {
        Row: PhotoMatchHistoryRow;
        Insert: Optional<
          PhotoMatchHistoryRow,
          "id" | "owner_id" | "old_value" | "new_value" | "detected_at"
        >;
        Update: Partial<PhotoMatchHistoryRow>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
