import { useState, type ReactNode } from "react";
import {
  CircleCheck,
  CircleHelp,
  CircleX,
  Cloud,
  Copy,
  GitBranch,
  KeyRound,
  LoaderCircle,
  LogIn,
  RefreshCw,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BrandLogo } from "@/components/EngineMark";
import {
  providerNames,
  type Command,
  type Project,
  type ProviderAccount,
  type ProviderId,
  type RepositoryAccess,
  type Snapshot,
} from "../../shared/types";

type Send = (command: Command) => Promise<Snapshot | null>;

const providers: Record<
  ProviderId,
  { icon: typeof Cloud; cli: string; install: string; hint: string }
> = {
  azure: {
    icon: Cloud,
    cli: "Azure CLI (az)",
    install:
      "https://learn.microsoft.com/en-us/cli/azure/install-azure-cli-windows",
    hint: "Sign in with the work account that is a member of the Azure DevOps organization. Workstream signs in to the organization's own tenant.",
  },
  github: {
    icon: GitBranch,
    cli: "GitHub CLI (gh)",
    install: "https://cli.github.com",
    hint: "Sign in with the GitHub account that has write access to the repository. Approve SSO for your organization if GitHub asks.",
  },
};

/** Coloured tile with a generic icon plus the provider name, so the provider is clear at a glance. */
export function ProviderMark({
  provider,
  size = "md",
}: {
  provider: Project["provider"];
  size?: "sm" | "md";
}) {
  const Icon = provider === "other" ? GitBranch : providers[provider].icon;
  return (
    <span className={cn("provider-mark", provider, size)}>
      <span className="provider-tile" aria-hidden>
        {provider === "github" ? (
          <BrandLogo brand="github" size={size === "sm" ? 13 : 20} onDark />
        ) : provider === "azure" ? (
          <BrandLogo brand="azure-devops" size={size === "sm" ? 14 : 24} />
        ) : (
          <Icon size={size === "sm" ? 13 : 20} />
        )}
      </span>
      <span className="provider-name">{providerNames[provider]}</span>
    </span>
  );
}

function accountState(account?: ProviderAccount) {
  if (!account?.checkedAt && !account?.signingIn)
    return { label: "Not checked", tone: "" };
  if (account.signingIn) return { label: "Signing in…", tone: "running" };
  if (!account.cliInstalled) return { label: "CLI not installed", tone: "blocked" };
  return account.signedIn
    ? { label: "Signed in", tone: "complete" }
    : { label: "Not signed in", tone: "blocked" };
}

export function AccessChips({ access }: { access?: RepositoryAccess }) {
  if (!access) return <p className="muted-note">Access not checked yet.</p>;
  const items: [string, boolean | null][] = [
    ["Read", access.read],
    ["Push", access.push],
    ["Create branch", access.createBranch],
    ["Pull requests", access.pullRequest],
  ];
  return (
    <div className="access-chips" aria-label="Repository permissions">
      {items.map(([name, value]) => (
        <span
          key={name}
          className={cn(
            "access-chip",
            value === true ? "yes" : value === false ? "no" : "unknown",
          )}
          title={
            value === true
              ? "Allowed"
              : value === false
                ? "Denied"
                : "Could not be determined"
          }
        >
          {value === true ? (
            <CircleCheck size={13} />
          ) : value === false ? (
            <CircleX size={13} />
          ) : (
            <CircleHelp size={13} />
          )}
          {name}
        </span>
      ))}
    </div>
  );
}

function Row({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="connection-row">
      {icon}
      <span>{children}</span>
    </div>
  );
}

function ProviderCard({
  provider,
  account,
  pending,
  send,
}: {
  provider: ProviderId;
  account?: ProviderAccount;
  pending: boolean;
  send: Send;
}) {
  const state = accountState(account);
  const info = providers[provider];
  const [copied, setCopied] = useState(false);
  return (
    <section className="panel provider-card">
      <header>
        <ProviderMark provider={provider} />
        <span className={cn("status-badge", state.tone)}>
          <span className="status-dot" />
          {state.label}
        </span>
      </header>
      <Row icon={<UserRound size={15} />}>
        {account?.signedIn ? (
          <>
            <strong>{account.account ?? "Unknown account"}</strong>
            {account.displayName && ` · ${account.displayName}`}
          </>
        ) : (
          "No account"
        )}
      </Row>
      {provider === "azure" && account?.tenantId && (
        <Row icon={<KeyRound size={15} />}>Tenant {account.tenantId}</Row>
      )}
      <Row icon={provider === "azure" ? <BrandLogo brand="azure" size={15} /> : <BrandLogo brand="github" size={15} />}>
        Uses {info.cli}. Push and pull requests use this same account.
      </Row>
      {account?.loginCode && (
        <div className="login-code" role="status">
          <span>Enter this code on github.com:</span>
          <strong>{account.loginCode}</strong>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void navigator.clipboard
                ?.writeText(account.loginCode!)
                .then(() => setCopied(true))
                .catch(() => {});
            }}
          >
            <Copy size={14} /> {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      )}
      {account?.signingIn && provider === "azure" && (
        <p className="muted-note">
          Finish the Microsoft sign-in in your browser and pick the account that
          belongs to the organization.
        </p>
      )}
      {account?.error && !account.signedIn && !account.signingIn && (
        <p className="inline-error">{account.error}</p>
      )}
      <p className="muted-note">{info.hint}</p>
      <div className="button-row">
        {account && !account.cliInstalled ? (
          <Button
            variant="outline"
            onClick={() => void send({ type: "openExternal", url: info.install })}
          >
            Install {info.cli}
          </Button>
        ) : (
          <Button
            variant={account?.signedIn ? "outline" : "default"}
            disabled={pending || account?.signingIn}
            onClick={() => void send({ type: "signIn", provider })}
          >
            {account?.signingIn ? (
              <LoaderCircle className="spin" size={15} />
            ) : (
              <LogIn size={15} />
            )}
            {account?.signedIn ? "Switch account" : `Sign in to ${providerNames[provider]}`}
          </Button>
        )}
      </div>
    </section>
  );
}

