"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { FormError, FormField } from "@/components/FormField";
import type { BookingFormState } from "@/lib/actions/bookings";
import { isoToWallClock } from "@/lib/bookings/form";
import { BOOKING_TYPE_LABEL, BOOKING_TYPES, bookingDetails, PAYMENT_MODE_LABEL, PAYMENT_MODES } from "@/lib/bookings/state";
import type { BookingType, PhotoBookingRow, PhotoEventRow, PhotoOrganizationRow, PhotoPersonRow, PhotoServiceRow } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

export type BookingFormProps = {
  action: (prev: BookingFormState, formData: FormData) => Promise<BookingFormState>;
  initial?: PhotoBookingRow | null;
  people: Array<Pick<PhotoPersonRow, "id" | "full_name" | "email" | "phone">>;
  organizations: Array<Pick<PhotoOrganizationRow, "id" | "name" | "kind">>;
  services: PhotoServiceRow[];
  events: Array<Pick<PhotoEventRow, "id" | "name" | "event_date" | "active">>;
  defaultClientId?: string | null;
  defaultEventId?: string | null;
  submitLabel?: string;
  cancelHref?: string;
};

const SHOW: Record<BookingType, readonly string[]> = {
  tournament_athlete: ["athlete", "academy", "belt", "divisions", "gi", "coverage", "source_url", "competition_date", "booked_for"],
  club: ["academy", "athlete_count", "wants", "coverage"],
  training_session: ["academy", "coverage", "athlete"],
  private_session: ["athlete", "academy", "belt", "coverage", "booked_for"],
  custom: ["coverage", "athlete"],
};

