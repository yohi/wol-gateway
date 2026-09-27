import type { Target, TargetStatus } from "./target.js";

export type RelayStatus = "online" | "unavailable";

export type WakeResult =
  | { status: "accepted" }
  | { status: "already_online" }
  | { status: "rate_limited"; retryAfter?: number }
  | { status: "unavailable" };

export interface WolRelay {
  readonly id: "home-gateway" | "esp32";
  readonly type: "gateway" | "esp32";
  status(): Promise<RelayStatus>;
  getTargetStatus(target: Target): Promise<TargetStatus>;
  wake(target: Target): Promise<WakeResult>;
}
