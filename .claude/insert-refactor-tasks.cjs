const Database = require("better-sqlite3");
const { randomUUID } = require("crypto");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const data = JSON.parse(
  fs.readFileSync(path.join(__dirname, "refactor-tasks.json"), "utf8")
);
const db = new Database(path.join(repoRoot, "vibe-dash.db"));
db.pragma("foreign_keys = ON");

const ins = db.prepare(
  "INSERT INTO tasks (id, project_id, parent_task_id, milestone_id, assigned_agent_id, title, description, status, priority, progress, due_date, start_date, estimate, recurrence_rule, created_at, updated_at)" +
    " VALUES (?, ?, NULL, ?, NULL, ?, ?, 'planned', ?, 0, NULL, NULL, NULL, NULL, ?, ?)"
);

const existingTitles = new Set(
  db
    .prepare("SELECT title FROM tasks WHERE milestone_id = ?")
    .all(data.milestone_id)
    .map((r) => r.title)
);

const insertAll = db.transaction((rows) => {
  const now = new Date().toISOString();
  let created = 0;
  let skipped = 0;
  for (const t of rows) {
    if (existingTitles.has(t.title)) {
      skipped++;
      continue;
    }
    ins.run(
      randomUUID(),
      data.project_id,
      data.milestone_id,
      t.title,
      t.description,
      t.priority,
      now,
      now
    );
    created++;
  }
  return { created, skipped };
});

const result = insertAll(data.tasks);
console.log("result:", JSON.stringify(result));

const summary = db
  .prepare(
    "SELECT priority, COUNT(*) AS n FROM tasks WHERE milestone_id = ? GROUP BY priority ORDER BY CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END"
  )
  .all(data.milestone_id);
console.log("by priority:", JSON.stringify(summary));

const total = db
  .prepare("SELECT COUNT(*) AS n FROM tasks WHERE milestone_id = ?")
  .get(data.milestone_id);
console.log("total tasks in milestone:", total.n);

db.close();
