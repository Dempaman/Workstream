import { git } from "./process";
import { activeRevision, type Project, type RepositoryAccess, type Run } from "../shared/types";
import { assertApproved, reviewCleared, safeRemote } from "./guards";
import { inspectChanges, isAgentState, localTestFiles } from "./repository";
import { access as pathAccess } from "node:fs/promises";
import { join } from "node:path";
import { azurePermissions, azureSession } from "./azure";
import { githubPermissions, githubSession } from "./github";
import { providerForRemote, type NetworkFetch } from "./hosting";

export type { NetworkFetch } from "./hosting";
export { azureRepository } from "./azure";
export class ReviewContentChanged extends Error {}

/** One pull request for the branch, as the provider reports it. */
export interface PullRequestInfo {
  id: number;
  active: boolean;
  /** completed = merged into the target branch; abandoned = closed without merging. */
  state: "active" | "completed" | "abandoned";
  closedAt?: string;
}
/** A provider that can publish one pull request for the run branch. */
interface PullRequestHost {
  name: string;
  account?: string;
  /** Short-lived Git config so push uses the same account as the API. */
  gitEnv: Record<string, string>;
  access(): Promise<RepositoryAccess>;
  pullRequests(source: string, target: string): Promise<PullRequestInfo[]>;
  create(title: string, description: string, source: string, target: string): Promise<string>;
  update(id: number, title: string, description: string): Promise<string>;
  descriptionLimit: number;
}

async function hostFor(
  project: Project,
  networkFetch: NetworkFetch,
): Promise<PullRequestHost> {
  const provider = project.provider ?? providerForRemote(project.remote ?? "");
  if (provider === "azure") {
    const session = await azureSession(project, networkFetch);
    const { organization, project: azureProject, repository } = session.repo;
    const url = (id: number) =>
      `https://dev.azure.com/${encodeURIComponent(organization)}/${encodeURIComponent(azureProject)}/_git/${encodeURIComponent(repository)}/pullrequest/${id}`;
    const identity = (pr: { pullRequestId?: unknown }) => {
      if (!Number.isInteger(pr?.pullRequestId))
        throw new Error(
          "Azure did not return a PR identity. Retry to reconcile with the provider.",
        );
      return pr.pullRequestId as number;
    };
    return {
      name: "Azure DevOps",
      account: session.identity.account,
      gitEnv: session.gitEnv,
      access: () => azurePermissions(project, session),
      descriptionLimit: 3900,
      async pullRequests(source, target) {
        const query = new URLSearchParams({
          "searchCriteria.sourceRefName": `refs/heads/${source}`,
          "searchCriteria.targetRefName": `refs/heads/${target}`,
          "searchCriteria.status": "all",
        });
        const existing = (await session.request(`/pullrequests?${query}`)) as {
          value?: { pullRequestId: number; status: string; closedDate?: string }[];
        };
        return (existing?.value ?? []).map((pr) => ({
          id: pr.pullRequestId,
          active: pr.status === "active",
          state: pr.status === "completed" ? "completed" : pr.status === "abandoned" ? "abandoned" : "active",
          ...(pr.closedDate && pr.status !== "active" ? { closedAt: pr.closedDate } : {}),
        }));
      },
      async create(title, description, source, target) {
        return url(
          identity(
            (await session.request("/pullrequests", "POST", {
              title,
              description,
              sourceRefName: `refs/heads/${source}`,
              targetRefName: `refs/heads/${target}`,
            })) as { pullRequestId?: unknown },
          ),
        );
      },
      async update(id, title, description) {
        return url(
          identity(
            (await session.request(`/pullrequests/${id}`, "PATCH", {
              title,
              description,
            })) as { pullRequestId?: unknown },
          ),
        );
      },
    };
  }
  if (provider === "github") {
    const session = await githubSession(project, networkFetch);
    const owner = session.repo!.owner;
    const link = (pr: { number?: unknown; html_url?: unknown }) => {
      if (!Number.isInteger(pr?.number) || typeof pr.html_url !== "string")
        throw new Error(
          "GitHub did not return a PR identity. Retry to reconcile with the provider.",
        );
      return pr.html_url;
    };
    return {
      name: "GitHub",
      account: session.account,
      gitEnv: session.gitEnv,
      access: () => githubPermissions(project, session),
      descriptionLimit: 60_000,
      async pullRequests(source, target) {
        const query = new URLSearchParams({
          head: `${owner}:${source}`,
          base: target,
          state: "all",
        });
        const existing = (await session.api(
          `${session.base}/pulls?${query}`,
        )) as { number: number; state: string; merged_at?: string | null; closed_at?: string | null }[];
        return (Array.isArray(existing) ? existing : []).map((pr) => ({
          id: pr.number,
          active: pr.state === "open",
          state: pr.state === "open" ? "active" : pr.merged_at ? "completed" : "abandoned",
          ...(pr.state !== "open" && (pr.merged_at || pr.closed_at) ? { closedAt: (pr.merged_at || pr.closed_at)! } : {}),
        }));
      },
      async create(title, body, source, target) {
        return link(
          (await session.api(`${session.base}/pulls`, "POST", {
            title,
            body,
            head: source,
            base: target,
          })) as { number?: unknown; html_url?: unknown },
        );
      },
      async update(id, title, body) {
        return link(
          (await session.api(`${session.base}/pulls/${id}`, "PATCH", {
            title,
            body,
          })) as { number?: unknown; html_url?: unknown },
        );
      },
    };
  }
  throw new Error(
    "Publishing needs Azure DevOps or GitHub. Choose the provider for this project in Connections.",
  );
}

