import { absoluteUrl, SITE_NAME, SITE_URL } from "@/lib/metadata";

type BreadcrumbItem = {
  name: string;
  path: string;
};

export function buildBreadcrumbList(items: BreadcrumbItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

export function buildSiteStructuredData() {
  return [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: SITE_NAME,
      url: SITE_URL,
      logo: absoluteUrl("/icon.svg"),
      sameAs: [
        "https://github.com/gyawa24/gikai-map-hokkaido",
        "https://x.com/yoheiogawa_DPFP",
      ],
      email: "ogawayohei.hkd@gmail.com",
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: SITE_NAME,
      url: SITE_URL,
      inLanguage: "ja-JP",
    },
  ];
}
