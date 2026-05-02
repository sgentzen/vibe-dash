# Vibe Dash — View Purposes

Each top-level view has a single canonical purpose. Keep these distinct when adding panels.

| View key | Nav label | Purpose |
|---|---|---|
| `orchestration` | Overview | At-a-glance command center showing project health score, active blockers, milestone progress, agent compute, and token spend for the selected project. |
| `board` | Board | Kanban board for moving tasks across status columns (planned → in_progress → blocked → done). |
| `agents` | Agents | Per-agent health monitoring: sessions, completions, current task, recent activity, and model details. |
| `list` | List | Flat, sortable task list with inline status editing, filtering, and bulk selection. |
| `dashboard` | Dash | Analytical deep-dive: sprint burndown, velocity trend, agent contributions, activity heatmap, cost charts, and report generation. |
| `timeline` | Timeline | Gantt-style visualization of task durations, sprint boundaries, and inter-task dependencies. |
| `activity` | Activity | Chronological stream of all agent activity events grouped by day for audit and observability. |
| `worktrees` | Worktrees | Git worktree management — create, list, and clean up worktrees linked to specific tasks. |
| `executive` | Executive | Stakeholder-facing summary of milestone health, cost trends, and at-risk signals across all projects. |
