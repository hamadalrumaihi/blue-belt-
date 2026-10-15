import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { FAQ_ITEMS } from "@/lib/catalog/faq";
import { resolveViewer } from "@/lib/roles";
import { loadStudio } from "@/lib/studio/queries";
import { FAQ_CATEGORIES, FAQ_CATEGORY_LABEL, readFaqOverrides, readOpenQuestions } from "@/lib/studio/site-content";
import { AddFaq, FaqRow, OpenQuestionForm, OpenQuestionRow } from "./FaqEditor";

export const metadata: Metadata = { title: "FAQs & open questions" };
export const dynamic = "force-dynamic";

export default async function FaqsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await resolveViewer();
  if (viewer?.role !== "owner") redirect("/studio");
  const params = await searchParams;
  const prefill = typeof params.answer === "string" ? params.answer.slice(0, 200) : null;
  const studio = await loadStudio();
  const faqs = readFaqOverrides(studio?.settings);
  const questions = readOpenQuestions(studio?.settings);
  const open = questions.filter((q) => !q.resolved);
  const resolved = questions.filter((q) => q.resolved);
  return (
    <>
      <BrandHeader title="FAQs & open questions" subtitle="Your answers merge with the built-in FAQ on the website. Open questions stay private." backHref="/website" />
      <PageBody className="max-w-3xl space-y-6">
        <section className="space-y-3" aria-labelledby="faq-h" id="add-faq">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 id="faq-h" className="text-base font-bold text-ink">Your FAQ entries</h2>
              <p className="text-xs text-muted">{faqs.filter((f) => f.published).length} published · {faqs.length} stored. An entry whose id matches a built-in question replaces it; any other id is added to its category.</p>
            </div>
            <AddFaq prefill={prefill} knownIds={FAQ_ITEMS.map((f) => f.id)} />
          </div>
          {faqs.length === 0 ? <p className="card p-4 text-sm text-muted">No overrides yet. The website shows the built-in FAQ. Add an entry when a client keeps asking the same thing.</p> : (
            FAQ_CATEGORIES.filter((c) => faqs.some((f) => f.category === c)).map((c) => (
              <div key={c}>
                <h3 className="eyebrow mb-2">{FAQ_CATEGORY_LABEL[c]}</h3>
                <ul className="space-y-3">{faqs.filter((f) => f.category === c).map((f) => <FaqRow key={f.id} record={f} />)}</ul>
              </div>
            ))
          )}
        </section>

        <section className="card space-y-3 p-4" aria-labelledby="oq-h" id="open-questions">
          <div>
            <h2 id="oq-h" className="text-base font-bold text-ink">Open questions · {open.length}</h2>
            <p className="text-xs text-muted">Things visitors or clients asked that the website does not answer, or policies you have not decided. Private. Resolve one by answering it as an FAQ, or when the answer is settled.</p>
          </div>
          <OpenQuestionForm />
          {open.length === 0 ? <p className="text-sm text-muted">Nothing open.</p> : <ul className="divide-y divide-line">{open.map((q) => <OpenQuestionRow key={q.id} q={q} />)}</ul>}
          {resolved.length > 0 && (
            <details>
              <summary className="cursor-pointer text-xs font-semibold text-muted">{resolved.length} resolved</summary>
              <ul className="divide-y divide-line">{resolved.map((q) => <OpenQuestionRow key={q.id} q={q} />)}</ul>
            </details>
          )}
        </section>
      </PageBody>
    </>
  );
}
