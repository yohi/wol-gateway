# Security model

## Trust boundary

`Cloudflare Access` is the authentication and authorization boundary.

The application itself only performs a defense-in-depth presence check for
`Cf-Access-Jwt-Assertion`; it does **not** independently validate the JWT signature.
Enable **Protect with Access** on the Cloudflare Tunnel route so `cloudflared`
validates the Access token before forwarding the request to the origin.

## Deliberate constraints

- The target MAC address is server-side configuration only.
- The broadcast address is server-side configuration only.
- No arbitrary shell command execution exists.
- No remote shutdown/reboot endpoint exists.
- `/api/wake` only accepts POST.
- A custom confirmation header is required.
- CORS is not enabled.
- Repeated wake requests are rate limited in-process.
- The API binds only to `127.0.0.1`.
- The containers drop all Linux capabilities and use `no-new-privileges`.
- The WoL container root filesystem is read-only.

## Secret handling

Do not commit `.env`.

Treat these as secrets:
- `CLOUDFLARE_TUNNEL_TOKEN`
- future Service Token Client Secrets, if added

Do not log:
- Cloudflare Access JWTs
- Tunnel tokens
- Service Token secrets
- target MAC addresses

## Exposure

No router inbound port forwarding is required. If port 8088 is reachable from the
LAN or Internet, treat that as a deployment error and correct the bind/network
configuration before use.