/** Read-only: sign-in, repository read and evaluated push/branch/PR permissions. No push or PR mutation. */
export async function repositoryAccess(
  project: Project,
  networkFetch: NetworkFetch = fetch,
) {
  const host = await hostFor(project, networkFetch);
  return host.access();
}
/** Throws when the signed-in account cannot publish. Records the result on the project. */
export async function checkPublicationAccess(
  project: Project,
  networkFetch: NetworkFetch = fetch,
) {
  const access = await repositoryAccess(project, networkFetch);
  project.access = access;
  if (!access.ok) throw new Error(access.summary);
  return access;
}
/** Read-only: whether the run's pull request is still open. */
export async function pullRequestOpen(
  project: Project,
  run: Run,
  networkFetch: NetworkFetch = fetch,
) {
  const host = await hostFor(project, networkFetch);
  const existing = await host.pullRequests(run.branch, run.targetBranch);
  return existing.some((pr) => pr.active) ? "open" : existing.length ? "closed" : "missing";
}
/**
 * Where the run's pull request stands now (read-only): open, completed (merged),
 * abandoned, or missing. The newest PR for the branch counts.
 */
export async function pullRequestStatus(project: Project, run: Run, networkFetch: NetworkFetch = fetch) {
  const host = await hostFor(project, networkFetch);
  const all = await host.pullRequests(run.branch, run.targetBranch);
  const latest = [...all].sort((a, b) => b.id - a.id)[0];
  if (!latest) return { state: "missing" as const };
  return { state: latest.state, ...(latest.closedAt ? { closedAt: latest.closedAt } : {}) };
}
/** The PR description: the original task, then each change request round. */
export function pullRequestDescription(run: Run, localOnly: string[]) {
  const rounds = run.revisions ?? [];
  const original = rounds[0];
  const originalPlan = original?.previousPlan ?? run.plan!;
  const originalDevelopment = original ? original.previousDevelopment : run.development;
  const current = activeRevision(run);
  const changes = rounds.flatMap((round) => {
    const plan = round === current ? run.plan?.summary : round.planSummary;
    const development = round === current ? run.development?.summary : round.developmentSummary;
    return [
      `Change request ${round.number}${round.beforePr ? " (before the PR)" : ""}: ${round.request.replace(/\s+/g, " ").slice(0, 600)}`,
      ...(plan ? [`Plan: ${plan}`] : []),
      ...(development ? [`Done: ${development}`] : []),
    ];
  });
  return [
    originalPlan.summary,
    originalDevelopment?.summary ?? "",
    ...(changes.length ? ["Change requests", ...changes] : []),
    "Validation",
    ...run.checks.map((c) => `- ${c.name}: passed`),
    "Independent review",
    run.reviews.at(-1)!.summary,
    ...(run.development?.limitations ?? []).map((x) => `Limitation: ${x}`),
    ...(run.verification?.limitations ?? []).map(
      (x) => `Verification limitation: ${x}`,
    ),
    ...(run.acceptedGaps?.length && reviewCleared(run) && run.acceptedReviewIndex === run.reviews.length - 1
      ? [
          "Accepted as known limitations (not verified by Workstream)",
          ...run.acceptedGaps.map((gap) => `- ${gap.text}`),
          `Reason: ${run.acceptedGaps[0].reason}`,
        ]
      : []),
    ...(localOnly.length
      ? [
          `Local verification tests retained outside this PR: ${localOnly.join(", ")}`,
        ]
      : []),
    "CI status: not checked by Workstream.",
  ].join("\n\n");
}
export async function publish(
  project: Project,
  run: Run,
  save: () => void,
  networkFetch: NetworkFetch = fetch,
) {
  assertApproved(run);
  if (!run.approval?.publish)
    throw new Error("Publication was not included in this run’s approval.");
  if (
    !run.worktree ||
    !run.reviewedHash ||
    !run.reviews.length ||
    !reviewCleared(run)
  )
    throw new Error("Independent review must pass before publication.");
  if (!run.checks.length || run.checks.some((check) => !check.passed))
    throw new Error("Required checks have not passed.");
  const changes = await inspectChanges(run);
  if (changes.hash !== run.reviewedHash)
    throw new ReviewContentChanged(
      "Files changed after review. Continue verification and review before publishing.",
    );
  const branch = await git(run.worktree, ["branch", "--show-current"]);
  if (branch !== run.branch)
    throw new Error("Worktree branch changed. Publication stopped.");
  if (
    safeRemote(await git(run.worktree, ["remote", "get-url", "origin"])) !==
    project.remote
  )
    throw new Error(
      "The repository remote changed. Reconnect and verify the project.",
    );
  // Test files are never committed. Any already in the branch history stay as
  // they are (Workstream does not rewrite history); new edits to them stay local.
  const localOnly = await localTestFiles(run, changes.files);
  run.localOnlyFiles = localOnly;
  const publishFiles = changes.files.filter(
    (file) => !localOnly.includes(file),
  );
  if (!publishFiles.length)
    throw new Error("No production changes to publish.");
  const host = await hostFor(project, networkFetch);
  // Stop before committing or pushing when the account explicitly lacks rights.
  const access = await host.access();
  project.access = access;
  if (!access.ok) throw new Error(access.summary);
  const existing = await host.pullRequests(run.branch, run.targetBranch);
  const active = existing.find((pr) => pr.active);
  if (!active && existing.length)
    throw new Error(
      "This branch already has a completed or abandoned PR. Start a new task rather than overwriting its history.",
    );
  const revision = activeRevision(run);
  if (revision && !revision.beforePr && !active)
    throw new Error(
      "The pull request for this branch is no longer open, so the change request cannot be added to it. Nothing was pushed.",
    );
  const staged = (
    await git(run.worktree, ["diff", "--cached", "--name-only", "-z"])
  )
    .split("\0")
    .filter(Boolean);
  if (staged.some((file) => !publishFiles.includes(file)))
    throw new Error(
      "Unrelated staged files are present. Inspect the worktree before publication.",
    );
  if (!changes.files.length) throw new Error("No changes to publish.");
  // A deleted file is staged with rm --cached: "git add" refuses a path that is
  // gone from both the folder and the index (for example after an earlier attempt
  // already committed the deletion).
  const present: string[] = [];
  const removed: string[] = [];
  for (const file of publishFiles)
    (await pathAccess(join(run.worktree, file)).then(() => true, () => false) ? present : removed).push(file);
  if (present.length) await git(run.worktree, ["add", "--", ...present]);
  if (removed.length)
    await git(run.worktree, ["rm", "--cached", "--ignore-unmatch", "--quiet", "--", ...removed]);
  run.reviewedTree = await git(run.worktree, ["write-tree"]);
  save();
  const headTree = await git(run.worktree, ["rev-parse", "HEAD^{tree}"]);
  if (headTree !== run.reviewedTree) {
    const subject = `${run.ticketKey ? run.ticketKey + ": " : ""}${run.title}`;
    await git(run.worktree, [
      "commit",
      "-m",
      revision && !revision.beforePr
        ? `${subject} (change request ${revision.number})`
        : subject,
      ...(revision && !revision.beforePr
        ? ["-m", revision.request.replace(/\s+/g, " ").slice(0, 1000)]
        : []),
    ]);
  }
  run.commit = await git(run.worktree, ["rev-parse", "HEAD"]);
  save();
  const leftOver = [
    ...(await git(run.worktree, ["diff", "--name-only", "-z", "HEAD"]))
      .split("\0")
      .filter((file) => !localOnly.includes(file)),
    ...(
      await git(run.worktree, ["ls-files", "--others", "--exclude-standard", "-z"])
    )
      .split("\0")
      .filter((file) => !localOnly.includes(file) && !isAgentState(file)),
  ].filter(Boolean);
  const treeMoved =
    (await git(run.worktree, ["rev-parse", "HEAD^{tree}"])) !== run.reviewedTree;
  const hashMoved = (await inspectChanges(run)).hash !== run.reviewedHash;
  if (treeMoved || hashMoved || leftOver.length) {
    throw new ReviewContentChanged(
      `Commit hooks or another process changed the reviewed content${leftOver.length ? ` (not committed: ${leftOver.slice(0, 5).join(", ")})` : treeMoved ? " (the commit differs from what was reviewed)" : ""}. Click Re-check and review: the checks and a short review run on the changed files, then it publishes. Nothing was pushed.`,
    );
  }
  // Push as the same account that passed the permission check (see gitAuthEnv).
  await git(run.worktree, ["push", "--set-upstream", "origin", run.branch], {
    env: host.gitEnv,
  });
  const remoteHead = await git(
    run.worktree,
    ["ls-remote", "origin", `refs/heads/${run.branch}`],
    { env: host.gitEnv },
  );
  if (remoteHead.split(/\s/)[0] !== run.commit)
    throw new Error("The remote branch does not match the reviewed commit.");
  const description = pullRequestDescription(run, localOnly)
    .slice(0, host.descriptionLimit);
  const title = `${run.ticketKey ? run.ticketKey + ": " : ""}${run.title}`;
  // An uncertain create is never retried here. A user retry starts with the lookup above.
  return active
    ? host.update(active.id, title, description)
    : host.create(title, description, run.branch, run.targetBranch);
}
