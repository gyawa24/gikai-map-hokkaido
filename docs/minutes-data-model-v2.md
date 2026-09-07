# 議事録データモデル v2

## この文書の位置づけ

この文書は、北海道内179市町村へ議事録・質問履歴・検索を広げるためのデータ契約を定める。
対象は正式会議録だけでなく、PDF、HTML、議事録システムAPI、録画配信、YouTube字幕、ASR速報を含む。

v2は、既存の `structured-minutes` が持つ `SourceDocument`、`Speaker`、`Turn`、`QuestionBlock`、`TopicBlock`、`TopicSnippet` を核にする。会議と開催日、原典と改訂、正式版と速報、抽出と人手確認を区別する。将来は公開・移行条件を満たしたv2レコードを正本にするが、2026-09-07時点ではDNPの5会議とgijiroku.comの岩見沢799をローカルで試験しており、公開データの正本は切り替えていない。

この契約のJSON Schemaは `schemas/council-record.v2.schema.json` に置く。JSON Schemaで表現できない配列間の参照整合や公開条件は、同schemaの `x-referential-integrity` と本書の公開ゲートに従って専用validatorで検証する。

## 目的

- 自治体や議事録システムごとの違いを、画面や検索側へ漏らさない。
- 質問、答弁、要約、検索結果から公式原典の該当位置へ戻れるようにする。
- 同じ会議の速報と正式会議録を関連付け、正式版公開後も速報の来歴を失わない。
- 原典更新やparser変更の後に、古い要約・質問履歴・検索indexが残らないようにする。
- 現行URLと現行JSONを壊さず、自治体単位で段階的に移行できるようにする。

## 正本と派生層

データは次の4層に分ける。

### 1. 自治体・人物台帳

- `data/municipalities.json` を自治体メタデータの正とする。
- `data/{slug}/members.json` は人物同定の入力であり、氏名文字列だけを人物IDとして扱わない。
- 同一人物の任期をまたぐ活動は `person_id`、議会・任期内の所属は `membership_id` で区別する。未同定の発言者は無理に人物へ結び付けず、`Speaker` と照合状態を残す。

### 2. 原典・取得証跡層

- 公式API、HTML、PDF、動画、字幕、ASRなどを `SourceArtifact` として登録する。
- URLが同じでも内容が更新され得るため、取得した内容は不変の `SourceRevision` として管理する。
- 現行 `data/{slug}/minutes/` と `data/{slug}/sessions/` は、移行中は取得入力兼legacyデータとして維持する。これらの存在だけではv2正本になったとはみなさない。
- 取得失敗、未公開、アクセス拒否、空の公式資料、parse失敗を空文字やファイル欠落だけで表さない。

### 3. v2正本層

以下は移行後の目標配置であり、現在の生成先ではない。

```text
data/{slug}/structured-minutes/v2/{meeting_id}.json
```

1ファイルは一つの `Meeting` を表し、その中に複数の `Sitting` と原典、発言、質問、論点を持つ。大きすぎる会議をsitting単位に分割する場合も、同じ `record_id` とmanifestで一つの論理レコードとして扱う。

v2正本は少なくとも次を持つ。

- `Meeting`: 第何回定例会、臨時会、委員会などの会議単位。
- `Sitting`: その会議の開催日・日程単位。
- `SourceArtifact` / `SourceRevision`: 原典と取得時点の不変revision。
- `Speaker`: 原文上の発言者表記と人物照合結果。
- `Turn`: 発言単位の原文、発言順、原典位置。
- `DocumentItem` (`document_items`): 名簿・議題などの非発言記録。架空の発言者を付けず、Turnと共通の `order_index` で原順序を保持する。
- `QuestionBlock`: 一般質問等の質問者と質問・答弁のまとまり。
- `TopicBlock` / `TopicSnippet`: 論点と、その根拠となる原文断片。
- `Reconciliation`: 速報と正式版の照合状態。
- `Derivation`: 入力revision、parser、code revision、検証結果。
- `Publication`: 公開ゲートの判定結果。

### 4. 派生・互換層

移行後は次をv2から再生成可能なprojectionとする。現在の公開運用では既存generatorと `data/{slug}/` が継続して正であり、試験用v2からこれらを上書きしない。

