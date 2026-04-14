#!/bin/bash
# Super Whisperを使った議会音声 一括バッチ処理スクリプト
#
# 処理フロー:
#   YouTube URL → yt-dlp(音声) → [手動] Super Whisper(文字起こし) → import-superwhisper-db.mjs(要約) → JSON保存
#
# 使い方:
#   cd /Users/yohei/gikai-map-hokkaido
#   bash batch-superwhisper.sh
#
# 注意:
#   - Super Whisperが起動していること
#   - 各ファイルごとに「Super Whisperにドラッグしてください」と表示されます
#   - ドラッグ後は文字起こし完了を自動検知して次に進みます

set -e
cd /Users/yohei/gikai-map-hokkaido

SESSIONS=(
  "r8-teireikai1-day2-yosan1-20260309"
  "r8-teireikai1-day4-20260311"
  "r8-teireikai1-day6-20260313"
  "r8-yosan-6th-20260325"
)

YT_DLP="/opt/homebrew/bin/yt-dlp"
TMP_DIR="/Users/yohei/gikai-map-hokkaido/tmp_audio"
IMPORT_SCRIPT="site/scripts/import-superwhisper-db.mjs"
INDEX_FILE="data/chitose/sessions/index.json"
SW_DB="$HOME/Library/Application Support/SuperWhisper/database/superwhisper.sqlite"

# 完了を待つ最大時間（秒）— 4時間の音声は60〜120分目安
SW_TIMEOUT=7200
SW_POLL_INTERVAL=15

mkdir -p "$TMP_DIR"

echo "========================================"
echo "Super Whisper バッチ処理"
echo "対象: ${#SESSIONS[@]}セッション"
echo "========================================"

# Super Whisperの最新 rowid を取得
get_latest_sw_rowid() {
  sqlite3 "$SW_DB" "SELECT COALESCE(MAX(rowid), 0) FROM recording;" 2>/dev/null || echo "0"
}

# Super Whisperの処理完了を待つ
wait_for_sw_completion() {
  local before_rowid="$1"
  local elapsed=0

  while [ $elapsed -lt $SW_TIMEOUT ]; do
    sleep $SW_POLL_INTERVAL
    elapsed=$((elapsed + SW_POLL_INTERVAL))

    local latest_rowid
    latest_rowid=$(sqlite3 "$SW_DB" "SELECT COALESCE(MAX(rowid), 0) FROM recording;" 2>/dev/null || echo "0")

    if [ "$latest_rowid" -gt "$before_rowid" ] 2>/dev/null; then
      local wc dur
      wc=$(sqlite3 "$SW_DB" "SELECT rawWordCount FROM recording WHERE rowid = $latest_rowid;" 2>/dev/null || echo "0")
      dur=$(sqlite3 "$SW_DB" "SELECT duration FROM recording WHERE rowid = $latest_rowid;" 2>/dev/null || echo "0")

      # 60分(3600秒)未満の録音は議会音声ではないのでスキップ
      if [ "${wc:-0}" -gt "0" ] && [ "${dur:-0}" -gt "3600" ] 2>/dev/null; then
        echo "  → Super Whisper完了 (${elapsed}秒経過, ${wc}語, ${dur}秒)"
        return 0
      elif [ "${wc:-0}" -gt "0" ] 2>/dev/null; then
        echo "  ⚠ 短い録音を検知 (${dur}秒, ${wc}語) → スキップして待機継続"
        before_rowid=$latest_rowid
      fi

      if [ $((elapsed % 60)) -eq 0 ]; then
        echo "  処理中... ${elapsed}秒経過 (rawWordCount=${wc})"
      fi
    else
      if [ $((elapsed % 60)) -eq 0 ]; then
        printf "  待機中... ${elapsed}秒\r"
      fi
    fi
  done

  echo "  ✗ タイムアウト（${SW_TIMEOUT}秒）"
  return 1
}

# macOS通知
notify() {
  osascript -e "display notification \"$2\" with title \"$1\"" 2>/dev/null || true
}

FAIL=()
SUCCESS=()

for id in "${SESSIONS[@]}"; do
  echo ""
  echo "▶ $id"

  # YouTube IDをindex.jsonから取得
  YT_ID=$(node -e "
    const fs = require('fs');
    const idx = JSON.parse(fs.readFileSync('$INDEX_FILE', 'utf-8'));
    const s = idx.find(s => s.id === '$id');
    process.stdout.write(s ? s.youtube_id : '');
  " 2>/dev/null)

  if [ -z "$YT_ID" ]; then
    echo "  ✗ YouTube IDが見つかりません"
    FAIL+=("$id")
    continue
  fi

  AUDIO="$TMP_DIR/$id.mp3"

  # 1. 音声ダウンロード
  if [ ! -f "$AUDIO" ]; then
    echo "  [1/3] 音声ダウンロード中..."
    if ! "$YT_DLP" -x --audio-format mp3 --audio-quality 0 -o "$AUDIO" \
        "https://www.youtube.com/watch?v=$YT_ID"; then
      echo "  ✗ ダウンロード失敗"
      FAIL+=("$id")
      continue
    fi
    SIZE=$(du -sh "$AUDIO" | cut -f1)
    echo "  → ダウンロード完了: $SIZE"
  else
    SIZE=$(du -sh "$AUDIO" | cut -f1)
    echo "  [1/3] 音声ファイル既存 → スキップ ($SIZE)"
  fi

  # 2. Super Whisperで文字起こし（手動ドラッグが必要）
  BEFORE_ROWID=$(get_latest_sw_rowid)

  echo ""
  echo "  ============================================"
  echo "  [2/3] Super Whisperにドラッグしてください:"
  echo "        $AUDIO"
  echo "  文字起こしが完了したら自動で次に進みます"
  echo "  ============================================"
  echo ""

  # Finderでファイルを表示してドラッグしやすくする
  open -R "$AUDIO" 2>/dev/null || true
  # 通知も出す
  notify "Super Whisper バッチ処理" "$(basename $AUDIO) をSuper Whisperにドラッグしてください"

  echo "  完了を待機中..."
  if ! wait_for_sw_completion "$BEFORE_ROWID"; then
    echo "  ✗ タイムアウト"
    FAIL+=("$id")
    continue
  fi

  # 3. 要約生成・JSON保存
  echo "  [3/3] 要約生成中 (claude -p)..."
  if node "$IMPORT_SCRIPT" --id "$id"; then
    echo "  ✓ 完了"
    SUCCESS+=("$id")
    rm -f "$AUDIO"
    notify "✓ 完了" "$id の要約生成完了"
  else
    echo "  ✗ import-superwhisper-db失敗"
    FAIL+=("$id")
  fi
done

echo ""
echo "========================================"
if [ ${#SUCCESS[@]} -gt 0 ]; then
  echo "発言者情報を更新中..."
  node site/scripts/enrich-sessions-speakers.mjs

  echo ""
  echo "git commit & push..."
  git add data/ site/data/
  git commit -m "Add transcripts: 令和8年第1回定例会 Super Whisper処理 (${#SUCCESS[@]}セッション)"
  git push origin main
  notify "プッシュ完了" "${#SUCCESS[@]}セッションを公開しました"
else
  echo "成功したセッションがないためコミットをスキップ"
fi

echo ""
echo "========================================"
echo "処理結果:"
echo "  成功: ${#SUCCESS[@]}件"
echo "  失敗: ${#FAIL[@]}件"
if [ ${#FAIL[@]} -gt 0 ]; then
  echo "  失敗リスト:"
  for f in "${FAIL[@]}"; do echo "    - $f"; done
fi
