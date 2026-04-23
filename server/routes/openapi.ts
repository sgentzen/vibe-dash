import { Router } from "express";
import type Database from "better-sqlite3";
import type { BroadcastFn, RouteFactory } from "./types.js";

const TaskStatus = { type: "string", enum: ["planned", "in_progress", "blocked", "done"] };
const TaskPriority = { type: "string", enum: ["low", "medium", "high", "urgent"] };
const MilestoneStatus = { type: "string", enum: ["open", "achieved"] };
const nullableString = { type: ["string", "null"] };

const Task = {
  type: "object",
  properties: {
    id: { type: "string" },
    project_id: { type: "string" },
    parent_task_id: nullableString,
    milestone_id: nullableString,
    assigned_agent_id: nullableString,
    title: { type: "string" },
    description: nullableString,
    status: TaskStatus,
    priority: TaskPriority,
    progress: { type: "number", minimum: 0, maximum: 100 },
    due_date: nullableString,
    start_date: nullableString,
    estimate: { type: ["integer", "null"] },
    recurrence_rule: nullableString,
    created_at: { type: "string" },
    updated_at: { type: "string" },
  },
};

const Project = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    description: nullableString,
    created_at: { type: "string" },
    updated_at: { type: "string" },
  },
};

const Milestone = {
  type: "object",
  properties: {
    id: { type: "string" },
    project_id: { type: "string" },
    name: { type: "string" },
    description: nullableString,
    acceptance_criteria: nullableString,
    target_date: nullableString,
    status: MilestoneStatus,
    created_at: { type: "string" },
    updated_at: { type: "string" },
  },
};

const Agent = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    model: nullableString,
    capabilities: { type: "string" },
    role: nullableString,
    last_seen_at: nullableString,
  },
};

const Error = {
  type: "object",
  properties: { error: { type: "string" } },
};