- `data/{slug}/minutes/index.json` と `{council_id}.json`
- `data/{slug}/segments/`
- `data/{slug}/minutes/enriched/`
- `data/{slug}/members_activity.json`
- `data/{slug}/sessions/` の公開用index・要約
- `site/data/_search-index.json` と検索runtime index
- 現行 `site/data/structured-minutes/{slug}/{council_id}.json`

移行中はlegacy入力から生成したファイルも残る。各projectionにはv2の `record_id`、入力revision IDまたは入力hash、生成時刻、generator versionを持たせ、正本より古いprojectionを検出できるようにする。人手でprojectionだけを直さない。

## 会議・開催日の対応

現行の `council_id` は自治体内の外部IDまたは合成IDであり、開催日ではない。v2では次を分ける。

- `meeting_id`: 会議全体の安定ID。
- `sitting_id`: 開催日または日程の安定ID。
- `legacy_council_id`: 現行URL・現行JSONとの対応用ID。
- `legacy_schedule_id`: 現行scheduleとの対応用ID。
- `external_ids`: DNP、gijiroku.com、自治体独自システム等の外部ID。

日付は公式データまたは日程名に明記された年月日だけを採用する。`council_id`、配列順、ファイル名の連番から日付を推測しない。不明な日付はv2では `null` と `date_status: "unknown"` を使い、理由を `date_note` に残す。移行中のv1形式が文字列を要求する場合だけ空文字を使う。

## ID規則

### 共通規則

- IDは文字列とし、一度公開したIDを再利用・再採番しない。
- すべてのentity IDを自治体とentity種別でscopeする。
- 自治体IDは当面既存slugを使い、将来地方公共団体コードを追加してもslugとの対応を台帳に残す。
- title、氏名、日付、配列ordinalだけからIDを作らない。これらは訂正や再抽出で変化する。
- providerが安定IDを提供する場合はnamespace付きで保持する。提供しない場合はUUIDを一度採番してidentity mapへ保存する。

推奨例:

```text
chitose:meeting:dnp:578
chitose:sitting:dnp:578:2
chitose:source:dnp:578:2
chitose:turn:dnp:578:2:minute:184
chitose:question:01J...
```

`Turn` はproviderの不変なminute IDがあれば利用する。PDF、HTML、動画などprovider発言IDがない原典では、`SourceRevision` と原典位置から初回ID候補を作れるが、parser変更で位置が変わった場合に自動で別entityへ置き換えない。照合して同一発言なら既存IDを引き継ぎ、照合できなければ新IDと `supersedes` を記録する。

### legacy対応

v2の `legacy_ids` に `council_id`、`schedule_id`、`minute_id`、session ID等を保持する。legacy URLはこの対応を引いてv2を表示できるようにし、v2 IDを現行の数値IDへ無理に変換しない。

DNPのminute IDは日程内でscopeする。同じ番号の日程間再使用と欠番を保持する。会議名・年・日程名・`page_no`・minuteの `title` / `minute_type` など、互換出力に必要な値は型付き `legacy_presentation` に保存し、`legacy_ids` へ本文を詰めない。省略された値と `null`、空文字を互換投影で勝手に置換しない。

## SourceArtifactとSourceRevision

`SourceArtifact` は「千歳市公式会議録APIのある日程」「あるPDF」「ある録画配信ページ」など論理的な原典を表す。`SourceRevision` は特定時点で取得した内容を表す。

取得成功時のrevisionは次を必須とする。

- `revision_id`
- `observed_at` と `fetched_at`
- `retrieval_status`
- `parse_status`
- `content_sha256`
- MIME typeまたはsource kind
- snapshot pathまたは再取得可能なcontent URL
- parser名・versionは `Derivation` から追跡可能であること

HTTP status、ETag、Last-Modified、byte size、page count、OCR状態は取得できる範囲で持つ。取得できなかった場合は値を捏造せず、状態と理由を残す。

状態は少なくとも次を区別する。

```text
retrieval_status:
  discovered | fetched | not_published | unavailable | blocked | failed

parse_status:
  not_started | parsed | partial | needs_ocr | failed
```

