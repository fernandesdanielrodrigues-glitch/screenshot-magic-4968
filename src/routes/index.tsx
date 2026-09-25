import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, CalendarClock, CheckCircle2, UserPlus } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Avatar, StatusBadge } from "@/components/Badges";
import { SKILLS, formatLongDate, formatTime } from "@/lib/mock-data";
import { useStore } from "@/lib/store";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — SyncMídia" },
      { name: "description", content: "Visão geral de eventos, confirmações e alertas da equipe de mídia." },
      { property: "og:title", content: "Dashboard — SyncMídia" },
      { property: "og:description", content: "Acompanhe escalas, confirmações e substituições em tempo real." },
    ],
  }),
  component: Dashboard,
});

function MetricCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  icon: typeof CalendarClock;
  tone: string;
}) {
  return (
    <div className="rounded-xl bg-card p-5 shadow-card">
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 truncate text-sm font-medium text-muted-foreground">{label}</p>
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${tone}`}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-3 text-3xl font-bold tracking-tight text-foreground">{value}</p>
    </div>
  );
}

function Dashboard() {
  const { events, schedules, notifications, userById } = useStore();

  const total = schedules.length;
  const confirmed = schedules.filter((s) => s.status === "confirmed").length;
  const rate = total ? Math.round((confirmed / total) * 100) : 0;
  const swaps = schedules.filter((s) => s.status === "swap_requested").length;
  const openSlots = events.reduce((acc, event) => {
    const filled = new Set(schedules.filter((s) => s.event_id === event.id).map((s) => s.sector_name));
    return acc + SKILLS.filter((sk) => !filled.has(sk)).length;
  }, 0);

  return (
    <AppShell title="Dashboard" subtitle="Panorama das escalas da semana e da confirmação da equipe.">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Próximos Eventos" value={String(events.length)} icon={CalendarClock} tone="bg-primary/10 text-primary" />
        <MetricCard label="Taxa de Confirmação" value={`${rate}%`} icon={CheckCircle2} tone="bg-success/15 text-success" />
        <MetricCard label="Vagas Abertas" value={String(openSlots)} icon={UserPlus} tone="bg-ocean/12 text-ocean" />
        <MetricCard label="Alertas de Substituição" value={String(swaps)} icon={AlertTriangle} tone="bg-warning/20 text-warning-foreground" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section className="rounded-xl bg-card p-5 shadow-card">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
            <h2 className="truncate text-lg font-semibold text-foreground">Escala da semana</h2>
            <Link
              to="/escalas/nova"
              className="shrink-0 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-foreground transition hover:opacity-90"
            >
              Nova escala
            </Link>
          </div>

          <div className="mt-4 space-y-4">
            {events.map((event) => {
              const assigned = schedules.filter((s) => s.event_id === event.id);
              const filledSectors = new Set(assigned.map((s) => s.sector_name));
              return (
                <article key={event.id} className="rounded-xl border border-border p-4">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate font-semibold text-foreground">{event.title}</h3>
                      <p className="text-sm capitalize text-muted-foreground">
                        {formatLongDate(event.date_time)} · {formatTime(event.date_time)}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-secondary-foreground">
                      {filledSectors.size}/4 setores
                    </span>
                  </div>

                  <ul className="mt-3 space-y-2">
                    {assigned.map((s) => (
                      <li key={s.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                        <div className="flex min-w-0 items-center gap-2">
                          <Avatar name={userById(s.user_id)?.name ?? "?"} />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-foreground">
                              {userById(s.user_id)?.name}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">{s.role_label}</p>
                          </div>
                        </div>
                        <StatusBadge status={s.status} />
                      </li>
                    ))}
                    {assigned.length === 0 ? (
                      <li className="text-sm text-muted-foreground">Nenhum membro escalado ainda.</li>
                    ) : null}
                  </ul>
                </article>
              );
            })}
          </div>
        </section>

        <section className="rounded-xl bg-card p-5 shadow-card">
          <h2 className="text-lg font-semibold text-foreground">Notificações recentes</h2>
          <ul className="mt-4 space-y-4">
            {notifications.map((n) => (
              <li key={n.id} className="flex gap-3">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />
                <div className="min-w-0">
                  <p className="text-sm text-foreground">{n.message}</p>
                  <p className="text-xs text-muted-foreground">{n.time}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </AppShell>
  );
}
