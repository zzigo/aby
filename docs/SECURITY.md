# Security

- Secrets are accepted only through environment variables and are never returned by health/config endpoints.
- Production requires PostgreSQL, Wasabi and a dedicated Logto client; demo mode is rejected when `NODE_ENV=production`.
- All storage keys are normalized and must remain below `ABY_STORAGE_PREFIX`; traversal and sibling prefixes are rejected.
- Playback URLs are short-lived and issued only after asset ownership checks.
- SQL uses parameterized queries and owner-scoped reads. Aby migrations never address Seshat or Musiki schemas.
- Request logs contain trace IDs and structured error codes, with credential-like fields redacted.
- Imported metadata remains a candidate until an explicit canonical commit.
- Local-path inspection is limited to the bundled development fixture. General filesystem ingestion belongs in a worker with an allowlisted root.

Phase 0 does not yet claim production authentication or row-level security. Before deployment, wire Logto session validation, deny anonymous mutating routes, define ownership/ACL tests, and decide whether PostgreSQL RLS adds defense in depth without duplicating application policy.