同じURLを再取得してhashが変わった場合は新しいrevisionを追加し、古いrevisionを上書きしない。`current_revision_id` だけを新revisionへ進める。TurnやTopicは必ず参照したrevision IDを保持する。

## 発言と根拠位置

`Turn.text_original` は原典から抽出した文字列を保存し、AIで書き換えない。表記ゆれ調整や検索用空白除去は `text_normalized` に分ける。

各Turnは `source_span` に `source_artifact_id` と `source_revision_id` を必須で持ち、さらに次のいずれかで原典位置を示す。

- API/providerのminute ID
- PDFのページと文字範囲、可能ならbbox
- HTMLのDOM pathと文字範囲
- 保存済みraw textの開始・終了行
- 動画・音声の開始・終了時刻
- 文書全体に対する文字offset

TopicSnippetはTurn内の開始・終了offsetを持ち、`text_original` がTurnの該当substringと完全一致しなければならない。

非発言の空本文は `document_items` に `text_original: ""`、`text_status: "empty_in_source"` と `empty_reason` を保持する。本文がある場合は `text_status: "present"`、`empty_reason: null` とする。空の議題を削除したり、AIで本文やspeakerを補ったりしない。DNP取得bytesは加工せず保存し、本文抽出は既存scraperと同じ空白・タグ処理を照合する。人名・発言内容の修正や要約をこの処理へ混ぜない。

## 発言者・質問履歴

- 発言者の原文表記を `Speaker.name_original` に残す。
- 正規化名が一致しても自動的に同一人物と断定しない。
- 人物照合は `matched | candidate | unresolved | rejected` とし、method、confidence、候補を残す。
- 一般質問等の履歴は `QuestionBlock` を正とし、`members_activity.json` を正にしない。
- QuestionBlockは `questioner_speaker_id`、`sitting_id`、根拠Turn、質問種別、公開状態を持つ。
- AI生成のテーマ・要約はannotationとして生成元、model、prompt version、入力revisionを持ち、原文や手動確認済みテーマを上書きしない。

## 速報から正式版への照合

動画、YouTube字幕、ASR、手動速報は `authority: "official_stream"` または適切なauthorityと、`record_status: "provisional"` を持つ原典として登録する。速報だからといって正本外へ捨てず、原典revisionとTurnを保持する。

照合状態は次の順で扱う。

```text
unmatched -> candidate -> confirmed -> superseded
                         \-> rejected
```

- `unmatched`: 正式会議録が未公開、または候補を発見できていない。
- `candidate`: 自治体、会議名、日付、質問者、発言順等から候補を得たが未確認。
- `confirmed`: 外部IDの一致、十分強い本文照合、または人手確認で対応が確定。
- `superseded`: 公開表示の優先根拠を正式版へ移した。速報revision自体は削除しない。
- `rejected`: 候補が別会議・別発言と判明。

速報で先に公開した `question_id` は、正式版確認後も維持する。同一質問と確認できた場合は正式Turnを同じQuestionBlockの優先根拠にし、速報Turnを `evidence_variants` として残す。自動照合が曖昧なら `candidate` のままとし、正式版へ自動置換しない。

表示・検索では次を守る。

- `unmatched` / `candidate` は「速報・暫定文字起こし」と表示する。
- `confirmed` 後は正式会議録を優先表示し、速報への導線と来歴を残す。
- 速報のAI要約を正式原文の引用として扱わない。
- 正式版と速報の差異を検出した場合、正式版を優先しつつ差異をreview対象にする。

## reviewと公開ゲート

抽出methodとreview状態を分ける。`rule_based` で生成しただけのデータを `rule_based_with_manual_review` と記録しない。v2では人が確認した場合だけ `review.status: "reviewed"`、`reviewed_by`、`reviewed_at` を持つ。移行中のv1形式では同じ意味を既存の `review_status` に投影する。

v2レコードを公開可能にするには、少なくとも次をすべて満たす。

