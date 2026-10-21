import { createServer, type IncomingMessage, type Server as HttpServer } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  UnauthorizedError,
  type OAuthClientProvider,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import type { ConnectorStatus } from "../shared/types";

/** Encrypted named secrets (Electron safeStorage in the app, memory in tests). */
export interface SecretVault {
  get(name: string): string | undefined;
  set(name: string, value: string | undefined): void;
}
export const memoryVault = (): SecretVault => {
  const values = new Map<string, string>();
  return {
    get: (name) => values.get(name),
    set: (name, value) =>
      value === undefined ? values.delete(name) : values.set(name, value),
  };
};

export interface ConnectorDefinition {
  id: string;
  name: string;
  publisher: string;
  description: string;
  url: string;
  /** "oauth" for hosted servers, "none" for local ones such as the Figma desktop app. */
  auth: "oauth" | "none";
  custom?: boolean;
}
export const catalogue: ConnectorDefinition[] = [
  {
    id: "atlassian",
    name: "Atlassian (Jira, Confluence)",
    publisher: "Atlassian",
    description:
      "Import Jira tickets into tasks, let agents read issues and Confluence pages, and post the PR back to Jira.",
    url: "https://mcp.atlassian.com/v1/mcp",
    auth: "oauth",
  },
  {
    id: "figma",
    name: "Figma",
    publisher: "Figma",
    description:
      "Let agents read frames, components and design tokens from Figma links in the ticket.",
    url: "https://mcp.figma.com/mcp",
    auth: "oauth",
  },
  {
    id: "figma-desktop",
    name: "Figma desktop app",
    publisher: "Figma",
    description:
      "Local MCP server of the Figma desktop app (enable it under Preferences in Figma). No sign-in needed.",
    url: "http://127.0.0.1:3845/mcp",
    auth: "none",
  },
];

/**
 * Agents only ever see read-only tools. A tool counts as read-only when the
 * server marks it so, or when its name clearly reads data and the server has
 * not marked it as mutating. Writes happen only through explicit Workstream
 * actions that the user clicks.
 */
export function isReadOnlyTool(tool: Pick<Tool, "name" | "annotations">) {
  if (tool.annotations?.readOnlyHint === true) return true;
  if (tool.annotations?.readOnlyHint === false) return false;
  if (tool.annotations?.destructiveHint === true) return false;
  const name = tool.name.replace(/[_-]/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  if (/\b(create|update|edit|delete|remove|add|transition|post|set|move|upload|write|publish|assign|send|archive|merge|close|comment)\b/.test(name))
    return false;
  return /^(get|search|list|fetch|lookup|read|find|query|describe|whoami|atlassian user info|download|export|view)\b/.test(name);
}

const callbackPort = 47823;
const redirectUrl = `http://127.0.0.1:${callbackPort}/oauth/callback`;

class VaultOAuthProvider implements OAuthClientProvider {
  pendingState?: string;
  constructor(
    private id: string,
    private vault: SecretVault,
    private open: (url: string) => Promise<void>,
  ) {}
  private read<T>(key: string) {
    const value = this.vault.get(`mcp-${this.id}-${key}`);
    return value ? (JSON.parse(value) as T) : undefined;
  }
  private write(key: string, value: unknown) {
    this.vault.set(`mcp-${this.id}-${key}`, value === undefined ? undefined : JSON.stringify(value));
  }
  get redirectUrl() {
    return redirectUrl;
  }
  get clientMetadata() {
    return {
      client_name: "Workstream",
      redirect_uris: [redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }
  state() {
    this.pendingState = randomUUID();
    return this.pendingState;
  }
  clientInformation() {
    return this.read<never>("client");
  }
  saveClientInformation(info: unknown) {
    this.write("client", info);
  }
  tokens() {
    return this.read<never>("tokens");
  }
  saveTokens(tokens: unknown) {
    this.write("tokens", tokens);
  }
  async redirectToAuthorization(url: URL) {
    const local = ["127.0.0.1", "localhost"].includes(url.hostname);
    if (url.protocol !== "https:" && !local)
      throw new Error("Refusing a non-HTTPS sign-in page.");
    await this.open(url.toString());
  }
  saveCodeVerifier(verifier: string) {
    this.write("verifier", verifier);
  }
  codeVerifier() {
    const verifier = this.read<string>("verifier");
    if (!verifier) throw new Error("Sign-in expired. Start it again.");
    return verifier;
  }
  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery") {
    if (scope === "all" || scope === "client") this.write("client", undefined);
    if (scope === "all" || scope === "tokens") this.write("tokens", undefined);
    if (scope === "all" || scope === "verifier") this.write("verifier", undefined);
  }
  get signedIn() {
    return Boolean(this.read("tokens"));
  }
}

/** Waits for the OAuth redirect on the fixed loopback port. */
function waitForCallback(expectedState: () => string | undefined, signal: AbortSignal) {
  return new Promise<string>((resolve, reject) => {
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", redirectUrl);
      if (url.pathname !== "/oauth/callback") {
        response.writeHead(404).end();
        return;
      }
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const ok = Boolean(code) && state === expectedState();
      response
        .writeHead(ok ? 200 : 400, { "Content-Type": "text/html; charset=utf-8" })
        .end(
          `<!doctype html><title>Workstream</title><body style="font-family:system-ui;padding:40px"><h2>${ok ? "Signed in. You can close this window and return to Workstream." : "Sign-in failed. Return to Workstream and try again."}</h2></body>`,
        );
      server.close();
      if (ok) resolve(code!);
      else reject(new Error(url.searchParams.get("error_description") ?? "Sign-in was cancelled or did not match this request."));
    });
    server.on("error", (error) =>
      reject(
        (error as NodeJS.ErrnoException).code === "EADDRINUSE"
          ? new Error(`Port ${callbackPort} is in use, so the sign-in callback cannot be received. Close the other sign-in and retry.`)
          : error,
      ),
    );
    signal.addEventListener("abort", () => {
      server.close();
      reject(new Error("Sign-in timed out. Start it again."));
    });
    server.listen(callbackPort, "127.0.0.1");
  });
}

