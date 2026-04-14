#!/bin/bash
# 0件セッションを一括再処理して git push まで実行するスクリプト
#
# 使い方:
#   cd /Users/yohei/gikai-map-hokkaido
#   bash retry-zero-sessions.sh

set -e
cd /Users/yohei/gikai-map-hokkaido

SESSIONS=(
  "r8-teireikai1-day2-yosan1-20260309"
  "r8-teireikai1-day3-20260310"
  "r8-teireikai1-day4-20260311"
  "r8-teireikai1-day6-20260313"
  "r8-yosan-6th-20260325"
)

echo "========================================"
echo "対象: ${#SESSIONS[@]}セッション"
echo "========================================"

FAIL=()

for id in "${SESSIONS[@]}"; do
  echo ""
  echo "▶ $id"
  if node site/scripts/batch-transcribe.mjs --no-skip --id "$id"; then
    echo "  ✓ 完了"
  else
    echo "  ✗ 失敗"
    FAIL+=("$id")
  fi
done

echo ""
echo "========================================"
echo "発言者情報を更新中..."
node site/scripts/enrich-sessions-speakers.mjs

echo ""
echo "========================================"
echo "git commit & push..."
git add data/ site/data/
git commit -m "Add transcripts: 令和8年第1回定例会 day2〜day6・yosan-6th 再処理"
git push origin main

echo ""
echo "========================================"
echo "完了！"
if [ ${#FAIL[@]} -gt 0 ]; then
  echo "失敗したセッション:"
  for f in "${FAIL[@]}"; do echo "  - $f"; done
else
  echo "全セッション成功"
fi