/** The owner's booking form (create + edit). One form; the Details section follows the booking type. */
export function BookingForm({ action, initial, people, organizations, services, events, defaultClientId, defaultEventId, submitLabel = "Save booking", cancelHref = "/bookings" }: BookingFormProps) {
  const [state, formAction, pending] = useActionState(action, null);
  const fe = state?.fieldErrors ?? {};
  const details = initial ? bookingDetails(initial) : {};
  const [type, setType] = useState<BookingType>(initial?.booking_type ?? "tournament_athlete");
  const [clientMode, setClientMode] = useState<"existing" | "new">(initial?.client_id || defaultClientId ? "existing" : people.length ? "existing" : "new");
  const [serviceId, setServiceId] = useState(initial?.service_id ?? "");
  const service = services.find((s) => s.id === serviceId) ?? null;
  const wall = isoToWallClock(initial?.session_at);
  const show = (key: string) => SHOW[type].includes(key);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <FormError message={state?.error} />

      <section className="card space-y-4 p-5">
        <h2 className="text-sm font-extrabold uppercase tracking-wider text-muted">What</h2>
        <FormField label="Booking type" htmlFor="booking_type" required error={fe.booking_type}>
          <select id="booking_type" name="booking_type" className="input" value={type} onChange={(e) => setType(e.target.value as BookingType)} required>
            {BOOKING_TYPES.map((t) => <option key={t} value={t}>{BOOKING_TYPE_LABEL[t]}</option>)}
          </select>
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Service / package" htmlFor="service_id" error={fe.service_id} hint={service ? (service.price_qr === null ? "Quote on request" : `${service.price_qr} ${service.currency}`) : "Optional"}>
            <select id="service_id" name="service_id" className="input" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
              <option value="">No service selected</option>
              {services.filter((s) => s.active || s.id === initial?.service_id).map((s) => <option key={s.id} value={s.id}>{s.name}{s.booking_type !== type ? ` (${BOOKING_TYPE_LABEL[s.booking_type]})` : ""}</option>)}
            </select>
          </FormField>
          <FormField label="Tournament / event" htmlFor="event_id" error={fe.event_id} hint="Optional — links the booking to the Watcher">
            <select id="event_id" name="event_id" className="input" defaultValue={initial?.event_id ?? defaultEventId ?? ""}>
              <option value="">No event</option>
              {events.map((e) => <option key={e.id} value={e.id}>{e.name}{e.event_date ? ` · ${e.event_date}` : ""}{e.active ? "" : " (past)"}</option>)}
            </select>
          </FormField>
        </div>
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="text-sm font-extrabold uppercase tracking-wider text-muted">Client</h2>
        <div className="flex gap-2" role="radiogroup" aria-label="Client">
          <button type="button" role="radio" aria-checked={clientMode === "existing"} className={cn("min-h-11 flex-1 rounded-xl border px-3 text-sm font-semibold", clientMode === "existing" ? "border-primary bg-lightblue text-primary" : "border-line bg-white text-muted")} onClick={() => setClientMode("existing")} disabled={!people.length}>Existing client</button>
          <button type="button" role="radio" aria-checked={clientMode === "new"} className={cn("min-h-11 flex-1 rounded-xl border px-3 text-sm font-semibold", clientMode === "new" ? "border-primary bg-lightblue text-primary" : "border-line bg-white text-muted")} onClick={() => setClientMode("new")}>New contact</button>
        </div>
        {clientMode === "existing" ? (
          <FormField label="Client" htmlFor="client_id" required error={fe.client_id}>
            <select id="client_id" name="client_id" className="input" defaultValue={initial?.client_id ?? defaultClientId ?? ""} required>
              <option value="">Choose a client…</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}{p.phone ? ` · ${p.phone}` : p.email ? ` · ${p.email}` : ""}</option>)}
            </select>
          </FormField>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="client_id" value="" />
            <FormField label="Full name" htmlFor="customer_name" required error={fe.customer_name} className="sm:col-span-2">
              <input id="customer_name" name="customer_name" className="input" defaultValue={initial?.customer_name ?? ""} autoComplete="name" maxLength={120} required />
            </FormField>
            <FormField label="Phone" htmlFor="customer_phone" error={fe.customer_phone} hint="Matched against existing clients">
              <input id="customer_phone" name="customer_phone" className="input" type="tel" inputMode="tel" autoComplete="tel" defaultValue={initial?.customer_phone ?? ""} placeholder="+974 …" />
            </FormField>
            <FormField label="Email" htmlFor="customer_email" error={fe.customer_email} hint="Needed for confirmations and payment links">
              <input id="customer_email" name="customer_email" className="input" type="email" inputMode="email" autoComplete="email" defaultValue={initial?.customer_email ?? ""} />
            </FormField>
            <FormField label="Instagram" htmlFor="instagram" error={fe.instagram}>
              <input id="instagram" name="instagram" className="input" defaultValue={details.instagram ?? ""} placeholder="@handle" autoComplete="off" autoCapitalize="none" />
            </FormField>
          </div>
        )}
        <FormField label="Team / club" htmlFor="organization_id" error={fe.organization_id} hint="Optional">
          <select id="organization_id" name="organization_id" className="input" defaultValue={initial?.organization_id ?? ""}>
            <option value="">None</option>
            {organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </FormField>
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="text-sm font-extrabold uppercase tracking-wider text-muted">Details</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {show("athlete") && (
            <FormField label={type === "tournament_athlete" ? "Athlete name" : "Who is photographed"} htmlFor="athlete_name" error={fe.athlete_name} hint="Leave blank if it is the client">
              <input id="athlete_name" name="athlete_name" className="input" defaultValue={initial?.athlete_name ?? ""} maxLength={120} autoComplete="off" />
            </FormField>
          )}
          {show("academy") && (
            <FormField label={type === "club" ? "Club / academy name" : "Academy"} htmlFor="academy" error={fe.academy}>
              <input id="academy" name="academy" className="input" defaultValue={details.academy ?? initial?.academy ?? ""} maxLength={120} autoComplete="organization" />
            </FormField>
          )}
          {show("belt") && (
            <FormField label="Belt" htmlFor="belt" error={fe.belt}>
              <input id="belt" name="belt" className="input" defaultValue={details.belt ?? ""} maxLength={40} placeholder="Blue" autoComplete="off" />
            </FormField>
          )}
          {show("divisions") && (
            <>
              <FormField label="Age division" htmlFor="age_division" error={fe.age_division}>
                <input id="age_division" name="age_division" className="input" defaultValue={details.age_division ?? ""} maxLength={60} placeholder="Adult" autoComplete="off" />
              </FormField>
              <FormField label="Weight division" htmlFor="weight_division" error={fe.weight_division}>
                <input id="weight_division" name="weight_division" className="input" defaultValue={details.weight_division ?? ""} maxLength={60} placeholder="-76 kg" autoComplete="off" />
              </FormField>
            </>
          )}
          {show("gi") && (
            <FormField label="Gi / No-Gi" htmlFor="gi" error={fe.gi}>
              <select id="gi" name="gi" className="input" defaultValue={details.gi ?? ""}>
                <option value="">Not specified</option>
                <option value="gi">Gi</option>
                <option value="no-gi">No-Gi</option>
                <option value="both">Both</option>
              </select>
            </FormField>
          )}
          {show("coverage") && (
            <FormField label="Coverage" htmlFor="coverage" error={fe.coverage}>
              <select id="coverage" name="coverage" className="input" defaultValue={details.coverage ?? ""}>
                <option value="">Not specified</option>
                <option value="photo">Photo</option>
                <option value="video">Video</option>
                <option value="both">Photo + video</option>
              </select>
            </FormField>
          )}
          {show("athlete_count") && (
            <FormField label="Number of athletes" htmlFor="athlete_count" error={fe.athlete_count}>
              <input id="athlete_count" name="athlete_count" className="input" type="number" inputMode="numeric" min={1} max={500} defaultValue={details.athlete_count ?? ""} />
            </FormField>
          )}
          {show("competition_date") && (
            <FormField label="Competition date" htmlFor="competition_date" error={fe.competition_date}>
              <input id="competition_date" name="competition_date" className="input" type="date" defaultValue={details.competition_date ?? ""} />
            </FormField>
          )}
          {show("booked_for") && (
            <FormField label="Booked for" htmlFor="booked_for" error={fe.booked_for}>
              <select id="booked_for" name="booked_for" className="input" defaultValue={details.booked_for ?? ""}>
                <option value="">Not specified</option>
                <option value="self">The client themselves</option>
                <option value="child">Their child</option>
                <option value="athlete">An athlete they manage</option>
                <option value="club">A club</option>
              </select>
            </FormField>
          )}
          {show("source_url") && (
            <FormField label="Bracket / player URL" htmlFor="source_url" error={fe.source_url} hint="Optional — prefills the tracked athlete later" className="sm:col-span-2">
              <input id="source_url" name="source_url" className="input" type="url" inputMode="url" defaultValue={details.source_url ?? ""} placeholder="https://" autoComplete="off" />
            </FormField>
          )}
        </div>
        {show("wants") && (
          <div className="flex flex-wrap gap-3">
            <label className="flex min-h-11 items-center gap-3 rounded-xl border border-line px-3"><input type="checkbox" name="wants_photographer" value="1" className="h-5 w-5 accent-primary" defaultChecked={details.wants_photographer} /><span className="text-sm font-semibold text-ink">Photographer</span></label>
            <label className="flex min-h-11 items-center gap-3 rounded-xl border border-line px-3"><input type="checkbox" name="wants_videographer" value="1" className="h-5 w-5 accent-primary" defaultChecked={details.wants_videographer} /><span className="text-sm font-semibold text-ink">Videographer</span></label>
          </div>
        )}
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="text-sm font-extrabold uppercase tracking-wider text-muted">When &amp; where</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Date" htmlFor="session_date" error={fe.session_date} hint="Qatar time">
            <input id="session_date" name="session_date" className="input" type="date" defaultValue={wall?.date ?? ""} />
          </FormField>
          <FormField label="Time" htmlFor="session_time" error={fe.session_time} hint="Defaults to 09:00 when a date is set">
            <input id="session_time" name="session_time" className="input" type="time" defaultValue={wall?.time ?? ""} />
          </FormField>
          <FormField label="Location" htmlFor="location" error={fe.location} className="sm:col-span-2">
            <input id="location" name="location" className="input" defaultValue={initial?.location ?? ""} maxLength={200} placeholder="Lusail Sports Arena, Mat 3" autoComplete="off" />
          </FormField>
        </div>
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="text-sm font-extrabold uppercase tracking-wider text-muted">Payment</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Amount (QAR)" htmlFor="amount_qr" error={fe.amount_qr} hint={service?.price_qr !== null && service?.price_qr !== undefined && !initial ? `Blank = service price (${service.price_qr})` : "0 or blank = no charge yet"}>
            <input id="amount_qr" name="amount_qr" className="input" inputMode="decimal" type="text" defaultValue={initial ? String(initial.amount_qr) : ""} placeholder={service?.price_qr != null ? String(service.price_qr) : "350"} autoComplete="off" />
          </FormField>
          <FormField label="How will it be paid?" htmlFor="payment_mode" error={fe.payment_mode}>
            <select id="payment_mode" name="payment_mode" className="input" defaultValue={initial?.payment_mode ?? "manual"}>
              {PAYMENT_MODES.map((m) => <option key={m} value={m}>{PAYMENT_MODE_LABEL[m]}</option>)}
            </select>
          </FormField>
        </div>
        {!initial && (
          <label className="flex min-h-11 items-center gap-3 rounded-xl border border-line px-3">
            <input type="checkbox" name="requires_contract" value="1" className="h-5 w-5 accent-primary" />
            <span className="text-sm text-ink"><span className="font-semibold">Needs a signed agreement first</span> <span className="text-muted">— the booking waits for the contract before payment</span></span>
          </label>
        )}
      </section>

      <section className="card space-y-4 p-5">
        <FormField label="Notes" htmlFor="notes" error={fe.notes} hint="Internal — not shown to the client">
          <textarea id="notes" name="notes" className="input min-h-24 py-2" defaultValue={initial?.notes ?? ""} maxLength={2000} rows={3} />
        </FormField>
      </section>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Link href={cancelHref} className="btn-secondary">Cancel</Link>
        <button type="submit" className="btn-primary" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : submitLabel}</button>
      </div>
    </form>
  );
}
