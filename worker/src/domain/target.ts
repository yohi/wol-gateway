export type TargetStatus = "online" | "offline" | "unknown";

export interface Target {
  id: "ai-agent";
  name: string;
  relayId: "home-gateway";
}

export const TARGETS: Readonly<Record<string, Target>> = Object.freeze({
  "ai-agent": Object.freeze({
    id: "ai-agent",
    name: "AIエージェントPC",
    relayId: "home-gateway",
  }),
});

export function getTarget(id: string): Target | undefined {
  return TARGETS[id];
}
