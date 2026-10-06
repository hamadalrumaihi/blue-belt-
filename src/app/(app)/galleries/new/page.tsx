import type { Metadata } from "next";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { createGallery } from "@/lib/actions/galleries";
import { listBookingsForGalleryPicker } from "@/lib/galleries/queries";
import { isUuid } from "@/lib/validation";
import { GalleryForm } from "../GalleryForm";

export const metadata: Metadata = { title: "Add gallery" };
export const dynamic = "force-dynamic";

export default async function NewGalleryPage({ searchParams }: PageProps<"/galleries/new">) {
  const params = await searchParams;
  const bookings = await listBookingsForGalleryPicker();
  const defaultBookingId = isUuid(params.booking) ? params.booking : null;
  return (
    <>
      <BrandHeader title="Add gallery" subtitle="Record a Pic-Time gallery and who it is for" backHref="/galleries" />
      <PageBody className="max-w-2xl">
        <GalleryForm action={createGallery} bookings={bookings} defaultBookingId={defaultBookingId} submitLabel="Add gallery" />
      </PageBody>
    </>
  );
}
