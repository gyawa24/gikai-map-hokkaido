# Security Policy

## Scope

This repository hosts a public civic-information website.
Before production changes, follow `docs/release-checklist.md` and the
Cloudflare runbooks under `docs/`.

## Reporting

Please report suspected vulnerabilities privately to the maintainer instead of
opening a public issue.

Include:

- affected URL or feature
- reproduction steps
- impact
- screenshots or request/response samples when relevant

## Secrets

- never commit `.env` files
- rotate any credential that is exposed in git history or logs
- use separate credentials for production and non-production environments
- scan git history with `gitleaks git .` before publishing sensitive changes
- production rate limiting must use server-side KV or Redis credentials, not memory fallback

## Public Repo Readiness

- verify no local secret files are tracked with `git ls-files`
- scan current files with `./scripts/scan_for_secrets.sh`
- scan full git history with `gitleaks git .`
- confirm production environment variables are set outside git:
  `MCP_API_KEYS`, KV or Upstash Redis credentials, and `UPTIME_WEBHOOK_TOKEN` if health checks are used
- validate the deployed site with `cd site && npm run cf:post-cutover-check`
