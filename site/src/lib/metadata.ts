import type { Metadata } from "next";

export const SITE_URL = "https://chihougikai.com";
export const SITE_NAME = "地方議会ドットコム（β）";
export const DEFAULT_DESCRIPTION =
  "北海道内の市町村議会の議員情報・議事録・議決結果を横断的に公開する市民向け情報サイトです。（ベータ公開中）";
export const DEFAULT_OG_IMAGE = `${SITE_URL}/api/og-site`;

function fullTitle(title: string): string {
  return title === SITE_NAME ? title : `${title} | ${SITE_NAME}`;
}

export function absoluteUrl(path: string): string {
  return new URL(path, SITE_URL).toString();
}

type BuildPageMetadataInput = {
  title: string;
  description?: string;
  path: string;
  image?: string;
  type?: "website" | "article";
};

export function buildPageMetadata({
  title,
  description = DEFAULT_DESCRIPTION,
  path,
  image = DEFAULT_OG_IMAGE,
  type = "website",
}: BuildPageMetadataInput): Metadata {
  const url = absoluteUrl(path);
  const ogTitle = fullTitle(title);

  return {
    title,
    description,
    alternates: {
      canonical: path,
    },
    openGraph: {
      title: ogTitle,
      description,
      url,
      siteName: SITE_NAME,
      locale: "ja_JP",
      type,
      images: [
        {
          url: image,
          width: 1200,
          height: 630,
          alt: ogTitle,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: ogTitle,
      description,
      images: [image],
    },
  };
}

