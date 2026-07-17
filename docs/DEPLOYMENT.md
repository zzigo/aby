# VPS deployment

## Topology

| Surface | Value |
| --- | --- |
| Checkout | `/opt/apps/aby` (`zz:zz`, mode 0755) |
| PM2 process | `aby-web` |
| Application listener | `127.0.0.1:4332` |
| PostgreSQL | shared cluster, dedicated database `aby`, role/schema `aby_app` / `aby` |
| Qdrant | shared loopback service, future collections prefixed `aby_` |
| Wasabi | shared operational credentials; legacy `ref/` and `mov/` sources, canonical `aby/aud/` and `aby/mov/` |
| Caddy | `aby.zztt.org -> 127.0.0.1:4332` |

The remote `.env` is owned by `zz`, mode 0600, and is never copied into Git. `bun run logto:provision` creates or updates Aby's dedicated Traditional Web client through the self-hosted Logto Management API and writes the client ID, client secret and cookie encryption key directly into that file without printing them. On older OSS installations where the seeded `m-default` application has only a deprecated legacy secret, the helper adds a new named active secret before using the Management API; it does not replace existing credentials.

## Tunnel

Run `bun run tunnel:vps` locally. It exposes:

- `localhost:4332` — Aby;
- `localhost:55432` — PostgreSQL;
- `localhost:56333` — Qdrant HTTP.

The command uses the `hetzner` SSH host alias and `ExitOnForwardFailure`; all remote listeners remain bound to loopback.

## Release sequence

1. Push reviewed commits to GitHub from local workspace: `git push`.
2. SSH to the VPS and pull: `ssh hetzner "cd /opt/apps/aby && git pull"`.
3. Install dependencies on VPS: `npx --yes bun@1.3.14 install --frozen-lockfile`.
4. Run validation on VPS: `npx --yes bun@1.3.14 run validate`.
5. Run database migrations: `npx --yes bun@1.3.14 --env-file=.env run db:migrate`.
6. Build client and server bundles: `npx --yes bun@1.3.14 --env-file=.env run build`.
7. Reload the PM2 process: `pm2 reload aby-web --update-env`.
8. Verify public health status from `https://aby.zztt.org/api/health`.

## Public endpoint

Cloudflare has an unproxied A record `aby.zztt.org -> 46.225.154.68`. Caddy manages the public certificate and proxies `https://aby.zztt.org` to the loopback application. Verification requires both a valid TLS chain and `status: ok` from `https://aby.zztt.org/api/health`.
