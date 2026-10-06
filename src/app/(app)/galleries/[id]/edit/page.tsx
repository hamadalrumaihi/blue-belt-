import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { updateGallery } from "@/lib/actions/galleries";
import { getGallery, listBookingsForGalleryPicker } from "@/lib/galleries/queries";
import { GalleryForm } from "../../GalleryForm";

export const metadata: Metadata = { title: "Edit gallery" };
export const dynamic = "force-dynamic";

export default async function EditGalleryPage({ params }: PageProps<"/galleries/[id]/edit">) {
  const { id } = await params;
  const [detail, bookings] = await Promise.all([getGallery(id), listBookingsForGalleryPicker()]);
  if (!detail) notFound();
  const action = updateGallery.bind(null, id);
  return (
    <>
      <BrandHeader title="Edit gallery" subtitle={detail.gallery.name} backHref={`/galleries/${id}`} />
      <PageBody className="max-w-2xl">
        <GalleryForm action={action} bookings={bookings} initial={detail.gallery} submitLabel="Save changes" cancelHref={`/galleries/${id}`} />
      </PageBody>
    </>
  );
}
