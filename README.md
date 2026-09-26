# wol-gateway

Cloudflare Tunnel + Cloudflare Access を入口にし、宅内ゲートウェイPCから固定対象へ Wake-on-LAN Magic Packet を送る最小構成です。

## 1. Requirements

### Functional
- 外出先のブラウザから `https://wol.y-ohi.com/` を開ける。
- Cloudflare Access を通過したユーザーだけが UI を利用できる。
- `Wake` 操作は固定済みの 1 台へだけ Magic Packet を送る。
- 任意 MAC、任意 broadcast address、任意コマンドはリクエストから指定できない。
- 連打防止の minimum interval を持つ。
- `/health` は WoL を実行しない。

### Security
- Router の inbound port forwarding は不要。
- WoL API は `127.0.0.1:8088` のみで listen する。
- Cloudflare Tunnel も同一ホストから localhost origin に接続する。
- Cloudflare Access を認証・認可境界とする。
- `/api/wake` は `POST` のみ。
- `X-WOL-Confirm: wake` を必須にし、単純な cross-site form POST を拒否する。
- CORS は有効化しない。
- Docker container は read-only、`cap_drop: ALL`、`no-new-privileges`。
- WoL API に shell 実行機能を持たせない。
- ログに MAC address / Tunnel token / Access JWT を出さない。

## 2. Architecture

```text
External browser
      |
    HTTPS
      |
Cloudflare Access
      |
Cloudflare Tunnel
      |
127.0.0.1:8088
      |
  wol-api
      |
UDP Magic Packet -> LAN directed broadcast
      |
Target PC
```

Cloudflare Tunnel 自体で WoL broadcast を転送するのではなく、HTTP control plane と LAN 内 WoL delivery を分離します。

## 3. Prerequisites

対象PC側:
- BIOS/UEFI で Wake-on-LAN を有効化。
- NIC / OS 側でも WoL を有効化。
- 有線LANを推奨。
- シャットダウン後も NIC に給電される設定であること。

ゲートウェイPC側:
- Docker Engine + Docker Compose plugin。
- 対象PCと同じ LAN/VLAN から directed broadcast を送れること。
- outbound Internet connection。

Cloudflare:
- Cloudflare 管理下の domain。
- Cloudflare Tunnel。
- Cloudflare Access self-hosted application。

## 4. Local preparation

```bash
cp .env.example .env
chmod 600 .env
```

`.env` を編集します。

```dotenv
WOL_MAC=AA:BB:CC:DD:EE:FF
WOL_BROADCAST=192.168.1.255
WOL_PORT=9
WOL_MIN_INTERVAL_SECONDS=30
REQUIRE_CF_ACCESS=true
CLOUDFLARE_TUNNEL_TOKEN=...
```

### Directed broadcast

たとえば gateway が `192.168.1.10/24` なら、通常は:

```text
192.168.1.255
```

です。

ネットワーク構成により broadcast が異なるため、`ip addr` / `ip route` で確認してください。

## 5. Verify WoL before Cloudflare

Cloudflare を設定する前に、まず LAN 内で WoL が成立することを確認してください。

このリポジトリでは API を起動して localhost から動作確認できます。ただし `REQUIRE_CF_ACCESS=true` の場合 `/api/wake` は Access assertion がないため拒否します。

初回の LAN 試験時だけ一時的に:

```dotenv
REQUIRE_CF_ACCESS=false
```

として:

```bash
docker compose up -d --build wol-api

curl -i \
  -X POST \
  -H 'X-WOL-Confirm: wake' \
  http://127.0.0.1:8088/api/wake
```

確認後は必ず:

```dotenv
REQUIRE_CF_ACCESS=true
```

へ戻します。

## 6. Create the Tunnel connector first — but do not publish the hostname yet

Cloudflare Dashboard:

```text
Networking
  -> Tunnels
  -> Create Tunnel
```

Tunnel connector を作成し、Docker 用の Tunnel token を取得します。`.env` の
`CLOUDFLARE_TUNNEL_TOKEN` に保存してください。

この時点では `wol.y-ohi.com` の Published application route はまだ追加しません。

## 7. Create Cloudflare Access before publishing

Zero Trust / Access で Self-hosted application を作成します。

```text
Application domain:
wol.y-ohi.com
```

Policy は最初は極小にします。

例:

```text
Action:
Allow

Include:
Emails -> 自分のメールアドレス
```

この Access application が有効になったことを確認してから Tunnel route を公開します。

## 8. Publish the application through the Tunnel

Tunnel に Published application route を追加します。

```text
Hostname:
wol.y-ohi.com

Service URL:
http://localhost:8088
```

Tunnel 設定で `Protect with Access` を有効にしてください。これにより cloudflared 側でも
Access token validation を行わせ、origin bypass / misconfiguration に対する防御を追加します。

`cloudflared` は `network_mode: host` なので、この `localhost` はゲートウェイPC上の
`wol-api` を指します。

起動:

```bash
docker compose up -d --build
```

確認:

```bash
docker compose ps
docker compose logs --tail=100 cloudflared
```

ブラウザから:

```text
https://wol.y-ohi.com/
```

へアクセスし、Access authentication 後に `Wake` を押します。

## 9. Tests

Magic Packet unit tests:

```bash
make test
```

Expected:

```text
3 tests ... OK
```

Compose validation:

```bash
docker compose config
```

## 10. Operational checks

起動後:

```bash
curl http://127.0.0.1:8088/health
```

Expected:

```json
{"status":"ok"}
```

Public endpoint は Cloudflare Access authentication が必須です。

Wake request logs:

```bash
docker compose logs --tail=100 wol-api
```

ログは actor の Access email、broadcast address、port のみを記録し、MAC address や Access JWT は出力しません。

## 11. Acceptance criteria

- [ ] Router に inbound port forward が存在しない。
- [ ] `ss -ltnp` で API が `127.0.0.1:8088` のみに bind している。
- [ ] Access 未認証状態で `wol.y-ohi.com` の UI / API に到達できない。
- [ ] Tunnel の `Protect with Access` が有効である。
- [ ] Access 認証済みブラウザから UI が開く。
- [ ] `POST /api/wake` 以外で Magic Packet が送信されない。
- [ ] `X-WOL-Confirm` が無い POST は 400。
- [ ] repeated request は 429。
- [ ] Magic Packet で対象PCが起動する。
- [ ] container は `cap_drop: ALL` / `read_only` / `no-new-privileges`。
- [ ] `.env` は Git 管理されない。

## 12. Deliberately out of scope for v1

- 任意 MAC address 指定
- 複数端末管理
- remote shutdown / reboot
- shell command execution
- SSH proxy
- WARP private-network access
- power-state を断定する monitoring

「Magic Packet を送れた」ことと「PC が起動完了した」ことは別です。v1 は前者だけを責務とします。

## 13. Suggested v2

必要になった場合だけ追加します。

- 固定 target の複数台対応
- target ごとの Access policy
- fixed TCP probe による `reachable / unreachable` 表示
- Cloudflare rate limiting
- Prometheus/OpenTelemetry metrics
- audit log retention

いずれも `arbitrary destination` や `arbitrary command execution` には拡張しない方針を維持します。
