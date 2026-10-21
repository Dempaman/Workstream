import { z } from "zod";
import type { ModelPrice } from "./pricing";

export const stages = [
  "intake",
  "planning",
  "approval",
  "developing",
  "verifying",
  "reviewing",
  "ready",
  "publishing",
  "complete",
] as const;
export type Stage = (typeof stages)[number];
export type Role = "planner" | "developer" | "reviewer";
export const checkSchema = z.object({
  name: z.string().min(1),
  executable: z.enum(["npm", "npx", "node"]),
  args: z.array(z.string().min(1)).min(1),
});
export type Check = z.infer<typeof checkSchema>;
export const planSchema = z.object({
  summary: z.string().min(1),
  markdown: z.string().min(1),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
  checks: z.array(checkSchema).min(1),
  specialization: z.string().min(1),
  risks: z.array(z.string()),
});
export type Plan = z.infer<typeof planSchema>;
export const developmentSchema = z.object({
  summary: z.string(),
  files: z.array(z.string()),
  criteriaCovered: z.array(z.string()),
  limitations: z.array(z.string()),
});
export type Development = z.infer<typeof developmentSchema>;
export const reviewSchema = z.object({
  verdict: z.enum(["pass", "changes_requested"]),
  summary: z.string(),
  findings: z.array(
    z.object({
      severity: z.enum(["error", "warning", "info"]),
      file: z.string(),
      line: z.number().int().nonnegative(),
      scenario: z.string(),
      recommendation: z.string(),
    }),
  ),
  acceptanceGaps: z.array(z.string()),
});
export type Review = z.infer<typeof reviewSchema>;
export const verificationSchema = z.object({
  summary: z.string(),
  limitations: z.array(z.string()),
  evidence: z.array(
    z.object({
      check: z.string().min(1),
      method: z.enum([
        "live_browser",
        "fixture_browser",
        "automated_test",
        "inspection",
      ]),
      result: z.enum(["passed", "failed", "unavailable"]),
      details: z.string().min(1),
    }),
  ),
  needs: z.array(
    z.object({
      kind: z.enum(["image", "environment", "code", "verification", "external"]),
      action: z.string().min(1),
    }),
  ),
});
export type Verification = z.infer<typeof verificationSchema>;
export const providerIds = ["azure", "github"] as const;
export type ProviderId = (typeof providerIds)[number];
export const providerNames: Record<Project["provider"], string> = {
  azure: "Azure DevOps",
  github: "GitHub",
  other: "Git repository",
};
/** Who a provider CLI is signed in as. Never contains tokens. */
export interface ProviderAccount {
  provider: ProviderId;
  /** false when the CLI (az / gh) could not be found. */
  cliInstalled: boolean;
  signedIn: boolean;
  /** Login name or e-mail the token belongs to. */
  account?: string;
  displayName?: string;
  tenantId?: string;
  checkedAt?: string;
  error?: string;
  /** Device code shown while a browser sign-in is waiting. */
  loginCode?: string;
  loginUrl?: string;
  signingIn?: boolean;
}
export type MemoryKind = "outcome" | "feedback" | "finding" | "check" | "note";
/** One remembered fact for a project, from a run or written by you. */
export interface MemoryItem {
  id: string;
  projectId: string;
  runId?: string;
  runLabel?: string;
  kind: MemoryKind;
  title: string;
  body: string;
  files: string[];
  pinned: boolean;
  source: "auto" | "user";
  createdAt: string;
  updatedAt: string;
  uses: number;
}
/** A skill found in the connected repository (.agents/skills, .codex/skills, .claude/skills). */
export interface SkillInfo {
  path: string;
  name: string;
  description: string;
  /** Describes a whole delivery workflow; Workstream itself plays that part. */
  workflow: boolean;
}
export type AgentSetup = Record<Role, { skills: string[]; notes: string }>;
/** An MCP connector as shown in the Connectors page. Never contains tokens. */
export interface ConnectorStatus {
  id: string;
  name: string;
  publisher: string;
  description: string;
  url: string;
  auth: "oauth" | "none";
  custom: boolean;
  signedIn: boolean;
  connected: boolean;
  connecting: boolean;
  /** Offered to agents (read-only tools only). */
  enabled: boolean;
  tools: number;
  readOnlyTools: number;
  error?: string;
}
/** An MCP server configured in Claude Code or Codex itself (not in Workstream). */
export interface AgentMcpEntry {
  name: string;
  url?: string;
  state: "connected" | "signed-in" | "needs-auth" | "failed" | "configured" | "disabled" | "unknown";
  detail?: string;
}
export interface AgentMcpReport {
  engine: Engine;
  checkedAt: string;
  servers: AgentMcpEntry[];
  error?: string;
}
/** A connector endpoint handed to an agent session (Workstream's local read-only proxy). */
export interface AgentMcpServer {
  id: string;
  name: string;
  url: string;
  headers: Record<string, string>;
}
export interface JiraTicket {
  key: string;
  title: string;
  description: string;
  url?: string;
}
/** Result of a non-mutating repository permission check for one project. */
export interface RepositoryAccess {
  provider: ProviderId;
  checkedAt: string;
  account?: string;
  /** null = could not be determined. */
  read: boolean | null;
  push: boolean | null;
  createBranch: boolean | null;
  pullRequest: boolean | null;
  /** How git push authenticates for this remote. */
  pushAuth: "cli-token" | "ssh" | "none";
  ok: boolean;
  summary: string;
}
export interface Project {
  archived?: boolean;
  azureTenantId?: string;
  access?: RepositoryAccess;
  skillInfo?: SkillInfo[];
  /** Saved per-role skills and notes. Missing means the suggested mapping is used. */
  agentSetup?: AgentSetup;
  id: string;
  name: string;
  path: string;
  remote: string;
  provider: "azure" | "github" | "other";
  targetBranch: string;
  branchPrefix: string;
  instructions: boolean;
  skills: string[];
  /** Technologies detected in the repository (ids from shared/techstack), for the logos in the app. */
  stack?: string[];
  /** Accept agent permission requests without asking in every run of this project (the agent sandbox still applies). */
  allowAgentCommands?: boolean;
}
/** Where a task lives: its worktree and what your repository has checked out. */
export interface RunLocation {
  checkedAt: string;
  repoPath: string;
  repoBranch?: string;
  repoHead?: string;
  /** Uncommitted changes to tracked files in your repository. */
  repoChanges?: number;
  targetHead?: string;
  /** Local target branch compared with origin (as of the last fetch). */
  targetAhead?: number;
  targetBehind?: number;
  worktreeExists: boolean;
  worktreePath?: string;
  worktreeBranch?: string;
  worktreeHead?: string;
  worktreeChanges?: number;
}
export interface Model {
  id: string;
  name: string;
  description: string;
  isDefault: boolean;
  efforts: string[];
  defaultEffort: string;
}
export type ClaudeAuth = "claude-code" | "api-key";
export const engines = ["codex", "claude", "copilot"] as const;
export type Engine = (typeof engines)[number];
/** Short names where space is tight (the Runs on toggle). */
export const engineShortNames: Record<Engine, string> = { codex: "Codex", claude: "Claude", copilot: "Copilot" };
export const engineNames: Record<Engine, string> = {
  codex: "Codex",
  claude: "Claude",
  copilot: "GitHub Copilot",
};
export interface Profile {
  /** Which agent runtime runs this role. Missing means Codex (older saved state). */
  engine?: Engine;
  model: string;
  effort: string;
}
export interface Settings {
  codexPath: string;
  /** Claude Code executable used by the Claude Agent SDK. */
  claudePath?: string;
  /** Optional path to a Copilot runtime; empty uses the one shipped with Workstream. */
  copilotPath?: string;
  /** How Claude agents sign in. Missing means your Claude Code sign-in. */
  claudeAuth?: ClaudeAuth;
  /** Your own prices (USD per 1M tokens) for cost estimates, keyed by model id. */
  prices?: Record<string, ModelPrice>;
  profiles: Record<Role, Profile>;
}
export interface Activity {
  id: string;
  time: string;
  stage: Stage;
  text: string;
  kind: "info" | "success" | "error";
}
export interface CheckResult extends Check {
  exitCode: number | null;
  output: string;
  passed: boolean;
}
export interface Approval {
  at: string;
  planHash: string;
  publish: boolean;
}
export interface AgentSession {
  /** What this session was told, so you can see why it acted as it did. */
  instructions?: { text: string; skills: { path: string; hash: string }[]; notes: boolean };
  engine?: Engine;
  model?: string;
  purpose?: "verification";
  usage?: TokenUsage;
  role: Role;
  threadId: string;
  turnId?: string;
}
/** Test files never go into a pull request; they stay in the worktree for verification. */
export const isTestFile = (file: string) =>
  /(?:^|\/)(?:__tests__|tests)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(file.replace(/\\/g, "/"));
