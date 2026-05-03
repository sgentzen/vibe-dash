import type { APIRequestContext } from "@playwright/test";

const API_BASE = "http://localhost:3001";

export interface Project {
  id: string;
  name: string;
}

export interface Task {
  id: string;
  title: string;
  status: string;
  project_id: string;
}

export class VibeDashApi {
  constructor(private request: APIRequestContext) {}

  async createProject(name: string): Promise<Project> {
    const res = await this.request.post(`${API_BASE}/api/projects`, {
      data: { name, description: "" },
    });
    if (!res.ok()) {
      throw new Error(
        `POST /api/projects failed: ${res.status()} ${await res.text()}`
      );
    }
    return res.json();
  }

  async createTask(
    projectId: string,
    title: string,
    options: { status?: string; priority?: string } = {}
  ): Promise<Task> {
    const res = await this.request.post(`${API_BASE}/api/tasks`, {
      data: {
        project_id: projectId,
        title,
        status: options.status ?? "planned",
        priority: options.priority ?? "medium",
      },
    });
    if (!res.ok()) {
      throw new Error(
        `POST /api/tasks failed: ${res.status()} ${await res.text()}`
      );
    }
    return res.json();
  }

  async updateTask(
    taskId: string,
    updates: Partial<Pick<Task, "status" | "title"> & { priority: string }>
  ): Promise<Task> {
    const res = await this.request.patch(
      `${API_BASE}/api/tasks/${taskId}`,
      { data: updates }
    );
    if (!res.ok()) {
      throw new Error(
        `PATCH /api/tasks/${taskId} failed: ${res.status()} ${await res.text()}`
      );
    }
    return res.json();
  }

  async getTask(taskId: string): Promise<Task> {
    const res = await this.request.get(`${API_BASE}/api/tasks/${taskId}`);
    if (!res.ok()) {
      throw new Error(
        `GET /api/tasks/${taskId} failed: ${res.status()} ${await res.text()}`
      );
    }
    return res.json();
  }
}
