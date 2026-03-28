# Vibe Dash — Design Specification

**Date:** 2026-03-28
**Status:** Draft

## Overview

Vibe Dash is a local-first, open-source visual dashboard for monitoring and managing AI-driven development projects. It provides a Three-Zone Mission Control interface for humans and an MCP server for AI agents, giving at-a-glance visibility into what's planned, what's actively being worked on, and what needs attention across multiple projects.

## Problem

AI-driven development workflows lack visibility. When multiple AI agents work across multiple projects, there's no centralized way to see what's happening, what's planned, or what's stuck. Agents don't report progress well, and humans have to piece together status from git commits, scattered files, and terminal output.

## Solution

A dashboard that is simultaneously:
1. **A visual UI** for humans to monitor and manage tasks across projects
2. **An MCP server** that AI agents connect to for reporting progress, creating tasks, and logging activity
3. **A real-time system** where agent activity shows up instantly in the UI

## Target Audience

Open/public tool — designed for any developer or team managing AI-driven development workflows. Should be easy to adopt (npm install, npm start) and work out of the box.

## Architecture

### High-Level

```
┌─────────────────┐     MCP (stdio/SSE)     ┌──────────────────────┐
│   AI Agents     │ ◄──────────────────────► │   Vibe Dash Server   │
│ (Claude Code,   │                          │                      │
│  subagents,     │                          │  ┌────────────────┐  │
│  other MCP      │                          │  │  MCP Server    │  │
│  clients)       │                          │  │  (stdio + SSE) │  │
└─────────────────┘                          │  └───────┬────────┘  │
                                             │          │           │
                                             │  ┌───────▼────────┐  │
                                             │  │  Express API   │  │
                                             │  │  + WebSocket   │  │
                                             │  └───────┬────────┘  │
┌─────────────────┐     WebSocket            │          │           │
│   React UI      │ ◄──────────────────────► │  ┌───────▼────────┐  │
│  (Browser)      │                          │  │    SQLite      │  │
└─────────────────┘                          │  └────────────────┘  │
                                             └──────────────────────┘
```

### Tech Stack

- **Backend:** Node.js + Express + TypeScript
- **Database:** SQLite (via better-sqlite3)
- **Real-time:** WebSocket (ws library)
- **MCP Server:** @modelcontextprotocol/sdk (stdio + SSE transports)
- **Frontend:** React + TypeScript
- **Build:** Vite

### Data Flow

1. Agent calls MCP tool (e.g., `update_task`, `log_activity`)
2. MCP server handler writes to SQLite
3. MCP server handler broadcasts WebSocket event to all connected frontends
4. React UI receives event and updates state in real-time

UI mutations follow the same path: React -> Express API -> SQLite -> WebSocket broadcast.

## UI Design: Three-Zone Mission Control

### Layout

```
┌──────────────────────────────────────────────────────────────────┐
│ VIBE DASH          4 projects  3 agents  1 alert    [+Project]  │
├────────────┬──────────────────────────────┬──────────────────────┤
│            │  Tasks — erate-assistant     │ Live Agent Activity  │
│ PROJECTS   │  [All] [Active] [Planned]   │                      │
│            ├──────────┬─────────┬─────────┤ ● claude-opus        │
│ ● erate-   │ PLANNED  │IN PROG  │ DONE   │   API refactor       │
│   assistant│          │         │        │   refactoring...     │
│ ● erate-   │ Auth     │●API     │✓ DB    │   23m · 65%          │
│   prospect │ midware  │ refactor│ schema │                      │
│ ○ vibe-    │          │         │        │ ● sub-agent-1        │
│   dash     │ Error    │●Write   │✓ Log   │   Write tests        │
│ ⚠ client-  │ handling │ tests   │ infra  │   3/8 tests          │
│   portal   │          │         │        │   12m                │
│            │ [+Add]   │         │        │──────────────────────│
│            │          │         │        │ Recent Events        │
│            │          │         │        │ 2m ago: test 3/8     │
│            │          │         │        │ 5m ago: commit a3f2d │
├────────────┴──────────┴─────────┴─────────┴──────────────────────┤
│ ⚠ ALERT: client-portal deploy blocked by failing test            │
└──────────────────────────────────────────────────────────────────┘
```

### Left Panel: Project List

- Each project shows: name, agent status indicator (active/idle/blocked), mini progress bar, task count summary
- Click a project to filter the center task board to that project
- Color-coded left border: green = active agents, gray = idle, amber = blocked
- **"+ Add Project"** button in the top bar

### Center Panel: Task Board (Kanban)

- Three columns: **Planned**, **In Progress**, **Done**
- Filtered by the selected project in the left panel
- Filter tabs: All / Active / Planned
- Task cards show:
  - Title
  - Description snippet
  - For active tasks: agent name, current action summary, progress bar
  - For sub-tasks: expandable nested list
- **Interactions:**
  - Click card → slide-out edit drawer (title, description, status, priority, sub-tasks)
  - Drag card between columns to change status
  - Double-click title for inline edit
  - "+" button at bottom of each column to add new task

