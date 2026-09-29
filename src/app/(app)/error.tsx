"use client";

import { EmptyState } from "@/components/EmptyState";
import { AlertIcon } from "@/components/icons";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto max-w-lg px-4 py-16">
      <EmptyState
        icon={<AlertIcon />}
        title="Something went wrong"
        description={error.message || "The page could not be loaded."}
        action={<button type="button" className="btn-primary" onClick={reset}>Try again</button>}
      />
    </main>
  );
}