/** A comment you left on a line in the Changes tab, like a pull request review comment. */
export interface ReviewComment {
  id: string;
  file: string;
  /** Line number in the new file ("new") or, for a removed line, in the old file ("old"). */
  line: number;
  side: "new" | "old";
  /** The code on that line when you commented, so the agent can find it after edits. */
  code: string;
  text: string;
  createdAt: string;
  /** open: not sent yet. sent: handed to the developer. resolved: you closed it. */
  status: "open" | "sent" | "resolved";
  sentAt?: string;
}
/** One "Request changes" round on a run whose pull request already exists. */
export interface Revision {
  number: number;
  /** What you asked to change, in your own words. */
  request: string;
  requestedAt: string;
  /** Branch head the round started from (the commit already in the PR). */
  fromCommit: string;
  /** Content hash when the round started, to detect "no changes made". */
  startHash: string;
  /** What the run looked like before this round, restored if you cancel. */
  previousPlan?: Plan;
  previousDevelopment?: Development;
  previousApproval?: Approval;
  previousChecks?: CheckResult[];
  /** Requested before the pull request existed (at Ready or Publish). */
  beforePr?: boolean;
  /** Before the PR: snapshot of the worktree when the round started (git tree id). */
  fromTree?: string;
  /** Restored if a change request made before the PR is cancelled. */
  previousStage?: Stage;
  previousCommit?: string;
  previousReviewedHash?: string;
  previousRepairCount?: number;
  previousVerification?: Verification;
  previousAcceptedGaps?: Run["acceptedGaps"];
  previousAcceptedReviewIndex?: number;
  /** Filled in as the round progresses. */
  planSummary?: string;
  developmentSummary?: string;
  commit?: string;
  completedAt?: string;
  /** Notes from reopening the branch, for example newer commits picked up. */
  notes?: string[];
}
/** The change request round in progress, if any. */
export function activeRevision(run: Pick<Run, "revisions">) {
  const last = run.revisions?.at(-1);
  return last && !last.completedAt ? last : undefined;
}
export interface Run {
  /** Your line comments from the Changes tab. */
  comments?: ReviewComment[];
  /** "Request changes" rounds after the pull request was created. */
  revisions?: Revision[];
  reviewContentChanged?: boolean;
  /** Where the task lives right now (see describeLocation). */
  location?: RunLocation;
  /** A repository action in progress (for the progress bar): finished steps and the current one. */
  repoAction?: { label: string; startedAt: string; done: string[]; current?: string; expected: number };
  /** The last "Pull the latest" result, shown in the pull request panel. */
  lastPull?: { at: string; branch: string; switched: boolean; before: string; after: string; total: number; commits: { hash: string; subject: string }[] };
  /** The pull request's state at the provider, checked read-only (see pullRequestStatus). */
  prStatus?: { state: "active" | "completed" | "abandoned" | "missing"; checkedAt: string; closedAt?: string; error?: string };
  /** Snapshot of the worktree when the last review ran, so the next review can focus on what changed. */
  lastReviewTree?: string;
  keepNewTestsLocal?: boolean;
  localOnlyFiles?: string[];
  verification?: Verification;
  verificationContentHash?: string;
  verificationAttemptKey?: string;
  images?: Attachment[];
  resolutionNotes?: string;
  lastAttemptHash?: string;
  lastAttemptEvidenceHash?: string;
  memory?: string;
  memorySources?: string[];
  live?: {
    text: string;
    at: string;
    startedAt: string;
    steps?: { step: string; status: string }[];
  };
  id: string;
  projectId: string;
  title: string;
  ticketKey: string;
  description: string;
  stage: Stage;
  status: "idle" | "running" | "blocked";
  createdAt: string;
  updatedAt: string;
  branch: string;
  targetBranch: string;
  worktree?: string;
  baseCommit?: string;
  plan?: Plan;
  approval?: Approval;
  development?: Development;
  reviews: Review[];
  checks: CheckResult[];
  activity: Activity[];
  sessions: AgentSession[];
  repairCount: number;
  diff?: string;
  files: string[];
  reviewedHash?: string;
  reviewedTree?: string;
  commit?: string;
  prUrl?: string;
  /** Unresolved items you accepted as known limitations (listed in the PR). Bound to one review. */
  acceptedGaps?: { text: string; kind: string; reason: string; at: string }[];
  acceptedReviewIndex?: number;
  /** "Allow everything for this run": later permission requests are accepted automatically. */
  autoApprove?: boolean;
  /** Memories handed to this run's agents. */
  memoryUsed?: { id: string; kind: MemoryKind; title: string }[];
  /** Plan revision requests you typed, kept for memory. */
  planFeedback?: string[];
  jiraUpdatedAt?: string;
  /** .env files copied into the worktree when it was created. */
  envFiles?: string[];
  /** The worktree was removed so the branch could be checked out in the repo folder. */
  worktreeRemoved?: boolean;
  previousRepoBranch?: string;
  /** Whether your repository folder has this branch checked out (set by Check out / Switch back). */
  repoCheckedOut?: boolean;
  devServer?: { url?: string; startedAt: string; script: string };
  error?: string;
  profiles: Record<Role, Profile>;
}
export type Theme = "light" | "dark";
export interface ConnectorSettings {
  /** Connector id -> offered to agents. */
  enabled: Record<string, boolean>;
  custom: { id: string; name: string; url: string }[];
  atlassianSites?: { id: string; name: string; url: string }[];
  atlassianSiteId?: string;
}
export interface State {
  theme: Theme;
  version: 1;
  connectors?: ConnectorSettings;
  connections?: Partial<Record<ProviderId, ProviderAccount>>;
  projects: Project[];
  runs: Run[];
  settings: Settings;
}
export interface Runtime {
  /** Claude sign-in in progress: fallback page and whether a pasted code is expected. */
  login?: { url?: string; awaitingCode: boolean };
  limits?: UsageBucket[];
  limitsUpdatedAt?: string;
  limitsError?: string;
  connected: boolean;
  authenticated: boolean;
  accountLabel: string;
  models: Model[];
  error?: string;
  /** Something worth knowing that is not an error, for example a followed Codex app update. */
  note?: string;
}
export interface AgentApproval {
  canAllowSession?: boolean;
  tool?: string;
  command?: string;
  description?: string;
  id: string;
  runId: string;
  method: string;
  details: string;
}
export interface Snapshot extends State {
  runtime: Runtime;
  claude: Runtime & { hasKey: boolean };
  copilot: Runtime;
  connectorList: ConnectorStatus[];
  /** The Memory page's current list (not saved in state.json). */
  memoryView?: { projectId: string; query: string; items: MemoryItem[]; total: number; available: boolean };
  /** MCP servers in Claude Code's and Codex's own settings, from the last check. */
  agentMcp?: Partial<Record<Engine, AgentMcpReport>>;
  agentMcpChecking?: boolean;
  /** Workstream's fixed rules per role, shown read-only. */
  roleRules: Record<Role, string>;
  /** Last Jira import result, used to prefill the new task form. */
  jiraImport?: JiraTicket;
  jiraTransitions?: Record<string, { id: string; name: string }[]>;
  pendingApprovals: AgentApproval[];
  desktop: boolean;
}

