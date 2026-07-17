# Integrations

## Identity / Logto

Aby uses the same Logto issuer and stable OIDC `sub` identifiers as Seshat and Musiki, with its own Traditional Web application, callback, cookie encryption and client secret. This is shared SSO, not a shared application cookie: entering Aby redirects through Logto, which immediately recognizes an existing central session even when sibling apps use a different parent domain. API ownership filters use the authenticated `sub`.

Production callback: `https://aby.zztt.org/callback`. Post-logout redirect: `https://aby.zztt.org`. The deployment helper uses the official Management API to provision or update the client and writes secrets only to the mode-0600 VPS `.env`; it never prints them or copies sibling client secrets.

## Seshat

Seshat remains canonical for bibliography and documents. Aby stores only stable foreign IDs and provenance-bearing relations such as `segment -> document reference`. Future consumption is through `@zztt/seshat-sdk`, authenticated API calls or events such as `bibliography.updated`; no Seshat table reads are permitted.

## Musiki

Musiki's Cloudflare R2 and application tables remain separate. Musiki may later consume published works, recordings or segments through `@zztt/aby-sdk`. It never receives internal object keys or direct database access.

## GLIP

Aby emits candidates, not definitive TAEs. Human validation precedes promotion to GLIP. Relations preserve the distinction between algorithmic detection, human annotation, candidate segment and validated operational musical unit.

## Qdrant

Collections are namespaced and model-specific (`aby_segments_clap_v1`, `aby_segments_mert_v1`). Before first write, each collection contract must record vector dimension, distance metric, model digest/version and reconstruction procedure. PostgreSQL stores the authoritative embedding record and source checksum.
