// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { AlertBanner } from "../../src/components/AlertBanner";
import { AppProvider, useNotificationState, useAppDispatch } from "../../src/store";
import {
  renderWithProviders,
  makeBlocker,
  screen,
  resetIdSeq,
} from "./test-utils";

beforeEach(() => {
  resetIdSeq();
});

describe("AlertBanner", () => {
  it("renders nothing when there are no blockers", () => {
    const { container } = renderWithProviders(<AlertBanner />, { seed: { blockers: [] } });
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders the most recent blocker reason", () => {
    renderWithProviders(<AlertBanner />, {
      seed: { blockers: [makeBlocker({ reason: "older" }), makeBlocker({ reason: "newest" })] },
    });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("newest");
    expect(alert).not.toHaveTextContent("older");
  });

  it("counts the remaining blockers as +N more", () => {
    renderWithProviders(<AlertBanner />, {
      seed: { blockers: [makeBlocker(), makeBlocker(), makeBlocker()] },
    });
    expect(screen.getByRole("alert")).toHaveTextContent("+2 more");
  });

  it("omits the count suffix for a single blocker", () => {
    renderWithProviders(<AlertBanner />, { seed: { blockers: [makeBlocker()] } });
    expect(screen.getByRole("alert")).not.toHaveTextContent("more");
  });
});

// `fileConflicts` is vestigial. Commit 0c46e35 cut the agent file-lock feature
// (the `report_working_on` MCP tool, the DB functions, the FileConflict type, the
// SET_FILE_CONFLICTS action) and migration 012_drop_agent_file_locks dropped the
// table, but the `unknown[]` field was left behind in AppState. That orphan kept a
// dead `fileConflicts.length > 0` clause type-checking in App.tsx's banner guard,
// which mounted AlertBanner only for it to render null.
//
// If this test fails, the feature is being reimplemented: delete this block and
// wire the new state into the banner deliberately. Do not gate UI on the orphan.
describe("fileConflicts is vestigial state, not a live signal", () => {
  it("has no writer, so it stays empty as other events arrive", () => {
    const { result } = renderHook(
      () => ({ notifications: useNotificationState(), dispatch: useAppDispatch() }),
      { wrapper: AppProvider },
    );

    expect(result.current.notifications.fileConflicts).toEqual([]);

    act(() => {
      result.current.dispatch({
        type: "WS_EVENT",
        payload: { type: "blocker_reported", payload: makeBlocker() },
      });
    });

    expect(result.current.notifications.fileConflicts).toEqual([]);
  });
});
