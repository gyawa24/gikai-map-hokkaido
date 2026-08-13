import type {
  PolicySourceAdapter,
  PolicySourceDocument,
  ResearchSearchQuery,
  SourceType,
} from "../types.js";

abstract class FutureSourceAdapter implements PolicySourceAdapter {
  abstract readonly sourceTypes: SourceType[];

  async search(_query: ResearchSearchQuery): Promise<PolicySourceDocument[]> {
    return [];
  }
}

export class CommitteeMinutesAdapter extends FutureSourceAdapter {
  readonly sourceTypes: SourceType[] = ["committee_minutes"];
}

export class AdministrativePlanAdapter extends FutureSourceAdapter {
  readonly sourceTypes: SourceType[] = ["administrative_plan"];
}

export class BudgetAdapter extends FutureSourceAdapter {
  readonly sourceTypes: SourceType[] = ["budget"];
}

export class SettlementAdapter extends FutureSourceAdapter {
  readonly sourceTypes: SourceType[] = ["settlement"];
}

export class OrdinanceAdapter extends FutureSourceAdapter {
  readonly sourceTypes: SourceType[] = ["ordinance"];
}

export class StatisticsAdapter extends FutureSourceAdapter {
  readonly sourceTypes: SourceType[] = ["statistics"];
}