type Live = { client: Client; tools: Tool[] };

export class Connectors {
  private live = new Map<string, Live>();
  private proxy?: HttpServer;
  private proxyKey = randomBytes(24).toString("hex");
  private connecting = new Set<string>();
  constructor(
    private vault: SecretVault,
    private open: (url: string) => Promise<void>,
    private customs: () => ConnectorDefinition[] = () => [],
  ) {}
  definitions() {
    return [...catalogue, ...this.customs()];
  }
  definition(id: string) {
    const found = this.definitions().find((c) => c.id === id);
    if (!found) throw new Error("Connector not found.");
    return found;
  }
  private provider(id: string) {
    return new VaultOAuthProvider(id, this.vault, this.open);
  }
  status(enabled: Record<string, boolean>): ConnectorStatus[] {
    return this.definitions().map((definition) => {
      const live = this.live.get(definition.id);
      const signedIn =
        definition.auth === "none" || this.provider(definition.id).signedIn;
      return {
        id: definition.id,
        name: definition.name,
        publisher: definition.publisher,
        description: definition.description,
        url: definition.url,
        auth: definition.auth,
        custom: Boolean(definition.custom),
        signedIn,
        connected: Boolean(live),
        connecting: this.connecting.has(definition.id),
        enabled: enabled[definition.id] ?? false,
        tools: live?.tools.length ?? 0,
        readOnlyTools: live?.tools.filter(isReadOnlyTool).length ?? 0,
      };
    });
  }
  private transport(definition: ConnectorDefinition, provider?: VaultOAuthProvider) {
    return new StreamableHTTPClientTransport(new URL(definition.url), {
      ...(provider ? { authProvider: provider } : {}),
    });
  }
  /** Connects, running the browser sign-in first when needed. */
  async connect(id: string, interactive: boolean) {
    const definition = this.definition(id);
    if (this.live.has(id)) return this.live.get(id)!;
    this.connecting.add(id);
    try {
      const provider = definition.auth === "oauth" ? this.provider(id) : undefined;
      let client = new Client({ name: "workstream", version: "1" });
      let transport = this.transport(definition, provider);
      try {
        await client.connect(transport);
      } catch (error) {
        if (!(error instanceof UnauthorizedError) || !provider) {
          throw new Error(
            definition.auth === "none"
              ? `${definition.name} is not reachable at ${definition.url}. Start it and try again.`
              : /\b403\b/.test(String(error)) && /figma\.com/i.test(definition.url)
                ? "Figma only lets approved apps (such as Claude Code, Codex, Cursor and VS Code) connect to its online MCP server, and Workstream is not one of them. Connect Figma in Claude Code or Codex instead (see \"Your agents' own connections\" below), or use the Figma desktop app connector."
                : `${definition.name} could not be reached: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        if (!interactive)
          throw new Error(`${definition.name} needs you to sign in again in Connectors.`);
        // The SDK has opened the browser. Wait for the redirect, then finish.
        const timeout = new AbortController();
        const timer = setTimeout(() => timeout.abort(), 5 * 60_000);
        const code = await waitForCallback(() => provider.pendingState, timeout.signal).finally(() => clearTimeout(timer));
        await transport.finishAuth(code);
        transport = this.transport(definition, provider);
        client = new Client({ name: "workstream", version: "1" });
        await client.connect(transport);
      }
      const tools: Tool[] = [];
      let cursor: string | undefined;
      do {
        const page = await client.listTools(cursor ? { cursor } : {});
        tools.push(...page.tools);
        cursor = page.nextCursor;
      } while (cursor);
      const live = { client, tools };
      this.live.set(id, live);
      return live;
    } finally {
      this.connecting.delete(id);
    }
  }
  async disconnect(id: string) {
    await this.live.get(id)?.client.close().catch(() => {});
    this.live.delete(id);
    this.provider(id).invalidateCredentials("all");
  }
  /** Workstream's own calls (Jira import and explicit Jira updates). */
  async call(id: string, name: string, args: Record<string, unknown>) {
    const live = await this.connect(id, false);
    if (!live.tools.some((tool) => tool.name === name))
      throw new Error(`${this.definition(id).name} does not offer the ${name} tool.`);
    const result = await live.client.callTool({ name, arguments: args });
    const text = ((result.content ?? []) as { type: string; text?: string }[])
      .filter((part) => part.type === "text")
      .map((part) => part.text ?? "")
      .join("\n");
    if (result.isError) throw new Error(`${name} failed: ${text.slice(0, 500)}`);
    return { text, structured: result.structuredContent };
  }
  hasTool(id: string, name: string) {
    return Boolean(this.live.get(id)?.tools.some((tool) => tool.name === name));
  }
  /**
   * MCP endpoints for agent sessions: a loopback proxy that forwards only
   * read-only tools. Tokens never leave Workstream.
   */
  async agentServers(enabled: Record<string, boolean>) {
    const ids = this.definitions()
      .map((d) => d.id)
      .filter((id) => enabled[id]);
    const ready: string[] = [];
    for (const id of ids) {
      try {
        await this.connect(id, false);
        ready.push(id);
      } catch {
        /* Skipped; the Connectors page shows why. */
      }
    }
    if (!ready.length) return [];
    const port = await this.startProxy();
    return ready.map((id) => ({
      id,
      name: `workstream_${id.replace(/[^a-z0-9]/gi, "_")}`,
      url: `http://127.0.0.1:${port}/mcp/${encodeURIComponent(id)}`,
      headers: { "X-Workstream-Key": this.proxyKey },
    }));
  }
  private async startProxy() {
    if (!this.proxy) {
      this.proxy = createServer((request, response) => {
        void this.handleProxy(request, response).catch(() => {
          if (!response.headersSent) response.writeHead(500).end();
        });
      });
      await new Promise<void>((resolve, reject) => {
        this.proxy!.once("error", reject);
        this.proxy!.listen(0, "127.0.0.1", () => resolve());
      });
    }
    return (this.proxy.address() as AddressInfo).port;
  }
  private async handleProxy(request: IncomingMessage, response: import("node:http").ServerResponse) {
    const match = request.url?.match(/^\/mcp\/([^/?#]+)/);
    const live = match ? this.live.get(decodeURIComponent(match[1])) : undefined;
    if (request.headers["x-workstream-key"] !== this.proxyKey || !live) {
      response.writeHead(request.headers["x-workstream-key"] !== this.proxyKey ? 401 : 404).end();
      return;
    }
    const readOnly = live.tools.filter(isReadOnlyTool);
    const server = new Server(
      { name: "workstream-proxy", version: "1" },
      { capabilities: { tools: {} } },
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: readOnly }));
    server.setRequestHandler(CallToolRequestSchema, async (call) => {
      if (!readOnly.some((tool) => tool.name === call.params.name))
        return {
          isError: true,
          content: [{ type: "text", text: "Workstream only allows read-only connector tools for agents." }],
        };
      return (await live.client.callTool(call.params)) as never;
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    response.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(request, response);
  }
  async close() {
    for (const live of this.live.values()) await live.client.close().catch(() => {});
    this.live.clear();
    this.proxy?.close();
    this.proxy = undefined;
  }
}
