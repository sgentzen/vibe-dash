# Vibe Dash: Full Feature Vision

> **Historical planning artifact from 2026-03-29.** Not maintained — see [CLAUDE.md](../../../CLAUDE.md) for current architecture.

**Date:** 2026-03-29
**Status:** Draft
**Strategy:** Mission Control — balanced releases improving both agent visibility and project management in tandem

## Context

Vibe Dash is a local-first visual dashboard for monitoring AI-driven development projects. It currently has a solid MVP: projects, tasks (kanban with drag-drop), sprints, subtasks, agents, activity logging, blockers, and real-time WebSocket updates via an MCP server.

**Target audience:** Open-source community — developers adopting AI-agent workflows.

**Positioning:** "See what your AI agents are doing" + "Project management built for AI-first workflows." The differentiator is that agents are first-class participants, not an afterthought bolted onto a traditional PM tool.

**Pain points driving this vision:**
1. Can't tell which agent is doing what (agent visibility is too shallow)
2. No way to plan and prioritize work (PM features are thin)

This document maps the full product vision across five themes, to be implemented in themed releases that advance both axes simultaneously.

---

## Theme 1: Agent Visibility

### 1.1 Agent Assignment & Ownership
- Add `assigned_agent_id` (nullable FK to agents) on tasks. Single assignee per task (simple model; multi-assignee adds complexity without clear benefit for agent workflows).
- Task cards show assigned agent with their color badge.
- MCP tools: `assign_task(task_id, agent_id)`, `unassign_task(task_id)`.
- `list_tasks` gains `assigned_agent_id` filter.
- WebSocket events: `task_assigned`, `task_unassigned`.

### 1.2 Agent Dashboard View
- Full-page view showing each agent as a card:
  - Current task, recent activity timeline, tasks completed today, model, capabilities.
- Agent health indicator:
  - Active (green): activity in last 5 min.
  - Idle (yellow): 5-30 min since last activity.
  - Offline (gray): 30+ min.
- Click agent card to see full activity history and completion stats.

### 1.3 Agent Session Tracking
- New `agent_sessions` table: `id, agent_id, started_at, ended_at, tasks_touched, activity_count`.
- Sessions auto-start on first activity, auto-close after inactivity timeout (configurable, default 30min).
- MCP tool: `list_agent_sessions(agent_id)`.
- UI: session timeline in agent detail view.

### 1.4 Agent Conflict Detection
- MCP tool: `report_working_on(task_id, file_paths[])` — agents declare files they're touching.
- New `agent_file_locks` table: `agent_id, task_id, file_path, started_at`.
- Dashboard detects overlapping file_paths across agents and surfaces warnings.
- Alert banner shows: "Agent A and Agent B are both editing src/auth.ts".

### 1.5 Agent Performance Metrics
- Computed stats per agent:
  - Tasks completed (total, this sprint, today).
  - Avg completion time (first activity to `complete_task`).
  - Blocker rate (% of tasks that hit a blocker).
  - Activity frequency (events per hour while active).
- Sprint-level: agent contribution breakdown (pie chart of who completed what).
- MCP tool: `get_agent_stats(agent_id)`.

---

## Theme 2: Planning & Prioritization

### 2.1 Due Dates & Urgency
- Add `due_date` (nullable TEXT, ISO date) to tasks table.
- Visual treatment on task cards:
  - Overdue: red border/badge.
  - Due today: amber indicator.
  - Due this week: subtle dot.
- Sort option: "due soonest" on the board and list views.
- MCP: `update_task` already accepts arbitrary fields — just add schema support.

### 2.2 Time Estimates & Actuals
- Add `estimate` (nullable INTEGER, story points) to tasks.
- `time_spent` computed from activity log: delta between first activity and completion.
- Sprint capacity view: total estimated points vs. completed points vs. remaining.
- MCP tool: `update_task` gains `estimate` field.

