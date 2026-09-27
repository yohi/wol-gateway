# Security model

## Trust boundaries

### Browser -> Cloudflare Worker

`wol.y-ohi.com` must be protected by Cloudflare Access. The browser receives only the public UI and public target/relay API.

The browser never receives:

- target MAC address
- LAN broadcast address
- home gateway private origin
- Cloudflare Tunnel credentials
- `WOL_RELAY_SHARED_SECRET`

### Worker -> home gateway

The Worker reaches the LAN relay through a Workers VPC Network binding named `HOME_NETWORK`, bound directly to the existing Cloudflare Tunnel.

Workers VPC Network bindings provide network-wide reachability through the bound Tunnel. To reduce SSRF risk, the Worker contains no generic proxy endpoint and `GatewayRelay` uses a fixed private origin/path only.

The internal FastAPI relay additionally requires:

```http
Authorization: Bearer <WOL_RELAY_SHARED_SECRET>
```

The secret is compared with `hmac.compare_digest`, is never logged, and must be stored only in the gateway `.env` and Cloudflare Worker secret storage / GitHub Actions secret context.

## Fixed-target constraints

- Public target ID is fixed to `ai-agent`.
- Current relay ID is fixed to `home-gateway`.
- MAC address is server-side gateway configuration only.
- Broadcast address is server-side gateway configuration only.
- TCP probe host/port are server-side gateway configuration only.
- Worker VPC destination is fixed in `GatewayRelay`.
- No request body/query field can choose a MAC, host, URL, broadcast address, or shell command.
- Public Wake requests require `X-WOL-Confirm: wake`; no CORS policy is enabled, preventing a simple cross-site form from issuing a valid Wake request.
- No remote shutdown/reboot endpoint exists.
- No generic HTTP/TCP proxy exists.

## Status semantics

`offline` means the configured target TCP endpoint did not answer while the gateway relay itself was reachable.

If the relay cannot be reached, target state is `unknown`, not `offline`. This avoids presenting a network/control-plane failure as proof that the PC is powered off.

## Gateway exposure

The FastAPI container uses host networking but Uvicorn binds only to `127.0.0.1:8088`. No router inbound port forwarding is required.

Workers VPC accesses the relay through the existing Tunnel. If `cloudflared` runs inside a container, its network namespace must be able to reach the relay origin; host networking is the simplest arrangement for the documented `localhost:8088` origin.

## Cloudflare requirements

Workers VPC is beta.

For Workers VPC over Cloudflare Tunnel:

- `cloudflared >= 2025.7.0`
- Tunnel protocol `auto` or `quic`
- outbound UDP port 7844 available
- direct Tunnel binding requires Connectivity Directory Admin

The deployment API token should have the minimum Worker/zone/connectivity permissions necessary for this deployment.

## CI/CD secrets

GitHub Secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`
- `WOL_RELAY_SHARED_SECRET`

GitHub Repository Variables:

- `CLOUDFLARE_TUNNEL_ID`
- `CLOUDFLARE_WORKER_AUTO_DEPLOY` (optional production push gate; `true` enables automatic `master` deploys)

The Tunnel UUID is an identifier, not a credential. Tunnel tokens/credentials must not be committed or passed through this repository. Production CI writes `WOL_RELAY_SHARED_SECRET` only to an ephemeral git-ignored secrets file on the GitHub-hosted runner and supplies it to Wrangler with `--secrets-file`; the cleanup step removes the file even on failure.

## Logging

Do not log:

- Access JWTs
- Cloudflare API tokens
- Tunnel credentials
- relay shared secret
- target MAC address

Gateway logs may record that a Magic Packet was sent and the configured broadcast/port. Worker error responses must remain sanitized and must not expose private origin URLs or upstream stack details.
