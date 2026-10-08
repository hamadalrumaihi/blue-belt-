"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { FormError } from "@/components/FormField";
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";
import { submitPublicBooking, type PublicFormState } from "@/lib/actions/public";
import { CONSENT_TEXT, PUBLIC_BOOKING_TYPES, isPlausiblePhone, publicBookingFields, type PublicEventOption, type PublicField, type PublicServiceOption, type PublicStep } from "@/lib/bookings/public-form";
import { BOOKING_TYPE_LABEL, formatQr, isBookingType } from "@/lib/bookings/state";
import type { BookingType } from "@/lib/supabase/database.types";
import { cn, isValidEmail, isValidHttpUrl } from "@/lib/utils";
import { isValidCalendarDate } from "@/lib/validation";
import { formatEventDate } from "@/lib/time";

type Props = {
  events: PublicEventOption[];
  services: PublicServiceOption[];
  initialType: string | null;
  initialEventId: string | null;
  initialServiceId: string | null;
};

type Values = Record<string, string>;
type Errors = Record<string, string>;

const STEP_LABELS = ["What", "Details", "Contact", "Review"] as const;

/**
 * Four-step public booking form. All answers live in one state object so
 * Back never loses anything; only the review step posts (hidden inputs carry
 * every value), so the server sees one complete submission and validates it
 * with the same field definitions this component renders.
 */