const profileSchema = z.object({
  engine: z.enum(engines).optional(),
  model: z.string(),
  effort: z.string(),
});
export const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("connectClaude") }),
  z.object({ type: z.literal("checkAgentMcp") }),
  z.object({ type: z.literal("connectCopilot") }),
  z.object({ type: z.literal("stopAutoApprove"), runId: z.string() }),
  z.object({
    type: z.literal("requestChanges"),
    runId: z.string(),
    request: z.string().trim().min(5).max(20000),
    images: z
      .array(
        z.object({
          name: z.string().min(1).max(200),
          dataUrl: z
            .string()
            .max(6_000_000)
            .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/),
        }),
      )
      .max(6)
      .optional(),
  }),
  z.object({ type: z.literal("cancelChanges"), runId: z.string() }),
  z.object({
    type: z.literal("addComment"),
    runId: z.string(),
    file: z.string().min(1).max(1000),
    line: z.number().int().nonnegative(),
    side: z.enum(["new", "old"]),
    code: z.string().max(2000),
    text: z.string().trim().min(1).max(5000),
  }),
  z.object({
    type: z.literal("updateComment"),
    runId: z.string(),
    id: z.string(),
    text: z.string().trim().min(1).max(5000).optional(),
    status: z.enum(["open", "resolved"]).optional(),
  }),
  z.object({ type: z.literal("deleteComment"), runId: z.string(), id: z.string() }),
  z.object({ type: z.literal("sendComments"), runId: z.string() }),
  z.object({ type: z.literal("checkPullRequest"), runId: z.string() }),
  z.object({ type: z.literal("pullTargetBranch"), runId: z.string() }),
  z.object({ type: z.literal("removeWorktree"), runId: z.string() }),
  z.object({ type: z.literal("inspectLocation"), runId: z.string() }),
  z.object({ type: z.literal("fixFindings"), runId: z.string(), request: z.string().trim().min(5).max(20000) }),
  z.object({
    type: z.literal("acceptGaps"),
    runId: z.string(),
    items: z.array(z.string().max(4000)).min(1).max(50),
    reason: z.string().trim().min(10).max(2000),
  }),
  z.object({ type: z.literal("memoryList"), projectId: z.string(), query: z.string().max(300).optional() }),
  z.object({ type: z.literal("memoryAdd"), projectId: z.string(), title: z.string().trim().min(1).max(300), body: z.string().trim().min(1).max(6000) }),
  z.object({ type: z.literal("memoryUpdate"), id: z.string(), title: z.string().trim().min(1).max(300).optional(), body: z.string().trim().min(1).max(6000).optional(), pinned: z.boolean().optional() }),
  z.object({ type: z.literal("memoryDelete"), id: z.string() }),
  z.object({
    type: z.literal("updateAgentSetup"),
    projectId: z.string(),
    setup: z
      .object({ planner: z.object({ skills: z.array(z.string().max(300)).max(20), notes: z.string().max(8000) }), developer: z.object({ skills: z.array(z.string().max(300)).max(20), notes: z.string().max(8000) }), reviewer: z.object({ skills: z.array(z.string().max(300)).max(20), notes: z.string().max(8000) }) })
      .nullable(),
  }),
  z.object({ type: z.literal("refreshSkills"), projectId: z.string() }),
  z.object({ type: z.literal("openSkill"), projectId: z.string(), path: z.string().max(300) }),
  z.object({ type: z.literal("checkoutInRepo"), runId: z.string() }),
  z.object({ type: z.literal("switchRepoBack"), runId: z.string() }),
  z.object({ type: z.literal("startDevServer"), runId: z.string() }),
  z.object({ type: z.literal("openFolder"), runId: z.string() }),
  z.object({ type: z.literal("openInEditor"), runId: z.string() }),
  z.object({ type: z.literal("loginClaude") }),
  z.object({ type: z.literal("cancelClaudeLogin") }),
  z.object({
    type: z.literal("claudeLoginCode"),
    code: z.string().trim().min(4).max(2000).regex(/^[\x21-\x7e]+$/),
  }),
  z.object({ type: z.literal("connectConnector"), id: z.string().max(80) }),
  z.object({ type: z.literal("disconnectConnector"), id: z.string().max(80) }),
  z.object({
    type: z.literal("toggleConnector"),
    id: z.string().max(80),
    enabled: z.boolean(),
  }),
  z.object({
    type: z.literal("addConnector"),
    name: z.string().trim().min(1).max(80),
    url: z.string().url().max(500),
  }),
  z.object({ type: z.literal("removeConnector"), id: z.string().max(80) }),
  z.object({ type: z.literal("atlassianSite"), id: z.string().max(100) }),
  z.object({
    type: z.literal("importJira"),
    key: z.string().trim().regex(/^[A-Za-z][A-Za-z0-9]*-[0-9]+$/),
  }),
  z.object({ type: z.literal("jiraTransitions"), runId: z.string() }),
  z.object({
    type: z.literal("updateJira"),
    runId: z.string(),
    comment: z.string().max(20000),
    transitionId: z.string().max(50).optional(),
  }),
  z.object({
    type: z.literal("claudeKey"),
    key: z.string().trim().min(20).max(500).regex(/^[\x21-\x7e]+$/).nullable(),
  }),
  z.object({ type: z.literal("keepTestsLocal"), runId: z.string() }),
  z.object({ type: z.literal("checkPublicationAccess"), runId: z.string() }),
  z.object({ type: z.literal("loginAzure"), runId: z.string() }),
  z.object({ type: z.literal("refreshConnections") }),
  z.object({ type: z.literal("checkProjectAccess"), projectId: z.string() }),
  z.object({
    type: z.literal("signIn"),
    provider: z.enum(providerIds),
    projectId: z.string().optional(),
  }),
  z.object({
    type: z.literal("completeVerification"),
    runId: z.string(),
    evidence: z.string().trim().max(12000).optional(),
  }),
  z.object({
    type: z.literal("attachEvidence"),
    runId: z.string(),
    images: z
      .array(
        z.object({
          name: z.string().min(1).max(200),
          dataUrl: z
            .string()
            .max(6_000_000)
            .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/),
        }),
      )
      .min(1)
      .max(6),
  }),
  z.object({ type: z.literal("refreshUsage"), force: z.boolean().optional() }),
  z.object({
    type: z.literal("archiveProject"),
    id: z.string(),
    archived: z.boolean(),
  }),
  z.object({ type: z.literal("theme"), theme: z.enum(["light", "dark"]) }),
  z.object({
    type: z.literal("connectProject"),
    path: z.string().min(1).max(4000),
  }),
  z.object({
    type: z.literal("updateProject"),
    id: z.string(),
    name: z.string().trim().min(1).max(120).optional(),
    provider: z.enum(["azure", "github", "other"]).optional(),
    targetBranch: z.string().min(1),
    branchPrefix: z.string().min(1),
    allowAgentCommands: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("createRun"),
    projectId: z.string(),
    title: z.string().trim().min(1).max(200),
    ticketKey: z.string().trim().max(60),
    description: z.string().trim().min(1).max(50000),
    images: z
      .array(
        z.object({
          name: z.string().min(1).max(200),
          dataUrl: z
            .string()
            .max(6_000_000)
            .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/),
        }),
      )
      .max(6)
      .optional(),
  }),
  z.object({
    type: z.literal("plan"),
    runId: z.string(),
    feedback: z.string().max(10000).optional(),
  }),
  z.object({
    type: z.literal("approve"),
    runId: z.string(),
    plan: planSchema,
    publish: z.boolean(),
  }),
  z.object({
    type: z.literal("continue"),
    runId: z.string(),
    evidence: z.string().trim().max(12000).optional(),
  }),
  z.object({ type: z.literal("publish"), runId: z.string() }),
  z.object({ type: z.literal("interrupt"), runId: z.string() }),
  z.object({
    type: z.literal("agentApproval"),
    id: z.string(),
    accept: z.boolean(),
    scope: z.enum(["once", "session", "pending", "run", "project"]).optional(),
  }),
  z.object({
    type: z.literal("settings"),
    settings: z.object({
      codexPath: z.string().min(1),
      claudePath: z.string().min(1).max(4000).optional(),
      copilotPath: z.string().max(4000).optional(),
      claudeAuth: z.enum(["claude-code", "api-key"]).optional(),
      prices: z
        .record(
          z.string().trim().min(1).max(120),
          z.object({
            input: z.number().nonnegative().max(10000),
            cachedInput: z.number().nonnegative().max(10000),
            cacheWrite: z.number().nonnegative().max(10000).optional(),
            output: z.number().nonnegative().max(10000),
          }),
        )
        .optional(),
      profiles: z.object({
        planner: profileSchema,
        developer: profileSchema,
        reviewer: profileSchema,
      }),
    }),
  }),
  z.object({ type: z.literal("connectAgent") }),
  z.object({ type: z.literal("login") }),
  z.object({ type: z.literal("openExternal"), url: z.string().url() }),
]);
export type Command = z.infer<typeof commandSchema>;
export interface Bridge {
  attachment(id: string): Promise<string>;
  initialTheme: Theme;
  snapshot(): Promise<Snapshot>;
  command(command: Command): Promise<Snapshot>;
  chooseFolder(): Promise<string | null>;
  subscribe(callback: (snapshot: Snapshot) => void): () => void;
}