1. JSON Schema検証が成功している。
2. 全IDがレコード内で一意で、全参照先が存在する。
3. Meeting、Sitting、Turn、QuestionBlockの自治体・会議対応が一致する。
4. 公開するTurnとTopicにSourceRevisionと具体的なsource spanがある。
5. 取得成功したrevisionにcontent hashがあり、snapshotまたは公式content URLへ戻れる。
6. TopicSnippetがTurnの完全なsubstringである。
7. generatorの入力revisionと現在のsource revisionが一致し、派生データがstaleでない。
8. `needs_review` または `rejected` のTopicは `publication.public_visible: false` である。
9. 自動抽出Topicは既定で非公開とし、公開にはreview方針を満たす。
10. 速報は暫定であることを表示し、正式版との照合状態を持つ。

### PDF固有のゲート

PDFは段組み、欄外、ページ番号、表、OCR誤認識により文章順が崩れる。次のいずれかがある場合はTopicと質問履歴を自動公開しない。

- 左右段組みの混線を検出した。
- 発言者見出しが本文途中へ大量に混入した。
- ページ順・行順の単調性が崩れた。
- OCR confidenceや文字量が設定閾値を下回った。
- 質問・答弁の対応が発言順と矛盾する。
- 原典ページへ戻れない。

この場合も原典と抽出結果は削除せず、`parse_status: "partial"` またはreview warningを残す。

## validation

validationは次の層に分ける。

- schema: 型、必須項目、enum、日付・hash形式。
- graph: ID一意性、全参照、Meeting-Sitting-Source-Turn-Question-Topicの対応。
- provenance: source revision、snapshot、hash、source span、pipeline run。
- content: snippet一致、offset・page・line・time rangeの妥当性、空本文の理由。
- quality: 発言者認識率、質問答弁対応率、OCR品質、段組み混線、orphan text。
- freshness: source current revisionとderivation inputs、legacy projectionの生成元hash。
- publication: review状態、正式/速報表示、公開ゲート。

DNPとgijiroku.comの全文文書は実原典と合成fixtureで検証する。他のHTML、単段PDF、段組PDF、OCR PDF、録画/ASRのgolden fixtureとadapter別の検証は今後追加する。

## 段階移行

### 2026-08-23時点のlegacy投影改善

v2正本の全面実装に先立ち、現行投影には次の公開ゲートを適用した。

- `minutes/index.json` を公開会議のmanifestとして扱い、index外の会議JSONはURL直打ち、segments生成、質問履歴生成の対象にしない。
- 公開用 `site/data/{slug}/minutes/` へ同期するJSONは、`index.json`、indexが参照する会議本文、同じ会議IDのenriched projectionに限定する。収集側に調査・隔離目的のindex外JSONが残っていても公開用コピーへ再混入させない。
- `municipalities.json` で `minutes_access: "restricted"` の自治体は、会議一覧など本文を複製しない台帳情報だけを表示し、本文、enriched、structured minutes、質問履歴、テーマ、全文検索など議事録由来の派生表示を公開しない。この判定は検索生成、capability生成、UI、validatorで同じ台帳を参照する。
- legacy indexの日付は `start_date` / `end_date` / `sort_date` / `date_precision` に分離した。複数日にわたる会議の一覧順は最終開催日である `end_date` を `sort_date` に使い、表示名に含まれる日付を再解釈しない。`date_precision` は公式な開催日を確認できた `day` と、会議名の月までしか確認できない `month` を区別する。合成 `council_id`、会議種別、配列順から日付を作らず、日が確認できない場合は月精度または未取得のままにする。
- 年や本文品質が誤っている既存会議は削除せず、公開indexから外して `data/{slug}/quarantine/` に理由と原典を残す。
- 複数年度の日程が一つの会議JSONへ混入した場合は、本文冒頭の年と開催日の両方が公開年との不一致を示した日程だけを除外する。修復前JSONを `quarantine/minutes/year-mismatch/` に保存し、公式資料内の単純な年表記誤りや議案中の日付だけでは自動除外しない。
- PDFの「第N号」を「第N回会議」と誤認して複数会議を束ねた場合は、本文冒頭の公式会議名、種別、回次、開催日を全日程で確認できた自治体だけ分割する。修復前index・会議JSON、旧IDから新IDへの対応、原文payload hashを `quarantine/minutes/grouping-repair/` に保存し、発言本文は変更しない。
- segmentsの人物照合は現行議席番号から推測しない。原文の完全氏名、一意な姓、本文冒頭の明示氏名で確認できない場合は `member_name: null` とする。
- `members_activity.json` は質問ブロックと根拠minute/segment IDを持つ、表示用のbounded projectionとする。1記録の表示テーマ数と1議員の集約テーマ数には上限を設け、全文はminutes/segmentsへ残す。
- `canonical_topics` は、正規化したラベル全体がその質問ブロックの根拠minute/segment本文に含まれる場合だけ保持する。AIで整えたが原文に同じ表現がないラベルは `generated_topics` に分離し、公式原文由来のテーマとして扱わず、本文完全一致検索にも混ぜない。
- 画面でも `canonical_topics` は「原文で確認できる語句」、`generated_topics` は「AI整理テーマ（要原文確認）」として分け、generated labelを完全一致検索の根拠や公式見出しとして表示しない。
- 公開する質問履歴は、原文の質問境界と根拠minute/segment IDを独立validatorで再現できる `classified` レコードに限る。質問、討論、委員会報告等を区別できないlegacy segmentは `members_activity.json` へ投影せず、再分類できるよう原文segmentsを保持する。
- `data/{slug}/members_activity.json` を収集・編集側の正、`site/data/{slug}/members_activity.json` を同期コピーとする。公開時は議員単位の静的shardへ再投影し、人物ページの実行時バンドルへ自治体全員分の履歴を含めない。
- DNP会議録の終了宣言は共通parserと独立validatorで照合し、市町村名による分岐を置かない。

