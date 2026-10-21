import type { AgentSession, Role, TokenUsage } from "./types";

/** US dollars per 1 million tokens. */
export interface ModelPrice {
  input: number;
  cachedInput: number;
  /** Cache writes (Anthropic models). Missing means charged as normal input. */
  cacheWrite?: number;
  output: number;
}
export interface PriceEntry extends ModelPrice {
  /** Matched against the model id, ignoring case, dots, spaces and a "claude-" prefix. */
  key: string;
  label: string;
  provider: "OpenAI" | "Anthropic";
}

/** When the default prices below were checked against the official pricing pages. */
export const pricesCheckedOn = "19 October 2026";
export const priceSources = [
  "https://developers.openai.com/api/docs/pricing",
  "https://platform.claude.com/docs/en/about-claude/pricing",
  "https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing",
];

const o = (key: string, label: string, input: number, cachedInput: number, output: number): PriceEntry => ({
  key, label, provider: "OpenAI", input, cachedInput, output,
});
const a = (key: string, label: string, input: number, cachedInput: number, cacheWrite: number, output: number): PriceEntry => ({
  key, label, provider: "Anthropic", input, cachedInput, cacheWrite, output,
});

/**
 * Standard API list prices (no batch or priority tier). Long-context surcharges
 * (OpenAI above 272K tokens, Claude Haiku 5.5 above 100K) are not applied, because
 * usage is only reported as running totals.
 */
export const defaultPrices: PriceEntry[] = [
  o("gpt-6-astra", "GPT-6 Astra", 10, 1, 50),
  o("gpt-6-1-sol", "GPT-6.1 Sol", 2, 0.1, 10),
  o("gpt-6-sol", "GPT-6 Sol", 2, 0.2, 10),
  o("gpt-6-luna", "GPT-6 Luna", 0.1, 0.01, 0.5),
  o("gpt-5-6-sol", "GPT-5.6 Sol", 4, 0.4, 20),
  o("gpt-5-6-terra", "GPT-5.6 Terra", 2, 0.2, 12),
  o("gpt-5-6-luna", "GPT-5.6 Luna", 0.2, 0.02, 1.2),
  o("gpt-5-5", "GPT-5.5", 5, 0.5, 30),
  o("gpt-5-4-mini", "GPT-5.4 mini", 0.75, 0.075, 4.5),
  o("gpt-5-4-nano", "GPT-5.4 nano", 0.2, 0.02, 1.25),
  o("gpt-5-4", "GPT-5.4", 2.5, 0.25, 15),
  o("gpt-5-3-codex", "GPT-5.3-Codex", 1.75, 0.175, 14),
  o("gpt-5-mini", "GPT-5 mini", 0.25, 0.025, 2),
  a("fable-5-1", "Claude Fable 5.1", 10, 0.25, 12.5, 50),
  a("mythos-5-1", "Claude Mythos 5.1", 10, 0.25, 12.5, 50),
  a("fable-5", "Claude Fable 5", 10, 1, 12.5, 50),
  a("mythos-5", "Claude Mythos 5", 10, 1, 12.5, 50),
  a("opus-5-5", "Claude Opus 5.5", 4, 0.2, 5, 20),
  a("opus-5", "Claude Opus 5", 5, 0.5, 6.25, 25),
  a("opus-4-8", "Claude Opus 4.8", 5, 0.5, 6.25, 25),
  a("opus-4-7", "Claude Opus 4.7", 5, 0.5, 6.25, 25),
  a("opus-4-6", "Claude Opus 4.6", 5, 0.5, 6.25, 25),
  a("opus-4-5", "Claude Opus 4.5", 5, 0.5, 6.25, 25),
  a("sonnet-5-5", "Claude Sonnet 5.5", 2, 0.1, 2.5, 10),
  a("sonnet-5", "Claude Sonnet 5", 2, 0.2, 2.5, 10),
  a("sonnet-4-6", "Claude Sonnet 4.6", 3, 0.3, 3.75, 15),
  a("sonnet-4-5", "Claude Sonnet 4.5", 3, 0.3, 3.75, 15),
  a("sonnet-4", "Claude Sonnet 4", 3, 0.3, 3.75, 15),
  a("haiku-5-5", "Claude Haiku 5.5", 0.1, 0.01, 0.125, 0.5),
  a("haiku-4-5", "Claude Haiku 4.5", 1, 0.1, 1.25, 5),
];
/** Claude Code's model aliases point at the latest model of each family. */
const aliases: Record<string, string> = { opus: "opus-5-5", sonnet: "sonnet-5-5", haiku: "haiku-5-5" };

