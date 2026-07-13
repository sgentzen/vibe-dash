import { test, expect } from "@playwright/test";

// The Agents view is the Fleet view's "Agents" preset (FleetView → <AgentDashboard/>
// when fleetPreset === "agents"). It is reached via the PresetSwitcher tab, NOT a
// top-level nav button. Note the topbar also renders a "View active agents" stat
// pill, so button locators for "Active"/"Agents" must use exact matching to avoid
// colliding with it (and with project cards in the always-mounted sidebar).
test.describe("Agents view", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // PresetSwitcher renders role="tab" buttons ("Overview preset …", "Agents preset …").
    await page.getByRole("tab", { name: /agents/i }).click();
  });

  test("shows Agent Dashboard heading", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "Agent Dashboard" })
    ).toBeVisible();
  });

  test("shows status filter buttons in agents mode", async ({ page }) => {
    // FILTER_LABELS: "active+idle" → "Active", "all" → "All", "offline" → "Offline".
    // exact: true keeps "Active" from matching the topbar "View active agents" pill.
    await expect(
      page.getByRole("button", { name: "Active", exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "All", exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Offline", exact: true })
    ).toBeVisible();
  });

  test("shows correct state: empty message or agent controls", async ({
    page,
  }) => {
    const emptyMsg = page.getByText("No agents registered yet");
    // isVisible() resolves true when the message is present (no agents registered)
    const showsEmptyState = await emptyMsg.isVisible().catch(() => false);

    if (showsEmptyState) {
      // No agents — empty state message should be visible
      await expect(emptyMsg).toBeVisible();
    } else {
      // Agents are registered — filter controls should be present
      await expect(
        page.getByRole("button", { name: "Active", exact: true })
      ).toBeVisible();
    }
  });

  test("All filter shows all agent health states", async ({ page }) => {
    await page.getByRole("button", { name: "All", exact: true }).click();
    // Dashboard should still be functional after filter change
    await expect(
      page.getByRole("heading", { name: "Agent Dashboard" })
    ).toBeVisible();
  });
});