function ProjectAccess({
  project,
  pending,
  send,
}: {
  project: Project;
  pending: boolean;
  send: Send;
}) {
  const publishable = project.provider !== "other";
  return (
    <section className="panel project-access">
      <header>
        <div>
          <h3>{project.name}</h3>
          <p className="path-label">{project.remote || "No origin remote"}</p>
        </div>
        <label className="provider-select">
          <span>Publish with</span>
          <select
            value={project.provider}
            disabled={pending}
            onChange={(event) =>
              void send({
                type: "updateProject",
                id: project.id,
                provider: event.target.value as Project["provider"],
                targetBranch: project.targetBranch,
                branchPrefix: project.branchPrefix,
              })
            }
          >
            <option value="azure">Azure DevOps</option>
            <option value="github">GitHub</option>
            <option value="other">None (no PR publishing)</option>
          </select>
        </label>
      </header>
      {publishable ? (
        <>
          <AccessChips access={project.access} />
          {project.access && (
            <>
              <Row icon={<UserRound size={15} />}>
                Checked as <strong>{project.access.account ?? "unknown account"}</strong>{" "}
                · {new Date(project.access.checkedAt).toLocaleString()}
              </Row>
              <p className={project.access.ok ? "muted-note" : "inline-error"}>
                {project.access.summary}
              </p>
              {project.access.pushAuth === "ssh" && (
                <p className="muted-note">
                  This origin uses SSH, so git push uses your SSH key and its
                  account cannot be verified here.
                </p>
              )}
            </>
          )}
          <div className="button-row">
            <Button
              variant="outline"
              disabled={pending}
              onClick={() =>
                void send({ type: "checkProjectAccess", projectId: project.id })
              }
            >
              <RefreshCw size={14} /> Check access
            </Button>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() =>
                void send({
                  type: "signIn",
                  provider: project.provider as ProviderId,
                  projectId: project.id,
                })
              }
            >
              <LogIn size={14} /> Sign in for this project
            </Button>
          </div>
        </>
      ) : (
        <p className="muted-note">
          Planning, development and review work for this project. Choose Azure
          DevOps or GitHub to publish pull requests.
        </p>
      )}
    </section>
  );
}

export function Connections({
  snapshot,
  pending,
  send,
}: {
  snapshot: Snapshot;
  pending: boolean;
  send: Send;
}) {
  const projects = snapshot.projects.filter((p) => !p.archived);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">WHERE YOUR PULL REQUESTS GO</div>
          <h1>Connections</h1>
          <p>
            See which account each provider uses and whether it can push and
            open pull requests.
          </p>
        </div>
        <Button
          disabled={pending}
          onClick={() => void send({ type: "refreshConnections" })}
        >
          {pending ? (
            <LoaderCircle className="spin" size={15} />
          ) : (
            <RefreshCw size={15} />
          )}
          Refresh status
        </Button>
      </div>
      <div className="notice">
        <span>
          401 means you are not signed in (or signed in to the wrong tenant):
          sign in. 403 means the account is known but not allowed: switch
          account or ask an administrator for Contribute and Contribute to pull
          requests. Checks are read-only and never push.
        </span>
      </div>
      <div className="provider-grid">
        {(["azure", "github"] as const).map((provider) => (
          <ProviderCard
            key={provider}
            provider={provider}
            account={snapshot.connections?.[provider]}
            pending={pending}
            send={send}
          />
        ))}
      </div>
      <h2 className="connections-subtitle">Project access</h2>
      {projects.length ? (
        <div className="project-access-list">
          {projects.map((project) => (
            <ProjectAccess
              key={project.id}
              project={project}
              pending={pending}
              send={send}
            />
          ))}
        </div>
      ) : (
        <p className="muted-note">Connect a repository in Projects first.</p>
      )}
    </>
  );
}
