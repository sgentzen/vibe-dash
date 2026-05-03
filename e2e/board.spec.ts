import { test, expect } from "@playwright/test";
import { VibeDashApi } from "./helpers/api.js";

test.describe("Board view", () => {
  test("shows three kanban columns", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Board" }).click();
    // exact: true avoids matching project sidebar stats like "1 planned"
    await expect(page.getByText("PLANNED", { exact: true })).toBeVisible();
    await expect(page.getByText("IN PROGRESS", { exact: true })).toBeVisible();
    await expect(page.getByText("DONE", { exact: true })).toBeVisible();
  });

  test("task created via API appears in Planned column when project is selected", async ({
    page,
    request,
  }) => {
    const api = new VibeDashApi(request);
    const projectName = `[E2E] Board-API-${Date.now()}`;
    const project = await api.createProject(projectName);
    const taskTitle = `E2E Task ${Date.now()}`;
    await api.createTask(project.id, taskTitle);

    await page.goto("/");
    await page.getByRole("button", { name: "Board" }).click();
    await page.getByRole("button", { name: projectName }).click();

    // Verify task is inside the PLANNED column, not just anywhere on the page
    const plannedColumn = page
      .getByText("PLANNED", { exact: true })
      .locator("../..");
    await expect(plannedColumn.getByText(taskTitle).first()).toBeVisible();
  });

  test("creates a task via the board add-task input", async ({
    page,
    request,
  }) => {
    const api = new VibeDashApi(request);
    const projectName = `[E2E] Board-UI-${Date.now()}`;
    const project = await api.createProject(projectName);

    await page.goto("/");
    await page.getByRole("button", { name: "Board" }).click();
    await page.getByRole("button", { name: projectName }).click();

    const taskTitle = `UI Task ${Date.now()}`;
    await page.getByLabel("Add task to PLANNED").fill(taskTitle);
    await page.getByLabel("Add task to PLANNED").press("Enter");

    const plannedColumn = page
      .getByText("PLANNED", { exact: true })
      .locator("../..");
    await expect(plannedColumn.getByText(taskTitle).first()).toBeVisible();
  });

  test("task moves to In Progress column after status update via API", async ({
    page,
    request,
  }) => {
    const api = new VibeDashApi(request);
    const projectName = `[E2E] Board-Status-${Date.now()}`;
    const project = await api.createProject(projectName);
    const taskTitle = `Status Task ${Date.now()}`;
    const task = await api.createTask(project.id, taskTitle);

    // Verify task starts in PLANNED
    await page.goto("/");
    await page.getByRole("button", { name: "Board" }).click();
    await page.getByRole("button", { name: projectName }).click();
    const plannedColumn = page
      .getByText("PLANNED", { exact: true })
      .locator("../..");
    await expect(plannedColumn.getByText(taskTitle).first()).toBeVisible();

    // Update status via API (represents the result of a drag-and-drop action)
    await api.updateTask(task.id, { status: "in_progress" });

    // Reload and verify task is now in the IN PROGRESS column (not PLANNED)
    await page.reload();
    await page.getByRole("button", { name: "Board" }).click();
    await page.getByRole("button", { name: projectName }).click();

    const inProgressColumn = page
      .getByText("IN PROGRESS", { exact: true })
      .locator("../..");
    await expect(inProgressColumn.getByText(taskTitle).first()).toBeVisible();
  });

  test("drags a task card to the In Progress column", async ({
    page,
    request,
  }) => {
    const api = new VibeDashApi(request);
    const projectName = `[E2E] Board-Drag-${Date.now()}`;
    const project = await api.createProject(projectName);
    const taskTitle = `Drag Task ${Date.now()}`;
    const task = await api.createTask(project.id, taskTitle);

    await page.goto("/");
    await page.getByRole("button", { name: "Board" }).click();
    await page.getByRole("button", { name: projectName }).click();

    const taskCard = page.locator("[draggable]", { hasText: taskTitle });
    await expect(taskCard).toBeVisible();

    const inProgressColumn = page
      .getByText("IN PROGRESS", { exact: true })
      .locator("../..");

    // Intercept the PATCH call that fires when a task is dropped
    const patchResponse = page.waitForResponse(
      (res) =>
        res.url().includes("/api/tasks/") && res.request().method() === "PATCH",
      { timeout: 5000 }
    );

    await taskCard.dragTo(inProgressColumn);

    // Wait for the API call to complete, then verify the status changed
    await patchResponse;
    const updated = await api.getTask(task.id);
    expect(updated.status).toBe("in_progress");
  });
});
