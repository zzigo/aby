# VPS deployment

## Topology

| Surface | Value |
| --- | --- |
| Checkout | `/opt/apps/aby` (`zz:zz`, mode 0755) |
| PM2 process | `aby-web` |
| Application listener | `127.0.0.1:4332` |
| PostgreSQL | shared cluster, dedicated database `aby`, role/schema `aby_app` / `aby` |
| Qdrant | shared loopback service, future collections prefixed `aby_` |
| Wasabi | shared operational credentials, isolated prefix `aby/media/` |
| Caddy | `aby.zztt.org -> 127.0.0.1:4332` |

The remote `.env` is owned by `zz`, mode 0600, and is never copied into Git. Logto is reported as unconfigured until a dedicated application is provisioned.

## Tunnel

Run `bun run tunnel:vps` locally. It exposes:

- `localhost:4332` — Aby;
- `localhost:55432` — PostgreSQL;
- `localhost:56333` — Qdrant HTTP.

The command uses the `hetzner` SSH host alias and `ExitOnForwardFailure`; all remote listeners remain bound to loopback.

## Release sequence

1. Fast-forward `/opt/apps/aby` to a reviewed commit.
2. Run `npx --yes bun@1.3.14 install --frozen-lockfile`.
3. Run `npx --yes bun@1.3.14 run validate`.
4. Load `.env` and run `npx --yes bun@1.3.14 run db:migrate`.
5. Build and `pm2 reload aby-web --update-env`.
6. Verify `curl -fsS http://127.0.0.1:4332/api/health`.
7. Validate Caddy before any reload.

## Public endpoint

Cloudflare has an unproxied A record `aby.zztt.org -> 46.225.154.68`. Caddy manages the public certificate and proxies `https://aby.zztt.org` to the loopback application. Verification requires both a valid TLS chain and `status: ok` from `https://aby.zztt.org/api/health`.