### Right Panel: Agent Activity Feed

- **Top section:** Currently active agents with:
  - Agent name and model
  - Current task and project
  - Current action description (italic)
  - Duration and progress
  - Green pulsing indicator for active agents
- **Bottom section:** Recent Events log (chronological)
  - Timestamped entries: task completions, commits, blockers, agent assignments
  - Amber entries for alerts/blockers

### Top Bar

- App name/logo
- Global stats: project count, active agent count, alert count, total task count
- Action buttons: "+ Add Project", "Settings"

### Bottom Alert Banner

- Appears when there are active blockers or alerts
- Amber background, dismissable
- Shows the most recent/critical alert

## MCP Server

### Transports

- **stdio:** Standard transport for Claude Code integration. Agent configures vibe-dash as an MCP server in their settings.
- **SSE:** HTTP-based transport for multi-agent scenarios and remote connections. Runs on a configurable port.

### Tools

#### Agent Management

**`register_agent`**
- Input: `{ name: string, model?: string, capabilities?: string[] }`
- Output: `{ agent_id: string }`
- Called when an agent connects. Updates `last_seen_at` if agent already registered.

#### Project Management

**`create_project`**
- Input: `{ name: string, description?: string }`
- Output: `{ project_id: string }`

**`list_projects`**
- Input: `{}`
- Output: `{ projects: Project[] }`

#### Task Management

**`create_task`**
- Input: `{ project_id: string, title: string, description?: string, status?: string, priority?: string, parent_task_id?: string }`
- Output: `{ task_id: string }`
- `parent_task_id` creates a sub-task relationship.

**`update_task`**
- Input: `{ task_id: string, title?: string, description?: string, status?: string, priority?: string, progress?: number }`
- Output: `{ success: boolean }`

**`complete_task`**
- Input: `{ task_id: string, summary?: string }`
- Output: `{ success: boolean }`
- Sets status to `done`, progress to 100, records completion summary.

**`get_task`**
- Input: `{ task_id: string }`
- Output: `{ task: Task }`

**`list_tasks`**
- Input: `{ project_id?: string, status?: string, parent_task_id?: string }`
- Output: `{ tasks: Task[] }`

#### Activity & Monitoring

**`log_activity`**
- Input: `{ task_id: string, agent_name: string, message: string }`
- Output: `{ success: boolean }`
- This is the primary real-time reporting tool. Agents call it frequently with short status updates.

**`report_blocker`**
- Input: `{ task_id: string, reason: string }`
- Output: `{ blocker_id: string }`
- Sets task status to `blocked` and creates a blocker record.

**`resolve_blocker`**
- Input: `{ blocker_id: string }`
- Output: `{ success: boolean }`
- Marks blocker as resolved and sets task back to `in_progress`.

## Data Model

### Tables

```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  parent_task_id TEXT REFERENCES tasks(id),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'in_progress', 'blocked', 'done')),
  priority TEXT DEFAULT 'medium'
    CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  model TEXT,
  capabilities TEXT, -- JSON array
  registered_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE activity_log (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  agent_id TEXT REFERENCES agents(id),
  message TEXT NOT NULL,
  timestamp TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE blockers (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  reason TEXT NOT NULL,
  reported_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);
```

### IDs

All IDs are UUIDs (generated via `crypto.randomUUID()`).

## WebSocket Events

Events broadcast from server to all connected React frontends:

- `project_created` — new project added
- `task_created` — new task added
- `task_updated` — task status, progress, or details changed
- `task_completed` — task marked done
- `agent_registered` — new agent connected
- `agent_activity` — real-time activity log entry
- `blocker_reported` — task blocked
- `blocker_resolved` — blocker cleared

Each event includes the full updated entity so the frontend can replace its local state without re-fetching.

## Deployment

### Local-First

```bash
npm install
npm start
# Opens http://localhost:3000 (React UI)
# MCP SSE server on http://localhost:3001
```

### Agent Configuration (Claude Code)

```json
{
  "mcpServers": {
    "vibe-dash": {
      "command": "npx",
      "args": ["vibe-dash", "--stdio"]
    }
  }
}
```

Or for SSE:
```json
{
  "mcpServers": {
    "vibe-dash": {
      "url": "http://localhost:3001/sse"
    }
  }
}
```

### Future: Optional Sync

Not in MVP. Later, add the ability to sync the SQLite database to a shared server so multiple machines can see the same dashboard. This would use a simple HTTP sync protocol.

## Non-Goals (MVP)

- Markdown file sync (bidirectional sync with STATUS.md etc.) — deferred to post-MVP
- Multi-user auth — local-first, single-user for now
- Tags/labels on tasks — can add later
- Task dependencies — can add later
- Heatmap/timeline/orbital alternative views — can add as additional view modes later
- Mobile responsive design — desktop-first

## Success Criteria

1. A human can open the dashboard, see all projects and tasks at a glance, and edit tasks from the UI
2. An AI agent can connect via MCP, create tasks, log activity, and update progress
3. Agent activity appears in the UI within 1 second of the MCP call
4. The dashboard works with zero configuration beyond `npm start`
