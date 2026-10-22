import { useEffect } from "react";
import { AlertTriangle, CheckCircle2, CircleSlash, LoaderCircle, RefreshCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { bridge } from "@/lib/bridge";
import { cn } from "@/lib/utils";
import type { Command, HealthItem, Snapshot } from "../../shared/types";

type Send = (command: Command) => Promise<Snapshot | null>;

const icon = (status: HealthItem["status"]) =>
  status === "ok" ? <CheckCircle2 size={16} /> : status === "warn" ? <AlertTriangle size={16} /> : status === "fail" ? <XCircle size={16} /> : <CircleSlash size={16} />;

/** Health: everything Workstream depends on, checked in one go, with what to do when something is off. */
export function HealthPage({ snapshot, send, pending }: { snapshot: Snapshot; send: Send; pending: boolean }) {
  const health = snapshot.health;
  useEffect(() => {
    void bridge.command({ type: "healthCheck" }).catch(() => {});
  }, []);
  const items = health?.items ?? [];
  const groups = [...new Set(items.map((i) => i.group))];
  const count = (status: HealthItem["status"]) => items.filter((i) => i.status === status).length;
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">IS EVERYTHING CONNECTED?</div>
          <h1>Health</h1>
          <p>
            Checks the tools, sign-ins and projects Workstream depends on, so a missing sign-in or an old Git shows up here
            instead of in the middle of a task. It only reads: nothing is installed or changed.
          </p>
        </div>
        <Button disabled={pending || health?.running} onClick={() => void send({ type: "healthCheck" })}>
          {health?.running ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />} Check again
        </Button>
      </div>
      {items.length > 0 && (
        <div className="health-summary">
          <span className="ok">{count("ok")} fine</span>
          {count("warn") > 0 && <span className="warn">{count("warn")} to look at</span>}
          {count("fail") > 0 && <span className="fail">{count("fail")} not working</span>}
          {health?.checkedAt && <small>Checked {new Date(health.checkedAt).toLocaleTimeString()}</small>}
        </div>
      )}
      {!items.length && (
        <section className="panel health-group">
          <p className="muted-note">
            <LoaderCircle size={14} className="spin" /> Checking…
          </p>
        </section>
      )}
      {groups.map((group) => (
        <section key={group} className="panel health-group">
          <h2>{group}</h2>
          <ul>
            {items
              .filter((i) => i.group === group)
              .map((item) => (
                <li key={item.id} className={cn("health-item", item.status)}>
                  <span className="health-icon">{icon(item.status)}</span>
                  <div>
                    <strong>{item.label}</strong>
                    <span>{item.detail}</span>
                    {item.fix && <em>{item.fix}</em>}
                  </div>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </>
  );
}