### 2.3 Task Tags & Labels
- New tables: `tags(id, project_id, name, color)`, `task_tags(id, task_id, tag_id)`.
- Tags are project-scoped with a color (hex string).
- Multiple tags per task.
- MCP tools: `create_tag(project_id, name, color)`, `add_tag(task_id, tag_id)`, `remove_tag(task_id, tag_id)`, `list_tags(project_id)`.
- UI: colored tag pills on task cards; filter board by tag(s).

### 2.4 Sprint Velocity & Burndown
- Track completed points/tasks per day within a sprint.
- New table or computed view: `sprint_daily_stats(sprint_id, date, completed_points, remaining_points)`.
- Burndown chart: ideal line vs. actual.
- Velocity trend: average points completed across last 5 sprints.
- UI: new Sprint detail view with chart.

### 2.5 Task Dependencies
- New table: `task_dependencies(id, task_id, depends_on_task_id, created_at)`.
- A task cannot move to "in_progress" if unresolved dependencies exist (soft warning, not hard block).
- Visual: "blocked by 2 tasks" badge on cards; hover to see which.
- Auto-notify when a blocking task completes.
- MCP tools: `add_dependency(task_id, depends_on_task_id)`, `remove_dependency(dependency_id)`, `list_dependencies(task_id)`.

### 2.6 Recurring Tasks
- Add `recurrence_rule` (nullable TEXT) to tasks. Format: simple keywords (`daily`, `weekly`, `monthly`) or cron expression.
- When a recurring task is completed, a new instance is auto-created with the next due date.
- Recurring icon on task cards.
- MCP tool: `update_task` gains `recurrence_rule` field.

---

## Theme 3: Views & Navigation

### 3.1 Search & Advanced Filtering
- Global search bar in TopBar: full-text search across task titles, descriptions, activity messages.
- Filter panel (collapsible sidebar or dropdown): combine project, sprint, status, priority, tag, agent, due date range.
- Saved filter presets stored in SQLite: `saved_filters(id, name, filter_json)`.
- MCP tool: `search_tasks(query, filters)`.

### 3.2 List View
- Alternative to kanban: sortable data table with columns for all task fields.
- Column sorting (click header to sort).
- Bulk select (checkboxes) + bulk actions: change status, priority, assignee, tags.
- MCP tool: `bulk_update_tasks(task_ids[], updates)`.

### 3.3 Timeline / Gantt View
- Horizontal timeline: tasks as bars from start_date to due_date.
- Dependencies shown as arrows between bars.
- Sprint boundaries as vertical markers.
- Drag bar ends to adjust dates.
- Requires `start_date` field on tasks (nullable, defaults to created_at).

### 3.4 Dashboard / Overview View
- At-a-glance project health:
  - Burndown chart (current sprint).
  - Velocity trend (last 5 sprints).
  - Agent activity heatmap (which agents are most active, by hour).
  - Active blockers list.
  - Overdue tasks count.
- Configurable: per-project or cross-project.

### 3.5 Activity Stream View
- Full-page chronological feed of all activity across projects.
- Filterable by agent, project, task, event type.
- "What happened while I was away?" catch-up mode: shows activity since last visit.
- Timestamp grouping (today, yesterday, this week).

---

## Theme 4: Collaboration & Communication

### 4.1 Task Comments
- New table: `task_comments(id, task_id, agent_id, author_name, message, created_at)`.
- Both humans (via UI) and agents (via MCP) can comment.
- Distinct from activity log — comments are intentional messages, activity is automated system events.
- MCP tool: `add_comment(task_id, message, agent_name)`, `list_comments(task_id)`.
- UI: comment thread in TaskEditDrawer.

### 4.2 Notifications & Alerts
- Configurable alert rules stored in SQLite: `alert_rules(id, event_type, filter_json, enabled)`.
- Examples: "notify when any task is blocked", "when agent X completes a task", "when high-priority task is overdue".
- In-app notification center: bell icon in TopBar with unread count.
- New table: `notifications(id, rule_id, message, read, created_at)`.
- Optional: browser Notification API for desktop alerts.

