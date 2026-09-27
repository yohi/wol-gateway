# Security model

## Trust boundary

`Cloudflare Access` is the authentication and authorization boundary.

The application performs only a defense-in-depth presence check for
`Cf-Access-Jwt-Assertion`; it does **not** independently validate the JWT
signature. Protect `wol.y-ohi.com` with a Cloudflare Access self-hosted
application before exposing the existing Tunnel route.

## Deployment assumption

The home gateway PC is intentionally treated as an always-on infrastructure
node. It runs:

- the existing `cloudflared` connector;
- this `wol-api` container;
- the LAN-side Wake-on-LAN relay.

The home gateway is therefore shown as online when this application is
reachable. This project does **not** attempt to wake the home gateway itself.

## Deliberate constraints

- The AI agent PC MAC address is server-side configuration only.
- The broadcast address is server-side configuration only.
- The AI reachability probe host/port is server-side configuration only.
- No arbitrary destination can be supplied by an HTTP request.
- No arbitrary shell command execution exists.
- No remote shutdown/reboot endpoint exists.
- `/api/wake` only accepts POST.
- A custom confirmation header is required.
- CORS is not enabled.
- Repeated wake requests are rate limited in-process.
- The API binds only to `127.0.0.1`.
- The container drops all Linux capabilities and uses `no-new-privileges`.
- The container root filesystem is read-only.

## Status semantics

The AI agent PC is shown as online when the configured TCP endpoint answers.

A TCP connection refusal still proves the host's TCP stack answered and is
therefore considered online. A timeout or other network error is shown as
offline.

This is network reachability, not an authoritative hardware power sensor.
Configure a stable probe endpoint such as SSH on the AI agent PC.

## Tunnel credentials

This repository does **not** store or run a Cloudflare Tunnel token.

The existing `cloudflared` installation on the home gateway remains
responsible for Tunnel credentials. The only required Tunnel change is adding
`wol.y-ohi.com -> http://localhost:8088` to the existing Tunnel.

## Secret handling

Do not commit `.env`.

Do not log:

- Cloudflare Access JWTs
- Tunnel credentials
- target MAC addresses

## Exposure

No router inbound port forwarding is required. If port 8088 is reachable from
the LAN or Internet, treat that as a deployment error and correct the bind or
network configuration before use.
