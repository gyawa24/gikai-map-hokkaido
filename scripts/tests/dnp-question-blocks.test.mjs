import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "../..");
const CITY = "dnp-question-block-fixture";

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function runNode(root, script, ...args) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

function question(minuteId, title, text) {
  return { minute_id: minuteId, minute_type: "◆質問", title, text: `◆${title}　${text}` };
}

function chair(minuteId, text) {
  return { minute_id: minuteId, minute_type: "○議長", title: "議長（議長太郎）", text: `○議長（議長太郎）　${text}` };
}

test("DNP question blocks keep boundaries and never merge former members by surname prefix", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dnp-question-block-test-"));
  try {
    fs.mkdirSync(path.join(tempRoot, "scripts"), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, "site", "scripts"), { recursive: true });
    fs.copyFileSync(
      path.join(REPO_ROOT, "scripts", "verify-member-activity.mjs"),
      path.join(tempRoot, "scripts", "verify-member-activity.mjs")
    );
    fs.copyFileSync(
      path.join(REPO_ROOT, "site", "scripts", "build-member-activity.mjs"),
      path.join(tempRoot, "site", "scripts", "build-member-activity.mjs")
    );

    writeJson(path.join(tempRoot, "data", "municipalities.json"), [
      { slug: CITY, name: "DNP質問ブロックfixture", system: "dnp" },
    ]);
    writeJson(path.join(tempRoot, "data", CITY, "members.json"), [
      { seat_number: 1, name: "山田 太郎" },
      { seat_number: 2, name: "佐藤 花子" },
      { seat_number: 3, name: "鈴木 次郎" },
      { seat_number: 4, name: "佐藤 次郎" },
      { seat_number: 5, name: "沼﨑 雅之" },
      { seat_number: 6, name: "議長 太郎" },
    ]);
    writeJson(path.join(tempRoot, "data", CITY, "minutes", "index.json"), [
      {
        council_id: 1,
        name: "令和 ８年 第２回 定例会",
        year: "2026",
        file: "1.json",
        schedule_count: 7,
      },
      {
        council_id: 2,
        name: "令和 ８年 ５月臨時会",
        year: "2026",
        file: "2.json",
        schedule_count: 1,
      },
      {
        council_id: 3,
        name: "令和 ８年 第３回定例会",
        year: "2026",
        file: "3.json",
        schedule_count: 1,
      },
    ]);
    writeJson(path.join(tempRoot, "data", CITY, "minutes", "1.json"), {
      council_id: 1,
      name: "令和 ８年 第２回 定例会",
      year: "2026",
      schedules: [
        {
          schedule_id: 1,
          name: "06月10日－01号",
          minutes: [
            { minute_id: 1, minute_type: "名簿", title: "（名簿）", text: "令和8年第2回定例会" },
            { minute_id: 2, minute_type: "△議題", title: "一般質問", text: "△一般質問" },
            chair(3, "日程第1、一般質問を行います。1、市政について。以上、山田議員。"),
            question(4, "1番（山田太郎議員）", "初めに、自己紹介をさせていただきます。"),
            question(5, "1番（山田太郎議員）", "市政運営の考えを伺います。"),
            { minute_id: 6, minute_type: "◎答弁", title: "市長", text: "◎市長　お答えします。" },
            chair(7, "これをもちまして、山田議員の一般質問は終了いたしました。"),
            chair(8, "先ほどの山田議員の一般質問について、訂正を許可します。山田議員。"),
            question(9, "1番（山田太郎議員）", "先ほどの発言を訂正いたします。"),
            chair(10, "次に、佐藤議員。"),
            question(11, "2番（佐藤花子議員）", "初めに、自己紹介をいたします。"),
            question(12, "2番（佐藤花子議員）", "教育行政についてお尋ねします。"),
            { minute_id: 13, minute_type: "△議題", title: "発言の訂正", text: "△発言の訂正" },
            chair(14, "佐藤議員の発言の訂正を許可します。"),
            { minute_id: 15, minute_type: "△議題", title: "一般質問（続行）", text: "△一般質問（続行）" },
            question(16, "2番（佐藤花子議員）", "続いて、教育環境について伺います。"),
            chair(17, "これをもちまして、佐藤議員の質疑を終了しました。"),
            chair(18, "以上で、本日予定の一般質問は全て終了しました。"),
          ],
        },
        {
          schedule_id: 2,
          name: "06月11日－02号",
          minutes: [
            { minute_id: 1, minute_type: "△議題", title: "一般質問", text: "△一般質問" },
            chair(2, "休憩前に引き続き、一般質問を続行いたします。"),
            chair(3, "旧田議員の質問を許します。旧田議員。"),
            question(4, "3番議員（鈴木次郎）", "この際、動議を提出いたします。"),
            chair(5, "以上で、旧田議員の一般質問は終了いたしました。鈴木次郎議員の質問を許します。鈴木次郎議員。"),
            question(6, "3番議員（鈴木次郎）", "議会運営委員会を開催したので、その結果を報告いたします。"),
            question(7, "3番議員（鈴木次郎）", "まちづくりについて伺います。"),
            chair(8, "以上で、鈴木次郎議員の一般質問は終了いたしました。山田太郎議員の質問を許します。山田太郎議員。"),
            question(9, "1番議員（山田太郎）", "防災対策についてお聞きします。"),
            chair(10, "以上で、山田太郎議員の個人質問は終わりました。"),
            chair(11, "以上で、一般質問を終了いたします。"),
          ],
        },
        {
          schedule_id: 3,
          name: "06月12日－03号",
          minutes: [
            { minute_id: 1, minute_type: "△議題", title: "代表質問", text: "△代表質問" },
            chair(2, "代表質問を行います。佐藤花子議員の質問を許可します。"),
            question(3, "2番議員（佐藤花子）", "会派を代表して市長の所見を伺います。"),
            chair(4, "佐藤花子議員の質問が了しました。以上をもって、代表質問を終結いたします。"),
          ],
        },
        {
          schedule_id: 4,
          name: "06月13日－04号",
          minutes: [
            { minute_id: 1, minute_type: "△議題", title: "一般質問", text: "△一般質問" },
            chair(2, "一般質問を続行いたします。"),
            question(3, "（佐藤旧人議員）", "公共交通について伺います。"),
            { minute_id: 4, minute_type: "◎答弁", title: "市長", text: "◎市長　お答えします。" },
            question(5, "（山田太郎議員）", "地域防災について伺います。"),
            chair(6, "以上で、１番の質問を終わります。これをもちまして、一般質問を終結いたします。"),
          ],
        },
        {
          schedule_id: 5,
          name: "06月16日－05号",
          minutes: [
            { minute_id: 1, minute_type: "△議題", title: "一般質問", text: "△一般質問" },
            chair(2, "一般質問を続行いたします。佐藤花子議員の質問を許可します。佐藤花子議員。"),
            question(3, "2番議員（佐藤花子）", "公共交通について伺います。"),
            chair(4, "この場合、暫時休憩いたします。"),
            chair(5, "休憩前に引き続き、一般質問を続行いたします。山田太郎議員の質問を許可します。山田太郎議員。"),
            question(6, "1番議員（山田太郎）", "防災体制について伺います。"),
            chair(7, "山田太郎議員の発言は終わりました。"),
            chair(8, "以上で、一般質問を終了いたします。"),
          ],
        },
        {
          schedule_id: 6,
          name: "06月17日－06号",
          minutes: [
            { minute_id: 1, minute_type: "△議題", title: "代表質問", text: "△代表質問" },
            question(2, "3番議員（鈴木次郎）", "会派を代表して施政方針を伺います。"),
            chair(3, "これをもちまして、鈴木次郎議員の再質問は終了しました。"),
            chair(4, "以上で、代表質問を終了いたします。"),
          ],
        },
        {
          schedule_id: 7,
          name: "06月18日－07号",
          minutes: [
            { minute_id: 1, minute_type: "△議題", title: "一般質問", text: "△一般質問" },
            question(2, "5番議員（沼﨑雅之）", "防災行政について伺います。"),
            chair(3, "これにて、沼﨑君一般質問を終わりました。"),
            chair(4, "以上で、一般質問を終了いたします。"),
          ],
        },
      ],
    });
    writeJson(path.join(tempRoot, "data", CITY, "minutes", "2.json"), {
      council_id: 2,
      name: "令和 ８年 ５月臨時会",
      year: "2026",
      schedules: [
        {
          schedule_id: 1,
          name: "05月01日－01号",
          minutes: [
            question(10, "（佐藤花子議員）", "補正予算について質疑します。"),
            question(20, "（佐藤旧人議員）", "公共交通について質疑します。"),
            question(25, "（鈴木旧人議員）", "福祉施策について質疑します。"),
            question(30, "（山田太郎議員）", "防災対策について質疑します。"),
            question(40, "（佐藤次郎議員）", "地域交通について質疑します。"),
            question(41, "（佐藤次郎議員）", "先ほどの説明により最初の質問は取り消します。ただ、追加支援の考えを伺います。"),
            question(42, "（佐藤次郎議員）", "予算計上は誤りだったとのことですが、原因をお聞きします。"),
            question(43, "（佐藤次郎議員）", "先ほど説明を受けましたので、この質問は却下します。"),
            question(44, "（佐藤次郎議員）", "先ほどの発言を訂正いたします。"),
            question(45, "（佐藤次郎議員）", "聞き違いでしたら訂正いたしますけども、耐用年数を教えていただければと思います。"),
          ],
        },
      ],
    });
    writeJson(path.join(tempRoot, "data", CITY, "minutes", "3.json"), {
      council_id: 3,
      name: "令和 ８年 第３回定例会",
      year: "2026",
      schedules: [
        {
          schedule_id: 1,
          name: "09月01日－01号",
          minutes: [
            chair(1, "質疑終結いたしました。第３款民生費、質疑に付します。山田太郎議員。"),
            question(2, "1番議員（山田太郎）", "物価高騰支援金給付事業と、DV被害者への給付対応について質疑します。"),
            question(3, "1番議員（山田太郎）", "質問があります。対象世帯数をお聞かせください。以上です。"),
            { minute_id: 4, minute_type: "◎答弁", title: "福祉部長", text: "◎福祉部長　お答えします。" },
            question(5, "1番議員（山田太郎）", "よろしく頼みます。以上です。"),
            chair(6, "この場合、暫時休憩いたします。"),
            chair(7, "休憩前に引き続き、同款について質疑を続行いたします。山田太郎議員。"),
            question(8, "1番議員（山田太郎）", "追加の支援対象について質疑します。"),
            question(9, "1番議員（山田太郎）", "以上で、終わります。ありがとうございました。"),
            chair(10, "質疑終結いたしました。第４款環境衛生費について、質疑を続行いたします。佐藤花子議員。"),
            question(11, "2番議員（佐藤花子）", "妊産婦支援事業と産後ケア事業について質疑します。"),
            question(12, "2番議員（佐藤花子）", "質問はしません。でも、私はこの制度の方向に進んでいること自体は問題だと思いますし、何でもデジタルということについて問題を感じています。また別の機会にこの問題についてはしっかり改めて取り上げたいと思いますけれども、今回は制度が始まった背景を踏まえ、利用する市民の方が多いことは否定できない一方で、国の進め方には合意できないという意見だけを申し上げます。さらに、市民への丁寧な説明と慎重な制度運用が必要だという立場を改めて申し上げて、終わりたいと思います。"),
            question(13, "2番議員（佐藤花子）", "市民への丁寧な説明を要望として、私からの質疑を終えたいと思います。"),
            question(14, "2番議員（佐藤花子）", "理事者の考え方をお伺いして、私の質問を終わらせていただきたいと思います。"),
            chair(15, "答弁を求めます。市長。"),
            { minute_id: 16, minute_type: "◎答弁", title: "市長", text: "◎市長　お答えします。" },
            question(17, "2番議員（佐藤花子）", "質問はしませんけれども、新年度また新たに発生するということでしょうか。"),
            chair(18, "答弁を求めます。福祉部長。"),
            { minute_id: 19, minute_type: "◎答弁", title: "福祉部長", text: "◎福祉部長　お答えします。" },
            question(20, "2番議員（佐藤花子）", "どうもありがとうございました。私の質問は、これで終わります。以上です。"),
            chair(21, "質疑終結いたしました。"),
          ],
        },
      ],
    });
    writeJson(path.join(tempRoot, "data", CITY, "minutes", "enriched", "2.json"), {
      council_id: 2,
      name: "令和 ８年 ５月臨時会",
      questioners: [
        { name: "鈴木 次郎", topics: ["原文根拠のない補足"] },
      ],
    });
    writeJson(path.join(tempRoot, "data", CITY, "minutes", "enriched", "1.json"), {
      council_id: 1,
      name: "令和 ８年 第２回 定例会",
      questioners: [
        { name: "山田 太郎", topics: ["防災対策についてお聞きします"] },
      ],
    });
    writeJson(path.join(tempRoot, "data", CITY, "minutes", "enriched", "3.json"), {
      council_id: 3,
      name: "令和 ８年 第３回定例会",
      questioners: [
        {
          name: "山田 太郎",
          topics: ["物価高騰支援金給付事業と対象世帯", "DV被害者への給付対応"],
          ai_topics: ["根拠のないAI補足"],
        },
        {
          name: "佐藤 花子",
          topics: ["妊産婦支援事業", "産後ケア事業"],
          ai_topics: ["根拠のないAI補足"],
        },
      ],
    });
    writeJson(path.join(tempRoot, "data", CITY, "segments", "_index.json"), [
      { council_id: 1 },
      { council_id: 2 },
    ]);
    writeJson(path.join(tempRoot, "data", CITY, "segments", "1.json"), [
      {
        id: `${CITY}-1-2-009`,
        council_id: 1,
        council_name: "令和 ８年 第２回 定例会",
        date: "2026-06-11",
        speaker: "1番議員（山田太郎）",
        member_name: "山田 太郎",
        speaker_role: "質問",
        is_procedural: false,
        text: "防災対策",
        source: { schedule_id: 2, minute_ids: [9] },
      },
    ]);
    writeJson(path.join(tempRoot, "data", CITY, "segments", "2.json"), [
      {
        id: `${CITY}-2-1-001`,
        council_id: 2,
        council_name: "令和 ８年 ５月臨時会",
        date: "2026-05-01",
        speaker: "（佐藤花子議員）",
        member_name: "佐藤 花子",
        speaker_role: "質問",
        is_procedural: false,
        text: "補正予算について質疑します。",
        source: { schedule_id: 1, minute_ids: [10] },
      },
      {
        id: `${CITY}-2-1-002`,
        council_id: 2,
        council_name: "令和 ８年 ５月臨時会",
        date: "2026-05-01",
        speaker: "（佐藤旧人議員）",
        speaker_role: "質問",
        is_procedural: false,
        text: "公共交通について質疑します。",
        source: { schedule_id: 1, minute_ids: [20] },
      },
      {
        id: `${CITY}-2-1-003`,
        council_id: 2,
        council_name: "令和 ８年 ５月臨時会",
        date: "2026-05-01",
        speaker: "（鈴木旧人議員）",
        speaker_role: "質問",
        is_procedural: false,
        text: "福祉施策について質疑します。",
        source: { schedule_id: 1, minute_ids: [25] },
      },
      {
        id: `${CITY}-2-1-004`,
        council_id: 2,
        council_name: "令和 ８年 ５月臨時会",
        date: "2026-05-01",
        speaker: "（山田太郎議員）",
        member_name: "山田 太郎",
        speaker_role: "質問",
        is_procedural: false,
        text: "防災対策について質疑します。",
        source: { schedule_id: 1, minute_ids: [30] },
      },
      {
        id: `${CITY}-2-1-005`,
        council_id: 2,
        council_name: "令和 ８年 ５月臨時会",
        date: "2026-05-01",
        speaker: "（佐藤次郎議員）",
        member_name: "佐藤 次郎",
        speaker_role: "質問",
        is_procedural: false,
        text: "地域交通について質疑します。",
        source: { schedule_id: 1, minute_ids: [40] },
      },
      {
        id: `${CITY}-2-1-006`,
        council_id: 2,
        council_name: "令和 ８年 ５月臨時会",
        date: "2026-05-01",
        speaker: "（佐藤次郎議員）",
        member_name: "佐藤 次郎",
        speaker_role: "質問",
        is_procedural: false,
        text: "先ほどの説明により最初の質問は取り消します。ただ、追加支援の考えを伺います。",
        source: { schedule_id: 1, minute_ids: [41] },
      },
      {
        id: `${CITY}-2-1-007`,
        council_id: 2,
        council_name: "令和 ８年 ５月臨時会",
        date: "2026-05-01",
        speaker: "（佐藤次郎議員）",
        member_name: "佐藤 次郎",
        speaker_role: "質問",
        is_procedural: false,
        text: "予算計上は誤りだったとのことですが、原因をお聞きします。",
        source: { schedule_id: 1, minute_ids: [42] },
      },
      {
        id: `${CITY}-2-1-008`,
        council_id: 2,
        council_name: "令和 ８年 ５月臨時会",
        date: "2026-05-01",
        speaker: "（佐藤次郎議員）",
        member_name: "佐藤 次郎",
        speaker_role: "質問",
        is_procedural: false,
        text: "先ほど説明を受けましたので、この質問は却下します。",
        source: { schedule_id: 1, minute_ids: [43] },
      },
      {
        id: `${CITY}-2-1-009`,
        council_id: 2,
        council_name: "令和 ８年 ５月臨時会",
        date: "2026-05-01",
        speaker: "（佐藤次郎議員）",
        member_name: "佐藤 次郎",
        speaker_role: "質問",
        is_procedural: false,
        text: "先ほどの発言を訂正いたします。",
        source: { schedule_id: 1, minute_ids: [44] },
      },
      {
        id: `${CITY}-2-1-010`,
        council_id: 2,
        council_name: "令和 ８年 ５月臨時会",
        date: "2026-05-01",
        speaker: "（佐藤次郎議員）",
        member_name: "佐藤 次郎",
        speaker_role: "質問",
        is_procedural: false,
        text: "聞き違いでしたら訂正いたしますけども、耐用年数を教えていただければと思います。",
        source: { schedule_id: 1, minute_ids: [45] },
      },
    ]);

    runNode(tempRoot, "site/scripts/build-member-activity.mjs", "--city", CITY);
    const verifyOutput = runNode(tempRoot, "scripts/verify-member-activity.mjs", "--city", CITY);
    assert.match(verifyOutput, /12 expected official records \/ 9 declared personal endings/u);

    const activity = JSON.parse(
      fs.readFileSync(path.join(tempRoot, "data", CITY, "members_activity.json"), "utf8")
    );
    const records = Object.entries(activity).flatMap(([memberName, entry]) =>
      entry.sessions.map((record) => ({ ...record, memberName }))
    );
    assert.equal(records.length, 12);
    assert.ok(records.every((record) => record.topics.length <= 12));
    assert.ok(records.every((record) => (record.canonical_topics ?? []).length <= 24));
    assert.ok(Object.values(activity).every((entry) => entry.all_topics.length <= 80));
    assert.deepEqual(
      records.reduce((counts, record) => {
        counts[record.question_kind] = (counts[record.question_kind] ?? 0) + 1;
        return counts;
      }, {}),
      { general_question: 8, representative_question: 2, plenary_question: 2 }
    );
    assert.equal(activity["山田太郎"].classification_status, "classified");
    assert.equal(activity["鈴木次郎"].classification_status, "classified");
    assert.equal(activity["佐藤次郎"], undefined);

    const byId = new Map(records.map((record) => [record.record_id, record]));
    assert.equal(
      byId.has(`${CITY}:official:2:other_question:legacy-segments:佐藤次郎`),
      false
    );
    const prefix = `${CITY}:official:1`;
    const plenaryPrefix = `${CITY}:official:3`;
    const welfareRecord = byId.get(`${plenaryPrefix}:plenary_question:s1-m1:山田太郎`);
    assert.deepEqual(welfareRecord?.evidence_minute_ids, [2, 3, 8]);
    assert.equal(byId.has(`${plenaryPrefix}:plenary_question:s1-m7:山田太郎`), false);
    assert.deepEqual(welfareRecord?.canonical_topics, ["DV被害者への給付対応"]);
    assert.deepEqual(welfareRecord?.summary_topics.slice(0, 1), welfareRecord?.canonical_topics);
    assert.deepEqual(welfareRecord?.generated_topics, [
      "物価高騰支援金給付事業と対象世帯",
      "根拠のないAI補足",
    ]);
    assert.equal(welfareRecord?.summary_topics.includes("物価高騰支援金給付事業と対象世帯"), false);
    assert.equal(welfareRecord?.summary_topics.includes("根拠のないAI補足"), false);
    const maternityRecord = byId.get(`${plenaryPrefix}:plenary_question:s1-m10:佐藤花子`);
    assert.deepEqual(maternityRecord?.evidence_minute_ids, [11, 14, 17]);
    assert.deepEqual(maternityRecord?.canonical_topics, ["妊産婦支援事業", "産後ケア事業"]);
    assert.deepEqual(maternityRecord?.summary_topics.slice(0, 2), maternityRecord?.canonical_topics);
    assert.deepEqual(maternityRecord?.generated_topics, ["根拠のないAI補足"]);
    assert.equal(maternityRecord?.summary_topics.includes("根拠のないAI補足"), false);
    assert.deepEqual(
      byId.get(`${prefix}:general_question:s1-m4:山田太郎`)?.evidence_minute_ids,
      [5]
    );
    assert.deepEqual(
      byId.get(`${prefix}:general_question:s1-m11:佐藤花子`)?.evidence_minute_ids,
      [12, 16]
    );
    assert.deepEqual(
      byId.get(`${prefix}:general_question:s2-m5:鈴木次郎`)?.evidence_minute_ids,
      [7]
    );
    assert.equal(
      byId.get(`${prefix}:general_question:s2-m5:鈴木次郎`)?.closure_method,
      "chair_declaration"
    );
    assert.deepEqual(
      byId.get(`${prefix}:general_question:s2-m8:山田太郎`)?.evidence_minute_ids,
      [9]
    );
    assert.deepEqual(
      byId.get(`${prefix}:general_question:s2-m8:山田太郎`)?.canonical_topics,
      ["防災対策についてお聞きします"]
    );
    assert.deepEqual(
      byId.get(`${prefix}:representative_question:s3-m2:佐藤花子`)?.evidence_minute_ids,
      [3]
    );
    assert.deepEqual(
      byId.get(`${prefix}:general_question:s4-m5:山田太郎`)?.evidence_minute_ids,
      [5]
    );
    assert.deepEqual(
      byId.get(`${prefix}:general_question:s5-m2:佐藤花子`)?.evidence_minute_ids,
      [3]
    );
    assert.equal(
      byId.get(`${prefix}:general_question:s5-m2:佐藤花子`)?.closure_method,
      "next_question_marker"
    );
    assert.deepEqual(
      byId.get(`${prefix}:general_question:s5-m5:山田太郎`)?.evidence_minute_ids,
      [6]
    );
    assert.deepEqual(
      byId.get(`${prefix}:representative_question:s6-m2:鈴木次郎`)?.evidence_minute_ids,
      [2]
    );
    assert.deepEqual(
      byId.get(`${prefix}:general_question:s7-m2:沼﨑雅之`)?.evidence_minute_ids,
      [2]
    );
    assert.equal(byId.has(`${prefix}:general_question:s4-m3:佐藤花子`), false);
    assert.equal(
      byId.has(`${CITY}:official:2:other_question:legacy-segments:佐藤花子`),
      false
    );
    assert.equal(
      byId.has(`${CITY}:official:2:other_question:legacy-segments:山田太郎`),
      false
    );
    assert.equal(
      byId.has(`${CITY}:official:2:other_question:legacy-segments:鈴木次郎`),
      false
    );
    assert.equal(
      records.some((record) => record.schedule_id === 1 && record.marker_minute_id === 9),
      false
    );
    assert.equal(
      records.some((record) => record.schedule_id === 2 && record.evidence_minute_ids.includes(4)),
      false
    );
    assert.equal(
      records.some((record) => record.schedule_id === 2 && record.evidence_minute_ids.includes(6)),
      false
    );

    const forgedCanonical = structuredClone(activity);
    const forgedRecord = forgedCanonical["山田太郎"].sessions.find(
      (record) => record.record_id === `${plenaryPrefix}:plenary_question:s1-m1:山田太郎`
    );
    forgedRecord.canonical_topics = ["原文根拠のない生成テーマ"];
    forgedRecord.summary_topics = ["原文根拠のない生成テーマ", ...(forgedRecord.summary_topics ?? [])];
    writeJson(path.join(tempRoot, "data", CITY, "members_activity.json"), forgedCanonical);
    writeJson(path.join(tempRoot, "site", "data", CITY, "members_activity.json"), forgedCanonical);
    const invalidCanonical = spawnSync(
      process.execPath,
      ["scripts/verify-member-activity.mjs", "--city", CITY],
      { cwd: tempRoot, encoding: "utf8" }
    );
    assert.notEqual(invalidCanonical.status, 0);
    assert.match(
      `${invalidCanonical.stdout}\n${invalidCanonical.stderr}`,
      /canonical topic has no exact raw evidence/u
    );

    const noEvidence = structuredClone(activity);
    noEvidence["山田太郎"].sessions[0].evidence_minute_ids = [];
    noEvidence["山田太郎"].sessions[0].evidence_segment_ids = [];
    writeJson(path.join(tempRoot, "data", CITY, "members_activity.json"), noEvidence);
    writeJson(path.join(tempRoot, "site", "data", CITY, "members_activity.json"), noEvidence);
    const invalidEvidence = spawnSync(
      process.execPath,
      ["scripts/verify-member-activity.mjs", "--city", CITY],
      { cwd: tempRoot, encoding: "utf8" }
    );
    assert.notEqual(invalidEvidence.status, 0);
    assert.match(invalidEvidence.stderr, /official record has no raw evidence/u);

    activity["山田太郎"].sessions[0].href = `/${CITY}/minutes/999`;
    writeJson(path.join(tempRoot, "data", CITY, "members_activity.json"), activity);
    writeJson(path.join(tempRoot, "site", "data", CITY, "members_activity.json"), activity);
    const invalidHref = spawnSync(
      process.execPath,
      ["scripts/verify-member-activity.mjs", "--city", CITY],
      { cwd: tempRoot, encoding: "utf8" }
    );
    assert.notEqual(invalidHref.status, 0);
    assert.match(`${invalidHref.stdout}\n${invalidHref.stderr}`, /official href does not match council_id/u);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
