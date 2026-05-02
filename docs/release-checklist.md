# Release Checklist

Use this before every production release.

## Domain And Transport

- production domain resolves correctly
- HTTP redirects to HTTPS
- certificate is valid and auto-renewal is confirmed
- HSTS is enabled after confirming HTTPS stability

## Metadata And Crawlability

- every public page has title and description
- canonical URLs are correct
- OGP tags render correctly on key pages
- `favicon`, `robots.txt`, `sitemap.xml`, and `site.webmanifest` are reachable
- staging or preview environments are `noindex`

## Error Handling

- `404` page returns real `404`
- `500` path is handled by custom error page
- user-facing pages avoid leaking stack traces or internal details

## Forms And Auth

- all forms validate input on the server
- rate limiting is enabled on contact, login, admin, reset, and similar endpoints
- spam mitigation is enabled where needed
- auth and reset flows avoid account enumeration

## Headers And Cookies

- CSP is enforced and reviewed for new third-party assets
- clickjacking protection is enabled
- `X-Content-Type-Options: nosniff` is present
- `Referrer-Policy` is present
- `Permissions-Policy` is present
- cookies use `Secure`, `HttpOnly`, and `SameSite`

## Email And Privacy

- SPF is published
- DKIM is published and signing real mail
- DMARC is published with monitored reporting
- privacy policy is published and current

## Monitoring And Ops

- uptime checks are green
- error reporting is receiving test events
- alert routing is correct
- backup or recovery expectations are documented if applicable
- dependency updates are enabled and reviewed
- server-side rate limit storage is configured in production (`KV_REST_*` or `UPSTASH_REDIS_*`)
- protected health checks use a bearer token (`UPTIME_WEBHOOK_TOKEN`) when enabled

## Public Repo And Secrets

- `git ls-files` does not include `.env`, `.pem`, `.key`, or `.vercel` secret artifacts
- `./scripts/scan_for_secrets.sh`
- `gitleaks git .`
- production secrets are stored only in the hosting platform, not in tracked files
- if repository visibility will change, verify branch protection and private vulnerability reporting settings first

## Final Audit

- `./scripts/check_required_files.sh`
- `./scripts/audit_live_site.sh https://example.com`
- `./scripts/audit_metadata.sh https://example.com`
- `./scripts/check_mail_dns.sh example.com`
