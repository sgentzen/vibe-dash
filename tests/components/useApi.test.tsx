// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useApi, ApiError } from "../../src/hooks/useApi";

type ResOpts = { ok?: boolean; status?: number; retryAfter?: string };

function mockRes(body: unknown, opts: ResOpts = {}): Response {
  const { ok = true, status = 200, retryAfter } = opts;
  const headers = new Headers();
  if (retryAfter !== undefined) headers.set("Retry-After", retryAfter);
  return {
    ok,
    status,
    headers,
    json: async () => body,
  } as unknown as Response;
}

function getFetchMock() {
  return globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
}

describe("useApi", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("getProjects GETs /api/projects and returns parsed JSON", async () => {
    const projects = [{ id: "p1", name: "Demo" }];
    getFetchMock().mockResolvedValue(mockRes(projects));
    const { result } = renderHook(() => useApi());

    await expect(result.current.getProjects()).resolves.toEqual(projects);
    expect(getFetchMock().mock.calls[0][0]).toBe("/api/projects");
  });

  it("getTasks encodes the project_id query param", async () => {
    getFetchMock().mockResolvedValue(mockRes([]));
    const { result } = renderHook(() => useApi());

    await result.current.getTasks("a b/c");
    expect(getFetchMock().mock.calls[0][0]).toBe("/api/tasks?project_id=a%20b%2Fc");
  });

  it("createTask POSTs JSON with the right body and headers", async () => {
    const created = { id: "t1", title: "Write tests" };
    getFetchMock().mockResolvedValue(mockRes(created));
    const { result } = renderHook(() => useApi());

    const data = { project_id: "p1", title: "Write tests" };
    await expect(result.current.createTask(data)).resolves.toEqual(created);

    const [url, init] = getFetchMock().mock.calls[0];
    expect(url).toBe("/api/tasks");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual(data);
  });

  it("throws ApiError carrying the HTTP status on a non-2xx response", async () => {
    getFetchMock().mockResolvedValue(mockRes({ error: "boom" }, { ok: false, status: 500 }));
    const { result } = renderHook(() => useApi());

    const err = await result.current.getProjects().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(500);
    expect(err.retryAfterMs).toBeNull();
  });

  it("parses Retry-After seconds into retryAfterMs on a 429", async () => {
    getFetchMock().mockResolvedValue(
      mockRes({ error: "slow down" }, { ok: false, status: 429, retryAfter: "2" })
    );
    const { result } = renderHook(() => useApi());

    const err = await result.current.getProjects().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(429);
    expect(err.retryAfterMs).toBe(2000);
  });
});
