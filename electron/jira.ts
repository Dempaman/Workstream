import type { JiraTicket } from "../shared/types";
import type { Connectors } from "./connectors";

export interface AtlassianSite {
  id: string;
  name: string;
  url: string;
}
const parse = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/** Converts Atlassian Document Format (or plain text) into readable text. */
export function adfToText(node: unknown): string {
  if (typeof node === "string") return node;
  if (!node || typeof node !== "object") return "";
  const value = node as { type?: string; text?: string; content?: unknown[]; attrs?: { url?: string; text?: string } };
  const inner = (value.content ?? []).map(adfToText).join("");
  switch (value.type) {
    case "text":
      return value.text ?? "";
    case "hardBreak":
      return "\n";
    case "mention":
    case "emoji":
      return value.attrs?.text ?? "";
    case "inlineCard":
      return value.attrs?.url ?? "";
    case "paragraph":
    case "heading":
    case "blockquote":
    case "codeBlock":
    case "panel":
      return `${inner}\n\n`;
    case "listItem":
      return `- ${inner.trim()}\n`;
    case "bulletList":
    case "orderedList":
      return `${inner}\n`;
    case "tableRow":
      return `${(value.content ?? []).map((cell) => adfToText(cell).trim()).join(" | ")}\n`;
    default:
      return inner;
  }
}

export async function atlassianSites(connectors: Connectors) {
  const { text, structured } = await connectors.call("atlassian", "getAccessibleAtlassianResources", {});
  const data = (structured as { resources?: unknown } | undefined)?.resources ?? structured ?? parse(text);
  const list = Array.isArray(data) ? data : [];
  return list
    .map((site) => site as { id?: string; name?: string; url?: string; scopes?: string[] })
    .filter((site) => site.id && site.url && (!site.scopes || site.scopes.some((scope) => /jira/i.test(scope))))
    .map((site) => ({ id: site.id!, name: site.name ?? site.url!, url: site.url! }));
}

export async function jiraIssue(connectors: Connectors, site: AtlassianSite, key: string): Promise<JiraTicket> {
  const { text, structured } = await connectors.call("atlassian", "getJiraIssue", {
    cloudId: site.id,
    issueIdOrKey: key,
  });
  const issue = (structured ?? parse(text)) as
    | { key?: string; fields?: Record<string, unknown> }
    | undefined;
  if (!issue?.fields)
    // Some server versions answer in Markdown; keep it as the description.
    return { key, title: key, description: text.trim(), url: `${site.url}/browse/${key}` };
  const fields = issue.fields;
  const name = (value: unknown) => (value as { name?: string } | undefined)?.name;
  const description = adfToText(fields.description).replace(/\n{3,}/g, "\n\n").trim();
  const facts = [
    name(fields.issuetype) && `Type: ${name(fields.issuetype)}`,
    name(fields.status) && `Status: ${name(fields.status)}`,
    Array.isArray(fields.labels) && fields.labels.length ? `Labels: ${fields.labels.join(", ")}` : "",
    name(fields.priority) && `Priority: ${name(fields.priority)}`,
  ].filter(Boolean);
  return {
    key: issue.key ?? key,
    title: String(fields.summary ?? key),
    description: [description || "(No description in Jira.)", facts.join(" · "), `Jira: ${site.url}/browse/${issue.key ?? key}`]
      .filter(Boolean)
      .join("\n\n"),
    url: `${site.url}/browse/${issue.key ?? key}`,
  };
}

export async function jiraTransitions(connectors: Connectors, site: AtlassianSite, key: string) {
  const { text, structured } = await connectors.call("atlassian", "getTransitionsForJiraIssue", {
    cloudId: site.id,
    issueIdOrKey: key,
  });
  const data = (structured ?? parse(text)) as { transitions?: { id: string; name: string }[] } | { id: string; name: string }[] | undefined;
  const list = Array.isArray(data) ? data : (data?.transitions ?? []);
  return list.filter((t) => t?.id && t?.name).map((t) => ({ id: String(t.id), name: String(t.name) }));
}

/** Writes to Jira. Only called after the user clicks Post to Jira. */
export async function updateJira(
  connectors: Connectors,
  site: AtlassianSite,
  key: string,
  comment: string,
  transitionId?: string,
) {
  if (comment.trim())
    await connectors.call("atlassian", "addCommentToJiraIssue", {
      cloudId: site.id,
      issueIdOrKey: key,
      commentBody: comment,
    });
  if (transitionId)
    await connectors.call("atlassian", "transitionJiraIssue", {
      cloudId: site.id,
      issueIdOrKey: key,
      transition: { id: transitionId },
    });
}
