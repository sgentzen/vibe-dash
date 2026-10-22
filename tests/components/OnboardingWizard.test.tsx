// @vitest-environment jsdom
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { OnboardingWizard } from "../../src/components/OnboardingWizard";

// Unlike the other modals, the wizard's FocusTrap keeps focus-trap's default
// visibility check, which sees no tabbable node under jsdom's zero-size layout
// and throws on mount. Focus trapping is not what these tests are about.
vi.mock("focus-trap-react", () => ({
  FocusTrap: ({ children }: { children: ReactNode }) => children,
}));

const createProjectMock = vi.fn();
vi.mock("../../src/hooks/useApi", () => ({
  useApi: () => ({ createProject: createProjectMock }),
}));

// jsdom has no navigator.clipboard, so each test installs its own.
const writeTextMock = vi.fn();

/** Create a project to reach the "Connect an Agent" step with the copy button. */
async function renderAtConfigStep(): Promise<void> {
  render(<OnboardingWizard onComplete={() => {}} />);
  fireEvent.change(screen.getByLabelText("Project Name"), { target: { value: "Demo" } });
  fireEvent.click(screen.getByRole("button", { name: "Create Project" }));
  await screen.findByRole("button", { name: "Copy Config" });
}

describe("OnboardingWizard copy config", () => {
  beforeEach(() => {
    createProjectMock.mockReset().mockResolvedValue({ id: "proj-1" });
    writeTextMock.mockReset();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextMock },
      configurable: true,
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it("says Copied! once the config is on the clipboard", async () => {
    writeTextMock.mockResolvedValue(undefined);
    await renderAtConfigStep();

    fireEvent.click(screen.getByRole("button", { name: "Copy Config" }));

    expect(await screen.findByRole("button", { name: "Copied!" })).toBeTruthy();
    expect(writeTextMock).toHaveBeenCalledWith(expect.stringContaining('"vibe-dash"'));
  });

  // A refused write used to be an unhandled rejection, which vitest reports as
  // a failed run; it is now caught, and the button must not claim success.
  it("keeps offering Copy Config when the clipboard refuses the write", async () => {
    writeTextMock.mockRejectedValue(new Error("denied"));
    await renderAtConfigStep();

    fireEvent.click(screen.getByRole("button", { name: "Copy Config" }));

    await waitFor(() => expect(writeTextMock).toHaveBeenCalled());
    await Promise.resolve();
    expect(screen.getByRole("button", { name: "Copy Config" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Copied!" })).toBeNull();
  });
});
