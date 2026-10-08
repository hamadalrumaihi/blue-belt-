"use client";

import { useRouter } from "next/navigation";
import { DeleteDialog } from "@/components/DeleteDialog";
import { deletePriceReference } from "@/lib/actions/pricing";

export function ReferenceRowActions({ id, provider }: { id: string; provider: string }) {
  const router = useRouter();
  return (
    <DeleteDialog
      trigger="Delete"
      triggerClassName="min-h-10"
      title="Delete reference price?"
      summary={<><strong>{provider}</strong> will be removed from your reference prices. Quotes already created keep their breakdown.</>}
      onConfirm={async () => {
        const r = await deletePriceReference(id);
        if (!r.ok) return { error: r.error };
        router.refresh();
        return null;
      }}
    />
  );
}
