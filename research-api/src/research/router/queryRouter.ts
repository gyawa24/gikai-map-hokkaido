import type {
  PolicySourceAdapter,
  PolicySourceDocument,
  ResearchSearchQuery,
  SourceType,
} from "../types.js";

export interface QueryRoute {
  adapters: PolicySourceAdapter[];
  searchedSourceTypes: SourceType[];
  unavailableSourceTypes: SourceType[];
}

export interface RoutedSearchResult extends Omit<QueryRoute, "adapters"> {
  documents: PolicySourceDocument[];
}

function uniqueSourceTypes(values: readonly SourceType[]): SourceType[] {
  return Array.from(new Set(values));
}

export class QueryRouter {
  constructor(private readonly adapters: readonly PolicySourceAdapter[]) {}

  route(query: ResearchSearchQuery): QueryRoute {
    const requested = uniqueSourceTypes(
      query.sourceTypes?.length ? query.sourceTypes : ["plenary_minutes"],
    );
    const selected = this.adapters.filter((adapter) =>
      adapter.sourceTypes.some((type) => requested.includes(type)),
    );
    const available = new Set(selected.flatMap((adapter) => adapter.sourceTypes));
    return {
      adapters: selected,
      searchedSourceTypes: requested.filter((type) => available.has(type)),
      unavailableSourceTypes: requested.filter((type) => !available.has(type)),
    };
  }

  async search(query: ResearchSearchQuery): Promise<RoutedSearchResult> {
    const route = this.route(query);
    const documents = (
      await Promise.all(route.adapters.map((adapter) => adapter.search(query)))
    ).flat();
    return {
      documents,
      searchedSourceTypes: route.searchedSourceTypes,
      unavailableSourceTypes: route.unavailableSourceTypes,
    };
  }
}