export const normalizeModel = (model: string) =>
  model
    .toLowerCase()
    .trim()
    .replace(/[\s._]+/g, "-")
    .replace(/^(?:anthropic|openai)\//, "")
    .replace(/^claude-/, "");

/** Your own prices win over the defaults; the longest matching key wins (gpt-6-1-sol before gpt-6). */
export function priceFor(model: string | undefined, overrides: Record<string, ModelPrice> = {}) {
  if (!model) return undefined;
  const id = normalizeModel(model);
  const resolved = aliases[id] ?? id;
  const own = Object.entries(overrides)
    .map(([key, price]) => ({ key: normalizeModel(key), price }))
    .filter(({ key }) => key && (resolved === key || resolved.startsWith(`${key}-`) || resolved.startsWith(key)))
    .sort((x, y) => y.key.length - x.key.length)[0];
  if (own) return { key: own.key, label: own.key, ...own.price, custom: true as const };
  const match = defaultPrices
    .filter((entry) => resolved === entry.key || resolved.startsWith(`${entry.key}-`))
    .sort((x, y) => y.key.length - x.key.length)[0];
  return match ? { ...match, custom: false as const } : undefined;
}

/** Estimated cost in US dollars of token usage at the given price. */
export function tokenCost(usage: TokenUsage, price: ModelPrice) {
  const cached = usage.cachedInputTokens;
  const writes = usage.cacheWriteTokens ?? 0;
  const uncached = Math.max(0, usage.inputTokens - cached - writes);
  return (
    (uncached * price.input +
      cached * price.cachedInput +
      writes * (price.cacheWrite ?? price.input) +
      usage.outputTokens * price.output) /
    1_000_000
  );
}

export type CostSource = "reported" | "estimate" | "unpriced" | "none";
export interface SessionCost {
  usd: number;
  source: CostSource;
  model?: string;
  label?: string;
}
/**
 * Cost of one agent session. The runtime's own figure is used when it reports
 * one (Claude's API-price estimate, Copilot's AI credits); otherwise tokens × list price.
 */
export function sessionCost(
  session: AgentSession,
  overrides: Record<string, ModelPrice> = {},
  /** Each runtime's default model, for sessions that ran on "Runtime default" before the model was recorded. */
  defaults: Partial<Record<string, string>> = {},
): SessionCost {
  const usage = session.usage;
  const model = usage?.model || session.model || (session.engine ? defaults[session.engine] : undefined) || undefined;
  if (!usage) return { usd: 0, source: "none", model };
  const price = priceFor(model, overrides);
  if (typeof usage.reportedCostUsd === "number" && !price?.custom)
    return { usd: usage.reportedCostUsd, source: "reported", model, label: price?.label };
  if (!price) return { usd: 0, source: "unpriced", model };
  return { usd: tokenCost(usage, price), source: "estimate", model, label: price.label };
}

export interface AgentCost {
  key: string;
  role: Role;
  verification: boolean;
  engines: string[];
  models: string[];
  sessions: number;
  tokens: number;
  usd: number;
  sources: Set<CostSource>;
}
/** Costs per agent (planner, developer, reviewer, and verification separately), in pipeline order. */
export function costByAgent(
  sessions: AgentSession[],
  overrides: Record<string, ModelPrice> = {},
  defaults: Partial<Record<string, string>> = {},
) {
  const order = ["planner", "developer", "verification", "reviewer"];
  const groups = new Map<string, AgentCost>();
  for (const session of sessions) {
    const verification = session.purpose === "verification";
    const key = verification ? "verification" : session.role;
    const group =
      groups.get(key) ??
      ({ key, role: session.role, verification, engines: [], models: [], sessions: 0, tokens: 0, usd: 0, sources: new Set() } as AgentCost);
    const cost = sessionCost(session, overrides, defaults);
    group.sessions++;
    group.tokens += session.usage?.totalTokens ?? 0;
    group.usd += cost.usd;
    group.sources.add(cost.source);
    if (session.engine && !group.engines.includes(session.engine)) group.engines.push(session.engine);
    const name = cost.label ?? cost.model;
    if (name && !group.models.includes(name)) group.models.push(name);
    groups.set(key, group);
  }
  return [...groups.values()].sort((x, y) => order.indexOf(x.key) - order.indexOf(y.key));
}

export const formatUsd = (usd: number) =>
  usd === 0 ? "$0.00" : usd < 0.01 ? "< $0.01" : `$${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Copilot reports AI credits in nano-AIU: 1 AI credit = 1,000,000,000 nano-AIU = $0.01. */
export const nanoAiuToUsd = (nano: number) => nano / 1e11;
