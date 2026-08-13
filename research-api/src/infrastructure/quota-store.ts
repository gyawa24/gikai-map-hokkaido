import {
  DynamoDBClient,
  TransactWriteItemsCommand,
  type DynamoDBClientConfig,
} from "@aws-sdk/client-dynamodb";

export interface QuotaLimits {
  daily: number;
  monthly: number;
}

export interface QuotaStore {
  consume(now?: Date): Promise<boolean>;
}

type Counter = { count: number; expiresAt: number };

export class InMemoryQuotaStore implements QuotaStore {
  private readonly counters = new Map<string, Counter>();

  constructor(private readonly limits: QuotaLimits) {}

  async consume(now = new Date()): Promise<boolean> {
    const nowSeconds = Math.floor(now.getTime() / 1000);
    for (const [key, counter] of this.counters) {
      if (counter.expiresAt <= nowSeconds) this.counters.delete(key);
    }

    const dayKey = `day#${now.toISOString().slice(0, 10)}`;
    const monthKey = `month#${now.toISOString().slice(0, 7)}`;
    const day = this.counters.get(dayKey)?.count ?? 0;
    const month = this.counters.get(monthKey)?.count ?? 0;
    if (day >= this.limits.daily || month >= this.limits.monthly) return false;

    this.counters.set(dayKey, {
      count: day + 1,
      expiresAt: nowSeconds + 3 * 24 * 60 * 60,
    });
    this.counters.set(monthKey, {
      count: month + 1,
      expiresAt: nowSeconds + 62 * 24 * 60 * 60,
    });
    return true;
  }
}

export class DynamoDbQuotaStore implements QuotaStore {
  private readonly client: DynamoDBClient;

  constructor(
    private readonly tableName: string,
    private readonly limits: QuotaLimits,
    client?: DynamoDBClient,
    clientConfig: DynamoDBClientConfig = {},
  ) {
    this.client = client ?? new DynamoDBClient(clientConfig);
  }

  async consume(now = new Date()): Promise<boolean> {
    const nowSeconds = Math.floor(now.getTime() / 1000);
    const dayKey = `day#${now.toISOString().slice(0, 10)}`;
    const monthKey = `month#${now.toISOString().slice(0, 7)}`;

    try {
      await this.client.send(
        new TransactWriteItemsCommand({
          TransactItems: [
            this.counterUpdate(
              dayKey,
              this.limits.daily,
              nowSeconds + 3 * 24 * 60 * 60,
            ),
            this.counterUpdate(
              monthKey,
              this.limits.monthly,
              nowSeconds + 62 * 24 * 60 * 60,
            ),
          ],
        }),
      );
      return true;
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === "TransactionCanceledException" ||
          error.name === "ConditionalCheckFailedException")
      ) {
        return false;
      }
      throw error;
    }
  }

  private counterUpdate(key: string, limit: number, expiresAt: number) {
    return {
      Update: {
        TableName: this.tableName,
        Key: { quotaKey: { S: key } },
        UpdateExpression: "SET expiresAt = :expiresAt ADD requestCount :one",
        ConditionExpression:
          "attribute_not_exists(requestCount) OR requestCount < :limit",
        ExpressionAttributeValues: {
          ":expiresAt": { N: String(expiresAt) },
          ":one": { N: "1" },
          ":limit": { N: String(limit) },
        },
      },
    };
  }
}