export interface Attachment {
  id: string;
  name: string;
  mime: string;
}
export interface TokenUsage {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  /** Tokens written to the prompt cache (Anthropic models), included in inputTokens. */
  cacheWriteTokens?: number;
  /** Model that actually answered (the runtime default or Copilot's Auto resolved). */
  model?: string;
  /** Cost the runtime itself reported in US dollars (Claude's API-price figure, Copilot AI credits). */
  reportedCostUsd?: number;
}
export interface UsageWindow {
  usedPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
}
export interface UsageBucket {
  id: string;
  name: string;
  primary: UsageWindow | null;
  secondary: UsageWindow | null;
}
declare global {
  interface Window {
    workstream?: Bridge;
  }
}

/** One readable line for an agent permission request (tool and command). */
export function describeApproval(method: string, params: Record<string, unknown>) {
  const input = (params.input ?? {}) as Record<string, unknown>;
  const raw = params.command ?? input.command ?? input.file_path ?? input.url ?? params.reason;
  const command = Array.isArray(raw) ? raw.join(" ") : typeof raw === "string" ? raw : "";
  const tool =
    typeof params.tool === "string"
      ? params.tool
      : method.includes("commandExecution")
        ? "Command"
        : method.includes("fileChange")
          ? "File change"
          : method.split("/").pop() ?? "Request";
  const description = typeof input.description === "string" ? input.description : "";
  return { tool, command: command.slice(0, 2000), description: description.slice(0, 300) };
}
