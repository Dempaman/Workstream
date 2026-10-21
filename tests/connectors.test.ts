import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { Connectors, isReadOnlyTool, memoryVault } from "../electron/connectors";

const calls: string[] = [];
const upstream = createServer(async (request, response) => {
  const server = new Server({ name: "fake-jira", version: "1" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      { name: "getJiraIssue", inputSchema: { type: "object" } },
      { name: "searchJiraIssuesUsingJql", inputSchema: { type: "object" } },
      { name: "addCommentToJiraIssue", inputSchema: { type: "object" } },
      { name: "fetchThing", inputSchema: { type: "object" }, annotations: { readOnlyHint: false } },
    ],
  }));
  server.setRequestHandler(CallToolRequestSchema, async (call) => {
    calls.push(call.params.name);
    return { content: [{ type: "text", text: JSON.stringify({ called: call.params.name }) }] };
  });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  response.on("close", () => void server.close());
  await server.connect(transport);
  await transport.handleRequest(request, response);
});
await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/mcp`;
afterAll(() => upstream.close());

describe("connector tool policy", () => {
  it("classifies read and write tools", () => {
    expect(isReadOnlyTool({ name: "getJiraIssue" })).toBe(true);
    expect(isReadOnlyTool({ name: "get_figma_data" })).toBe(true);
    expect(isReadOnlyTool({ name: "addCommentToJiraIssue" })).toBe(false);
    expect(isReadOnlyTool({ name: "transitionJiraIssue" })).toBe(false);
    expect(isReadOnlyTool({ name: "getOrCreateThing", annotations: { readOnlyHint: false } })).toBe(false);
    expect(isReadOnlyTool({ name: "doSomething", annotations: { readOnlyHint: true } })).toBe(true);
    expect(isReadOnlyTool({ name: "doSomething" })).toBe(false);
  });
});

describe("agent proxy", () => {
  it("exposes only read-only tools to agents and requires the session key", async () => {
    const connectors = new Connectors(memoryVault(), async () => {}, () => [
      { id: "fake", name: "Fake Jira", publisher: "Test", description: "", url, auth: "none", custom: true },
    ]);
    const [server] = await connectors.agentServers({ fake: true });
    expect(server.name).toBe("workstream_fake");
    const agent = new Client({ name: "agent", version: "1" });
    await agent.connect(new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: server.headers } }));
    const tools = (await agent.listTools()).tools.map((tool) => tool.name);
    expect(tools).toEqual(["getJiraIssue", "searchJiraIssuesUsingJql"]);
    const denied = await agent.callTool({ name: "addCommentToJiraIssue", arguments: {} });
    expect(denied.isError).toBe(true);
    const allowed = await agent.callTool({ name: "getJiraIssue", arguments: { issueIdOrKey: "DPP-1" } });
    expect(JSON.stringify(allowed.content)).toContain("getJiraIssue");
    expect(calls).toEqual(["getJiraIssue"]);
    const stranger = await fetch(server.url, { method: "POST", body: "{}" });
    expect(stranger.status).toBe(401);
    // Workstream itself may call a write tool after an explicit user action.
    await connectors.call("fake", "addCommentToJiraIssue", {});
    expect(calls).toEqual(["getJiraIssue", "addCommentToJiraIssue"]);
    expect(connectors.status({ fake: true }).find((c) => c.id === "fake")).toMatchObject({ connected: true, tools: 4, readOnlyTools: 2, enabled: true });
    await agent.close();
    await connectors.close();
  });
});
