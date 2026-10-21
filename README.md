# Workstream

A local desktop workspace for taking a task from a repository-informed plan through development, independent review, and an Azure DevOps pull request.

## Start

For this machine, close the previous version and open `release/Workstream <version>/Workstream.exe` (newer builds are an unpacked folder, which starts faster than the old single portable .exe). It starts its own desktop window; no terminal or Vite server is needed. Existing local state is retained. Git, Node.js, Codex, and provider authentication are still required to execute development workflows.

Prerequisites: Node.js 22 or newer, Git, an installed Codex CLI, and a Codex account/model you can use. Azure publication additionally requires Azure CLI, a work account with repository permissions, and working Git push authentication. Use **Check Azure access** in a run's Publication readiness panel; if sign-in is needed, Workstream offers **Sign in to Azure** and opens Microsoft's normal browser sign-in.

Use the moon/sun button in the top-right corner to switch between light and dark mode. The desktop app saves your preference and restores it on startup, including the native window appearance. Browser preview supports switching for the current session.

## Task images, usage, and project controls

- New tasks accept up to six PNG, JPEG, or WebP images (4 MB each). Choose files or paste a screenshot into the description area. Images are copied into the application's attachments directory and passed as image inputs to the planner, developer, and reviewer. They remain available after restarting or deleting the original screenshot.
- **Usage remaining** shows the connected account's available quota windows and local reset times. It refreshes on connection, runtime updates, and once per minute while connected; use Refresh usage for an immediate update. Unavailable data is explicitly labeled. These limits are shared across Codex applications.
- Each run records cumulative token usage per agent session and displays the total with input, cached input, output, and reasoning breakdowns. Cached input is part of input; reasoning is part of output. Older sessions without recorded usage remain unknown. Tokens cannot reliably be converted into a percentage of the account's allowance.
- **Changes** provides a searchable file list, added/removed counts, old/new line numbers, and colored unified hunks, including new, deleted, and binary files. This is the last captured verification snapshot.
- **Projects → Edit project** updates the display name, target branch, and branch prefix. Existing tasks retain their original target and branch. **Remove project** disconnects it from new-task selection while preserving files, worktrees, memory, and history. Enable **Show removed projects** to restore it.
- Permission prompts support allowing once, allowing for the current agent session when Codex supports that decision, and allowing or declining all requests currently pending for that run. These actions do not approve a plan or bypass review/publication gates.

## What the agents follow

**Agents & models → What the agents follow** shows, per role, the instruction layers each agent receives, in order of authority:

1. **Workstream rules** (read-only view, always on): the bundled role skill plus safety rules (read-only stages, no commits, pushes or PRs, structured output).
2. **Your notes for the project**, saved in Workstream.
3. **Repository skills** you tick, from `.agents/skills`, `.codex/skills` or `.claude/skills`. The mapping is suggested from skill names (for example `jira-ticket-plan` → Planner, `frontend-pr-reviewer` → Reviewer) until you save it. Workflow skills such as `orchestrator` are shown but not given to a single agent, because Workstream runs that flow itself. Skill files are read fresh from the repository when each agent starts; **Open** opens the SKILL.md in your editor, and changes go through Git like other code.

The repository's AGENTS.md is read by the agents themselves (Codex directly, Claude through CLAUDE.md). Where a repository skill describes its own workflow steps (asking for approval, committing, pushing, opening PRs, spawning subagents, updating Jira), agents are told to skip them because Workstream performs them. Each run's Overview shows **What each agent was told**: role, engine, model, the skills (with a short version hash), whether your notes applied, and the full instructions.

## Worktrees and trying a PR locally

New task worktrees are created next to the connected repository, for example `C:\Source\ecommerce-frontend.worktrees\DPP-1234-short-title` (falls back to the app data folder if that location is not writable). Existing runs keep their old worktree paths. Your repository's `.env` and `.env.*` files are copied into new worktrees when Git ignores them and does not track them, so agents can run the site with your settings without the files ever being committed.

After the PR, a run shows **Try it locally**:

- **Check out in my repo** removes the task worktree and checks the branch out in your repository folder, where node_modules and settings already exist. Git does not allow one branch in two places, which is why the worktree goes. It refuses without changing anything if your repository has uncommitted changes to tracked files, if the worktree has changes that are not in the PR, or if the worktree does not match the pushed commit. Local-only test files are moved to `<repo>.worktrees\_kept-local-tests\<task>` first.
- **Start localhost** opens a PowerShell window in your repository running the `dev` (or `start`/`serve`) script with npm, yarn or pnpm, detected from the lockfile, and opens the browser when a local URL appears. Close the window to stop it.
- **Switch back to <branch>** returns your repository to the branch it was on, when it has no uncommitted changes.

