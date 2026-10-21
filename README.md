<div align="center">

# Workstream

### Plan, build, review and ship tasks with AI agents, from one desktop app

<p>
  <img src="https://img.shields.io/badge/version-0.2.44-7c3aed?style=for-the-badge" alt="Version 0.2.44">
  <img src="https://img.shields.io/badge/Windows-desktop-0078D4?style=for-the-badge&logo=windows&logoColor=white" alt="Windows desktop">
  <img src="https://img.shields.io/badge/personal_use-only-f59e0b?style=for-the-badge" alt="Personal use only">
</p>
<p>
  <img src="https://img.shields.io/badge/Electron-44-47848F?logo=electron&logoColor=white" alt="Electron 44">
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black" alt="React 19">
  <img src="https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Vite-build-646CFF?logo=vite&logoColor=white" alt="Vite">
  <img src="https://img.shields.io/badge/Vitest-tested-6E9F18?logo=vitest&logoColor=white" alt="Vitest">
</p>

</div>

Workstream takes a task from a repository-aware plan, through development and an independent review, to a pull request on Azure DevOps or GitHub. You stay in charge at every gate.

## The flow

```mermaid
flowchart LR
    T([Task]):::input --> P[Plan]:::agent --> A{You approve}:::you
    A --> D[Develop]:::agent --> V[Verify]:::check --> R[Review]:::agent
    R -- "fix, max 2 rounds" --> D
    R --> U[Publish PR]:::ship --> X([Done]):::done
    classDef input fill:#e0e7ff,stroke:#6366f1,color:#1e1b4b
    classDef agent fill:#ede9fe,stroke:#7c3aed,color:#2e1065
    classDef you fill:#fef3c7,stroke:#d97706,color:#451a03
    classDef check fill:#cffafe,stroke:#0891b2,color:#083344
    classDef ship fill:#dcfce7,stroke:#16a34a,color:#052e16
    classDef done fill:#16a34a,stroke:#15803d,color:#ffffff
```

> [!IMPORTANT]
> The gates are enforced by the app, not by prompts. Nothing is published without an approved plan, passing checks and an independent review. Workstream never force-pushes, auto-merges or deletes your work.

## Agents

Each role (planner, developer, reviewer) can run on a different engine. All three follow the same rules and skills.

| | Engine | Sign-in |
|:-:|---|---|
| <img src="src/assets/brands/codex.svg" width="28" alt=""> | Codex | Your ChatGPT account |
| <img src="src/assets/brands/claude.svg" width="28" alt=""> | Claude | Claude Code sign-in or an API key |
| <picture><source media="(prefers-color-scheme: dark)" srcset="src/assets/brands/github-copilot-white-icon.svg"><img src="src/assets/brands/github-copilot.svg" width="28" alt=""></picture> | GitHub Copilot | Your GitHub account with a Copilot plan |

## Highlights

| | |
|---|---|
| 🟣 Live cost | Spend per run and per agent, with your own price table |
| 🔵 Task location | See the worktree, branch and PR state for every task |
| 🟢 PR status | Spots completed PRs, pulls the target branch and removes the worktree for you |
| 🟠 Clear next steps | A "What needs to be resolved" panel explains why a run is waiting |
| 🔴 Clean branches | Test files the agents write are kept out of the PR |
| ⚪ Connectors | Read-only Jira, Confluence and Figma access over MCP |
| ⚫ Project memory | Local SQLite memory of past runs, plan feedback and review findings |

## Get started

> [!TIP]
> Already have a build? Open `release\Workstream <version>\Workstream.exe`. No terminal needed.

```powershell
npm ci
npm run build
npm start
```

Then, in the app:

1. Connect a repository under Projects and check its target branch.
2. Pick an engine and model for each role under Agents & models.
3. Create a task, read the plan and approve it.
4. Follow development, checks and review, then publish the PR.

> [!NOTE]
> You need Node.js 22+, Git and at least one signed-in engine. Publishing needs the Azure CLI (`az`) or the GitHub CLI (`gh`).

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Run the app with hot reload |
| `npm run dev:web` | Browser-only UI preview (no agents or Git) |
| `npm test` | Unit and Git integration tests |
| `npm run lint` | ESLint |
| `npm run package` | Build a Windows release into `release/` |
| `npm run copilot-runtime` | Fetch the bundled Copilot runtime before packaging |

<details>
<summary><b>Project structure</b></summary>

| Folder | Contents |
|---|---|
| `src/` | React UI. The preload only exposes typed, validated commands |
| `electron/` | Workflow engine, agent clients, Git worktrees, state and publishing |
| `shared/` | Data contracts and Zod validation |
| `skills/` | Role instructions for the planner, developer and reviewer |
| `tests/` | Vitest suites, many against real temporary Git repositories |

</details>

<details>
<summary><b>Data and security</b></summary>

- State lives in `%APPDATA%\workstream\state.json`. Set `WORKSTREAM_DATA_DIR` to use another folder, which the tests do.
- Worktrees go next to your repository, in `<repo>.worktrees\`.
- API keys and connector tokens are encrypted with Windows credential protection and never written to state or logs.
- Agents never see tokens. Connectors go through a local read-only proxy.
- After a restart, an interrupted run is marked as blocked and can continue from its saved worktree.

</details>

<details>
<summary><b>Known limits</b></summary>

- Live paid inference, browser verification and real PR creation are not covered by the automated tests.
- PR comments from reviewers are not read back yet. Change requests use your own notes.
- Windows only.

</details>

---

<div align="center">
<sub>Built for personal use by <a href="https://github.com/Dempaman">Dempaman</a></sub>
</div>
