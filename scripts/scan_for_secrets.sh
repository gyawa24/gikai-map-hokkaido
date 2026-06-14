#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

failed=0

echo "Checking tracked filenames for secret-looking files..."
if git ls-files | grep -E '(^|/)(\.env|.*\.(pem|key|p12|pfx))$|(^|/)\.vercel/' >/tmp/gikai-secret-files.txt; then
  cat /tmp/gikai-secret-files.txt
  failed=1
fi

echo "Checking tracked content for private keys and token-shaped values..."
if git grep -n -I -E 'BEGIN (RSA |OPENSSH |EC |DSA )?PRIVATE KEY|sk-(proj-)?[A-Za-z0-9_-]{40,}|sk-ant-[A-Za-z0-9_-]{40,}|gkmcp_[A-Za-z0-9_-]{32,}|AKIA[0-9A-Z]{16}' -- . ':(exclude)package-lock.json' ':(exclude)site/package-lock.json' ':(exclude)mcp-server/package-lock.json' ':(exclude)agents/package-lock.json' >/tmp/gikai-secret-content.txt; then
  cat /tmp/gikai-secret-content.txt
  failed=1
fi

rm -f /tmp/gikai-secret-files.txt /tmp/gikai-secret-content.txt

if [ "$failed" -ne 0 ]; then
  echo "Secret scan failed."
  exit 1
fi

echo "Secret scan passed."
