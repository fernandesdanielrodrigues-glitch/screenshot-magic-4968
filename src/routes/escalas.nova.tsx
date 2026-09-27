import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, CalendarPlus, Copy, Plus, Repeat, Sparkles, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Avatar, SkillTag } from "@/components/Badges";
import { SKILLS, dateKey, formatLongDate, formatTime, type Skill, type User } from "@/lib/mock-data";
import { useStore } from "@/lib/store";

export const Route = createFileRoute("/escalas/nova")({
  head: () => ({
    meta: [
      { title: "Criador de Escalas — SyncMídia" },
      { name: "description", content: "Crie eventos e monte a escala por setor em poucos cliques." },
      { property: "og:title", content: "Criador de Escalas — SyncMídia" },
      { property: "og:description", content: "Atalhos de domingos, cópia da escala anterior e atribuição em 1 clique." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  validateSearch: (s: Record<string, unknown>): { evento?: string } =>
    typeof s["evento"] === "string" ? { evento: s["evento"] as string } : {},
  component: NovaEscala,
});

const MONTHS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const EVENT_SUGGESTIONS = ["Culto de Domingo", "Culto de Quarta", "Encontro de Jovens", "Ensaio"];
const pad = (n: number) => String(n).padStart(2, "0");
const toKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const emptyAssign = (): Record<Skill, string[]> => ({ Slide: [], "Telão": [], "Câmera": [], Social: [] });

function nextSundays(count: number) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7 || 7));
  return Array.from({ length: count }, (_, i) => {
    const x = new Date(d);
    x.setDate(d.getDate() + 7 * i);
    return x;
  });
}

function buildAssignments(
  eventId: string,
  schedules: { event_id: string; sector_name: Skill; user_id: string }[],
): Record<Skill, string[]> {
  const base = emptyAssign();
  schedules.filter((s) => s.event_id === eventId).forEach((s) => base[s.sector_name].push(s.user_id));
  return base;
}

function NovaEscala() {
  const { users, events, schedules, publishSchedule, addEvent } = useStore();
  const { evento } = Route.useSearch();
  const initialId = events.find((e) => e.id === evento)?.id ?? events[0]?.id ?? "";
  const [eventId, setEventId] = useState(initialId);
  const [skillFilter, setSkillFilter] = useState<Skill | null>(null);
  const [assignments, setAssignments] = useState<Record<Skill, string[]>>(() =>
    buildAssignments(initialId, schedules),
  );
  const [eventModal, setEventModal] = useState(false);
  const [addMenu, setAddMenu] = useState<Skill | null>(null);

  const event = events.find((e) => e.id === eventId);
  const eventDay = event ? dateKey(event.date_time) : "";
  const sundays = useMemo(() => nextSundays(3), []);

  const assignedIds = useMemo(() => new Set(SKILLS.flatMap((s) => assignments[s])), [assignments]);
  const available = users.filter(
    (u) => !assignedIds.has(u.id) && u.status === "Ativo" && (!skillFilter || u.skills.includes(skillFilter)),
  );
  const assignmentCount = (userId: string) => schedules.filter((s) => s.user_id === userId).length;
  const isUnavailable = (u: User) => u.unavailable_dates.includes(eventDay);

  function selectEvent(id: string) {
    setEventId(id);
    setAssignments(buildAssignments(id, schedules));
    setAddMenu(null);
  }

  function selectSunday(d: Date) {
    const key = toKey(d);
    const existing = events.find((e) => dateKey(e.date_time) === key);
    if (existing) { selectEvent(existing.id); return; }
    const id = addEvent({ title: "Culto de Domingo", date_time: `${key}T10:00:00`, recurring: false });
    setEventId(id);
    setAssignments(emptyAssign());
    toast.success(`Culto de Domingo (${pad(d.getDate())}/${MONTHS[d.getMonth()]}) criado.`);
  }

  function assign(u: User, sector: Skill) {
    if (isUnavailable(u) && !window.confirm(`${u.name} está indisponível nesta data. Escalar mesmo assim?`)) return;
    setAssignments((prev) => ({ ...prev, [sector]: [...prev[sector], u.id] }));
    setAddMenu(null);
    toast.success(`${u.name} → ${sector}`, { duration: 1200 });
  }

  function unassign(userId: string, sector: Skill) {
    setAssignments((prev) => ({ ...prev, [sector]: prev[sector].filter((id) => id !== userId) }));
  }

  function autoFill() {
    const next = emptyAssign();
    const used = new Set<string>();
    SKILLS.forEach((sector) => {
      const needed = sector === "Câmera" ? 2 : 1;
      users
        .filter((u) => u.status === "Ativo" && u.skills.includes(sector) && !used.has(u.id) && !isUnavailable(u))
        .sort((a, b) => assignmentCount(a.id) - assignmentCount(b.id))
        .slice(0, needed)
        .forEach((c) => {
          used.add(c.id);
          next[sector].push(c.id);
        });
    });
    setAssignments(next);
    toast.success("Escala sugerida com base no menor número de escalas recentes.");
  }

  function copyPrevious() {
    if (!event) return;
    const previous = [...events]
      .filter(
        (e) =>
          e.id !== event.id &&
          e.date_time < event.date_time &&
          schedules.some((s) => s.event_id === e.id),
      )
      .sort((a, b) => {
        const aSun = new Date(a.date_time).getDay() === 0 ? 1 : 0;
        const bSun = new Date(b.date_time).getDay() === 0 ? 1 : 0;
        return bSun - aSun || b.date_time.localeCompare(a.date_time);
      })[0];
    if (!previous) { toast.error("Nenhuma escala anterior encontrada."); return; }
    const base = buildAssignments(previous.id, schedules);
    let removed = 0;
    SKILLS.forEach((s) => {
      base[s] = base[s].filter((id) => {
        const u = users.find((x) => x.id === id);
        const ok = !!u && u.status === "Ativo" && !isUnavailable(u);
        if (!ok) removed++;
        return ok;
      });
    });
    setAssignments(base);
    toast.success(
      `Escala copiada de ${previous.title} (${formatLongDate(previous.date_time)})${
        removed ? ` — ${removed} indisponível(is) removido(s)` : ""
      }.`,
    );
  }

  return (
    <AppShell title="Criador de Escalas" subtitle="Escolha o evento e distribua a equipa por setor em poucos cliques.">
      <div className="rounded-xl bg-card p-5 shadow-card">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="min-w-0">
            <label className="text-sm font-medium text-foreground">Evento</label>
            <select
              value={eventId}
              onChange={(e) => selectEvent(e.target.value)}
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
            onClick={() => setEventModal(true)}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
          >
            <CalendarPlus className="h-4 w-4" /> Novo Evento
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Domingos:</span>
          {sundays.map((d, i) => {
            const active = eventDay === toKey(d);
            return (
              <button
                key={toKey(d)}
                onClick={() => selectSunday(d)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                  active ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:opacity-80"
                }`}
              >
                {i === 0 ? "Próximo Domingo " : ""}
                {i === 0 ? "(" : ""}
                {pad(d.getDate())}/{MONTHS[d.getMonth()]}
                {i === 0 ? ")" : ""}
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
          <button
            onClick={autoFill}
            className="inline-flex items-center gap-2 rounded-lg bg-ocean px-4 py-2.5 text-sm font-semibold text-ocean-foreground transition hover:opacity-90"
          >
            <Sparkles className="h-4 w-4" /> Automatizar Escala
          </button>
          <button
            onClick={copyPrevious}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-secondary px-4 py-2.5 text-sm font-semibold text-secondary-foreground transition hover:opacity-90"
          >
            <Copy className="h-4 w-4" /> Copiar Escala Anterior
          </button>
          <button
            onClick={() => {
              publishSchedule(eventId, assignments);
              toast.success("Escala publicada. Equipa notificada.");
            }}
            className="ml-auto rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground transition hover:opacity-90"
          >
            Publicar Escala
          </button>
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,3fr)]">
        <section className="rounded-xl bg-card p-5 shadow-card">
          <h2 className="font-semibold text-foreground">Membros disponíveis</h2>
          <p className="text-xs text-muted-foreground">Clique numa função para escalar.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {SKILLS.map((s) => (
              <SkillTag key={s} skill={s} active={skillFilter === s} onClick={() => setSkillFilter(skillFilter === s ? null : s)} />
            ))}
          </div>
          <ul className="mt-4 space-y-3">
            {available.map((u) => {
              const unavailable = isUnavailable(u);
              return (
                <li key={u.id} className={`rounded-lg border p-3 ${unavailable ? "border-destructive/30 bg-destructive/5" : "border-border"}`}>
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar name={u.name} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{u.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{assignmentCount(u.id)} escalas recentes</p>
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
                        onClick={() => assign(u, s)}
                        className={`rounded-md border px-2 py-1 text-xs font-medium transition ${
                          unavailable
                            ? "border-destructive/30 text-destructive/70 hover:bg-destructive/10"
                            : "border-border text-foreground hover:bg-primary hover:text-primary-foreground"
                        }`}
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

        <div className="grid content-start gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {SKILLS.map((sector) => {
            const qualified = users.filter((u) => u.status === "Ativo" && u.skills.includes(sector) && !assignedIds.has(u.id));
            return (
              <section key={sector} className="relative rounded-xl bg-card p-4 shadow-card">
                <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  {sector === "Social" ? "Redes Sociais" : sector}
                </h3>
                <ul className="mt-3 space-y-2">
                  {assignments[sector].map((userId) => {
                    const u = users.find((x) => x.id === userId);
                    if (!u) return null;
                    const warn = isUnavailable(u);
                    return (
                      <li
                        key={userId}
                        className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-lg border p-2.5 ${
                          warn ? "border-destructive/40 bg-destructive/5" : "border-border"
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">{u.name}</p>
                          <p className={`truncate text-xs ${warn ? "font-semibold text-destructive" : "text-muted-foreground"}`}>
                            {warn ? "Conflito de data" : "Disponível"}
                          </p>
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

                <button
                  onClick={() => setAddMenu(addMenu === sector ? null : sector)}
                  className="mt-3 inline-flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-primary/50 py-2 text-xs font-semibold text-primary transition hover:bg-primary/10"
                >
                  <Plus className="h-3.5 w-3.5" /> Adicionar
                </button>
                {addMenu === sector ? (
                  <div className="absolute inset-x-4 z-20 mt-1 max-h-64 overflow-auto rounded-xl border border-border bg-popover shadow-card">
                    {qualified.length === 0 ? (
                      <p className="p-3 text-xs text-muted-foreground">Nenhum membro qualificado livre.</p>
                    ) : (
                      qualified.map((u) => {
                        const unav = isUnavailable(u);
                        return (
                          <button
                            key={u.id}
                            onClick={() => assign(u, sector)}
                            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-popover-foreground transition hover:bg-secondary"
                          >
                            <span className="truncate">{u.name}</span>
                            {unav ? <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" /> : null}
                          </button>
                        );
                      })
                    )}
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      </div>

      {eventModal ? (
        <NewEventModal
          onClose={() => setEventModal(false)}
          onSave={(data) => {
            const id = addEvent(data);
            setEventId(id);
            setAssignments(emptyAssign());
            setEventModal(false);
            toast.success(`Evento "${data.title}" criado.`);
          }}
        />
      ) : null}
    </AppShell>
  );
}

function NewEventModal({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (data: { title: string; date_time: string; recurring: boolean }) => void;
}) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(toKey(new Date()));
  const [time, setTime] = useState("19:30");
  const [recurring, setRecurring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    const t = title.trim();
    if (!t) return setError("Informe o nome do evento.");
    if (!date || !time) return setError("Escolha data e hora.");
    onSave({ title: t.slice(0, 80), date_time: `${date}T${time}:00`, recurring });
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/40 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-xl bg-card p-6 shadow-card">
        <h2 className="text-lg font-semibold text-foreground">Novo Evento</h2>

        <label className="mt-4 block text-sm font-medium text-foreground">Nome do evento</label>
        <div className="mt-2 flex flex-wrap gap-2">
          {EVENT_SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => {
                setTitle(s);
                if (s === "Culto de Domingo") setTime("10:00");
              }}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                title === s ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:opacity-80"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value.slice(0, 80))}
          placeholder="Ou escreva um nome (ex.: Conferência)"
          className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring"
        />

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-foreground">Data</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground">Hora</label>
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>

        <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm text-foreground">
          <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} className="h-4 w-4 accent-primary" />
          <Repeat className="h-4 w-4 text-muted-foreground" /> Repetir semanalmente (próximas 4 semanas)
        </label>

        {error ? <p className="mt-3 text-sm font-medium text-destructive">{error}</p> : null}

        <div className="mt-6 flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-lg bg-secondary px-4 py-2.5 text-sm font-semibold text-secondary-foreground">
            Cancelar
          </button>
          <button onClick={save} className="flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90">
            Criar evento
          </button>
        </div>
      </div>
    </div>
  );
}
