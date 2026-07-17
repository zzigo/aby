# Security

- Secrets are accepted only through environment variables and are never returned by health/config endpoints.
- Production requires PostgreSQL, Wasabi and a dedicated Logto client; demo mode is rejected when `NODE_ENV=production`.
- Canonical playback keys must remain below `aby/`; discovery keys are separately restricted to the legacy `ref/` and `mov/` roots. Traversal and unrelated prefixes are rejected.
- Playback URLs are short-lived and issued only after asset ownership checks.
- SQL uses parameterized queries and owner-scoped reads. Aby migrations never address Seshat or Musiki schemas.
- Request logs contain trace IDs and structured error codes, with credential-like fields redacted.
- Imported metadata remains a candidate until an explicit canonical commit.
- Local-path inspection is limited to the bundled development fixture. General filesystem ingestion belongs in a worker with an allowlisted root.

Production authentication uses Aby's dedicated Logto client and the shared issuer. Anonymous mutating routes are denied; ownership is the stable OIDC `sub`. PostgreSQL RLS remains a possible defense-in-depth layer after application-level ownership tests are expanded.
