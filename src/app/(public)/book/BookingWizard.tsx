"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { FormError } from "@/components/FormField";
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";
import { submitPublicBooking, type PublicFormState } from "@/lib/actions/public";
import {
  HONEYPOT_FIELD,
  MESSAGES,
  SERVICE_KINDS,
  defaultServiceKind,
  fieldInputNames,
  fieldVisible,
  isServiceKind,
  publicBookingFields,
  serviceKindInfo,
  stepIndexForField,
  validateFieldValue,
  type PublicEventOption,
  type PublicField,
  type PublicServiceOption,
  type PublicStep,
  type ServiceKind,
} from "@/lib/bookings/public-form";
import { BOOKING_TYPE_LABEL, formatQr, isBookingType } from "@/lib/bookings/state";
import type { BookingType } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";
import { formatEventDate } from "@/lib/time";

type Props = {
  events: PublicEventOption[];
  services: PublicServiceOption[];
  /** `/book?type=` (a booking type) or `/book?kind=` (a service kind) preselects the first step. */
  initialType: string | null;
  initialKind: string | null;
  initialEventId: string | null;
  initialServiceId: string | null;
};

type Values = Record<string, string>;
type Errors = Record<string, string>;

const STEP_LABELS = ["Service", "Details", "About you", "Review"] as const;

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

function initialKindFrom(kind: string | null, type: string | null): ServiceKind | null {
  if (isServiceKind(kind)) return kind;
  if (isBookingType(type)) return defaultServiceKind(type);
  return null;
}

/**
 * Four-step public booking form. All answers live in one state object so
 * Back never loses anything; only the review step posts (hidden inputs carry
 * every value), so the server sees one complete submission and validates it
 * with the same field definitions this component renders. The idempotency
 * key is generated once per mount, so a retry or a double click lands on the
 * same booking.
 */