export function BookingWizard({ events, services, initialType, initialEventId, initialServiceId }: Props) {
  const [type, setType] = useState<BookingType | null>(isBookingType(initialType) ? initialType : null);
  const [step, setStep] = useState(type ? 1 : 0);
  const [values, setValues] = useState<Values>(() => {
    const v: Values = {};
    if (initialEventId && events.some((e) => e.id === initialEventId)) v.event_id = initialEventId;
    if (initialServiceId && services.some((s) => s.id === initialServiceId && s.booking_type === initialType)) v.service_id = initialServiceId;
    return v;
  });
  const [errors, setErrors] = useState<Errors>({});
  const [consent, setConsent] = useState(false);
  const [state, formAction, pending] = useActionState<PublicFormState, FormData>(submitPublicBooking, null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [seenState, setSeenState] = useState<PublicFormState>(null);

  // Server-side field errors: show them and jump to the step that holds the first one.
  if (state !== seenState) {
    setSeenState(state);
    if (state?.fieldErrors && type) {
      setErrors(state.fieldErrors);
      const steps = publicBookingFields(type);
      const idx = steps.findIndex((s) => s.fields.some((f) => fieldNames(f).some((n) => n in state.fieldErrors!)));
      setStep(idx >= 0 ? idx + 1 : 3);
    }
  }

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: false });
  }, [step]);

  const steps: PublicStep[] = type ? publicBookingFields(type) : [];
  const current = step === 1 || step === 2 ? steps[step - 1] : null;
  const setValue = (name: string, v: string) => {
    setValues((prev) => ({ ...prev, [name]: v }));
    setErrors((prev) => {
      if (!prev[name]) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  };

  function pickType(t: BookingType) {
    setType(t);
    setErrors({});
    setStep(1);
  }

  function validateStep(s: PublicStep): Errors {
    const errs: Errors = {};
    for (const f of s.fields) {
      if (f.kind === "event") {
        const id = values.event_id ?? "";
        const name = (values.event_name ?? "").trim();
        if (f.required && !(id && id !== "other") && !name) errs.event_id = "Tell us which competition.";
        continue;
      }
      if (f.kind === "checkbox") {
        if (f.required && !(f.options ?? []).some((o) => values[o.value] === "1")) errs[f.name] = "Pick at least one.";
        continue;
      }
      if (f.kind === "service") {
        if (f.required && !values[f.name]) errs[f.name] = "Pick a package.";
        continue;
      }
      const v = (values[f.name] ?? "").trim();
      if (!v) {
        if (f.required) errs[f.name] = "Required.";
        continue;
      }
      if (f.max && v.length > f.max) errs[f.name] = `Keep this under ${f.max} characters.`;
      else if (f.kind === "email" && !isValidEmail(v)) errs[f.name] = "Enter a valid e-mail address.";
      else if (f.kind === "tel" && !isPlausiblePhone(v)) errs[f.name] = "Enter a phone number with at least 8 digits.";
      else if (f.kind === "date" && !isValidCalendarDate(v)) errs[f.name] = "Enter a real date.";
      else if (f.kind === "url" && !isValidHttpUrl(v)) errs[f.name] = "Enter a full link starting with https://";
      else if (f.kind === "number" && !/^\d+$/.test(v)) errs[f.name] = "Enter a whole number.";
    }
    if (type === "tournament_athlete" && s.key === "details" && values.booked_for && values.booked_for !== "self" && !(values.athlete_name ?? "").trim()) errs.athlete_name = "Enter the athlete's name.";
    return errs;
  }

  function next() {
    if (!current) return;
    const errs = validateStep(current);
    setErrors(errs);
    if (Object.keys(errs).length) {
      const first = Object.keys(errs)[0];
      document.getElementById(`f-${first}`)?.focus();
      return;
    }
    setStep((s) => Math.min(3, s + 1));
  }

  function back() {
    setErrors({});
    setStep((s) => Math.max(0, s - 1));
  }

  const stepTitle = step === 0 ? "What would you like to book?" : step === 3 ? "Review & send" : current?.title ?? "";

  return (
    <form
      action={formAction}
      className="relative"
      noValidate
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
      {step === 3 && <p className="mt-2 text-base text-muted">Check the details, agree to the terms and send. No payment is needed to book.</p>}

      <div className="mt-6 space-y-5">
        {step === 0 && (
          <ul className="grid gap-3" role="list">
            {PUBLIC_BOOKING_TYPES.map((t) => (
              <li key={t.value}>
                <button
                  type="button"
                  onClick={() => pickType(t.value)}
                  aria-pressed={type === t.value}
                  className={cn("card flex w-full items-center gap-4 p-4 text-left transition-colors hover:border-primary/50 sm:p-5", type === t.value && "border-primary bg-lightblue/40")}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-base font-extrabold text-ink">{t.title}</span>
                    <span className="mt-0.5 block text-sm text-muted">{t.body}</span>
                  </span>
                  <ChevronRightIcon className="shrink-0 text-muted" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {current && type && current.fields.map((f) => <FieldInput key={f.name} field={f} values={values} setValue={setValue} errors={errors} events={events} services={services.filter((s) => s.booking_type === type)} />)}

        {step === 3 && type && (
          <>
            <Review type={type} steps={steps} values={values} events={events} services={services} onEdit={(i) => setStep(i)} />
            {/* Everything the server needs travels as hidden fields; the visible inputs of earlier steps are unmounted. */}
            <input type="hidden" name="booking_type" value={type} />
            {Object.entries(values).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
            <div className="absolute -left-[9999px] top-0 h-0 w-0 overflow-hidden" aria-hidden>
              <label htmlFor="website">Website</label>
              <input id="website" name="website" tabIndex={-1} autoComplete="off" />
            </div>
            <div className="rounded-card border border-line bg-page p-4">
              <label className="flex min-h-11 items-start gap-3">
                <input id="f-consent" type="checkbox" name="consent" value="1" className="mt-1 h-5 w-5 shrink-0 accent-primary" checked={consent} onChange={(e) => setConsent(e.target.checked)} aria-invalid={Boolean(errors.consent)} aria-describedby={errors.consent ? "consent-error" : undefined} />
                <span className="text-sm text-ink">
                  {CONSENT_TEXT}. Read the <Link href="/terms" target="_blank" className="font-semibold text-primary">terms</Link> and <Link href="/privacy" target="_blank" className="font-semibold text-primary">privacy note</Link>.
                </span>
              </label>
              {errors.consent && <p id="consent-error" className="mt-1 text-xs font-semibold text-danger" role="alert">{errors.consent}</p>}
            </div>
            <FormError message={state?.error ?? errors.website ?? errors.booking_type} />
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
            <button type="submit" className="btn-primary min-h-12 flex-1 text-base" disabled={pending || !consent} aria-busy={pending}>
              {pending ? "Sending…" : "Send booking request"}
            </button>
          )}
        </div>
      )}
      <p className="sr-only" aria-live="polite">{pending ? "Sending your booking request" : ""}</p>
    </form>
  );
}

function fieldNames(f: PublicField): string[] {
  if (f.kind === "event") return ["event_id", "event_name"];
  if (f.kind === "checkbox") return [f.name, ...(f.options ?? []).map((o) => o.value)];
  return [f.name];
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
            <option value="">Choose a competition…</option>
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
    return (
      <fieldset>
        <legend className="label text-base">
          {field.label}
          {field.required && <span className="ml-0.5 text-danger" aria-hidden>*</span>}
        </legend>
        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label={field.label}>
          {(field.options ?? []).map((o, i) => {
            const on = values[field.name] === o.value;
            return (
              <label key={o.value} className={cn("flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2", on ? "border-primary bg-lightblue" : "border-line bg-white")}>
                <input id={i === 0 ? id : undefined} type="radio" name={`ui-${field.name}`} value={o.value} checked={on} onChange={() => setValue(field.name, o.value)} className="h-4 w-4 accent-primary" />
                <span className="text-sm font-semibold text-ink">{o.label}</span>
              </label>
            );
          })}
        </div>
        {error ? <p className="mt-1 text-xs font-semibold text-danger" role="alert">{error}</p> : field.hint ? <p className="hint">{field.hint}</p> : null}
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
                <input id={i === 0 ? id : undefined} type="checkbox" checked={on} onChange={(e) => setValue(o.value, e.target.checked ? "1" : "")} className="h-5 w-5 accent-primary" />
                <span className="text-sm font-semibold text-ink">{o.label}</span>
              </label>
            );
          })}
        </div>
        {error ? <p className="mt-1 text-xs font-semibold text-danger" role="alert">{error}</p> : field.hint ? <p className="hint">{field.hint}</p> : null}
      </fieldset>
    );
  }

  if (field.kind === "select") {
    return (
      <Wrap field={field} error={error} htmlFor={id}>
        <select id={id} className="input" value={values[field.name] ?? ""} onChange={(e) => setValue(field.name, e.target.value)} {...a11y}>
          <option value="">Choose…</option>
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

function Review({ type, steps, values, events, services, onEdit }: { type: BookingType; steps: PublicStep[]; values: Values; events: PublicEventOption[]; services: PublicServiceOption[]; onEdit: (step: number) => void }) {
  const display = (f: PublicField): string | null => {
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
          <p className="text-sm font-bold text-ink">Booking</p>
          <button type="button" className="text-sm font-semibold text-primary" onClick={() => onEdit(0)}>Change</button>
        </div>
        <p className="mt-1 text-base text-ink">{BOOKING_TYPE_LABEL[type]}</p>
      </div>
      {steps.map((s, i) => (
        <div key={s.key} className="card p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-bold text-ink">{s.title}</p>
            <button type="button" className="text-sm font-semibold text-primary" onClick={() => onEdit(i + 1)}>Edit</button>
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
        <li className="flex items-start gap-2"><CheckIcon size={16} className="mt-0.5 shrink-0 text-success" /> No payment is needed to book. After the shoot you pay online through MyFatoorah.</li>
      </ul>
    </div>
  );
}
