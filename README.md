# wol-gateway

`wol.y-ohi.com` から自宅LAN内の固定PCを安全に Wake-on-LAN するための小さな control plane / relay です。

## Architecture

```text
Browser
  |
  v
Cloudflare Access
  |
  v
Cloudflare Worker  (wol.y-ohi.com)
  |- Static UI
  |- GET  /api/targets
  |- GET  /api/relays
  `- POST /api/targets/ai-agent/wake
         |
         v
  Workers VPC Network binding: HOME_NETWORK
         |
         v
  existing Cloudflare Tunnel
         |
         v
Home Gateway PC / FastAPI relay
  |- GET  /health
  |- GET  /internal/status
  `- POST /internal/targets/ai-agent/wake
         |
         v
  UDP Wake-on-LAN Magic Packet
         |
         v
  AI Agent PC
```

### Design assumptions

- 宅内ゲートウェイPCは原則常時ON。
- 既存の Cloudflare Tunnel を再利用する。
- このリポジトリは Tunnel connector / Tunnel token を管理しない。
- 公開UI/APIは Cloudflare Worker に置く。
- FastAPI はLAN側の固定WoL relay専用。
- Wake対象は `ai-agent` 1台のみ。
- arbitrary MAC / IP / URL / shell command は受け付けない。
- 将来ESP32を追加する場合も、公開APIは変えず `WolRelay` の別実装として追加する。

Workers VPC は 2026-09-27 時点で beta です。

## Public UI

Cloudflare Access 認証後、UIには以下を表示します。

- **宅内ゲートウェイPC**: `Online` / `Unavailable`
- **AIエージェントPC**: `Online` / `Offline` / `Unknown`

Relayへ到達できない場合、AI PCを `Offline` と断定せず `Unknown` にします。

Wakeボタンは次の場合だけ有効です。

```text
Gateway relay = Online
AI Agent PC   = Offline
```

ブラウザは5秒ごとにWorker APIをpollします。Wake送信後は最大90秒間起動確認状態になり、起動を確認できなければ再試行可能になります。

## Public API

### GET /api/targets

```json
{
  "targets": [
    {
      "id": "ai-agent",
      "name": "AIエージェントPC",
      "status": "offline",
      "wakeAvailable": true,
      "relay": {
        "id": "home-gateway",
        "status": "online"
      }
    }
  ]
}
```

### GET /api/relays

```json
{
  "relays": [
    {
      "id": "home-gateway",
      "type": "gateway",
      "status": "online"
    }
  ]
}
```

### POST /api/targets/ai-agent/wake

Required header:

```http
X-WOL-Confirm: wake
```

This custom header is a CSRF defense-in-depth measure: a simple cross-site HTML form cannot send it.

Responses:

- `202`: Wake accepted
- `409`: target already online
- `429`: rate limited
- `503`: relay unavailable / target state unknown
- `404`: unknown target

Browser requests cannot supply a MAC address, broadcast address, relay URL, private host, or arbitrary target destination.

## Home gateway setup

### Requirements

- Ubuntu Server / Docker Engine / Docker Compose plugin
- AI Agent PC と同じLANから directed broadcast を送信できること
- existing `cloudflared >= 2025.7.0`
- Tunnel transport が `auto` または `quic`
- outbound UDP/7844 が許可されていること

Workers VPC は HTTP/2-only Tunnel transport では正常に動作しません。

### Environment

```bash
cp .env.example .env
chmod 600 .env
```

```dotenv
WOL_MAC=AA:BB:CC:DD:EE:FF
WOL_BROADCAST=192.168.1.255
WOL_PORT=9

AI_AGENT_HOST=192.168.1.20
AI_AGENT_PORT=22
AI_AGENT_PROBE_TIMEOUT_SECONDS=0.8

WOL_MIN_INTERVAL_SECONDS=30
WOL_RELAY_SHARED_SECRET=<long-random-secret>
LOG_LEVEL=INFO
```

`WOL_RELAY_SHARED_SECRET` はWorker Secretと同じ値にします。

### Start relay

```bash
docker compose up -d --build
curl http://127.0.0.1:8088/health
```

Expected:

```json
{"status":"ok"}
```

Internal endpoints require:

```http
Authorization: Bearer <WOL_RELAY_SHARED_SECRET>
```

## Cloudflare / GitHub configuration

### GitHub Secrets

```text
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_API_TOKEN
WOL_RELAY_SHARED_SECRET
```

### GitHub Repository Variables

```text
CLOUDFLARE_TUNNEL_ID
CLOUDFLARE_WORKER_AUTO_DEPLOY   # optional; set to true after initial cutover
```

