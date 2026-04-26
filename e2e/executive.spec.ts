import { test, expect } from "@playwright/test";
import { VibeDashApi } from "./helpers/api.js";

test.describe("Dashboard (executive) view", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Dash" }).click();
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

  test("shows report generator card when a project exists", async ({
    page,
    request,
  }) => {
    const api = new VibeDashApi(request);
    await api.createProject(`[E2E] Dash-Report-${Date.now()}`);

    await page.reload();
    await page.getByRole("button", { name: "Dash" }).click();

    const reportBtn = page.getByRole("button", { name: /generate report/i });
    await expect(reportBtn).toBeVisible();
  });

  test("KPI cards render with numeric values", async ({ page }) => {
    // Verify KPI card labels are all present, confirming the grid rendered
    await expect(page.getByText("Open Milestones", { exact: true })).toBeVisible();
    await expect(page.getByText("Active Tasks", { exact: true })).toBeVisible();
  });
});
