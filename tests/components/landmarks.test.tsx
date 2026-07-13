// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { ProjectList } from "../../src/components/ProjectList";
import { AgentFeed } from "../../src/components/AgentFeed";
import { RailDrawers } from "../../src/components/RailDrawers";
import { renderWithProviders, screen, resetIdSeq } from "./test-utils";

describe("landmark structure", () => {
  beforeEach(() => {
    resetIdSeq();
  });

  it("sidebar exposes a labelled navigation landmark", () => {
    renderWithProviders(<ProjectList />);
    expect(
      screen.getByRole("navigation", { name: "Projects" }),
    ).toBeInTheDocument();
  });

  it("agent feed exposes a labelled complementary landmark", () => {
    renderWithProviders(<AgentFeed onCollapse={() => {}} />);
    expect(
      screen.getByRole("complementary", { name: "Agent feed" }),
    ).toBeInTheDocument();
  });

  it("center column is the single main landmark", () => {
    renderWithProviders(
      <RailDrawers
        drawer={null}
        onOpenLeft={() => {}}
        onOpenRight={() => {}}
        onClose={() => {}}
        left={<div>left</div>}
        right={<div>right</div>}
        topRow={<div>top</div>}
      >
        <div>center body</div>
      </RailDrawers>,
    );
    const mains = screen.getAllByRole("main", { name: "Main content" });
    expect(mains).toHaveLength(1);
    expect(mains[0]).toHaveTextContent("center body");
  });
});
