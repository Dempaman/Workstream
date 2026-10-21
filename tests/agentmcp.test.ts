import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { claudeUserMcpServers, parseClaudeMcpList, parseCodexMcpList, parseCodexRuntime } from "../electron/agentmcp";

describe("your agents' own MCP connections", () => {
  it("reads Claude Code's mcp list, including Windows-style symbols", () => {
    const out = [
      "Checking MCP server health…",
      "",
      "figma: https://mcp.figma.com/mcp (HTTP) - ✓ Connected",
      "linear: https://mcp.linear.app/mcp (HTTP) - ! Needs authentication",
      "local: node server.js - ✗ Failed to connect",
      "plugin:figma:figma: https://mcp.figma.com/mcp (HTTP) - ✓ Connected",
    ].join("\r\n");
    expect(parseClaudeMcpList(out)).toEqual([
      { name: "figma", url: "https://mcp.figma.com/mcp", state: "connected", detail: "Connected" },
      { name: "linear", url: "https://mcp.linear.app/mcp", state: "needs-auth", detail: "Needs authentication" },
      { name: "local", url: undefined, state: "failed", detail: "Failed to connect" },
      expect.objectContaining({ name: "plugin:figma:figma", url: "https://mcp.figma.com/mcp", state: "connected" }),
    ]);
  });

  it("reads Codex's mcp list --json", () => {
    const out = `WARNING: something\n${JSON.stringify([
      { name: "figma", enabled: true, transport: { type: "streamable_http", url: "https://mcp.figma.com/mcp" }, auth_status: "o_auth" },
      { name: "jira", enabled: true, transport: { url: "https://x" }, auth_status: "not_logged_in" },
      { name: "off", enabled: false, transport: { command: "x" }, auth_status: "unsupported" },
    ])}`;
    const servers = parseCodexMcpList(out);
    expect(servers.map((s) => s.state)).toEqual(["signed-in", "needs-auth", "disabled"]);
    expect(servers[1].detail).toContain("codex mcp login jira");
  });

  it("passes only your remote Claude Code servers to Workstream's Claude agents", async () => {
    const home = await mkdtemp(join(tmpdir(), "ws-claudehome-"));
    await writeFile(
      join(home, ".claude.json"),
      JSON.stringify({
        mcpServers: {
          figma: { type: "http", url: "https://mcp.figma.com/mcp" },
          local: { type: "stdio", command: "node", args: ["x.js"] },
          "bad name": { type: "http", url: "https://x" },
        },
        projects: {
          "C:\\Source\\ecommerce-frontend": { mcpServers: { linear: { type: "sse", url: "https://mcp.linear.app/sse" } } },
          "C:\\Other": { mcpServers: { other: { type: "http", url: "https://other" } } },
        },
      }),
    );
    expect(await claudeUserMcpServers(home)).toEqual({ figma: { type: "http", url: "https://mcp.figma.com/mcp" } });
    expect(Object.keys(await claudeUserMcpServers(home, "c:/Source/ecommerce-frontend/"))).toEqual(["figma", "linear"]);
    expect(await claudeUserMcpServers(join(home, "missing"))).toEqual({});
  });

  it("reads what the Codex runtime itself reports, including plugins and apps", () => {
    const servers = parseCodexRuntime(
      {
        data: [
          { name: "figma", pluginId: "figma@openai-curated", httpOrigin: "https://mcp.figma.com", tools: { get_design_context: {}, get_screenshot: {} }, toolsError: null, authStatus: "oAuth" },
          { name: "jira", pluginId: null, httpOrigin: "https://x", tools: {}, toolsError: null, authStatus: "notLoggedIn" },
          { name: "broken", tools: {}, toolsError: "MCP startup failed", authStatus: "unknown" },
        ],
      },
      { data: [{ id: "figma", name: "Figma", isAccessible: true, isEnabled: true }, { id: "slack", name: "Slack", isAccessible: false }] },
    );
    expect(servers.map((s) => [s.name, s.state])).toEqual([
      ["figma (plugin figma@openai-curated)", "connected"],
      ["jira", "needs-auth"],
      ["broken", "failed"],
      ["Figma (app)", "connected"],
    ]);
    expect(servers[0].detail).toBe("2 tools available: get_design_context, get_screenshot");
  });

  it("finds connected apps from the tools codex_apps offers when the app list is empty", () => {
    const servers = parseCodexRuntime(
      {
        data: [
          {
            name: "codex_apps",
            httpOrigin: "https://chatgpt.com",
            tools: {
              figma_get_design_context: { _meta: { connector_id: "c1", connector_name: "Figma" } },
              figma_get_screenshot: { _meta: { connector_id: "c1", connector_name: "Figma" } },
            },
            authStatus: "oAuth",
          },
        ],
      },
      { data: [] },
    );
    expect(servers.map((s) => [s.name, s.state, s.detail])).toEqual([
      ["codex_apps", "connected", "2 tools available: figma_get_design_context, figma_get_screenshot"],
      ["Figma (app)", "connected", "2 tools through codex_apps"],
    ]);
  });
});