The PowerShell launcher was not run in automated tests (they run on Linux); Git checkout and worktree removal are tested with real repositories.

## Request changes on a pull request

When a task is done and its pull request exists, the run page shows Request changes. Describe what should be different (you can attach up to the run's six images). Workstream then:

1. Checks that the pull request is still open. A completed or abandoned PR cannot take more changes; start a new task instead.
2. Reopens the branch. It reuses the task worktree, or creates a new one beside the repository if Check out in my repo removed it. If your repository folder has the branch checked out, it switches that folder back to the branch it was on before (or the target branch) and stops if there are uncommitted changes. Newer commits on origin are picked up by fast-forward only. A rewritten branch or unpushed local commits stop the round without changing anything.
3. Plans only the requested changes, against the PR branch, for you to approve. You can ask for plan adjustments as usual.
4. Develops, runs the approved checks and runs the independent review with a fresh two-repair budget. The reviewer sees both this round's changes and the whole PR diff.
5. Commits on top of the branch (`<title> (change request N)`) and pushes without force, so the same pull request gets a new commit. The PR description lists each change request.

You can cancel a change request until it changes files. Earlier rounds are listed under Request changes. Reviewer comments in the PR are not read yet; only your own notes are used.

## GitHub Copilot agents

Any role can run on GitHub Copilot (Agents & models). Workstream uses the official Copilot SDK and ships the Copilot runtime (`resources/copilot-runtime`, fetched with `npm run copilot-runtime` before packaging), so nothing else is installed. Sign-in is your GitHub account with a Copilot plan: the runtime uses an existing Copilot login or the GitHub CLI (gh) sign-in, which "Sign in with GitHub" starts. Models are the ones your plan allows; "Usage remaining" shows premium requests.

Copilot agents follow the same rules as Codex and Claude: read-only stages cannot edit files, the developer may only write inside its worktree, connectors are read-only, Copilot's own memory is refused, and shell commands and web requests ask you (or follow "Allow everything for this run"). Results use the SDK's structured output.

## Connectors (MCP: Jira, Figma and others)

Open **Connectors** in the sidebar. **Discover** lists Atlassian (Jira, Confluence), Figma (hosted) and the Figma desktop app's local server. **Add** registers any other MCP server URL (https, or http on localhost).

- **Connect** opens the provider's normal browser sign-in (OAuth with PKCE and dynamic client registration). The redirect comes back to `http://127.0.0.1:47823/oauth/callback`. Tokens and client registration are encrypted with Windows credential protection under the app data `secrets` folder, never in `state.json`. Signed-in connectors reconnect in the background at start-up without opening a browser.
- **Agents can read** offers a connector to every agent session, Codex and Claude alike. Agents never receive tokens: they talk to a loopback proxy in Workstream that requires a per-run key and exposes only read-only tools (tools marked `readOnlyHint`, or get/search/list/fetch-style names that the server has not marked as mutating). The page shows how many tools are offered.
- **New task → Import from Jira** fills the title, key and description (Atlassian Document Format converted to text, with type, status, labels and link). Attachments are not imported. With more than one Jira site, choose the site on the Atlassian row.
- After a PR exists, the run shows **Update <KEY> in Jira**: an editable comment with the PR link and an optional status change. Nothing is sent until you click **Post to Jira**, and posting again asks for confirmation.

Limits: Jira calls use the Atlassian Remote MCP server's tools (`getAccessibleAtlassianResources`, `getJiraIssue`, `getTransitionsForJiraIssue`, `addCommentToJiraIssue`, `transitionJiraIssue`). If Atlassian renames them, Workstream reports the missing tool. Figma's hosted MCP server may only accept approved clients; the Figma desktop app server works without sign-in when enabled in Figma. Codex receives connectors through thread `config` overrides (`mcp_servers.<name>.url` / `http_headers`). The OAuth flow and read-only proxy are tested against the MCP SDK's reference authorization server and a local MCP server; live Atlassian and Figma sign-in were not exercised.

## Claude agents

Each agent role (Planner, Developer, Reviewer) can run on Codex or Claude. Choose under **Agents & models → Runs on**, then save the profiles. New tasks capture the choice. Each session records the engine and model it used.

Claude runs through the Claude Agent SDK (bundled into the app) and your installed Claude Code CLI (`claude.exe`, or enter its full path). **Sign in with** offers two modes. *Claude Code sign-in* (default) uses the account your installed Claude Code is signed in with, like Codex uses your ChatGPT sign-in: **Sign in with Claude** runs `claude auth login`, and if the browser shows a code you paste it into Workstream. Runs count towards your Claude plan. This mode is for personal use; Anthropic's terms ask apps used by others to use API keys. *Anthropic API key* uses a Console key instead. The key is encrypted with Windows credential protection (Electron safeStorage) in `claude-key.bin` under the app data folder and is never written to `state.json` or logs. Usage is billed to the key's API workspace.

Read-only roles cannot use Claude's file editing tools. The developer auto-accepts file edits inside the ticket worktree. Shell commands and other tool requests appear as Workstream permission requests, as for Codex. Repository `CLAUDE.md` and `.claude` project settings apply; personal Claude Code permission rules do not. An invalid key stops the session at once instead of waiting for retries. Live Claude inference was not exercised in automated tests (the SDK-to-CLI wiring was tested with a rejected key).

## Connections (Azure DevOps and GitHub)

Open **Connections** in the sidebar to see, per provider, whether its CLI is installed, which account it is signed in as, and (for Azure) the tenant. Each project shows a **Publish with** choice (Azure DevOps, GitHub or none) and read-only permission chips for Read, Push, Create branch and Pull requests, plus the account that was checked.

- Sign-in fixes 401 (not signed in, or signed in to the wrong tenant). It does not fix 403: that means the account is known but not allowed. Switch account, or ask an administrator for Basic access level (Stakeholder cannot use Repos), project membership, and Contribute / Contribute to pull requests on the repository.
- Workstream discovers the Azure DevOps organization's tenant up front and requests tokens for that tenant (`az account get-access-token --tenant`), so a different default tenant in Azure CLI no longer produces a wrong-account token.
- Permissions are evaluated with Azure DevOps' permission evaluation API (Git Repositories namespace) and GitHub's repository `permissions`. Nothing is pushed by a check. Publication stops before committing when a permission is explicitly denied.
- `git push` and `ls-remote` now use the same signed-in account as the PR API. For HTTPS remotes the token is passed as a temporary `http.extraHeader` through `GIT_CONFIG_*` environment variables (never in arguments or saved config), and the credential helper is cleared for that command so Git Credential Manager cannot substitute a different cached account. SSH remotes keep using your SSH key.
- GitHub uses the GitHub CLI (`gh`). **Sign in to GitHub** shows the one-time device code in the app and opens github.com/login/device. PRs are created or updated through the GitHub REST API. Organization SSO may need approval on github.com.

Live sign-in, permission evaluation and push against real Azure DevOps and GitHub accounts have not been exercised in automated tests; they are covered with mocked CLI and network responses.

## Review recovery and local memory

Version 0.2.3 separates Git stdout from diagnostic stderr so CRLF warnings cannot become filenames or destabilize review hashes. Publication detects actual content changes and returns to review with **Re-verify changed files**, instead of trapping Continue in publication retries. Older runs affected by the corrupted hash may need one fresh verification/review; the application never silently approves a new hash.

Agents have no token or time limits in Workstream: they run until they finish or you press Stop. Your Codex or Claude plan's own usage limits still apply, and run usage is shown per session. Worktree artifacts are preserved when you stop a run.

New runs keep newly added test/spec files local by default. For existing runs, use **Keep new tests local** in Publication readiness. This preserves test files on disk, unstages only those selected new tests, and excludes them from the commit/PR. Existing tracked tests are never silently removed; already committed tests require manual history inspection. The diff labels local-only files explicitly, while content verification still covers them. Actual Git staging/commit behavior is covered by temporary-repository tests with mocked remote publication.

**Check Azure access** performs a read-only authenticated repository request without a model call or Git push. Azure requests use Electron's network stack and suppress federated HTML redirects, matching Microsoft's bearer-token handler. Authentication failures (401), permission failures (403), and network failures have distinct messages. If a 401 response identifies the organization's tenant, **Sign in to Azure** runs `az login` for that tenant and checks repository access again. Workstream does not store credentials; Azure CLI manages the sign-in. See [Microsoft's Azure CLI sign-in guide](https://learn.microsoft.com/en-us/cli/azure/authenticate-azure-cli?view=azure-cli-latest) and [bearer-token handler](https://github.com/microsoft/typed-rest-client/blob/master/lib/handlers/bearertoken.ts). Read access does not guarantee push or PR creation rights.

`scripts/azure-access-smoke.mjs` can perform this read-only diagnostic using an explicitly supplied `WORKSTREAM_DIAGNOSTIC_STATE` path. Its Electron profile and state are isolated from the running app; it does not infer, commit, push, or create PRs. On this machine the live check returned 401 for the connected organization. Signing in with the appropriate organization identity remains a user action.

The app performs at most two automatic development repairs. Missing acceptance evidence pauses the workflow separately from code defects. On a blocked review, choose **Complete missing verification**: no description is required for the first attempt. Attach the missing original screenshot under Reference images if available. This explicitly starts one targeted verification session using the reviewer model profile and a writable worktree sandbox for temporary test artifacts. The agent is instructed to leave code, tests, configuration and Git state unchanged; a content-hash check blocks further review if tracked or nonignored contents change. No additional development repair is started.

The session runs missing targeted checks and reports **Passed**, **Failed**, or **Could not verify**, with specific next actions for missing images, environment/access, code fixes, or verification. It is instructed to inspect project setup, start and diagnose the worktree's own loopback dev server using installed tools, and use available browser/MCP tools or installed Playwright. It must verify it is testing the ticket worktree, leave unrelated servers alone, and clean up only processes it started. Runtime approval can still be required for launching the server/browser. Workstream does not supply the Codex desktop chat's browser tools or automatically install integrations.

Missing live data should trigger a local alternative: temporary browser response fixtures or a mock server based on actual contracts, exercising the real changed app. Isolated browser fixtures can simulate mutation responses without changing external backend data. Evidence labels distinguish **Live browser**, **Browser with local fixtures**, **Automated test**, and **Inspection**. Non-blocking live-data limitations are recorded separately; fixtures cannot prove real backend integration or satisfy an explicitly required live check. Independent review evaluates adequacy against the approved scope. Previous verification reports remain available to avoid repeating successful checks when contents are unchanged. A policy update permits one fresh recovery attempt without inventing a context note.

If a required gap remains, recovery stops without another independent review. Items only people or systems outside the code can resolve (CMS content, market-approved texts, live data, business sign-off) are labelled "Outside the code". **Accept the remaining items and continue** lets you record that they are outside this change, with a reason: the run moves to Ready to publish and the PR description lists the accepted items and reason. It is refused when a check failed, a verification check failed, or the review reported code errors or warnings, and an acceptance only applies to the review it was given for. Otherwise, approved checks and a separate read-only review must pass before the existing publication gate can proceed. The approved plan and two-repair limit remain intact. The action consumes model tokens. Server startup, browser selection and fixture generation are agent instructions using existing tools, not a bundled browser/server supervisor; unavailable tools or unknown data contracts are still reported explicitly.

Repeated attempts with unchanged contents, images, review findings and context are rejected. After supplying missing inputs, add optional context describing the corrected environment or evidence location and try again. Connection failures can be retried. For manual fixes/evidence, expand **I already fixed the issues or collected evidence** to rerun verification and independent review directly. A note or agent report alone cannot mark the run complete. Tests use simulated verifier/reviewer output and real temporary Git repositories; live browser verification and paid recovery inference have not been exercised for this release.

Live activity shows command/tool starts, completed commands, agent commentary, last activity time, elapsed stage time, and reported plan steps when supplied. Step counts are not a time estimate. Long quiet operations remain visible without being falsely labeled as stuck.

Workstream keeps project memory in a local SQLite database (`memory.sqlite` in the app data folder, using the SQLite built into Electron, with full-text search). When a run finishes it records what was built and where, your plan feedback, review findings (marked fixed when the final review passed) and failed checks. Text that looks like a credential is removed before saving. Memories never cross projects. When an agent starts, Workstream picks pinned notes plus the most relevant items (full-text relevance, boosted by files both tasks touched) within a size budget and passes them as untrusted history; agents never access the database. The **Memory** page lets you search, pin, edit, delete and add notes; each run shows which memories its agents were given. Older run summaries are imported once.

Permission requests show the tool and command. **Allow everything for this run** accepts the current and all later requests of that run (the agent's own sandbox still applies); the run shows a banner with **Ask me again**. When a request arrives while Workstream is in the background, Windows shows a notification and the taskbar button flashes.

`node scripts/improvements-smoke.mjs` validates these UI flows with isolated data, including simulated usage/activity notifications. `npm run test:desktop` also checks real Codex authentication, model discovery, and account quota reads without inference. Image interpretation and token events during paid model execution require a separate live run; these tests do not claim to verify that behavior end to end.

```powershell
cd 'C:\Source\DeLaval ChatGPT\Workstream'
npm ci
npm run build
npm start
```

For development use `npm run dev`. `npm run dev:web` opens a browser-only UI preview at http://127.0.0.1:4317; it cannot run local agents or Git operations. `npm run package` builds a Windows portable executable into `release/`.

1. Connect an existing repository folder in Projects. Confirm its target branch and branch prefix.
2. In Agents & models, connect Codex. If it is not on PATH, enter the absolute path to codex.exe. Sign in if needed. Choose the planner, developer, and reviewer model profiles.
3. Create a task with a title, requirements, and optional ticket key. Select Create plan.
4. Read the Plan tab, including every command that verification will run. Request revisions as needed. Approve the plan, choosing whether to include publication.
5. Follow development, checks, independent review, and up to two repair rounds. The UI surfaces runtime permission requests.
6. Publish after passing verification and review, or include publication when approving the plan. The application creates or updates an Azure DevOps PR without merging it.

## Architecture

- `src/`: React / TypeScript / shadcn UI. Electron's context-isolated preload exposes only typed, validated commands.
- `electron/`: local workflow engine, Codex App Server JSON-RPC client, Git worktrees, durable JSON state, and Azure DevOps REST publication.
- `shared/`: data contracts and Zod command/output validation.
- `skills/`: portable planning, development, independent review, and orchestration guidance adapted from the existing ecommerce workflow. The original repository skills are unchanged.

Workflow gates are application code, not prompt conventions. Plan approval stores a content hash; review captures the change contents; publication checks the final diff, index, hook results, and remote source commit. Only one workflow stage runs at a time. The app does not auto-merge, force-push, delete worktrees, or update ticket systems.

## Storage and recovery

Projects, runs, approvals, results, and agent session IDs are saved atomically in `state.json` under Electron's userData directory (normally `%APPDATA%/workstream`). Isolated worktrees are created beneath its `worktrees/` folder. `WORKSTREAM_DATA_DIR` can point at an alternate data directory for testing. Keep this directory private: task descriptions, code diffs, and command results may be sensitive. Authentication remains managed by Codex and Azure CLI; Workstream does not store access tokens in its state.

After a restart, an in-progress run is marked blocked. Continue reruns the interrupted stage from the saved worktree and rechecks evidence; it does not pretend to resume an in-flight agent turn. Previous Codex thread IDs remain in state. An interrupted publication reconciles existing PRs before attempting creation. Existing branches are never automatically overwritten.

Codex processes inherit the local Codex configuration. Model catalogs do not guarantee entitlement; the first inference turn verifies access. Read-only agents and a workspace-write developer use the runtime sandbox, with explicit UI permission requests when needed. Context necessary for inference is sent to the selected model provider. Agents are instructed not to publish or call external mutation tools; review your local Codex MCP/tool configuration accordingly.

## Current scope

This release supports local checkout selection, pasted tasks, fixed configurable per-role model profiles, and Azure DevOps or GitHub PR publication. Repository cloning, Jira import, automatic per-task model routing, embedded browser previews, automatic CI monitoring, and multi-user collaboration are future work. Agent question/elicitation methods other than command/file approvals return an unsupported-method response; clarify requirements through plan revisions. Required visual checks depend on browser tooling available to the developer agent and must be reported as missing if unavailable.

`npm test` covers approval integrity, review gating, recovery, and real temporary Git worktree behavior. `npm run lint` and `npm run build` validate the codebase. Live paid inference and external PR creation require a deliberate task run; they are not exercised by unit tests.

`npm run test:desktop` verifies the actual Electron UI with isolated state and checks the local Codex connection without inference. `npm run test:live` runs a minimal real planner/developer/reviewer workflow in a generated repository and excludes publication. It stops if a runtime permission is needed. Only with explicit authorization, `WORKSTREAM_TEST_ALLOW_NODE_TEST=1` allows the exact `node --test` command in that generated worktree; no other approvals are accepted.

## Validation on this machine

The Electron UI, repository connection, task creation, saved state, desktop and narrow layouts, Codex authentication discovery, and seven-model catalog were verified. A live planner returned a valid plan, and a live developer created the fixture file. The test then correctly surfaced a sandbox permission request for the Node test subprocess. A subsequent live attempt was blocked by the selected Codex workspace reporting that it was out of credits. End-to-end live independent review and Azure DevOps publication remain unverified; local integration tests simulate agent results and exercise real Git operations without external publication.
