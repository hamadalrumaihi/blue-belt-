"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { FormError } from "@/components/FormField";
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";
import { submitPublicBooking, type PublicFormState } from "@/lib/actions/public";
import {
  HONEYPOT_FIELD,
  MEDIA_NOT_SURE,
  MESSAGES,
  SERVICE_LABEL,
  fieldInputNames,
  fieldVisible,
  legacyServiceKind,
  mediaChoiceLabel,
  orderedServices,
  publicBookingFields,
  stepIndexForField,
  validateFieldValue,
  videoFieldName,
  type MediaChoice,
  type PublicEventOption,
  type PublicField,
  type PublicServiceOption,
  type PublicStep,
  type WizardEntry,
} from "@/lib/bookings/public-form";
import { BOOKING_TYPE_LABEL } from "@/lib/bookings/state";
import { SERVICE_DEFINITIONS, isMediaScope, type ServiceKey } from "@/lib/catalog";
import { cn } from "@/lib/utils";
import { formatEventDate } from "@/lib/time";

type Props = {
  events: PublicEventOption[];
  /** Public packages: price as a label only, descriptions stripped of placeholders. */
  services: PublicServiceOption[];
  /** Resolved from `?service=`, `?audience=`, legacy `?type=` / `?kind=`, `?event=`. */
  entry: WizardEntry;
};

type Values = Record<string, string>;
type Errors = Record<string, string>;

const STEP_LABELS = ["What", "The day", "About you", "Review"] as const;

