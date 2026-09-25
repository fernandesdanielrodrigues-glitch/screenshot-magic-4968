import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, Sparkles, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Avatar, SkillTag } from "@/components/Badges";
import { SKILLS, dateKey, formatLongDate, formatTime, type Skill } from "@/lib/mock-data";
import { useStore } from "@/lib/store";

export const Route = createFileRoute("/escalas/nova")({
  head: () => ({
    meta: [
      { title: "Criador de Escalas — SyncMídia" },
      { name: "description", content: "Monte a escala do evento por setor, com alertas de indisponibilidade." },
      { property: "og:title", content: "Criador de Escalas — SyncMídia" },
      { property: "og:description", content: "Distribua slide, telão, câmera e redes sociais em poucos cliques." },
    ],
  }),
  component: NovaEscala,
});

const emptyAssignments: Record<Skill, string[]> = {
  Slide: [],
  "Telão": [],
  "Câmera": [],
  Social: [],
};

function NovaEscala() {
  const { users, events, schedules, publishSchedule } = useStore();
  const [eventId, setEventId] = useState(events[0]?.id ?? "");
  const [skillFilter, setSkillFilter] = useState<Skill | null>(null);
  const [assignments, setAssignments] = useState<Record<Skill, string[]>>(() => {
    const base = { ...emptyAssignments, Slide: [], "Telão": [], "Câmera": [], Social: [] };
    schedules
      .filter((s) => s.event_id === (events[0]?.id ?? ""))
      .forEach((s) => base[s.sector_name].push(s.user_id));
    return base;
  });

  const event = events.find((e) => e.id === eventId);
  const eventDay = event ? dateKey(event.date_time) : "";

  const assignedIds = useMemo(
    () => new Set(SKILLS.flatMap((s) => assignments[s])),
    [assignments],
  );

  const available = users.filter(
    (u) =>
      !assignedIds.has(u.id) &&
      u.status === "Ativo" &&
      (!skillFilter || u.skills.includes(skillFilter)),
  );

  const assignmentCount = (userId: string) =>
    schedules.filter((s) => s.user_id === userId).length;

  function assign(userId: string, sector: Skill) {
    setAssignments((prev) => ({ ...prev, [sector]: [...prev[sector], userId] }));
  }

  function unassign(userId: string, sector: Skill) {
    setAssignments((prev) => ({ ...prev, [sector]: prev[sector].filter((id) => id !== userId) }));
  }

  function autoFill() {
    const next: Record<Skill, string[]> = { Slide: [], "Telão": [], "Câmera": [], Social: [] };
    const used = new Set<string>();
    SKILLS.forEach((sector) => {
      const needed = sector === "Câmera" ? 2 : 1;
      const candidates = users
        .filter(
          (u) =>
            u.status === "Ativo" &&
            u.skills.includes(sector) &&
            !used.has(u.id) &&
            !u.unavailable_dates.includes(eventDay),
        )
        .sort((a, b) => assignmentCount(a.id) - assignmentCount(b.id));
      candidates.slice(0, needed).forEach((c) => {
        used.add(c.id);
        next[sector].push(c.id);
      });
    });
    setAssignments(next);
    toast.success("Escala sugerida com base no menor número de escalas recentes.");
  }

  return (
    <AppShell title="Criador de Escalas" subtitle="Monte a escala do evento distribuindo a equipe por setor.">
      <div className="rounded-xl bg-card p-5 shadow-card">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:items-end">
          <div className="min-w-0">
            <label className="text-sm font-medium text-foreground">Evento</label>
            <select
              value={eventId}
              onChange={(e) => {
                setEventId(e.target.value);
                const base: Record<Skill, string[]> = { Slide: [], "Telão": [], "Câmera": [], Social: [] };
                schedules
                  .filter((s) => s.event_id === e.target.value)
                  .forEach((s) => base[s.sector_name].push(s.user_id));
                setAssignments(base);
              }}
              className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring"
            >
              {events.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title} — {formatLongDate(e.date_time)} · {formatTime(e.date_time)}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={autoFill}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-ocean px-4 py-2.5 text-sm font-semibold text-ocean-foreground transition hover:opacity-90"
          >
            <Sparkles className="h-4 w-4" /> Automatizar Escala
          </button>
          <button
            onClick={() => {
              publishSchedule(eventId, assignments);
              toast.success("Escala publicada. Equipe notificada.");
            }}
            className="shrink-0 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground transition hover:opacity-90"
          >
            Publicar Escala
          </button>
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,3fr)]">
        <section className="rounded-xl bg-card p-5 shadow-card">
          <h2 className="font-semibold text-foreground">Membros disponíveis</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {SKILLS.map((s) => (
              <SkillTag
                key={s}
                skill={s}
                active={skillFilter === s}
                onClick={() => setSkillFilter(skillFilter === s ? null : s)}
              />
            ))}
          </div>
          <ul className="mt-4 space-y-3">
            {available.map((u) => {
              const unavailable = u.unavailable_dates.includes(eventDay);
              return (
                <li key={u.id} className="rounded-lg border border-border p-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar name={u.name} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{u.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {assignmentCount(u.id)} escalas recentes
                      </p>
                    </div>
                  </div>
                  {unavailable ? (
                    <p className="mt-2 inline-flex items-center gap-1 rounded-md bg-destructive/10 px-2 py-1 text-xs font-semibold text-destructive">
                      <AlertTriangle className="h-3 w-3" /> Indisponível nesta data
                    </p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {u.skills.map((s) => (
                      <button
                        key={s}
                        onClick={() => assign(u.id, s)}
                        className="rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground transition hover:bg-secondary"
                      >
                        + {s}
                      </button>
                    ))}
                  </div>
                </li>
              );
            })}
            {available.length === 0 ? (
              <li className="text-sm text-muted-foreground">Nenhum membro disponível com este filtro.</li>
            ) : null}
          </ul>
        </section>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {SKILLS.map((sector) => (
            <section key={sector} className="rounded-xl bg-card p-4 shadow-card">
              <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                {sector === "Social" ? "Redes Sociais" : sector}
              </h3>
              <ul className="mt-3 space-y-2">
                {assignments[sector].map((userId) => {
                  const u = users.find((x) => x.id === userId);
                  if (!u) return null;
                  const warn = u.unavailable_dates.includes(eventDay);
                  return (
                    <li
                      key={userId}
                      className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-lg border p-2.5 ${
                        warn ? "border-destructive/40 bg-destructive/5" : "border-border"
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{u.name}</p>
                        {warn ? (
                          <p className="truncate text-xs font-semibold text-destructive">Conflito de data</p>
                        ) : (
                          <p className="truncate text-xs text-muted-foreground">Disponível</p>
                        )}
                      </div>
                      <button
                        aria-label="Remover"
                        onClick={() => unassign(userId, sector)}
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground transition hover:bg-secondary"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </li>
                  );
                })}
                {assignments[sector].length === 0 ? (
                  <li className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                    Vaga aberta
                  </li>
                ) : null}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