これはlegacy投影の誤公開と誤帰属を減らすための移行措置であり、v2完了を意味しない。現段階の質問ブロックには不変な `SourceRevision`、原典文字offset、人物の `person_id` / `membership_id` がまだ揃っていないため、`members_activity.json` を正本として扱わない。

同日の全公開index再監査では、仁木町・幌延町・妹背牛町の20会議から別年度の日程103件を公開対象外へ移し、平取町・陸別町・富良野市の14個の粗い会議JSONを37会議へ正規化した。修復後は公開会議に45日を超えて離れた日程を誤集約した例、および高確度な日程年不一致が0件であることを確認した。これらは原本削除ではなく、公開manifestと派生indexの修復である。

同日のread-only再生成比較では、segment差分対象62自治体のうち40自治体で、現行parserによる発言分割の変化がordinal依存segment IDをずらした。人物帰属だけを同じ発言へ再評価した結果は整合したが、全segmentsの一括再生成は既存の根拠IDを壊し得る。このため、v2の安定Turn IDとparser revision移行ができるまでは、公開manifest内の既存segmentへ外科的修復を適用し、構造再生成は自治体単位の差分監査を必須とする。

### 2026-09-07: DNP 5会議の内部試験まで実装

対象は千歳 `578`、恵庭 `265`、苫小牧 `298`、函館 `1362`、厚真 `433`。自治体名による分岐ではなくDNP adapterで、次の経路を実装した。再実行手順は [試験手順書](minutes-v2-pilot-runbook.md) を参照する。

```text
既存minutes + 自治体台帳
  → DNP APIのraw bytesを不変snapshotとして保存
  → 原典と既存minutesのID・順序・title・type・本文を完全照合
  → v2 (Turn + document_items)
  → Ajv 2020-12 + graph/content/provenanceのオフライン検証
  → legacy minutes互換投影の完全一致
  → reports内artifactをローカルpreviewで比較
```

