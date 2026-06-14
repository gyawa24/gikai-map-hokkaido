#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

required_files=(
  "README.md"
  "LICENSE"
  "DATA_LICENSE.md"
  "CONTRIBUTING.md"
  "SECURITY.md"
  "AGENTS.md"
  "DESIGN.md"
  "site/AGENTS.md"
  "site/README.md"
  "site/package.json"
  "docs/operations-principles.md"
  "docs/operations-board.md"
  "docs/open-data-policy.md"
  "docs/news-workflow.md"
)

missing=0
for file in "${required_files[@]}"; do
  if [ ! -f "$file" ]; then
    echo "Missing required file: $file"
    missing=1
  fi
done

if [ "$missing" -ne 0 ]; then
  exit 1
fi

echo "Required files check passed."