The Cloudflare API token should be scoped as narrowly as possible. Binding a Worker directly to an existing Tunnel through Workers VPC requires the token owner to have the **Connectivity Directory Admin** role.

### Worker deployment

PRs run CI only. Production deploy is always available through manual `workflow_dispatch`. A push to `master` deploys only after Repository Variable `CLOUDFLARE_WORKER_AUTO_DEPLOY=true` is set. This prevents merging the initial migration PR from accidentally attempting the hostname cutover before Cloudflare secrets/DNS are ready.

Worker configuration is generated from `worker/wrangler.template.json`; the Tunnel UUID is injected from `CLOUDFLARE_TUNNEL_ID`. Secrets are never written into the generated Wrangler file. The deploy workflow writes an ephemeral, git-ignored JSON secrets file and passes it to `wrangler deploy --secrets-file`, so first deploy can upload code and the required Worker secret together.

The Worker uses:

```text
Custom Domain: wol.y-ohi.com
workers.dev: disabled
Static Assets: worker/public
VPC binding: HOME_NETWORK -> existing Tunnel UUID
Private gateway origin: http://localhost:8088
```

`localhost` is resolved from the Tunnel connector side. If the existing `cloudflared` runs in an isolated container network rather than the gateway host network, the connector must be able to reach the relay service; use host networking or a gateway-local private address/hostname before production cutover.

## Production cutover

1. Add GitHub Secrets:
   - `CLOUDFLARE_ACCOUNT_ID`
   - `CLOUDFLARE_API_TOKEN`
   - `WOL_RELAY_SHARED_SECRET`
2. Add Repository Variable `CLOUDFLARE_TUNNEL_ID`; leave `CLOUDFLARE_WORKER_AUTO_DEPLOY` unset/false for the initial cutover.
3. Put the same `WOL_RELAY_SHARED_SECRET` in the gateway `.env`.
4. Deploy/restart the gateway relay and verify `/health` locally.
5. Verify `cloudflared --version` is at least `2025.7.0`.
6. Verify Tunnel transport is QUIC-capable (`auto` or `quic`) and UDP/7844 is allowed.
7. Confirm Cloudflare Access continues protecting `wol.y-ohi.com`.
8. Remove the old Tunnel Published Application / conflicting CNAME for `wol.y-ohi.com` **without deleting the Tunnel connector**.
9. Manually run the **Deploy Worker** `workflow_dispatch` so its Custom Domain can claim `wol.y-ohi.com`.
10. Verify:
    - Access login
    - UI loads
    - gateway relay reports online
    - AI Agent PC status changes correctly
    - one real Wake operation succeeds
11. After the initial cutover is stable, optionally set `CLOUDFLARE_WORKER_AUTO_DEPLOY=true` to deploy future `master` pushes automatically.

### Rollback

If Worker Custom Domain deployment or Workers VPC connectivity fails:

1. set `CLOUDFLARE_WORKER_AUTO_DEPLOY=false` or remove it;
2. stop further Worker cutover changes;
3. restore the previous Tunnel Published Application / DNS ownership for `wol.y-ohi.com`;
4. investigate VPC/Tunnel connectivity without changing the LAN WoL relay contract.

## Development

### Python

```bash
python -m pip install -r requirements.txt -r requirements-dev.txt
python -m unittest discover -s tests -v
```

### Worker

```bash
cd worker
npm install
npm test
npm run typecheck
```

Generate production-shaped Wrangler config locally with a test UUID:

```bash
CLOUDFLARE_TUNNEL_ID=550e8400-e29b-41d4-a716-446655440000 \
  node scripts/render-wrangler.mjs
```

A real Wrangler dry-run requires npm/Cloudflare tooling/network access and a placeholder for the required Worker secret:

```bash
printf '%s\n' '{"WOL_RELAY_SHARED_SECRET":"local-dry-run-placeholder"}' > .secrets.ci.json
npx wrangler@4 deploy --dry-run --config wrangler.generated.json --secrets-file .secrets.ci.json
rm -f .secrets.ci.json
```

## Future ESP32 extension

The Worker uses a relay abstraction:

```text
WolRelay
  |- GatewayRelay   (implemented now)
  `- Esp32Relay     (future)
```

A future ESP32 relay can keep an outbound WebSocket to a Durable Object and implement the same logical relay interface. The browser/API contract does not need to change.

Out of scope now:

- ESP32 firmware
- Durable Objects
- WebSocket device protocol
- automatic relay failover
- waking the home gateway itself
- remote shutdown/reboot
- arbitrary target destinations
