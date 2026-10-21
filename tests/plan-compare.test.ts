import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import { RevisionPlan, earlierPlans, seenBefore } from "../src/components/PlanCompare";
import type { Plan, Run } from "../shared/types";

const plan = (summary: string, criteria: string[], check = "npm run test"): Plan => ({
  summary,
  markdown: `## ${summary}`,
  acceptanceCriteria: criteria,
  checks: [{ name: check, executable: "npm", args: check.split(" ").slice(1) }],
  specialization: "frontend",
  risks: [],
});
const original = plan("Dealer filters and cards", ["Badge filters narrow the dealer list", "Dealer cards show contact details"]);
const change1 = plan("Restore dealer cards", ["Dealer cards look as before", "Badge filters narrow the dealer list"]);
const change2 = plan("Space between map and badges", ["There is 16px space between the map and the badges", "Badge filters narrow the dealer list."], "npm run lint");

const run = {
  plan: change2,
  revisions: [
    { number: 1, request: "Restore the cards", requestedAt: "a", fromCommit: "a", startHash: "a", previousPlan: original, completedAt: "b" },
    { number: 2, request: "Add space", requestedAt: "c", fromCommit: "c", startHash: "c", previousPlan: change1 },
  ],
} as unknown as Run;

describe("change plan comparison", () => {
  it("treats reworded or re-punctuated items as earlier ones", () => {
    expect(seenBefore("Badge filters narrow the dealer list.", ["badge filters narrow the dealer list"])).toBe(true);
    expect(seenBefore("There is space between the map and the badges", ["Dealer cards look as before"])).toBe(false);
  });

  it("lists the original plan and earlier change plans in order", () => {
    const { current, earlier } = earlierPlans(run);
    expect(current?.number).toBe(2);
    expect(earlier.map((e) => e.label)).toEqual(["Original plan", "Change plan 1"]);
    expect(earlier[1].plan).toBe(change1);
  });

  it("marks new and carried-over items", () => {
    const html = renderToString(createElement(RevisionPlan, { run }));
    expect(html).toContain("What change request <!-- -->2<!-- --> adds");
    expect(html.match(/plan-tag new/g)?.length).toBe(1 + 2); // legend + new criterion + new check
    expect(html).toContain("From an earlier plan");
    expect(html).toContain("Original plan");
  });
});
