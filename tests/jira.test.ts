import { describe, expect, it, vi } from "vitest";
import { adfToText, atlassianSites, jiraIssue, jiraTransitions, updateJira } from "../electron/jira";
import type { Connectors } from "../electron/connectors";

const stub = (responses: Record<string, unknown>) => {
  const call = vi.fn(async (_id: string, name: string) => {
    if (!(name in responses)) throw new Error(`no ${name}`);
    return { text: JSON.stringify(responses[name]), structured: undefined };
  });
  return { call } as unknown as Connectors & { call: typeof call };
};
const site = { id: "cloud-1", name: "delaval", url: "https://delaval.atlassian.net" };

describe("Jira via the Atlassian connector", () => {
  it("turns Atlassian Document Format into readable text", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "As a farmer" }, { type: "hardBreak" }, { type: "text", text: "I want X" }] },
        { type: "heading", content: [{ type: "text", text: "Acceptance criteria" }] },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Shows price" }] }] }] },
      ],
    };
    const text = adfToText(doc);
    expect(text).toContain("As a farmer\nI want X");
    expect(text).toContain("Acceptance criteria");
    expect(text).toContain("- Shows price");
  });

  it("picks Jira sites and imports an issue into task fields", async () => {
    const connectors = stub({
      getAccessibleAtlassianResources: [
        { id: "cloud-1", name: "delaval", url: "https://delaval.atlassian.net", scopes: ["read:jira-work"] },
        { id: "cloud-2", name: "wiki only", url: "https://x.atlassian.net", scopes: ["read:confluence-content.all"] },
      ],
      getJiraIssue: {
        key: "DPP-3279",
        fields: {
          summary: "Explore block layout",
          description: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Fix spacing" }] }] },
          issuetype: { name: "Story" },
          status: { name: "To Do" },
          labels: ["frontend"],
        },
      },
    });
    expect(await atlassianSites(connectors)).toEqual([site]);
    const ticket = await jiraIssue(connectors, site, "DPP-3279");
    expect(ticket).toMatchObject({ key: "DPP-3279", title: "Explore block layout", url: "https://delaval.atlassian.net/browse/DPP-3279" });
    expect(ticket.description).toContain("Fix spacing");
    expect(ticket.description).toContain("Type: Story · Status: To Do · Labels: frontend");
  });

  it("posts a comment and transition only through explicit update calls", async () => {
    const connectors = stub({
      getTransitionsForJiraIssue: { transitions: [{ id: "31", name: "In Review" }] },
      addCommentToJiraIssue: {},
      transitionJiraIssue: {},
    });
    expect(await jiraTransitions(connectors, site, "DPP-1")).toEqual([{ id: "31", name: "In Review" }]);
    await updateJira(connectors, site, "DPP-1", "PR: https://example/pr/1", "31");
    expect(connectors.call).toHaveBeenCalledWith("atlassian", "addCommentToJiraIssue", { cloudId: "cloud-1", issueIdOrKey: "DPP-1", commentBody: "PR: https://example/pr/1" });
    expect(connectors.call).toHaveBeenCalledWith("atlassian", "transitionJiraIssue", { cloudId: "cloud-1", issueIdOrKey: "DPP-1", transition: { id: "31" } });
  });
});