export function BookingWizard({ events, services, initialType, initialKind, initialEventId, initialServiceId }: Props) {
  const [kind, setKind] = useState<ServiceKind | null>(() => initialKindFrom(initialKind, initialType));
  const type: BookingType | null = kind ? serviceKindInfo(kind).booking_type : null;
  const [step, setStep] = useState(kind ? 1 : 0);
  const [values, setValues] = useState<Values>(() => {
    const v: Values = {};
    const t = initialKindFrom(initialKind, initialType);
    if (initialEventId && events.some((e) => e.id === initialEventId)) v.event_id = initialEventId;
    if (t && initialServiceId && services.some((s) => s.id === initialServiceId && s.booking_type === serviceKindInfo(t).booking_type)) v.service_id = initialServiceId;
    if (t === "tournament_athlete_photo") v.coverage = "photo";
    if (t === "tournament_athlete_photo_video") v.coverage = "both";
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
    if (state?.fieldErrors && type) {
      setErrors(state.fieldErrors);
      setServerErrors(state.fieldErrors);
      const first = Object.keys(state.fieldErrors)[0];
      const target = first ? (stepIndexForField(type, first) ?? 3) : 3;
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

  const steps: PublicStep[] = type ? publicBookingFields(type) : [];
  const current = step === 1 || step === 2 ? steps[step - 1] : null;
  const legalStep = steps.find((s) => s.key === "legal") ?? null;
  const setValue = (name: string, v: string) => {
    setValues((prev) => ({ ...prev, [name]: v }));
    setErrors((prev) => {
      if (!prev[name]) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
    setServerErrors((prev) => {
      if (!prev[name]) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  };

  function pickKind(k: ServiceKind) {
    setKind(k);
    setErrors({});
    setServerErrors({});
    setFocusRequest(null);
    setValues((prev) => {
      const next = { ...prev };
      if (k === "tournament_athlete_photo") next.coverage = "photo";
      if (k === "tournament_athlete_photo_video") next.coverage = "both";
      // A package belongs to one booking type; drop it when the type changes.
      if (next.service_id && !services.some((s) => s.id === next.service_id && s.booking_type === serviceKindInfo(k).booking_type)) delete next.service_id;
      return next;
    });
    setStep(1);
  }

  function validateStep(s: PublicStep): Errors {
    const errs: Errors = {};
    const today = localToday();
    for (const f of s.fields) {
      if (!fieldVisible(f, values)) continue;
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
      const v = (values[f.name] ?? "").trim();
      if (!v) {
        if (f.required) errs[f.name] = MESSAGES.required;
        continue;
      }
      const problem = validateFieldValue(f, v, today);
      if (problem) errs[f.name] = problem;
    }
    if (type === "tournament_athlete" && s.key === "contact" && values.client_type && values.client_type !== "individual" && !(values.athlete_name ?? "").trim()) errs.athlete_name = "Enter the athlete's name.";
    return errs;
  }

  function focusFirst(errs: Errors) {
    const first = Object.keys(errs)[0];
    if (!first) return;
    const el = document.getElementById(fieldElementId(first, events.length > 0));
    el?.focus();
  }

  function next() {
    if (!current || !type) return;
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
    if (!type) return;
    const target = stepIndexForField(type, name) ?? 3;
    setStep(target);
    setFocusTarget(name);
  }

  const stepTitle = step === 0 ? "What would you like to book?" : step === 3 ? "Review and send" : current?.title ?? "";
  const labelOf = (name: string): string => {
    for (const s of steps) for (const f of s.fields) if (fieldInputNames(f).includes(name)) return f.label;
    return name;
  };
  const summaryErrors = Object.entries({ ...serverErrors, ...(step === 3 ? errors : {}) }).filter(([k]) => k !== HONEYPOT_FIELD);
  const visibleNames = new Set(steps.flatMap((s) => s.fields.filter((f) => fieldVisible(f, values) && s.key !== "legal").flatMap(fieldInputNames)));

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
          if (step > 0) next();
        }
      }}
    >
      <Progress step={step} />
      <h2 ref={headingRef} tabIndex={-1} className="mt-6 text-2xl font-extrabold tracking-tight text-navy outline-none sm:text-3xl">
        {stepTitle}
      </h2>
      <p className="sr-only" aria-live="polite">Step {step + 1} of 4: {stepTitle}</p>
      {current?.intro && <p className="mt-2 text-base text-muted">{current.intro}</p>}
      {step === 3 && <p className="mt-2 text-base text-muted">Check the details, tick the boxes and send. We confirm within 24 hours. Nothing is paid until we have confirmed.</p>}

      {summaryErrors.length > 0 && step > 0 && (
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
          <ul className="grid gap-3" role="list">
            {SERVICE_KINDS.map((k) => (
              <li key={k.value}>
                <button
                  type="button"
                  onClick={() => pickKind(k.value)}
                  aria-pressed={kind === k.value}
                  className={cn("card flex w-full items-center gap-4 p-4 text-left transition-colors hover:border-primary/50 sm:p-5", kind === k.value && "border-primary bg-lightblue/40")}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-base font-extrabold text-ink">{k.title}</span>
                    <span className="mt-0.5 block text-sm text-muted">{k.body}</span>
                  </span>
                  <ChevronRightIcon className="shrink-0 text-muted" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {current && type && current.fields.filter((f) => fieldVisible(f, values)).map((f) => <FieldInput key={f.name} field={f} values={values} setValue={setValue} errors={errors} events={events} services={services.filter((s) => s.booking_type === type)} />)}

        {step === 3 && type && kind && (
          <>
            <Review type={type} kind={kind} steps={steps.filter((s) => s.key !== "legal")} values={values} events={events} services={services} onEdit={(i) => { setFocusRequest(null); setStep(i); }} />
            {/* Everything the server needs travels as hidden fields; the visible inputs of earlier steps are unmounted. */}
            <input type="hidden" name="service_kind" value={kind} />
            <input type="hidden" name="booking_type" value={type} />
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
            <FormError message={state?.error ?? errors.service_kind ?? errors.booking_type ?? errors.idempotency_key} />
          </>
        )}
      </div>

      {step > 0 && (
        <div className="mt-8 flex gap-3">
          <button type="button" onClick={back} className="btn-secondary min-h-12 px-5" disabled={pending}>
            <ChevronLeftIcon size={18} /> Back
          </button>
          {step < 3 ? (
            <button type="button" onClick={next} className="btn-primary min-h-12 flex-1 text-base">
              Continue <ChevronRightIcon size={18} />
            </button>
          ) : (
            <button type="submit" className="btn-primary min-h-12 flex-1 text-base" disabled={pending || !idempotencyKey} aria-busy={pending}>
              {pending ? "Sending..." : "Send booking request"}
            </button>
          )}
        </div>
      )}
      <p className="sr-only" aria-live="polite">{pending ? "Sending your booking request" : ""}</p>
    </form>
  );
}

/** The DOM id that receives focus for a field name (the event picker has two inputs). */
function fieldElementId(name: string, hasEvents: boolean): string {
  if (name === "event_id" || name === "event_name") return hasEvents ? "f-event_id" : "f-event_name";
  if (name === "wants") return "f-wants";
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
    if (!services.length) return <p className="rounded-xl bg-page px-4 py-3 text-sm text-muted">This type of coverage is quoted individually. We send a price after reviewing your request.</p>;
    return (
      <Wrap field={field} error={error} htmlFor={id}>
        <select id={id} className="input" value={values[field.name] ?? ""} onChange={(e) => setValue(field.name, e.target.value)} {...a11y}>
          <option value="">Not sure yet, advise me</option>
          {services.map((s) => (
            <option key={s.id} value={s.id}>{s.name}: {s.price_qr === null ? "quote" : formatQr(Number(s.price_qr))}</option>
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
              <label key={o.value} className={cn("flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2", on ? "border-primary bg-lightblue" : "border-line bg-white")}>
                <input id={i === 0 ? id : undefined} type="checkbox" checked={on} onChange={(e) => setValue(o.value, e.target.checked ? "1" : "")} className="h-5 w-5 accent-primary" aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} />
                <span className="text-sm font-semibold text-ink">{o.label}</span>
              </label>
            );
          })}
        </div>
        {error ? <p className="mt-1 text-xs font-semibold text-danger" role="alert" id={`${id}-error`}>{error}</p> : field.hint ? <p className="hint">{field.hint}</p> : null}
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

function Review({ type, kind, steps, values, events, services, onEdit }: { type: BookingType; kind: ServiceKind; steps: PublicStep[]; values: Values; events: PublicEventOption[]; services: PublicServiceOption[]; onEdit: (step: number) => void }) {
  const display = (f: PublicField): string | null => {
    if (!fieldVisible(f, values)) return null;
    if (f.kind === "event") {
      const ev = values.event_id && values.event_id !== "other" ? events.find((e) => e.id === values.event_id) : null;
      return ev ? ev.name : (values.event_name ?? "").trim() || null;
    }
    if (f.kind === "service") {
      const s = values.service_id ? services.find((x) => x.id === values.service_id) : null;
      return s ? `${s.name}: ${s.price_qr === null ? "quote" : formatQr(Number(s.price_qr))}` : services.some((x) => x.booking_type === type) ? "Not sure yet, advise me" : null;
    }
    if (f.kind === "checkbox") {
      const on = (f.options ?? []).filter((o) => values[o.value] === "1").map((o) => o.label);
      return on.length ? on.join(" + ") : null;
    }
    if (f.kind === "consent") return values[f.name] === "1" ? "Yes" : null;
    const v = (values[f.name] ?? "").trim();
    if (!v) return null;
    if (f.kind === "radio" || f.kind === "select") return f.options?.find((o) => o.value === v)?.label ?? v;
    if (f.kind === "date") return formatEventDate(v, "long");
    return v;
  };
  return (
    <div className="space-y-4">
      <div className="card p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-bold text-ink">Service</p>
          <button type="button" className="min-h-8 text-sm font-semibold text-primary" onClick={() => onEdit(0)}>Change</button>
        </div>
        <p className="mt-1 text-base text-ink">{serviceKindInfo(kind).title}</p>
        <p className="text-xs text-muted">{BOOKING_TYPE_LABEL[type]}</p>
      </div>
      {steps.map((s, i) => (
        <div key={s.key} className="card p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-bold text-ink">{s.title}</p>
            <button type="button" className="min-h-8 text-sm font-semibold text-primary" onClick={() => onEdit(i + 1)}>Edit</button>
          </div>
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
        <li className="flex items-start gap-2"><CheckIcon size={16} className="mt-0.5 shrink-0 text-success" /> You get a reference straight away; we confirm within 24 hours.</li>
        <li className="flex items-start gap-2"><CheckIcon size={16} className="mt-0.5 shrink-0 text-success" /> After confirmation you sign the agreement and pay the 50% deposit online. The remaining 50% is due after delivery.</li>
      </ul>
    </div>
  );
}
