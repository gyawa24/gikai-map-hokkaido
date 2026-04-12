import type { ComprehensivePlan, BasicGoal, Policy } from "@/types/comprehensivePlan";

/** タイトルから検索キーワード（4文字以上のチャンク）を抽出 */
export function extractKeywords(title: string): string[] {
  return title
    .split(/[のやと及び・、。（）\s]+/)
    .filter((c) => c.length >= 4)
    .sort((a, b) => b.length - a.length)
    .slice(0, 3);
}

export type PolicyTag = {
  policyId: number;
  policyTitle: string;
  goalId: number;
  goalTitle: string;
  score: number;
};

/**
 * メンバーのトピック・テーマから総合計画の施策をスコアリングして返す
 */
export function matchPoliciesToMember(
  topics: string[],
  themes: string[],
  plan: ComprehensivePlan,
  topN = 4
): PolicyTag[] {
  const scores: Map<number, number> = new Map();
  const policyMap = new Map<number, { policy: Policy; goal: BasicGoal }>();

  for (const goal of plan.basic_goals) {
    for (const policy of goal.policies) {
      policyMap.set(policy.id, { policy, goal });
      scores.set(policy.id, 0);
    }
  }

  // トピックと施策名の文字列一致スコア（長いほど高スコア）
  for (const topic of topics) {
    const topicKws = extractKeywords(topic);
    for (const goal of plan.basic_goals) {
      for (const policy of goal.policies) {
        for (const kw of topicKws) {
          if (policy.title.includes(kw) || topic.includes(kw)) {
            scores.set(policy.id, (scores.get(policy.id) ?? 0) + kw.length);
          }
        }
        // 直接部分一致（4文字以上）
        const policyKws = extractKeywords(policy.title);
        for (const kw of policyKws) {
          if (topic.includes(kw)) {
            scores.set(policy.id, (scores.get(policy.id) ?? 0) + kw.length * 2);
          }
        }
      }
    }
  }

  // テーマとの基本目標レベルの照合（低スコア）
  const THEME_GOAL_MAP: Record<string, number[]> = {
    "観光・交流": [5], "産業・経済": [5], "農業": [5], "企業誘致": [5],
    "教育": [4], "文化": [4], "スポーツ": [4],
    "防災・安全": [3], "消防": [3], "交通安全": [3],
    "福祉": [1], "医療": [1], "子育て": [1], "高齢者": [1],
    "環境": [2], "ごみ": [2],
    "道路・インフラ": [6], "交通": [6], "住宅": [6],
    "まちづくり": [7, 6], "行政": [7], "財政・予算": [7],
  };
  for (const theme of themes) {
    for (const [key, goalIds] of Object.entries(THEME_GOAL_MAP)) {
      if (theme.includes(key) || key.includes(theme.split("・")[0])) {
        for (const gid of goalIds) {
          const goal = plan.basic_goals.find((g) => g.id === gid);
          if (goal) {
            for (const policy of goal.policies) {
              scores.set(policy.id, (scores.get(policy.id) ?? 0) + 2);
            }
          }
        }
      }
    }
  }

  return [...scores.entries()]
    .filter(([, s]) => s > 0)
    .sort(([, a], [, b]) => b - a)
    .slice(0, topN)
    .map(([id, score]) => {
      const { policy, goal } = policyMap.get(id)!;
      return { policyId: id, policyTitle: policy.title, goalId: goal.id, goalTitle: goal.title, score };
    });
}

export type ExcerptItem = {
  councilId: number;
  sessionName: string;
  speakerName: string;
  text: string;
};

/** 議事録テキストからキーワード周辺の抜粋を取得 */
function extractExcerpt(text: string, keyword: string, maxLen = 120): string | null {
  const idx = text.indexOf(keyword);
  if (idx === -1) return null;
  const start = Math.max(0, idx - 30);
  const end = Math.min(text.length, idx + keyword.length + 90);
  let excerpt = text.slice(start, end).replace(/\n+/g, " ").trim();
  if (start > 0) excerpt = "…" + excerpt;
  if (end < text.length) excerpt = excerpt + "…";
  return excerpt.slice(0, maxLen + 10);
}

/**
 * 全議事録から施策ごとの関連発言を抜粋する
 * Returns: Map<policyId, ExcerptItem[]>
 */
export function computePolicyExcerpts(
  plan: ComprehensivePlan,
  minutesFiles: { councilId: number; sessionName: string; data: unknown }[]
): Record<number, ExcerptItem[]> {
  const result: Record<number, ExcerptItem[]> = {};

  for (const goal of plan.basic_goals) {
    for (const policy of goal.policies) {
      result[policy.id] = [];
    }
  }

  for (const { councilId, sessionName, data } of minutesFiles) {
    // schedules > minutes > text + title(speaker)
    const raw = data as {
      schedules?: {
        minutes?: { text?: string; title?: string }[];
      }[];
    };
    if (!raw.schedules) continue;

    for (const schedule of raw.schedules) {
      if (!schedule.minutes) continue;
      for (const minute of schedule.minutes) {
        const text = minute.text ?? "";
        if (!text || text.length < 20) continue;
        const speakerMatch = text.match(/^[◆○△◇●](.+?)[\s　]/);
        const speakerName = speakerMatch?.[1] ?? "";

        for (const goal of plan.basic_goals) {
          for (const policy of goal.policies) {
            if ((result[policy.id]?.length ?? 0) >= 3) continue;
            const kws = extractKeywords(policy.title);
            for (const kw of kws) {
              if (!text.includes(kw)) continue;
              const excerpt = extractExcerpt(text, kw);
              if (!excerpt) continue;
              // 重複チェック（同セッションは1件まで）
              const already = result[policy.id]?.some((e) => e.councilId === councilId);
              if (!already) {
                result[policy.id] = [
                  ...(result[policy.id] ?? []),
                  { councilId, sessionName, speakerName, text: excerpt },
                ];
              }
              break;
            }
          }
        }
      }
    }
  }

  return result;
}
