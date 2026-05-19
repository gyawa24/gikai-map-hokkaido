import { notFound } from "next/navigation";
import { getMunicipality } from "@/lib/municipalities";

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
