import type { AddressInfo } from "node:net";
import { afterAll, describe, expect, it } from "vitest";
import express from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { DemoInMemoryAuthProvider } from "@modelcontextprotocol/sdk/examples/server/demoInMemoryOAuthProvider.js";
import { Connectors, memoryVault } from "../electron/connectors";

process.env.MCP_DANGEROUSLY_ALLOW_INSECURE_ISSUER_URL = "1";
const provider = new DemoInMemoryAuthProvider();
const app = express();
app.use(express.json());
const listener = app.listen(0, "127.0.0.1");
await new Promise((resolve) => listener.once("listening", resolve));
const origin = `http://127.0.0.1:${(listener.address() as AddressInfo).port}`;
const mcpUrl = new URL(`${origin}/mcp`);
app.use(mcpAuthRouter({ provider, issuerUrl: new URL(origin), baseUrl: new URL(origin), resourceServerUrl: mcpUrl } as never));
app.post(
  "/mcp",
  requireBearerAuth({ verifier: provider, resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpUrl) }),
  async (request, response) => {
    const server = new Server({ name: "secure", version: "1" }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: "getJiraIssue", inputSchema: { type: "object" } }] }));
    server.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: "text", text: "ok" }] }));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    response.on("close", () => void server.close());
    await server.connect(transport);
    await transport.handleRequest(request, response, request.body);
  },
);
afterAll(() => listener.close());

describe("connector OAuth sign-in", () => {
  it("registers, opens the browser, receives the loopback callback and stores tokens in the vault", async () => {
    const vault = memoryVault();
    const opened: string[] = [];
    // Plays the browser: follow the authorization redirect to Workstream's callback.
    const browser = async (url: string) => {
      opened.push(url);
      const authorize = await fetch(url, { redirect: "manual" });
      const callback = authorize.headers.get("location")!;
      expect(callback).toMatch(/^http:\/\/127\.0\.0\.1:47823\/oauth\/callback\?code=/);
      setTimeout(() => void fetch(callback), 50);
    };
    const definition = { id: "secure", name: "Secure", publisher: "Test", description: "", url: mcpUrl.toString(), auth: "oauth" as const, custom: true };
    const connectors = new Connectors(vault, browser, () => [definition]);
    await connectors.connect("secure", true);
    expect(opened).toHaveLength(1);
    expect(JSON.parse(vault.get("mcp-secure-tokens")!).access_token).toBeTruthy();
    expect(connectors.status({}).find((c) => c.id === "secure")).toMatchObject({ signedIn: true, connected: true, tools: 1 });
    await connectors.close();
    // A restart reuses the stored token without opening the browser.
    const again = new Connectors(vault, async () => { throw new Error("should not open"); }, () => [definition]);
    await expect(again.call("secure", "getJiraIssue", {})).resolves.toMatchObject({ text: "ok" });
    await again.disconnect("secure");
    expect(vault.get("mcp-secure-tokens")).toBeUndefined();
    await again.close();
  });
});
