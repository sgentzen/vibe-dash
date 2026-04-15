import type Database from "better-sqlite3";
import type { ProjectTemplate, TaskPriority } from "../types.js";
import { now, genId } from "./helpers.js";
import { createProject } from "./projects.js";
import { createTask } from "./tasks.js";
import type { Project } from "../types.js";

export function createTemplate(db: Database.Database, name: string, description: string | null, templateJson: string): ProjectTemplate {
  const id = genId();
  const ts = now();
  db.prepare("INSERT INTO project_templates (id, name, description, template_json, created_at) VALUES (?, ?, ?, ?, ?)").run(id, name, description, templateJson, ts);
  return db.prepare("SELECT * FROM project_templates WHERE id = ?").get(id) as ProjectTemplate;
}

export function listTemplates(db: Database.Database): ProjectTemplate[] {
  return db.prepare("SELECT * FROM project_templates ORDER BY name ASC").all() as ProjectTemplate[];
}

export function getTemplate(db: Database.Database, id: string): ProjectTemplate | null {
  return (db.prepare("SELECT * FROM project_templates WHERE id = ?").get(id) as ProjectTemplate | undefined) ?? null;
}

export function deleteTemplate(db: Database.Database, id: string): boolean {
  return db.prepare("DELETE FROM project_templates WHERE id = ?").run(id).changes > 0;
}

export function createProjectFromTemplate(db: Database.Database, templateId: string, projectName: string): Project | null {
  const template = getTemplate(db, templateId);
  if (!template) return null;

  const run = db.transaction(() => {
    const project = createProject(db, { name: projectName, description: template.description });

    const taskDefs = JSON.parse(template.template_json) as { title: string; description?: string; priority?: TaskPriority; children?: { title: string; description?: string; priority?: TaskPriority }[] }[];
    for (const def of taskDefs) {
      const parent = createTask(db, {
        project_id: project.id,
        title: def.title,
        description: def.description ?? null,
        priority: def.priority ?? "medium",
      });
      if (def.children) {
        for (const child of def.children) {
          createTask(db, {
            project_id: project.id,
            parent_task_id: parent.id,
            title: child.title,
            description: child.description ?? null,
            priority: child.priority ?? "medium",
          });
        }
      }
    }

    return project;
  });

  return run();
}

export function seedBuiltInTemplates(db: Database.Database): void {
  const existing = listTemplates(db);
  const BUILT_IN_NAME = "API Project";
  if (existing.some(t => t.name === BUILT_IN_NAME)) return;

  const templates = [
    { name: "API Project", description: "REST API with auth, CRUD, and tests", json: JSON.stringify([
      { title: "Set up project structure", children: [{ title: "Initialize repo" }, { title: "Add linting and formatting" }] },
      { title: "Design API schema", children: [{ title: "Define endpoints" }, { title: "Write OpenAPI spec" }] },
      { title: "Implement authentication", priority: "high" },
      { title: "Implement CRUD endpoints", priority: "high" },
      { title: "Add integration tests", priority: "high" },
      { title: "Deploy to staging" },
    ])},
    { name: "Frontend Feature", description: "UI feature with components, state, and tests", json: JSON.stringify([
      { title: "Design mockups" },
      { title: "Create components", priority: "high", children: [{ title: "Build UI components" }, { title: "Add styling" }] },
      { title: "Wire up state management", priority: "high" },
      { title: "Add unit tests", priority: "high" },
      { title: "QA and polish" },
    ])},
    { name: "Bug Triage", description: "Bug investigation and fix workflow", json: JSON.stringify([
      { title: "Reproduce the bug", priority: "high" },
      { title: "Identify root cause", priority: "high" },
      { title: "Write failing test" },
      { title: "Implement fix", priority: "high" },
      { title: "Verify fix and regression test" },
    ])},
    { name: "Milestone Retro", description: "Milestone retrospective template", json: JSON.stringify([
      { title: "Collect feedback — what went well" },
      { title: "Collect feedback — what could improve" },
      { title: "Identify action items", priority: "high" },
      { title: "Assign action item owners" },
      { title: "Schedule follow-up" },
    ])},
  ];

  for (const t of templates) {
    createTemplate(db, t.name, t.description, t.json);
  }
}
