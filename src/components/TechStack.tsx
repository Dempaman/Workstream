import { techById, techRules } from "../../shared/techstack";
import { cn } from "@/lib/utils";

// Only the icons Workstream uses (src/assets/tech), not the whole brand folder.
const icons = import.meta.glob("../assets/tech/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;
export const techIconUrl = (id: string) => icons[`../assets/tech/${id}.svg`];

/** A technology or tool logo on a small light tile, so dark logos stay visible in the dark theme. */
export function TechIcon({
  id,
  size = 16,
  title,
  className,
}: {
  id: string;
  size?: number;
  title?: string;
  className?: string;
}) {
  const url = techIconUrl(id);
  if (!url) return null;
  return (
    <span
      className={cn("tech-icon", className)}
      style={{ width: size + 6, height: size + 6 }}
      title={title}
    >
      <img src={url} alt="" width={size} height={size} />
    </span>
  );
}

/** The repository's stack as small chips: logo and name, text only where there is no logo. */
export function TechStack({
  ids,
  limit,
  size = 14,
}: {
  ids?: string[];
  limit?: number;
  size?: number;
}) {
  if (!ids?.length) return null;
  const known = ids
    .map((id) => techById.get(id))
    .filter((rule) => rule !== undefined);
  // Logos first, in the detection order; text-only tools after them.
  const ordered = [
    ...known.filter((rule) => rule.icon),
    ...known.filter((rule) => !rule.icon),
  ];
  const shown = limit ? ordered.slice(0, limit) : ordered;
  const hidden = ordered.length - shown.length;
  return (
    <ul
      className="tech-stack"
      aria-label="Technologies used in this repository"
    >
      {shown.map((rule) => (
        <li
          key={rule.id}
          className={cn(!rule.icon && "text-only")}
          title={rule.name}
        >
          {rule.icon && <TechIcon id={rule.id} size={size} />}
          <span>{rule.name}</span>
        </li>
      ))}
      {hidden > 0 && (
        <li
          className="text-only"
          title={ordered
            .slice(shown.length)
            .map((rule) => rule.name)
            .join(", ")}
        >
          <span>+{hidden} more</span>
        </li>
      )}
    </ul>
  );
}

/** Only the logos, for tight places (project chips, run lists). */
export function TechLogos({
  ids,
  limit = 5,
  size = 14,
}: {
  ids?: string[];
  limit?: number;
  size?: number;
}) {
  const withIcons = (ids ?? [])
    .filter((id) => techById.get(id)?.icon)
    .slice(0, limit);
  if (!withIcons.length) return null;
  return (
    <span className="tech-logos">
      {withIcons.map((id) => (
        <TechIcon key={id} id={id} size={size} title={techById.get(id)?.name} />
      ))}
    </span>
  );
}

export const techCount = techRules.length;