- `scripts/build-dnp-council-record-v2.mjs` は新規取得、または既存capture manifestからのオフライン再生成に対応する。取得失敗や原典とlegacyの不一致で停止する。
- `scripts/validate-council-record-v2.mjs` は保存済みbytesを読み直す。recordの自己申告や呼出元のprovider本文mapだけで検証済みにせず、raw API bytesから本文・title・順序を再導出して照合する。`--strict` は未確認の証跡に関するwarningでも失敗する。
- `scripts/lib/council-record-v2-projection.mjs` はTurnとDocumentItemを日程内の共通 `order_index` で合成する。本文・旧ID・title・type・省略値を維持し、互換JSONの外に入力revision、record hash、出力hash、generator versionを記録する。
- `scripts/prepare-council-record-v2-preview.mjs` はmanifestを読み直して原典照合とvalidatorを再実行し、互換出力全体を既存minutesと完全比較してからpreview artifactを作る。公開index外・restricted自治体はサイトpreviewの対象にしない。
- 保存先は `reports/council-record-v2/` と `reports/council-record-v2-preview/`。いずれもGit管理対象外のローカル試験成果物で、`data/`・`site/data/` の正本や公開コピーへ昇格していない。
- `/{city}/minutes/{id}/preview` は `NODE_ENV=development` と `MINUTES_V2_PREVIEW_ROOT` の両方が必要。既存の議事録Readerで互換投影を表示し、通常URLと比較する。productionでは404になり、公開検索やMCPはこのartifactを読まない。
- `scripts/build-council-record-v2-segments-preview.mjs` はv2の互換minutesから既存segment parserを使って検索用データを生成する試験CLI。同じparserと人物台帳でlegacy minutesから再生成したbaselineとの完全一致を確認し、`reports/council-record-v2-segments-preview/` だけへ出力する。保存済み旧segmentsとの一致や、安定Turn IDへの移行完了を意味しない。

5自治体の試験結果は `reports/council-record-v2/dnp-five-municipality-trials.json` に記録し、計4,255原記録と1,907検索segmentsを照合した。千歳578では7日程、394原記録を271発言と123非発言へ分離し、全記録を完全に往復した。議長以外の発言種別は現段階では `unknown` を保ち、`◆質問` の表記だけで委員会報告等を一般質問へ分類しない。Speakerは発言ごとの観測IDで、人物同定は `unresolved`、`person_id` / `membership_id` は `null` のままである。

### 質問候補と一括オフライン実行

`scripts/prepare-council-record-v2-question-candidates.mjs` は原典ラベルと既存DNP質問境界parserから非公開候補を作る。`members.json` を人物同定の生成入力にせず、全候補は `review_status: "unreviewed"`、`identity_status: "unresolved"` のまま。v2正本のQuestionBlockは書き換えない。

千歳578の候補は9件（一般4・代表5）で、既存履歴の質問境界9件と一致した。候補に選ばれなかった `◆質問` 9発言は未分類一覧へ残し、委員長報告・訂正・未解決質問を「活動0」と解釈しない。既存履歴は比較専用で、候補生成の答えとして使わない。候補ID・根拠の重複を拒否し、baselineとの照合も一対一とする。baselineがなければbaseline件数・差分は `null`、比較未確認を明示する。

`scripts/run-council-record-v2-pilot.mjs --manifest <capture-manifest.json>` は保存済み原典からv2生成、minutes preview、segments preview、DNP質問候補を順に実行する。DNP5会議で一括試験を完了した。結果は `reports/council-record-v2-pilot-runs/` へ残し、各stageの実装hash・時刻・結果と失敗箇所を追える。`completed` は内部工程の終了であり、公開認証や人手review完了ではない。baseline差分なしでも人物同定・reviewは未完了である。

岩見沢799（gijiroku.com）の全文文書adapterも実装した。15個のraw HTMLレスポンス（一覧1・frameset7・本文7）から、目次を含む7個のDocumentItemを生成し、Turnは0件とした。厳格検証、legacy全fieldの完全一致、ローカル画面の目次・本文・病院事業検索・390px幅での表示を確認した。これは7開催日や発言0件の認定ではなく、既存7文書の容器を損失なく移した結果である。

`unit_kind: "document"`、開催日 `null` / `unknown` を保持し、source spanは抽出全文の文字範囲を指す。FINO・KGNO・UNID・HUIDと一覧/frameset/本文の対応をraw bytesから照合する。DNP質問抽出は適用せず、runnerの質問候補stageは `not_applicable`、比較判定は `null` となる。岩見沢はDNP5会議の集計とは別に扱う。

UI・segments・質問候補の各CLI入口では `assertCouncilRecordV2CaptureBinding` がrecordの原典URL、landing URL、provider ID、title、revisionの時刻・hash・snapshot pathを、登録自治体から検証したmanifest captureへ完全に結び付ける。validatorもURL内の識別子と日程・原典metadataの整合性を検証する。実799の誤URL・誤FINO負例と、各CLI入口の改変拒否を確認した。保存原典との結合が通っても公開認証ではない。

