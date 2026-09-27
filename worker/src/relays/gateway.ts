import type { RelayStatus, WakeResult, WolRelay } from "../domain/relay.js";
import type { Target, TargetStatus } from "../domain/target.js";

const GATEWAY_ORIGIN = "http://localhost:8088";
const STATUS_URL = `${GATEWAY_ORIGIN}/internal/status`;
const WAKE_URL = `${GATEWAY_ORIGIN}/internal/targets/ai-agent/wake`;

export interface NetworkBinding {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

type GatewayStatusPayload = {
  relay?: unknown;
  targets?: {
    "ai-agent"?: {
      status?: unknown;
    };
  };
};

export class GatewayRelay implements WolRelay {
  readonly id = "home-gateway" as const;
  readonly type = "gateway" as const;

  constructor(
    private readonly network: NetworkBinding,
    private readonly secret: string,
  ) {}

  private headers(): HeadersInit {
    return { Authorization: `Bearer ${this.secret}` };
  }

  private async fetchStatus(): Promise<GatewayStatusPayload | undefined> {
    try {
      const response = await this.network.fetch(STATUS_URL, {
        method: "GET",
        headers: this.headers(),
      });
      if (!response.ok) return undefined;
      const payload = (await response.json()) as GatewayStatusPayload;
      return payload;
    } catch {
      return undefined;
    }
  }

  async status(): Promise<RelayStatus> {
    const payload = await this.fetchStatus();
    return payload?.relay === "online" ? "online" : "unavailable";
  }

  async getTargetStatus(_target: Target): Promise<TargetStatus> {
    const payload = await this.fetchStatus();
    const status = payload?.targets?.["ai-agent"]?.status;
    return status === "online" || status === "offline" ? status : "unknown";
  }

  async wake(_target: Target): Promise<WakeResult> {
    try {
      const response = await this.network.fetch(WAKE_URL, {
        method: "POST",
        headers: this.headers(),
      });
      if (response.status === 202) return { status: "accepted" };
      if (response.status === 409) return { status: "already_online" };
      if (response.status === 429) {
        const value = response.headers.get("retry-after");
        const retryAfter = value === null ? undefined : Number.parseInt(value, 10);
        return Number.isFinite(retryAfter)
          ? { status: "rate_limited", retryAfter }
          : { status: "rate_limited" };
      }
      return { status: "unavailable" };
    } catch {
      return { status: "unavailable" };
    }
  }
}
