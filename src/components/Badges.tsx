import { Crown } from "lucide-react";
import type { ScheduleStatus, Skill } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

const skillStyles: Record<Skill, string> = {
  Slide: "bg-ocean/10 text-ocean",
  "Telão": "bg-primary/10 text-primary",
  "Câmera": "bg-accent/15 text-accent-foreground",
  Social: "bg-warning/15 text-warning-foreground",
};

export function SkillTag({ skill, onClick, active }: { skill: Skill; onClick?: () => void; active?: boolean }) {
  const Comp = onClick ? "button" : "span";
  return (
    <Comp
      onClick={onClick}
      className={cn(
        "rounded-full px-2.5 py-1 text-xs font-semibold transition",
        skillStyles[skill],
        active && "ring-2 ring-accent",
        onClick && "hover:opacity-80",
      )}
    >
      {skill}
    </Comp>
  );
}

const statusMap: Record<ScheduleStatus, { label: string; cls: string }> = {
  confirmed: { label: "Confirmado", cls: "bg-success/15 text-success" },
  pending: { label: "Pendente", cls: "bg-warning/20 text-warning-foreground" },
  declined: { label: "Recusado", cls: "bg-destructive/12 text-destructive" },
  swap_requested: { label: "Substituição", cls: "bg-ocean/12 text-ocean" },
};

export function StatusBadge({ status }: { status: ScheduleStatus }) {
  const s = statusMap[status];
  return (
    <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", s.cls)}>{s.label}</span>
  );
}

export function LeaderBadge({ sector }: { sector: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground">
      <Crown className="h-3 w-3" /> Líder · {sector}
    </span>
  );
}

export function MemberStatusBadge({ status }: { status: "Ativo" | "Indisponível" }) {
  return (
    <span
      className={cn(
        "rounded-full px-2.5 py-1 text-xs font-semibold",
        status === "Ativo" ? "bg-success/15 text-success" : "bg-muted text-muted-foreground",
      )}
    >
      {status}
    </span>
  );
}

export function Avatar({ name }: { name: string }) {
  const initials = name
    .split(" ")
    .slice(0, 2)
    .map((p) => p[0])
    .join("");
  return (
    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-sm font-bold text-primary">
      {initials}
    </div>
  );
}