### 検証の意味と公開境界

`ok: true` は現在のvalidatorで矛盾が見つからなかったことを表す。人手確認、最新の公式内容、質問答弁の意味、OCR品質の認証ではない。

- 日付はDNP日程名の明示月日とlegacy会議年から組み立てる。暦日・期間・メタデータの整合性は確認するが、会議年や日付の公式な正しさを独立認証したとは扱わない。不明日付は `null` と理由を保持する。
- `freshness` はrecord内の `current_revision_id` と入力revision、生成・取得時刻の整合性を検証する。HTTP取得時刻の真実性や、取得後の公式サイト更新まではオフラインでは確認しない。
- hash一致は保存bytesと派生内容の一致であり、それだけで取得元の権威・review・最新版を認証しない。
- qualityや人手reviewなど未実施のgateは `not_applicable` 等で限界を示す。現在のvalidatorはpublic認証を対象外として拒否し、`publicationReady` を与えない。projectorのpublic modeもこの結果を迂回できない。
- 将来public modeを解禁する際にも、実validator、外部の現行revision、公開index内の本文hash、restricted判定、reviewを揃える。既存公開indexに本文hashがない場合は適合済みとみなさない。

### 公開済みlegacy改善との分離

公開済みのcommit `67da5c76` / PR #4は、自治体ナビ・議事録Reader・出典表示・公開index同期等のlegacy改善である。このDNP v2試験の公開完了を意味しない。legacy `structured-minutes` の読取可否や厳格監査も、新規v2の検証とは別に扱う。

v2試験は公開機能・公開データを変更していないため、`site/data/news.json` には追加しない。将来公開する際はその変更と同じ単位で公開内容を記録する。

### 次に残る作業

1. v2由来の検索segments試験の検証結果を揃え、保存済み既存segmentsとの対応・原文・安定ID・入力revisionを監査する。公開検索への切替は別作業とする。
2. 非公開質問候補をreviewし、QuestionBlock / TopicBlock / TopicSnippetへ移行する。現在のv2 recordではこれらとReconciliationは空配列であり、公開質問履歴、人物照合、任期をまたぐ履歴、速報と正式版の接続は未移行。
3. gijiroku.com全文文書から発言・質問を抽出する品質契約とfixtureを追加する。他のHTML、単段PDF、段組/OCR PDF、動画/ASRも取得・未確認状態を共通契約へ接続する。
4. 外部の現行revisionと再取得差分、parser更新時のID継承、日付根拠、人手review、公開認証を実装する。
5. 自治体単位でdual readとrollbackを確認した後に正本・標準同期を切り替える。GitHub Raw fallbackと動的読込を維持し、大量本文をWorker bundleへ戻さない。

現行generatorやlegacyデータを削除するのは、対象自治体の公開・同期・rollback条件を満たした後とする。

## 完了条件

### v2レコード単位

- schema、graph、provenance、content、freshness、publicationの全検証が通る。
- すべての公開Turn・QuestionBlock・TopicBlockから原典revisionの具体位置へ戻れる。
- 日付不明、取得失敗、parse失敗、速報、正式版を区別できる。
- review済みと自動抽出をデータ上で判別できる。
- 原典revisionが変わったとき、古い派生データを検出できる。

### 自治体単位

- minutes indexと本文、v2 meetingとsitting、projectionの件数差が説明可能である。
- 質問履歴に人物誤帰属がなく、各項目にQuestionBlockと原典根拠がある。
- 速報から正式版への照合状態が未処理のまま隠れない。
- `data/{slug}/` と公開用データの関係、同期手順、検証コマンド、rollback方法が明確である。
- 次回更新で同じ手順を再実行でき、手作業で派生JSONを直す必要がない。

### 全道展開

- 自治体固有コードではなくsource adapterと共通schemaで追加できる。
- 179市町村すべてについて、未対応、未公開、取得失敗、parse失敗、検証済みを同じ状態モデルで報告できる。
- 正本から質問履歴・検索・MCP用データを再生成できる。
- UIの都合で原典、氏名、発言内容を改変しない。
