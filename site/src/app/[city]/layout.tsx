import { notFound } from "next/navigation";
import { getMunicipalities, getMunicipality } from "@/lib/municipalities";

export async function generateStaticParams() {
  return getMunicipalities()
    .filter((m) => m.active)
    .map((m) => ({ city: m.slug }));
}

export default async function CityLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ city: string }>;
}) {
  const { city } = await params;
  const municipality = getMunicipality(city);
  if (!municipality) notFound();
  return <>{children}</>;
}
