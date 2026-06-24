// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  setReducer,
  getInitialTheme,
  getInitialSearchScope,
} from "../../src/state/setReducer";
import type { AppAction, AppState } from "../../src/state/types";

const THEME_KEY = "vibe-dash-theme";
const SCOPE_KEY = "vibe-dash-search-scope";

function reduce(action: AppAction) {
  return setReducer({} as AppState, action);
}

describe("setReducer — browser-storage sanitization", () => {
  beforeEach(() => localStorage.clear());

  describe("SET_THEME", () => {
    it("persists a valid theme", () => {
      reduce({ type: "SET_THEME", payload: "light" });
      expect(localStorage.getItem(THEME_KEY)).toBe("light");
    });

    it("does not persist an unknown / tainted payload", () => {
      reduce({ type: "SET_THEME", payload: "javascript:alert(1)" } as unknown as AppAction);
      expect(localStorage.getItem(THEME_KEY)).toBeNull();
    });
  });

  describe("SET_SEARCH_SCOPE", () => {
    it("persists a valid scope", () => {
      reduce({ type: "SET_SEARCH_SCOPE", payload: "agents" });
      expect(localStorage.getItem(SCOPE_KEY)).toBe("agents");
    });

    it("does not persist an unknown / tainted payload", () => {
      reduce({ type: "SET_SEARCH_SCOPE", payload: "<img src=x onerror=1>" } as unknown as AppAction);
      expect(localStorage.getItem(SCOPE_KEY)).toBeNull();
    });
  });

  describe("initial readers ignore corrupted storage", () => {
    it("reads back a valid stored theme", () => {
      localStorage.setItem(THEME_KEY, "dark");
      expect(getInitialTheme()).toBe("dark");
    });

    it("ignores a corrupted stored theme (falls back)", () => {
      localStorage.setItem(THEME_KEY, "neon");
      // matchMedia polyfill reports matches:false → fall back to "dark".
      expect(getInitialTheme()).toBe("dark");
    });

    it("reads back a valid stored scope", () => {
      localStorage.setItem(SCOPE_KEY, "projects");
      expect(getInitialSearchScope()).toBe("projects");
    });

    it("ignores a corrupted stored scope (falls back to 'all')", () => {
      localStorage.setItem(SCOPE_KEY, "everything");
      expect(getInitialSearchScope()).toBe("all");
    });
  });
});
