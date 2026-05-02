# Security Policy

## Scope

This repository is expected to host a public website.
Before production launch, make sure the controls in `docs/launch-baseline.md`
are implemented in the deployed environment and in application code.

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
- before changing repository visibility to public, scan git history with `gitleaks git .`
- production rate limiting must use server-side KV or Redis credentials, not memory fallback

## Public Repo Readiness

- verify no local secret files are tracked with `git ls-files`
- scan current files with `./scripts/scan_for_secrets.sh`
- scan full git history with `gitleaks git .`
- confirm production environment variables are set outside git:
  `MCP_API_KEYS`, KV or Upstash Redis credentials, and `UPTIME_WEBHOOK_TOKEN` if health checks are used
- validate the deployed site before making the repository public
