import { getMinutesEnrichedDocs } from "@/lib/cityData";
import { getMunicipalities } from "@/lib/municipalities";
import { aliasesForTag, canonicalizeTag, isCitizenTopic, normalizeTopic, slugForTag } from "@/lib/topicAliases";
import type { MinutesEnriched } from "@/types/minutes";

export type EnrichedRecord = MinutesEnriched & {
  cityId: string;
  cityName: string;
};

export type TopicTag = {
  tag: string;
  slug: string;
  count: number;
  aliases: string[];
};

function recordKey(record: EnrichedRecord): string {
  return `${record.cityId}:${record.council_id}`;
}

function recordMatchesTag(record: EnrichedRecord, tag: string): boolean {
  const aliases = new Set(aliasesForTag(tag).map(normalizeTopic));
  return (record.tags ?? []).some((recordTag) => aliases.has(normalizeTopic(recordTag)));
}

function filterRecordsByTag(records: EnrichedRecord[], tag: string): EnrichedRecord[] {
  return records.filter((record) => recordMatchesTag(record, tag));
}

export function loadAllEnriched(): EnrichedRecord[] {
  const records: EnrichedRecord[] = [];

  for (const municipality of getMunicipalities().filter((m) => m.active)) {
    const cityId = municipality.slug;
    const cityName = municipality.name;
    for (const data of getMinutesEnrichedDocs(cityId)) {
      records.push({ ...data, cityId, cityName });
    }
  }

  return records;
}

export function getAllTags(): TopicTag[] {
  const all = loadAllEnriched();
  const buckets = new Map<string, { aliases: Set<string>; records: Set<string> }>();

  for (const record of all) {
    for (const tag of record.tags ?? []) {
      const canonical = canonicalizeTag(tag);
      const bucket = buckets.get(canonical) ?? { aliases: new Set<string>(), records: new Set<string>() };
      bucket.aliases.add(normalizeTopic(tag));
      bucket.records.add(recordKey(record));
      buckets.set(canonical, bucket);
    }
  }

  return Array.from(buckets.entries())
    .map(([tag, bucket]) => ({
      tag,
      slug: slugForTag(tag),
      count: bucket.records.size,
      aliases: aliasesForTag(tag).filter((alias) => alias === tag || bucket.aliases.has(alias)),
    }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "ja"));
}

export function getCitizenTopics(): TopicTag[] {
  return getAllTags().filter(({ tag }) => isCitizenTopic(tag));
}

export function getByTag(tag: string): EnrichedRecord[] {
  return filterRecordsByTag(loadAllEnriched(), tag);
}
