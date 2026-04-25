import { Octokit } from "@octokit/rest";
import type Database from "better-sqlite3";
import {
  getGitIntegration,
  upsertLinkedItem,
  getLinkedItemByExternal,
  updateLastSynced,
  getLinkedItemByTaskId,
} from "./db/index.js";
import { createTask } from "./db/index.js";
import { broadcast } from "./websocket.js";

export interface SyncResult {
  integration_id: string;
  issues_pulled: number;
  issues_updated: number;
  errors: string[];
}

/**
 * Pull open issues from GitHub → create/update vibe-dash tasks.
 * - New open issues: create a task (planned, medium priority) + linked_item record.
 * - Already-linked open issues: update the linked_item's external_state.
 * - Does NOT push tasks back to GitHub (push happens via closeLinkedIssue).
 */
export async function syncGitHubIssues(
  db: Database.Database,
  integrationId: string
): Promise<SyncResult> {
  const result: SyncResult = {
    integration_id: integrationId,
    issues_pulled: 0,
    issues_updated: 0,
    errors: [],
  };

  const integration = getGitIntegration(db, integrationId);
  if (!integration) {
    result.errors.push(`Integration ${integrationId} not found`);
    return result;
  }

  const octokit = new Octokit({ auth: integration.token });

  try {
    const { data: issues } = await octokit.issues.listForRepo({
      owner: integration.owner,
      repo: integration.repo,
      state: "open",
      per_page: 100,
    });

    for (const issue of issues) {
      // Skip pull requests (GitHub API returns PRs in the issues endpoint)
      if (issue.pull_request) continue;

      try {
        const existing = getLinkedItemByExternal(db, integrationId, "issue", issue.number);

        if (existing) {
          // Update state on existing linked item
          upsertLinkedItem(db, {
            integration_id: integrationId,
            task_id: existing.task_id,
            item_type: "issue",
            external_number: issue.number,
            external_id: String(issue.id),
            external_title: issue.title,
            external_state: issue.state,
            external_url: issue.html_url,
            pr_number: null,
            pr_state: null,
          });
          result.issues_updated++;
        } else {
          // Create a new task from this issue
          const task = createTask(db, {
            project_id: integration.project_id,
            title: issue.title,
            description: issue.body ?? null,
            status: "planned",
            priority: "medium",
          });

          broadcast({ type: "task_created", payload: task });

          upsertLinkedItem(db, {
            integration_id: integrationId,
            task_id: task.id,
            item_type: "issue",
            external_number: issue.number,
            external_id: String(issue.id),
            external_title: issue.title,
            external_state: issue.state,
            external_url: issue.html_url,
            pr_number: null,
            pr_state: null,
          });

          result.issues_pulled++;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(`Issue #${issue.number}: ${msg}`);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(`GitHub API error: ${msg}`);
  }

  updateLastSynced(db, integrationId);
  return result;
}

/**
 * Close a GitHub issue linked to a task (called when task is completed).
 * Silently returns if no linked issue exists or provider is not github.
 */
export async function closeLinkedIssue(
  db: Database.Database,
  taskId: string
): Promise<void> {
  const linked = getLinkedItemByTaskId(db, taskId);
  if (!linked || linked.provider !== "github") return;

  const octokit = new Octokit({ auth: linked.token });
  await octokit.issues.update({
    owner: linked.owner,
    repo: linked.repo,
    issue_number: linked.external_number,
    state: "closed",
  });
}
