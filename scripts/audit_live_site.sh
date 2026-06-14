#!/usr/bin/env bash
set -euo pipefail

base_url="${1:-https://chihougikai.com}"
base_url="${base_url%/}"

paths=(
  "/"
  "/about"
  "/news"
  "/privacy"
  "/methodology"
  "/robots.txt"
  "/sitemap.xml"
)

failed=0
for path in "${paths[@]}"; do
  url="${base_url}${path}"
  status="$(curl -L -s -o /dev/null -w '%{http_code}' "$url" || true)"
  if [[ ! "$status" =~ ^[23] ]]; then
    echo "FAIL $status $url"
    failed=1
  else
    echo "OK   $status $url"
  fi
done

if [ "$failed" -ne 0 ]; then
  exit 1
fi

echo "Live site audit passed."
