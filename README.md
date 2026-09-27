# wol-gateway

Cloudflare Access + **既存 Cloudflare Tunnel** を入口にし、原則常時稼働の
宅内ゲートウェイPCから AIエージェントPCを監視・Wake-on-LAN する構成です。

## Design decision

このリポジトリでは次を前提とします。

- 宅内ゲートウェイPCは常時ON。
- 既存の `cloudflared` / Cloudflare Tunnel を再利用する。
- `wol-gateway` 自身は `cloudflared` を起動しない。
- `CLOUDFLARE_TUNNEL_TOKEN` はこのリポジトリで管理しない。
- Wake対象は固定された AIエージェントPC 1台。
- UIには宅内GWとAIエージェントPCの状態を表示する。
- 宅内GW自身をこのアプリからWakeすることはしない。

## Architecture

```text
External browser
      |
    HTTPS
      |
Cloudflare Access
      |
Existing Cloudflare Tunnel
      |
127.0.0.1:8088
      |
wol-api on Home Gateway PC
      |
      +-- TCP probe --> AI Agent PC
      |
      +-- UDP Magic Packet --> AI Agent PC
```

宅内GWが停止した場合は、Tunnel connector と WoL relay も停止するため、
この構成だけでは宅内GW自身を復旧できません。これは意図したスコープ外です。

## UI behavior

`https://wol.y-ohi.com/` にログインすると2台を表示します。

```text
┌─────────────────────────┐
│ 宅内ゲートウェイPC       │
│ ● オンライン             │
│                         │
│ [ 常時稼働 ]             │
└─────────────────────────┘

┌─────────────────────────┐
│ AIエージェントPC         │
│ ● オフライン             │
│                         │
│ [ Wake ]                │
└─────────────────────────┘
```

AIエージェントPCがオンラインなら Wake ボタンは無効になります。
状態はブラウザから5秒ごとに更新します。

## Status semantics

AIエージェントPCの状態は固定 TCP endpoint への到達性で判定します。

例:

```dotenv
AI_AGENT_HOST=192.168.1.20
AI_AGENT_PORT=22
```

- TCP connect成功: `online`
- TCP connection refused: `online`
- timeout / network error: `offline`

connection refused でも対象PCからTCP応答が返っているため online とします。

これは厳密な電源状態ではなく **network reachability** です。
Firewall が probe を silent drop する構成では誤判定するため、SSH等の安定した
TCP endpoint を指定してください。

## Requirements

### Functional

- Cloudflare Access 認証後にUIを開ける。
- 宅内GWを online の WoL relay として表示する。
- AIエージェントPCの到達状態を表示する。
- AI PC が offline の場合のみ Wake 操作できる。
- Wake先MAC / broadcast / probe先はサーバー側固定。
- Wake連打をrate limitする。
- `/health` はprobeもWoLも実行しない。

### Security

- Router inbound port forwarding不要。
- APIは `127.0.0.1:8088` のみlisten。
- Cloudflare Accessを認証・認可境界とする。
- `POST /api/wake` のみがMagic Packetを送信する。
- `X-WOL-Confirm: wake` 必須。
- CORSを有効化しない。
- read-only container。
- `cap_drop: ALL`。
- `no-new-privileges`。
- shell executionなし。

## Setup

### 1. Prepare environment

```bash
cp .env.example .env
chmod 600 .env
```

`.env`:

```dotenv
WOL_MAC=AA:BB:CC:DD:EE:FF
WOL_BROADCAST=192.168.1.255
WOL_PORT=9

AI_AGENT_HOST=192.168.1.20
AI_AGENT_PORT=22
AI_AGENT_PROBE_TIMEOUT_SECONDS=0.8

WOL_MIN_INTERVAL_SECONDS=30
REQUIRE_CF_ACCESS=true
LOG_LEVEL=INFO
```

**Tunnel token は不要です。**

### 2. Verify WoL inside the LAN

Cloudflareを設定する前に、LAN内からAIエージェントPCへMagic Packetを送り、
実際に起動できることを確認してください。

対象PC側では以下を確認します。

- BIOS/UEFI Wake-on-LAN有効
- NIC / OS Wake-on-LAN有効
- shutdown後もNICへ給電
- 有線LAN推奨

### 3. Start wol-api on the home gateway

```bash
docker compose up -d --build
docker compose ps
```

health check:

```bash
curl http://127.0.0.1:8088/health
```

Expected:

```json
{"status":"ok"}
```

### 4. Protect wol.y-ohi.com with Cloudflare Access

Cloudflare AccessでSelf-hosted applicationを作成します。

```text
Application domain:
wol.y-ohi.com
```

最小のAllow policy例:

```text
Action:
Allow

Include:
Emails -> 自分のメールアドレス
```

### 5. Add a route to the existing Tunnel

**新しいTunnelは作成しません。**

現在宅内GWで動いているTunnelに Published application を追加します。

```text
Hostname:
wol.y-ohi.com

Service URL:
http://localhost:8088
```

既存 `cloudflared` が localhost の `wol-api` へ接続します。

このリポジトリのComposeには `cloudflared` serviceはありません。

## API

### Status

```http
GET /api/status
```

Response example:

```json
{
  "gateway": {
    "status": "online",
    "role": "wol-relay"
  },
  "ai_agent": {
    "status": "offline",
    "last_wake_at": null
  },
  "probe": {
    "type": "tcp",
    "port": 22
  },
  "min_interval_seconds": 30
}
```

### Wake

```http
POST /api/wake
X-WOL-Confirm: wake
```

AI PCがすでにprobeへ応答している場合は `409 Conflict` を返し、
Magic Packetを送りません。

## Tests

```bash
make test
docker compose config
```

## Acceptance criteria

- [ ] `CLOUDFLARE_TUNNEL_TOKEN` がrepo / `.env.example` に存在しない。
- [ ] Composeに `cloudflared` serviceが存在しない。
- [ ] 既存Cloudflare Tunnelを利用する。
- [ ] `wol.y-ohi.com -> http://localhost:8088` が既存Tunnelに設定される。
- [ ] `wol.y-ohi.com` がCloudflare Accessで保護される。
- [ ] UIに宅内GWとAIエージェントPCの2台が表示される。
- [ ] 宅内GWは常時稼働relayとして表示される。
- [ ] AI PC状態が5秒ごとに更新される。
- [ ] AI PC online時はWakeボタンが無効。
- [ ] AI PC offline時のみWake操作できる。
- [ ] APIから任意MAC/IPを指定できない。
- [ ] repeated Wake requestがrate limitされる。
- [ ] Router inbound port forwardingが存在しない。
- [ ] APIが `127.0.0.1:8088` のみにbindしている。
- [ ] Magic PacketでAIエージェントPCが実際に起動する。

## Out of scope

- 宅内GW自身のWake
- ESP32等の独立relay
- SwitchBotによる非常用電源制御
- 複数Wake target
- remote shutdown / reboot
- arbitrary shell execution
- authoritative hardware power-state detection

宅内GWの非常時復旧は、実際に必要性が生じた時点で独立した経路として追加します。