### 4.3 @Mentions
- In comment text, parse `@agent-name` patterns.
- Create a notification for the mentioned entity.
- Highlighted in the comment UI.
- Agents could poll for mentions via MCP: `list_mentions(agent_name)`.

### 4.4 Auto-Generated Status Reports
- MCP tool: `generate_report(project_id, period)` — produces markdown summary.
- Content: tasks completed, blockers encountered, agent contributions, sprint progress, velocity.
- UI action: "Generate Report" button on project view.
- Output: markdown to clipboard, or rendered in a modal.
- Useful for standup prep, stakeholder updates.

---

## Theme 5: Developer Experience & Ecosystem

### 5.1 Guided Onboarding
- First-run detection (empty database → show wizard).
- Steps: create first project, configure an agent (show `.mcp.json` snippet), create a sample task.
- Optional: load a demo project with pre-populated tasks to show the dashboard in action.
- "Copy MCP config" button generates the correct `.mcp.json` for the user's OS/path.

### 5.2 Project Templates
- New table: `project_templates(id, name, description, template_json)`.
- `template_json` contains a task hierarchy to auto-create.
- Built-in templates: "API Project", "Frontend Feature", "Bug Triage", "Sprint Retro".
- Custom templates: save current project structure as a template.
- MCP tool: `create_project_from_template(template_name, project_name)`.

### 5.3 Webhooks & Extensibility
- New table: `webhooks(id, url, event_types[], active)`.
- Fire HTTP POST to registered URLs on events (task_completed, blocker_reported, etc.).
- Payload: event type + entity data as JSON.
- UI: webhook management in settings.

### 5.4 CLI Companion
- `vibe-dash` CLI: `list`, `add-task`, `status`, `agents`.
- Shares SQLite database with the web dashboard.
- Lightweight: no server needed, direct DB access.
- Published as a separate npm package or sub-command of the main package.

### 5.5 Multi-Device Sync
- Optional cloud sync layer (Turso/LibSQL, Supabase, or custom).
- Local-first remains default — sync is opt-in.
- Enables: access from multiple machines, sharing with team members.
- Conflict resolution: last-write-wins for simple fields, merge for activity logs.

### 5.6 Theming
- Light theme option (not just dark).
- Custom accent color picker.
- CSS custom properties already in use — theme switching is straightforward.

---

## Suggested Release Groupings

These are logical groupings, not a strict order. Each release improves both agent visibility and PM capabilities:

| Release | Agent Side | PM Side | DX Side |
|---------|-----------|---------|---------|
| **R1: Foundations** | Assignment (1.1), Health indicators (from 1.2) | Due dates (2.1), Tags (2.3) | Onboarding wizard (5.1) |
| **R2: Intelligence** | Dashboard view (1.2), Session tracking (1.3) | Estimates (2.2), Dependencies (2.5) | Search & filtering (3.1) |
| **R3: Communication** | Conflict detection (1.4) | Comments (4.1), Notifications (4.2) | List view (3.2) |
| **R4: Analytics** | Performance metrics (1.5) | Burndown & velocity (2.4) | Dashboard view (3.4), Reports (4.4) |
| **R5: Power User** | @Mentions (4.3) | Recurring tasks (2.6), Timeline (3.3) | Templates (5.2) |
| **R6: Ecosystem** | — | Bulk actions (from 3.2) | Webhooks (5.3), CLI (5.4), Theming (5.6) |

---

## Non-Goals (Explicitly Out of Scope)

- **Multi-user auth / RBAC** — Local-first tool, not a SaaS. Defer until cloud sync exists.
- **Mobile app** — Desktop-first. Responsive web is sufficient for now.
- **AI-powered features** (auto-prioritization, smart assignment) — Interesting but premature. Get the data model right first.
- **Real-time collaborative editing** — Tasks are small; last-write-wins is fine.
- **Billing / monetization** — Open source. No paid tiers in this vision.
