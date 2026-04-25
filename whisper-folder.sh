#!/bin/bash
# whisper-folder.sh — フォルダ内の音声ファイルを上から順番に文字起こし
#
# 使い方:
#   bash whisper-folder.sh                        # tmp_audio/ を処理
#   bash whisper-folder.sh /path/to/folder        # 指定フォルダを処理
#   bash whisper-folder.sh /path/to/folder /path/to/output  # 出力先を別指定
#
# 対応フォーマット: mp3, m4a, wav, webm, mp4
# 処理済み（同名JSONが存在）はスキップ

set -euo pipefail

FOLDER="${1:-/Users/yohei/gikai-map-hokkaido/tmp_audio}"
OUTPUT="${2:-$FOLDER}"
# 処理済みチェック先（sessionsのJSONがあればスキップ）
SESSIONS_DIR="${3:-/Users/yohei/gikai-map-hokkaido/data/chitose/sessions}"
MLX="/Users/yohei/.local/bin/mlx_whisper"
MODEL="mlx-community/whisper-large-v3-turbo"

# ────────────────────────────────
# チェック
# ────────────────────────────────
if [ ! -d "$FOLDER" ]; then
  echo "❌ フォルダが見つかりません: $FOLDER"
  exit 1
fi

if [ ! -x "$MLX" ]; then
  echo "❌ mlx_whisper が見つかりません: $MLX"
  exit 1
fi

mkdir -p "$OUTPUT"

# ────────────────────────────────
# 音声ファイルを名前順に列挙
# ────────────────────────────────
FILES=$(find "$FOLDER" -maxdepth 1 \( \
  -name "*.mp3" -o \
  -name "*.m4a" -o \
  -name "*.wav" -o \
  -name "*.webm" -o \
  -name "*.mp4" \
\) | sort)

TOTAL=$(echo "$FILES" | grep -c . || true)

if [ "$TOTAL" -eq 0 ]; then
  echo "📭 音声ファイルが見つかりません: $FOLDER"
  exit 0
fi

echo ""
echo "📁 フォルダ: $FOLDER"
echo "📤 出力先:   $OUTPUT"
echo "🎵 対象ファイル数: $TOTAL"
echo ""

# ────────────────────────────────
# 処理ループ
# ────────────────────────────────
DONE=0
SKIPPED=0
FAILED=0
COUNT=0

while IFS= read -r FILE; do
  [ -z "$FILE" ] && continue
  COUNT=$((COUNT + 1))

  BASENAME=$(basename "$FILE")
  ID="${BASENAME%.*}"
  JSON="$OUTPUT/${ID}.json"

  echo "[$COUNT/$TOTAL] $BASENAME"

  # 処理済みチェック（出力先 or sessions/ のどちらかにJSONがあればスキップ）
  SESSIONS_JSON="$SESSIONS_DIR/${ID}.json"
  if [ -f "$JSON" ] || [ -f "$SESSIONS_JSON" ]; then
    echo "  ⏭  スキップ（処理済み）"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  # 文字起こし実行
  echo "  🎙  文字起こし中..."
  START=$(date +%s)

  if "$MLX" "$FILE" \
    --model "$MODEL" \
    --language ja \
    --output-format json \
    --output-dir "$OUTPUT" \
    --fp16 False \
    --no-speech-threshold 0.1 2>&1 | tail -3; then

    END=$(date +%s)
    ELAPSED=$((END - START))
    echo "  ✅ 完了 (${ELAPSED}秒)"
    DONE=$((DONE + 1))
  else
    echo "  ❌ 失敗: $BASENAME"
    FAILED=$((FAILED + 1))
  fi

  echo ""

done <<< "$FILES"

# ────────────────────────────────
# サマリー
# ────────────────────────────────
echo "════════════════════════════════"
echo "✅ 完了:     $DONE 件"
echo "⏭  スキップ: $SKIPPED 件"
if [ "$FAILED" -gt 0 ]; then
  echo "❌ 失敗:     $FAILED 件"
fi
echo "════════════════════════════════"
