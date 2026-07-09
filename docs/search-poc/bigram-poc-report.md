# Bigram検索PoCレポート

生成日: 2026-07-09T06:37:37.788Z

## 対象

- 対象自治体: chitose (2.77 MB) / atsuma (1.72 MB) / eniwa (1.58 MB) / hidaka (1.29 MB) / kutchan (1.05 MB) / kushiro (1.02 MB) / ashibetsu (1016.3 KB) / tomakomai (356.4 KB)
- ドキュメント数: 14,243
- bigram語数: 88,596
- シャード数: 2,295

## サイズ

| 項目 | JSON | gzip |
|---|---:|---:|
| ドキュメントストア | 10.36 MB | 1.91 MB |
| postings全体 | 10.59 MB | 4.18 MB |
| 最大postingシャード | の / 354.7 KB | 137.1 KB |

## クエリ別の推定転送量

| クエリ | terms | 候補数 | posting shard gzip | 上位20件 payload gzip | 1位 |
|---|---:|---:|---:|---:|---|
| 除雪 | 1 | 81 | 1.4 KB | 11.8 KB | agenda: 千歳市 令和 ５年 第２回定例会補正予算特別委員会 ８ 令和５年度千歳市一般会計補正予算概要 議案第１号について、政策予算として、令和５年度千歳… |
| 防災 | 1 | 305 | 3.0 KB | 19.3 KB | agenda: 厚真町 令和 ３年 １１月 決算審査特別委員会 情報防災グループ所管（財産管理費～災害対策費） 総務課参事（情報防災）より説明 |
| 給食 | 1 | 190 | 3.0 KB | 27.4 KB | agenda: 釧路市 令和 ６年第３回 ６月定例会 日程第２ 意見書案第６号ゼロカーボン北海道の実現に資する森林・林業・木材産業施策の充実・強化を求める意見書… |
| 小川陽平 | 3 | 9 | 7.0 KB | 3.3 KB | member: 千歳市 小川 陽平 |
| スケート学習 | 5 | 3 | 153.8 KB | 1.2 KB | member_activity: 千歳市 小川陽平 令和 ７年 第３回定例会 |
| ラピダス | 3 | 61 | 40.1 KB | 7.3 KB | member_activity: 恵庭市 三上まどか 令和 ６年 予算審査特別委員会 |

## 正解台帳チェック

| ケース | 結果 | 期待 | 1位 |
|---|---|---|---|
| chitose-ogawa-compact-name-only | PASS | member / 小川 陽平 | member: 千歳市 小川 陽平 |
| chitose-ogawa-skate-learning | PASS | member_activity / 572 / 小川陽平 | member_activity: 千歳市 小川陽平 令和 ７年 第３回定例会 |
| chitose-ogawa-compact-name-skate-learning | PASS | member_activity / 572 / 小川陽平 | member_activity: 千歳市 小川陽平 令和 ７年 第３回定例会 |
| chitose-ogawa-snow-removal | PASS | member_activity / 571 / 小川陽平 | member_activity: 千歳市 小川陽平 令和 ７年 決算特別委員会 |
| chitose-agenda-snow-removal-budget | PASS | agenda / 571 | agenda: 千歳市 令和 ３年 予算特別委員会 ８ 令和３年度千歳市各会計予算大綱 令和３年度の予算案及び関連議案を提出するに当たり、その大綱につきましてご… |
| chitose-ogawa-school-lunch | PASS | member_activity / 567 / 小川陽平 | member_activity: 千歳市 小川陽平 令和 ７年 第２回定例会 |
| eniwa-mikami-rapidus-tax | PASS | member_activity / 237 / 三上まどか | member_activity: 恵庭市 三上まどか 令和 ６年 予算審査特別委員会 |
| eniwa-hase-childcare-staff | PASS | member_activity / 257 / 長谷文子 | member_activity: 恵庭市 長谷文子 令和 ７年 決算審査特別委員会 |
| eniwa-tourism-plan | PASS | agenda / 219 | agenda: 恵庭市 令和 ５年 第４回 定例会 一般質問 |
| eniwa-disaster-radio-contract | PASS | agenda / 183 | agenda: 恵庭市 令和 ３年 第３回 定例会 議案第６号 |
| eniwa-childcare-after-school-club | PASS | agenda / 177 | agenda: 恵庭市 令和 ３年 第２回 定例会 一般質問 |
| tomakomai-shikata-ai-system | PASS | member_activity / 280 / 志方光徳 | member_activity: 苫小牧市 志方光徳 令和 ７年 一般会計予算審査特別委員会 |
| tomakomai-shikata-skate-festival | PASS | member_activity / 262 / 志方光徳 | member_activity: 苫小牧市 志方光徳 令和 ６年 第６回定例会（６月） |
| tomakomai-yamada-maternity-care | PASS | member_activity / 277 / 山田隆子 | member_activity: 苫小牧市 山田隆子 令和 ７年 第１２回定例会（２月） |
| tomakomai-ono-dv-benefit | PASS | member_activity / 245 / 大野正和 | member_activity: 苫小牧市 大野正和 令和 ６年 第５回定例会（２月） |
| tomakomai-kamiyama-school-lunch | PASS | member_activity / 245 / 神山哲太郎 | member_activity: 苫小牧市 神山哲太郎 令和 ６年 第５回定例会（２月） |

## 判定

PoC対象では正解台帳 16/16 件が通り、クエリに必要なposting shardも最大 153.8 KB に収まった。市内検索から段階導入する価値がある。

## 次の作業

- 実装済みの市内検索bigram候補取得を、実機スマホと本番ログで継続確認する。
- 全道横断検索はまだ置き換えない。市別候補の合流設計を追加してから扱う。
- 実装前後は `search_quality_cases.json` の16件を必ず通す。千歳は実装中に追加ケースを増やす。

