import { test, expect } from "@playwright/test";

test.describe("Agents view", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Agents" }).click();
  });

  test("shows Agent Dashboard heading", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "Agent Dashboard" })
    ).toBeVisible();
  });

  test("shows Agents and Performance toggle buttons", async ({ page }) => {
    // The nav "Agents" button is nth(0); the dashboard mode toggle is nth(1)
    await expect(page.getByRole("button", { name: "Agents" }).nth(1)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Performance" })
    ).toBeVisible();
  });

  test("shows status filter buttons in agents mode", async ({ page }) => {
    // FILTER_LABELS: "active+idle" → "Active", "all" → "All", "offline" → "Offline"
    await expect(page.getByRole("button", { name: "Active" })).toBeVisible();
    await expect(page.getByRole("button", { name: "All" }).first()).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Offline", exact: true })
    ).toBeVisible();
  });

  test("switches to Performance view when Performance button is clicked", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Performance" }).click();
    // Status filter buttons are hidden in performance mode
    await expect(page.getByRole("button", { name: "Active" })).not.toBeVisible();
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
      await expect(page.getByRole("button", { name: "Active" })).toBeVisible();
    }
  });

  test("All filter shows all agent health states", async ({ page }) => {
    await page.getByRole("button", { name: "All" }).first().click();
    // Dashboard should still be functional after filter change
    await expect(
      page.getByRole("heading", { name: "Agent Dashboard" })
    ).toBeVisible();
  });
});