function uuidV4(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Today in the browser's zone as YYYY-MM-DD, for the client-side date check. */
function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Values a change of service must not carry over (they belong to the previous service's options). */
function pruneForService(prev: Values, service: ServiceKey, services: PublicServiceOption[]): Values {
  const def = SERVICE_DEFINITIONS[service];
  const next = { ...prev };
  if (next.media_scope && next.media_scope !== MEDIA_NOT_SURE && !(def.mediaScopes as readonly string[]).includes(next.media_scope)) delete next.media_scope;
  for (const k of Object.keys(next)) if (k.startsWith("video_") && k !== videoFieldName("not_sure") && !def.videoDeliverables.some((d) => videoFieldName(d) === k)) delete next[k];
  // A package belongs to one booking type; drop it when the type changes.
  if (next.service_id && !services.some((s) => s.id === next.service_id && s.booking_type === def.bookingType)) delete next.service_id;
  return next;
}

/**
 * Four-step public request form driven by the catalog: what (service, media,
 * video deliverables, package), the day (per-service details), about you,
 * review. All answers live in one state object so Back never loses
 * anything; only the review step posts (hidden inputs carry every value), so
 * the server sees one complete submission and validates it with the same
 * field definitions this component renders. The idempotency key is generated
 * once per mount, so a retry or a double click lands on the same booking.
 */
export function BookingWizard({ events, services, entry }: Props) {
  const [service, setService] = useState<ServiceKey | null>(entry.service);
  const [step, setStep] = useState(entry.service && entry.media ? 1 : 0);
  const [values, setValues] = useState<Values>(() => {
    const v: Values = {};
    if (entry.eventId) v.event_id = entry.eventId;
    if (entry.serviceId) v.service_id = entry.serviceId;
    if (entry.media) v.media_scope = entry.media;
    return v;
  });
  const [errors, setErrors] = useState<Errors>({});
  const [serverErrors, setServerErrors] = useState<Errors>({});
  // Generated once per mount and never rendered during hydration (it only travels in a hidden field on the review step).
  const [idempotencyKey] = useState(() => uuidV4());
  const [state, formAction, pending] = useActionState<PublicFormState, FormData>(submitPublicBooking, null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [seenState, setSeenState] = useState<PublicFormState>(null);
  // Which field to focus after the next render (a jump from the error summary or a server error); null focuses the heading.
  const [focusRequest, setFocusRequest] = useState<{ name: string; tick: number } | null>(null);
  const setFocusTarget = (name: string) => setFocusRequest((prev) => ({ name, tick: (prev?.tick ?? 0) + 1 }));

  // Server-side field errors: keep them for the summary, show them beside the inputs and jump to the first.
  if (state !== seenState) {
    setSeenState(state);
    if (state?.fieldErrors && service) {
      setErrors(state.fieldErrors);
      setServerErrors(state.fieldErrors);
      const first = Object.keys(state.fieldErrors)[0];
      const target = first ? (stepIndexForField(service, first) ?? 3) : 3;
      setStep(target);
      if (first) setFocusTarget(first);
    }
  }

  // After a step change (or a jump from the error summary) focus the target field, else the heading.
  useEffect(() => {
    const el = focusRequest ? document.getElementById(fieldElementId(focusRequest.name, events.length > 0)) : null;
    if (el) el.focus({ preventScroll: false });
    else headingRef.current?.focus({ preventScroll: false });
  }, [step, focusRequest, events.length]);

  const steps: PublicStep[] = service ? publicBookingFields(service) : [];
  const current = step <= 2 ? (steps[step] ?? null) : null;
  const legalStep = steps.find((s) => s.key === "legal") ?? null;
  const bookingType = service ? SERVICE_DEFINITIONS[service].bookingType : null;
  const typeServices = services.filter((s) => s.booking_type === bookingType);
  const setValue = (name: string, v: string) => {
    setValues((prev) => ({ ...prev, [name]: v }));
    const clear = (prev: Errors) => {
      if (!prev[name]) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    };
    setErrors(clear);
    setServerErrors(clear);
  };

  function pickService(k: ServiceKey) {
    setService(k);
    setErrors({});
    setServerErrors({});
    setFocusRequest(null);
    setValues((prev) => pruneForService(prev, k, services));
    setStep(0);
  }

  function validateStep(s: PublicStep): Errors {
    const errs: Errors = {};
    const today = localToday();
    for (const f of s.fields) {
      if (!fieldVisible(f, values)) continue;
      if (f.kind === "catalog") {
        if (!service) errs.service_key = MESSAGES.service;
        continue;
      }
      if (f.kind === "event") {
        const id = values.event_id ?? "";
        const name = (values.event_name ?? "").trim();
        if (f.required && !(id && id !== "other") && !name) errs.event_id = "Tell us which competition.";
        continue;
      }
      if (f.kind === "checkbox") {
        if (f.required && !(f.options ?? []).some((o) => values[o.value] === "1")) errs[f.name] = MESSAGES.pickAtLeastOne;
        continue;
      }
      if (f.kind === "consent") {
        if (f.required && values[f.name] !== "1") errs[f.name] = MESSAGES.consent;
        continue;
      }
      if (f.kind === "service") {
        if (f.required && !values[f.name]) errs[f.name] = "Pick a package.";
        continue;
      }
      if (f.kind === "budget") {
        const amount = (values.budget_qr ?? "").trim();
        if (values.budget_unknown !== "1" && amount) {
          const problem = validateFieldValue(f, amount, today);
          if (problem) errs.budget_qr = problem;
        }
        continue;
      }
      const v = (values[f.name] ?? "").trim();
      if (!v) {
        if (f.required) errs[f.name] = f.name === "media_scope" ? MESSAGES.media : MESSAGES.required;
        continue;
      }
      const problem = validateFieldValue(f, v, today);
      if (problem) errs[f.name] = problem;
    }
    if (bookingType === "tournament_athlete" && s.key === "contact" && values.client_type && values.client_type !== "individual" && !(values.athlete_name ?? "").trim()) errs.athlete_name = "Enter the athlete's name.";
    return errs;
  }

  function focusFirst(errs: Errors) {
    const first = Object.keys(errs)[0];
    if (!first) return;
    const el = document.getElementById(fieldElementId(first, events.length > 0));
    el?.focus();
  }

  function next() {
    if (!current || !service) return;
    const errs = validateStep(current);
    setErrors(errs);
    if (Object.keys(errs).length) {
      // The athlete name lives on the details step; send the visitor there.
      if (errs.athlete_name && current.key === "contact") {
        setStep(1);
        setFocusTarget("athlete_name");
        return;
      }
      focusFirst(errs);
      return;
    }
    setFocusRequest(null);
    setStep((s) => Math.min(3, s + 1));
  }

  function back() {
    setErrors({});
    setFocusRequest(null);
    setStep((s) => Math.max(0, s - 1));
  }

  function jumpTo(name: string) {
    if (!service) return;
    const target = stepIndexForField(service, name) ?? 3;
    setStep(target);
    setFocusTarget(name);
  }

  const stepTitle = step === 3 ? "Review and send" : current?.title ?? "What do you need?";
  const labelOf = (name: string): string => {
    for (const s of steps) for (const f of s.fields) if (fieldInputNames(f).includes(name)) return f.label;
    return name === "service_key" ? "Service" : name;
  };
  const summaryErrors = Object.entries({ ...serverErrors, ...(step === 3 ? errors : {}) }).filter(([k]) => k !== HONEYPOT_FIELD);
  const visibleNames = new Set(steps.flatMap((s) => s.fields.filter((f) => fieldVisible(f, values) && s.key !== "legal").flatMap(fieldInputNames)));
  const media: MediaChoice | null = values.media_scope === MEDIA_NOT_SURE ? MEDIA_NOT_SURE : isMediaScope(values.media_scope) ? values.media_scope : null;
  const serviceKind = service ? legacyServiceKind(service, media && media !== MEDIA_NOT_SURE ? media : null, entry.legacyKind) : null;

  return (
    <form
      action={formAction}
      className="relative"
      noValidate
      onSubmit={(e) => {
        if (pending || !legalStep) {
          e.preventDefault();
          return;
        }
        const errs = validateStep(legalStep);
        if (Object.keys(errs).length) {
          e.preventDefault();
          setErrors(errs);
          focusFirst(errs);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && step < 3 && (e.target as HTMLElement).tagName !== "TEXTAREA" && (e.target as HTMLElement).tagName !== "BUTTON") {
          e.preventDefault();
          next();
        }
      }}
    >
      <Progress step={step} />
      <h2 ref={headingRef} tabIndex={-1} className="mt-6 text-2xl font-extrabold tracking-tight text-navy outline-none sm:text-3xl">
        {stepTitle}
      </h2>
      <p className="sr-only" aria-live="polite">Step {step + 1} of 4: {stepTitle}</p>
      {current?.intro && <p className="mt-2 text-base text-muted">{current.intro}</p>}
      {step === 0 && !service && <p className="mt-2 text-base text-muted">Pick the service, then photos, video or both. Prices are confirmed with you before anything is signed or paid.</p>}
      {step === 3 && <p className="mt-2 text-base text-muted">Check the details, tick the boxes and send. This is a request, not a confirmed reservation: we come back within 24 hours. Nothing is paid until we have confirmed the date and the price.</p>}

      {summaryErrors.length > 0 && (
        <div className="mt-5 rounded-xl border border-danger/30 bg-danger-soft p-4" role="alert" aria-labelledby="error-summary-heading">
          <p id="error-summary-heading" className="text-sm font-bold text-danger">Please check {summaryErrors.length === 1 ? "this field" : `these ${summaryErrors.length} fields`}</p>
          <ul className="mt-2 space-y-1 text-sm text-ink">
            {summaryErrors.map(([name, message]) => (
              <li key={name}>
                <button type="button" onClick={() => jumpTo(name)} className="min-h-8 text-left font-semibold text-danger underline underline-offset-2">
                  {labelOf(name)}
                </button>
                <span className="text-muted">: {message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6 space-y-5">
        {step === 0 && (
          <fieldset>
            <legend className="label text-base">
              Service<span className="ml-0.5 text-danger" aria-hidden>*</span>
            </legend>
            <ul className="grid gap-3" role="list" id="f-service_key">
              {orderedServices(entry.audience).map((k) => (
                <li key={k}>
                  <button
                    type="button"
                    onClick={() => pickService(k)}
                    aria-pressed={service === k}
                    className={cn("card flex w-full items-center gap-4 p-4 text-left transition-colors hover:border-primary/50 sm:p-5", service === k && "border-primary bg-lightblue/40")}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-base font-extrabold text-ink">{SERVICE_LABEL[k].title}</span>
                      <span className="mt-0.5 block text-sm text-muted">{SERVICE_LABEL[k].body}</span>
                    </span>
                    {service === k ? <CheckIcon className="shrink-0 text-primary" /> : <ChevronRightIcon className="shrink-0 text-muted" />}
                  </button>
                </li>
              ))}
            </ul>
            {errors.service_key && <p className="mt-1 text-xs font-semibold text-danger" role="alert" id="f-service_key-error">{errors.service_key}</p>}
          </fieldset>
        )}

        {current && service && current.fields.filter((f) => f.kind !== "catalog" && fieldVisible(f, values)).map((f) => <FieldInput key={f.name} field={f} values={values} setValue={setValue} errors={errors} events={events} services={typeServices} />)}

        {step === 3 && service && bookingType && serviceKind && (
          <>
            <Review service={service} steps={steps.filter((s) => s.key !== "legal")} values={values} events={events} services={services} onEdit={(i) => { setFocusRequest(null); setStep(i); }} />
            {/* Everything the server needs travels as hidden fields; the visible inputs of earlier steps are unmounted. */}
            <input type="hidden" name="service_key" value={service} />
            <input type="hidden" name="service_kind" value={serviceKind} />
            <input type="hidden" name="booking_type" value={bookingType} />
            <input type="hidden" name="idempotency_key" value={idempotencyKey} />
            {Object.entries(values).map(([k, v]) => (v && visibleNames.has(k) ? <input key={k} type="hidden" name={k} value={v} /> : null))}
            <div className="absolute -left-[9999px] top-0 h-0 w-0 overflow-hidden" aria-hidden>
              <label htmlFor={`f-${HONEYPOT_FIELD}`}>Leave this field empty</label>
              <input id={`f-${HONEYPOT_FIELD}`} name={HONEYPOT_FIELD} tabIndex={-1} autoComplete="off" />
            </div>
            <fieldset className="space-y-3">
              <legend className="label text-base">Before you send</legend>
              {legalStep?.fields.map((f) => (
                <ConsentInput key={f.name} field={f} checked={values[f.name] === "1"} onChange={(on) => setValue(f.name, on ? "1" : "")} error={errors[f.name]} links />
              ))}
            </fieldset>
            <FormError message={state?.error ?? errors.service_key ?? errors.booking_type ?? errors.idempotency_key} />
          </>
        )}
      </div>

      {(step > 0 || service) && (
        <div className="mt-8 flex gap-3">
          {step > 0 && (
            <button type="button" onClick={back} className="btn-secondary min-h-12 px-5" disabled={pending}>
              <ChevronLeftIcon size={18} /> Back
            </button>
          )}
          {step < 3 ? (
            // Distinct keys: React must not reuse this node for the submit button below, or the click that
            // moves to the review step would also trigger the browser's default submit on the re-typed button.
            <button key="continue" type="button" onClick={(e) => { e.preventDefault(); next(); }} className="btn-primary min-h-12 flex-1 text-base">
              Continue <ChevronRightIcon size={18} />
            </button>
          ) : (
            <button key="send" type="submit" className="btn-primary min-h-12 flex-1 text-base" disabled={pending || !idempotencyKey} aria-busy={pending}>
              {pending ? "Sending..." : "Send request"}
            </button>
          )}
        </div>
      )}
      <p className="sr-only" aria-live="polite">{pending ? "Sending your request" : ""}</p>
    </form>
  );
}

/** The DOM id that receives focus for a field name (the event picker has two inputs, the budget two). */
function fieldElementId(name: string, hasEvents: boolean): string {
  if (name === "event_id" || name === "event_name") return hasEvents ? "f-event_id" : "f-event_name";
  if (name === "budget" || name === "budget_unknown") return "f-budget_qr";
  return `f-${name}`;
}

function Progress({ step }: { step: number }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Step {step + 1} of {STEP_LABELS.length}</p>
      <ol className="mt-2 grid grid-cols-4 gap-1.5" aria-label="Progress">
        {STEP_LABELS.map((label, i) => (
          <li key={label} aria-current={i === step ? "step" : undefined} className="min-w-0">
            <div className={cn("h-1.5 rounded-full", i <= step ? "bg-primary" : "bg-line")} />
            <span className={cn("mt-1 block truncate text-[11px] font-semibold", i === step ? "text-primary" : "text-muted")}>{label}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

type FieldProps = { field: PublicField; values: Values; setValue: (n: string, v: string) => void; errors: Errors; events: PublicEventOption[]; services: PublicServiceOption[] };

function Wrap({ field, error, children, htmlFor, hint }: { field: PublicField; error?: string; children: ReactNode; htmlFor: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <label htmlFor={htmlFor} className="label text-base">
        {field.label}
        {field.required && <span className="ml-0.5 text-danger" aria-hidden>*</span>}
      </label>
      {children}
      {error ? <p className="mt-1 text-xs font-semibold text-danger" role="alert" id={`${htmlFor}-error`}>{error}</p> : (hint ?? field.hint) ? <p className="hint">{hint ?? field.hint}</p> : null}
    </div>
  );
}

function ConsentInput({ field, checked, onChange, error, links }: { field: PublicField; checked: boolean; onChange: (on: boolean) => void; error?: string; links?: boolean }) {
  const id = `f-${field.name}`;
  return (
    <div className="rounded-card border border-line bg-page p-4">
      <label className="flex min-h-11 items-start gap-3">
        <input id={id} type="checkbox" name={field.name} value="1" className="mt-1 h-5 w-5 shrink-0 accent-primary" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} />
        <span className="text-sm text-ink">
          {field.text ?? field.label}
          {field.required && <span className="ml-0.5 text-danger" aria-hidden>*</span>}
          {links && field.name === "accept_terms" && <> <Link href="/terms" target="_blank" className="font-semibold text-primary">Read the terms</Link>.</>}
          {links && field.name === "accept_privacy" && <> <Link href="/privacy" target="_blank" className="font-semibold text-primary">Read the privacy policy</Link>.</>}
        </span>
      </label>
      {error && <p id={`${id}-error`} className="mt-1 text-xs font-semibold text-danger" role="alert">{error}</p>}
    </div>
  );
}

function FieldInput({ field, values, setValue, errors, events, services }: FieldProps) {
  const id = `f-${field.name}`;
  const error = errors[field.name];
  const a11y = { "aria-invalid": Boolean(error), "aria-describedby": error ? `${id}-error` : undefined };

  if (field.kind === "event") {
    const err = errors.event_id ?? errors.event_name;
    const picked = values.event_id ?? "";
    const showName = events.length === 0 || picked === "other";
    return (
      <Wrap field={field} error={err} htmlFor={events.length ? "f-event_id" : "f-event_name"}>
        {events.length > 0 && (
          <select id="f-event_id" className="input" value={picked} onChange={(e) => setValue("event_id", e.target.value)} aria-invalid={Boolean(err)} aria-describedby={err ? "f-event_id-error" : undefined}>
            <option value="">Choose a competition</option>
            {events.map((e) => (
              <option key={e.id} value={e.id}>{e.name}{e.event_date ? `, ${formatEventDate(e.event_date, "short")}` : ""}</option>
            ))}
            <option value="other">Not listed / another event</option>
          </select>
        )}
        {showName && (
          <input id="f-event_name" className={cn("input", events.length > 0 && "mt-2")} placeholder="Name of the competition" maxLength={200} value={values.event_name ?? ""} onChange={(e) => setValue("event_name", e.target.value)} autoComplete="off" aria-label={events.length ? "Competition name" : undefined} />
        )}
      </Wrap>
    );
  }

  if (field.kind === "service") {
    if (!services.length) return <p className="rounded-xl bg-page px-4 py-3 text-sm text-muted">This coverage is quoted individually. We send a price after reviewing your request.</p>;
    const chosen = values[field.name] ? services.find((s) => s.id === values[field.name]) : null;
    return (
      <Wrap field={field} error={error} htmlFor={id} hint={chosen?.description ?? undefined}>
        <select id={id} className="input" value={values[field.name] ?? ""} onChange={(e) => setValue(field.name, e.target.value)} {...a11y}>
          <option value="">Not sure yet, advise me</option>
          {services.map((s) => (
            <option key={s.id} value={s.id}>{s.name}: {s.price_label}</option>
          ))}
        </select>
      </Wrap>
    );
  }

  if (field.kind === "radio") {
    const many = (field.options ?? []).length > 3;
    return (
      <fieldset>
        <legend className="label text-base">
          {field.label}
          {field.required && <span className="ml-0.5 text-danger" aria-hidden>*</span>}
        </legend>
        <div className={cn("grid gap-2", many ? "sm:grid-cols-2" : "sm:grid-cols-3")} role="radiogroup" aria-label={field.label}>
          {(field.options ?? []).map((o, i) => {
            const on = values[field.name] === o.value;
            return (
              <label key={o.value} className={cn("flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2", on ? "border-primary bg-lightblue" : "border-line bg-white")}>
                <input id={i === 0 ? id : undefined} type="radio" name={`ui-${field.name}`} value={o.value} checked={on} onChange={() => setValue(field.name, o.value)} className="h-4 w-4 accent-primary" aria-describedby={error ? `${id}-error` : undefined} />
                <span className="text-sm font-semibold text-ink">{o.label}</span>
              </label>
            );
          })}
        </div>
        {error ? <p className="mt-1 text-xs font-semibold text-danger" role="alert" id={`${id}-error`}>{error}</p> : field.hint ? <p className="hint">{field.hint}</p> : null}
      </fieldset>
    );
  }

  if (field.kind === "checkbox") {
    return (
      <fieldset>
        <legend className="label text-base">
          {field.label}
          {field.required && <span className="ml-0.5 text-danger" aria-hidden>*</span>}
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {(field.options ?? []).map((o, i) => {
            const on = values[o.value] === "1";
            return (
              <label key={o.value} className={cn("flex min-h-12 cursor-pointer items-start gap-3 rounded-xl border px-3 py-2", on ? "border-primary bg-lightblue" : "border-line bg-white")}>
                <input id={i === 0 ? id : undefined} type="checkbox" checked={on} onChange={(e) => setValue(o.value, e.target.checked ? "1" : "")} className="mt-0.5 h-5 w-5 accent-primary" aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-ink">{o.label}</span>
                  {o.hint && <span className="block text-xs text-muted">{o.hint}</span>}
                </span>
              </label>
            );
          })}
        </div>
        {error ? <p className="mt-1 text-xs font-semibold text-danger" role="alert" id={`${id}-error`}>{error}</p> : field.hint ? <p className="hint">{field.hint}</p> : null}
      </fieldset>
    );
  }

  if (field.kind === "budget") {
    const unknown = values.budget_unknown === "1";
    const err = errors.budget_qr;
    return (
      <fieldset>
        <legend className="label text-base">{field.label}</legend>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            id="f-budget_qr"
            type="text"
            inputMode="numeric"
            placeholder="1,500"
            className="input sm:max-w-xs"
            value={values.budget_qr ?? ""}
            disabled={unknown}
            onChange={(e) => setValue("budget_qr", e.target.value)}
            aria-invalid={Boolean(err)}
            aria-describedby={err ? "f-budget_qr-error" : undefined}
            aria-label="Budget in QAR"
          />
          <label className={cn("flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2", unknown ? "border-primary bg-lightblue" : "border-line bg-white")}>
            <input id="f-budget_unknown" type="checkbox" checked={unknown} onChange={(e) => setValue("budget_unknown", e.target.checked ? "1" : "")} className="h-5 w-5 accent-primary" />
            <span className="text-sm font-semibold text-ink">Not sure</span>
          </label>
        </div>
        {err ? <p className="mt-1 text-xs font-semibold text-danger" role="alert" id="f-budget_qr-error">{err}</p> : field.hint ? <p className="hint">{field.hint}</p> : null}
      </fieldset>
    );
  }

  if (field.kind === "consent") {
    return <ConsentInput field={field} checked={values[field.name] === "1"} onChange={(on) => setValue(field.name, on ? "1" : "")} error={error} />;
  }

  if (field.kind === "select") {
    return (
      <Wrap field={field} error={error} htmlFor={id}>
        <select id={id} className="input" value={values[field.name] ?? ""} onChange={(e) => setValue(field.name, e.target.value)} {...a11y}>
          <option value="">Choose</option>
          {(field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </Wrap>
    );
  }

  if (field.kind === "textarea") {
    return (
      <Wrap field={field} error={error} htmlFor={id}>
        <textarea id={id} className="input min-h-32 py-3" maxLength={field.max} placeholder={field.placeholder} value={values[field.name] ?? ""} onChange={(e) => setValue(field.name, e.target.value)} {...a11y} />
      </Wrap>
    );
  }

  const inputType = field.kind === "number" ? "text" : field.kind;
  return (
    <Wrap field={field} error={error} htmlFor={id}>
      <input
        id={id}
        type={inputType}
        inputMode={field.inputMode}
        autoComplete={field.autoComplete}
        maxLength={field.max}
        placeholder={field.placeholder}
        className="input"
        value={values[field.name] ?? ""}
        onChange={(e) => setValue(field.name, e.target.value)}
        {...a11y}
      />
    </Wrap>
  );
}

function Review({ service, steps, values, events, services, onEdit }: { service: ServiceKey; steps: PublicStep[]; values: Values; events: PublicEventOption[]; services: PublicServiceOption[]; onEdit: (step: number) => void }) {
  const bookingType = SERVICE_DEFINITIONS[service].bookingType;
  const display = (f: PublicField): string | null => {
    if (!fieldVisible(f, values)) return null;
    if (f.kind === "catalog") return SERVICE_LABEL[service].title;
    if (f.kind === "event") {
      const ev = values.event_id && values.event_id !== "other" ? events.find((e) => e.id === values.event_id) : null;
      return ev ? ev.name : (values.event_name ?? "").trim() || null;
    }
    if (f.kind === "service") {
      const s = values.service_id ? services.find((x) => x.id === values.service_id) : null;
      return s ? `${s.name}: ${s.price_label}` : services.some((x) => x.booking_type === bookingType) ? "Not sure yet, advise me" : null;
    }
    if (f.kind === "checkbox") {
      const on = (f.options ?? []).filter((o) => values[o.value] === "1").map((o) => o.label);
      return on.length ? on.join(" + ") : null;
    }
    if (f.kind === "budget") {
      if (values.budget_unknown === "1") return "Not sure";
      const v = (values.budget_qr ?? "").trim();
      return v ? `${v} QAR` : null;
    }
    if (f.kind === "consent") return values[f.name] === "1" ? "Yes" : null;
    const v = (values[f.name] ?? "").trim();
    if (!v) return null;
    if (f.name === "media_scope") return v === MEDIA_NOT_SURE ? "Not sure yet" : isMediaScope(v) ? mediaChoiceLabel(v) : v;
    if (f.kind === "radio" || f.kind === "select") return f.options?.find((o) => o.value === v)?.label ?? v;
    if (f.kind === "date") return formatEventDate(v, "long");
    return v;
  };
  return (
    <div className="space-y-4">
      {steps.map((s, i) => (
        <div key={s.key} className="card p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-bold text-ink">{s.key === "what" ? "What you asked for" : s.title}</p>
            <button type="button" className="min-h-8 text-sm font-semibold text-primary" onClick={() => onEdit(i)}>{s.key === "what" ? "Change" : "Edit"}</button>
          </div>
          {s.key === "what" && <p className="mt-1 text-xs text-muted">{BOOKING_TYPE_LABEL[bookingType]}</p>}
          <dl className="mt-2 divide-y divide-line">
            {s.fields.map((f) => {
              const v = display(f);
              if (!v) return null;
              return (
                <div key={f.name} className="grid gap-0.5 py-2 sm:grid-cols-[10rem_1fr]">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{f.label}</dt>
                  <dd className="break-words text-sm text-ink">{v}</dd>
                </div>
              );
            })}
          </dl>
        </div>
      ))}
      <ul className="space-y-1 text-sm text-muted">
        <li className="flex items-start gap-2"><CheckIcon size={16} className="mt-0.5 shrink-0 text-success" /> You get a reference straight away; we come back within 24 hours. Quoted work gets a price first.</li>
        <li className="flex items-start gap-2"><CheckIcon size={16} className="mt-0.5 shrink-0 text-success" /> Your date is confirmed once you sign the agreement and pay the 50% deposit online. The remaining 50% is due after delivery.</li>
      </ul>
    </div>
  );
}