function build(): Record<string, unknown> {
  const paths: Record<string, unknown> = {};
  const idParam = { name: "id", in: "path", required: true, schema: { type: "string" } };

  const json = (ref: string) => ({ "application/json": { schema: { $ref: `#/components/schemas/${ref}` } } });
  const jsonList = (ref: string) => ({ "application/json": { schema: { type: "array", items: { $ref: `#/components/schemas/${ref}` } } } });
  const body = (ref: string) => ({ required: true, content: json(ref) });

  paths["/api/stats"] = {
    get: {
      summary: "Dashboard stats",
      responses: { "200": { description: "OK", content: { "application/json": { schema: { type: "object" } } } } },
    },
  };

  paths["/api/projects"] = {
    get: { summary: "List projects", responses: { "200": { description: "OK", content: jsonList("Project") } } },
    post: {
      summary: "Create project",
      requestBody: body("CreateProject"),
      responses: { "201": { description: "Created", content: json("Project") }, "400": { description: "Invalid input", content: json("Error") } },
    },
  };

  paths["/api/projects/{id}"] = {
    put: {
      summary: "Update project",
      parameters: [idParam],
      requestBody: body("UpdateProject"),
      responses: { "200": { description: "OK", content: json("Project") }, "404": { description: "Not found", content: json("Error") } },
    },
  };

  paths["/api/tasks"] = {
    get: {
      summary: "List tasks",
      parameters: [
        { name: "project_id", in: "query", schema: { type: "string" } },
        { name: "status", in: "query", schema: TaskStatus },
        { name: "parent_task_id", in: "query", schema: { type: "string" } },
        { name: "assigned_agent_id", in: "query", schema: { type: "string" } },
      ],
      responses: { "200": { description: "OK", content: jsonList("Task") } },
    },
    post: {
      summary: "Create task",
      requestBody: body("CreateTask"),
      responses: { "201": { description: "Created", content: json("Task") }, "400": { description: "Invalid input", content: json("Error") } },
    },
  };

  paths["/api/tasks/{id}"] = {
    get: {
      summary: "Get task",
      parameters: [idParam],
      responses: { "200": { description: "OK", content: json("Task") }, "404": { description: "Not found", content: json("Error") } },
    },
    patch: {
      summary: "Update task",
      parameters: [idParam],
      requestBody: body("UpdateTask"),
      responses: { "200": { description: "OK", content: json("Task") }, "404": { description: "Not found", content: json("Error") } },
    },
  };

  paths["/api/tasks/{id}/complete"] = {
    post: {
      summary: "Mark task complete",
      parameters: [idParam],
      responses: { "200": { description: "OK", content: json("Task") } },
    },
  };

  paths["/api/tasks/search"] = {
    get: {
      summary: "Search tasks",
      parameters: [
        { name: "q", in: "query", schema: { type: "string" } },
        { name: "project_id", in: "query", schema: { type: "string" } },
        { name: "status", in: "query", schema: TaskStatus },
        { name: "priority", in: "query", schema: TaskPriority },
      ],
      responses: { "200": { description: "OK", content: jsonList("Task") } },
    },
  };

  paths["/api/milestones"] = {
    get: {
      summary: "List milestones",
      parameters: [{ name: "project_id", in: "query", schema: { type: "string" } }],
      responses: { "200": { description: "OK", content: jsonList("Milestone") } },
    },
    post: {
      summary: "Create milestone",
      requestBody: body("CreateMilestone"),
      responses: { "201": { description: "Created", content: json("Milestone") } },
    },
  };

  paths["/api/milestones/{id}"] = {
    patch: {
      summary: "Update milestone",
      parameters: [idParam],
      requestBody: body("UpdateMilestone"),
      responses: { "200": { description: "OK", content: json("Milestone") } },
    },
  };

  paths["/api/agents"] = {
    get: { summary: "List agents", responses: { "200": { description: "OK", content: jsonList("Agent") } } },
  };

  paths["/api/blockers"] = {
    get: { summary: "List active blockers", responses: { "200": { description: "OK" } } },
    post: {
      summary: "Report blocker",
      requestBody: {
        required: true,
        content: { "application/json": { schema: { type: "object", required: ["task_id", "reason"], properties: { task_id: { type: "string" }, reason: { type: "string" } } } } },
      },
      responses: { "201": { description: "Created" }, "400": { description: "Invalid input", content: json("Error") } },
    },
  };

  paths["/api/costs"] = {
    post: {
      summary: "Log cost entry",
      requestBody: body("LogCost"),
      responses: { "201": { description: "Created" } },
    },
  };

  paths["/api/integrations/pagerduty"] = {
    post: {
      summary: "PagerDuty webhook",
      parameters: [
        { name: "project_id", in: "query", required: true, schema: { type: "string" } },
        { name: "assigned_agent_id", in: "query", schema: { type: "string" } },
      ],
      requestBody: { required: true, content: { "application/json": { schema: { type: "object" } } } },
      responses: { "201": { description: "Task created" }, "400": { description: "Invalid input", content: json("Error") } },
    },
  };
  paths["/api/integrations/sentry"] = paths["/api/integrations/pagerduty"];
  paths["/api/integrations/grafana"] = paths["/api/integrations/pagerduty"];
  paths["/api/integrations/generic"] = paths["/api/integrations/pagerduty"];

  return {
    openapi: "3.1.0",
    info: {
      title: "Vibe Dash API",
      version: "1.0.0",
      description: "Local-first real-time dashboard for monitoring AI-driven development projects via MCP.",
    },
    servers: [{ url: "http://localhost:3001", description: "Local dev server" }],
    paths,
    components: {
      schemas: {
        Task,
        Project,
        Milestone,
        Agent,
        Error,
        CreateProject: {
          type: "object",
          required: ["name"],
          properties: { name: { type: "string", minLength: 1 }, description: { type: "string" } },
        },
        UpdateProject: {
          type: "object",
          properties: { name: { type: "string", minLength: 1 }, description: nullableString },
        },
        CreateTask: {
          type: "object",
          required: ["project_id", "title", "priority"],
          properties: {
            project_id: { type: "string" },
            parent_task_id: nullableString,
            milestone_id: nullableString,
            assigned_agent_id: nullableString,
            title: { type: "string", minLength: 1 },
            description: nullableString,
            status: TaskStatus,
            priority: TaskPriority,
            due_date: nullableString,
            start_date: nullableString,
            estimate: { type: ["integer", "null"], minimum: 0 },
            recurrence_rule: nullableString,
          },
        },
        UpdateTask: {
          type: "object",
          properties: {
            title: { type: "string", minLength: 1 },
            description: nullableString,
            status: TaskStatus,
            priority: TaskPriority,
            progress: { type: "number", minimum: 0, maximum: 100 },
            parent_task_id: nullableString,
            milestone_id: nullableString,
            assigned_agent_id: nullableString,
            due_date: nullableString,
            start_date: nullableString,
            estimate: { type: ["integer", "null"], minimum: 0 },
            recurrence_rule: nullableString,
          },
        },
        CreateMilestone: {
          type: "object",
          required: ["project_id", "name"],
          properties: {
            project_id: { type: "string" },
            name: { type: "string", minLength: 1 },
            description: nullableString,
            acceptance_criteria: nullableString,
            target_date: nullableString,
            status: MilestoneStatus,
          },
        },
        UpdateMilestone: {
          type: "object",
          properties: {
            name: { type: "string", minLength: 1 },
            description: nullableString,
            acceptance_criteria: nullableString,
            target_date: nullableString,
            status: MilestoneStatus,
          },
        },
        LogCost: {
          type: "object",
          required: ["model", "provider", "input_tokens", "output_tokens", "cost_usd"],
          properties: {
            model: { type: "string" },
            provider: { type: "string" },
            input_tokens: { type: "number", minimum: 0 },
            output_tokens: { type: "number", minimum: 0 },
            cost_usd: { type: "number", minimum: 0 },
            agent_id: { type: "string" },
            task_id: { type: "string" },
            milestone_id: { type: "string" },
            project_id: { type: "string" },
          },
        },
      },
    },
  };
}

const SWAGGER_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Vibe Dash API Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.onload = () => {
      window.ui = SwaggerUIBundle({
        url: "/api/openapi.json",
        dom_id: "#swagger-ui",
        deepLinking: true,
      });
    };
  </script>
</body>
</html>`;

export const openapiRoutes: RouteFactory = (_db: Database.Database, _broadcast: BroadcastFn): Router => {
  const router = Router();
  const spec = build();

  router.get("/api/openapi.json", (_req, res) => {
    res.json(spec);
  });

  router.get("/api/docs", (_req, res) => {
    res.type("html").send(SWAGGER_HTML);
  });

  return router;
};
