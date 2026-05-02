import { describe, it, expect } from "vitest";
import {
  TASK_STATUS_TOKEN,
  MILESTONE_HEALTH_TOKEN,
  AGENT_HEALTH_TOKEN,
  tokenToColor,
} from "../src/constants/statusTokens.js";
import type { TaskStatus, AgentHealthStatus } from "../src/types.js";
import type { MilestoneHealthStatus } from "../src/constants/statusTokens.js";

const TASK_STATUSES: TaskStatus[] = ["planned", "in_progress", "blocked", "done"];
const MILESTONE_HEALTHS: MilestoneHealthStatus[] = ["on_track", "at_risk", "behind"];
const AGENT_HEALTHS: AgentHealthStatus[] = ["active", "idle", "offline"];

describe("TASK_STATUS_TOKEN", () => {
  it("maps every TaskStatus to a token", () => {
    for (const status of TASK_STATUSES) {
      expect(TASK_STATUS_TOKEN[status]).toBeDefined();
    }
  });

  it("maps critical statuses to the correct tokens", () => {
    expect(TASK_STATUS_TOKEN.planned).toBe("neutral");
    expect(TASK_STATUS_TOKEN.in_progress).toBe("success");
    expect(TASK_STATUS_TOKEN.blocked).toBe("danger");
    expect(TASK_STATUS_TOKEN.done).toBe("info");
  });
});

describe("MILESTONE_HEALTH_TOKEN", () => {
  it("maps every MilestoneHealthStatus to a token", () => {
    for (const health of MILESTONE_HEALTHS) {
      expect(MILESTONE_HEALTH_TOKEN[health]).toBeDefined();
    }
  });

  it("maps health states to the correct tokens", () => {
    expect(MILESTONE_HEALTH_TOKEN.on_track).toBe("success");
    expect(MILESTONE_HEALTH_TOKEN.at_risk).toBe("warning");
    expect(MILESTONE_HEALTH_TOKEN.behind).toBe("danger");
  });
});

describe("AGENT_HEALTH_TOKEN", () => {
  it("maps every AgentHealthStatus to a token", () => {
    for (const health of AGENT_HEALTHS) {
      expect(AGENT_HEALTH_TOKEN[health]).toBeDefined();
    }
  });

  it("maps health states to the correct tokens", () => {
    expect(AGENT_HEALTH_TOKEN.active).toBe("success");
    expect(AGENT_HEALTH_TOKEN.idle).toBe("warning");
    expect(AGENT_HEALTH_TOKEN.offline).toBe("neutral");
  });
});

describe("tokenToColor", () => {
  it("returns a CSS var referencing --status-<token>", () => {
    expect(tokenToColor("success")).toBe("var(--status-success)");
    expect(tokenToColor("warning")).toBe("var(--status-warning)");
    expect(tokenToColor("danger")).toBe("var(--status-danger)");
    expect(tokenToColor("info")).toBe("var(--status-info)");
    expect(tokenToColor("neutral")).toBe("var(--status-neutral)");
  });
});
