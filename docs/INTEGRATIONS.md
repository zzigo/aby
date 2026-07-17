# Integrations

## Identity / Logto

Aby will use the same issuer and stable OIDC `sub` identifiers as sibling apps, but requires its own Logto application, redirect URIs and client secret. Phase 0 defines configuration names only; no client or secret is reused or provisioned. API ownership filters must use the authenticated subject.

## Seshat

Seshat remains canonical for bibliography and documents. Aby stores only stable foreign IDs and provenance-bearing relations such as `segment -> document reference`. Future consumption is through `@zztt/seshat-sdk`, authenticated API calls or events such as `bibliography.updated`; no Seshat table reads are permitted.

## Musiki

Musiki's Cloudflare R2 and application tables remain separate. Musiki may later consume published works, recordings or segments through `@zztt/aby-sdk`. It never receives internal object keys or direct database access.

## GLIP

Aby emits candidates, not definitive TAEs. Human validation precedes promotion to GLIP. Relations preserve the distinction between algorithmic detection, human annotation, candidate segment and validated operational musical unit.

## Qdrant

Collections are namespaced and model-specific (`aby_segments_clap_v1`, `aby_segments_mert_v1`). Before first write, each collection contract must record vector dimension, distance metric, model digest/version and reconstruction procedure. PostgreSQL stores the authoritative embedding record and source checksum.

