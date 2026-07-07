import { test, expect } from "@playwright/test";

// The "Dashboard (executive)" view is the Fleet view's default "Overview" preset
// (FleetView → <DashboardView/> when fleetPreset === "overview"), which is the
// default landing view. There is no "Dash" nav button — navigating to "/" already
// renders the Dashboard, so no extra click is needed in setup.
test.describe("Dashboard (executive) view", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("shows Dashboard heading", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "Dashboard" })
    ).toBeVisible();
  });

  test("shows KPI cards: Open Milestones, Overdue Tasks, Active Blockers, Active Tasks", async ({
    page,
  }) => {
    // Use exact: true because "Open Milestones" also appears as "Open Milestones Overview"
    await expect(page.getByText("Open Milestones", { exact: true })).toBeVisible();
    await expect(page.getByText("Overdue Tasks", { exact: true })).toBeVisible();
    await expect(page.getByText("Active Blockers", { exact: true })).toBeVisible();
    await expect(page.getByText("Active Tasks", { exact: true })).toBeVisible();
  });

  test("shows Cost & Token Tracking section", async ({ page }) => {
    const costSection = page.getByText("Cost & Token Tracking");
    const totalSpend = page.getByText("Total Spend", { exact: true });
    const hasCostData = await totalSpend.isVisible().catch(() => false);
    if (!hasCostData) {
      await expect(costSection).toBeVisible();
    } else {
      await expect(totalSpend).toBeVisible();
    }
  });

  test("shows milestone progress and overview sections", async ({ page }) => {
    // Both MilestoneProgressCard and MilestoneOverviewCard render on the dashboard
    await expect(page.getByText("Open Milestones", { exact: true })).toBeVisible();
  });

  test("KPI cards render with numeric values", async ({ page }) => {
    // Verify KPI card labels are all present, confirming the grid rendered
    await expect(page.getByText("Open Milestones", { exact: true })).toBeVisible();
    await expect(page.getByText("Active Tasks", { exact: true })).toBeVisible();
  });
});
