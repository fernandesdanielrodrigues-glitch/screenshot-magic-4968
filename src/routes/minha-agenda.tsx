import { createFileRoute } from "@tanstack/react-router";
import { CalendarDays, Clock, UserCircle2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { StatusBadge } from "@/components/Badges";
import { currentMember, formatLongDate, formatTime } from "@/lib/mock-data";
import { useStore } from "@/lib/store";

export const Route = createFileRoute("/minha-agenda")({
  head: () => ({
    meta: [
      { title: "Minha Agenda — SyncMídia" },
      { name: "description", content: "Confirme presença ou solicite substituição nas suas escalas." },
      { property: "og:title", content: "Minha Agenda — SyncMídia" },
      { property: "og:description", content: "Portal do voluntário com suas próximas escalas de mídia." },
    ],
  }),
  component: MinhaAgenda,
});

const reasons = ["Viagem", "Trabalho", "Saúde", "Compromisso familiar", "Outro"];

function MinhaAgenda() {
  const { schedules, events, users, userById, sectors, setScheduleStatus, pushNotification } = useStore();
  const [swapFor, setSwapFor] = useState<string | null>(null);
  const [reason, setReason] = useState(reasons[0]);
  const [substitute, setSubstitute] = useState("");

  const me = userById(currentMember);
  const mine = schedules.filter((s) => s.user_id === currentMember);

  return (
    <AppShell title="Minha Agenda" subtitle={`Olá, ${me?.name ?? "voluntário"}. Confira suas próximas escalas.`}>
      <div className="mx-auto max-w-lg space-y-4">
        {mine.map((s) => {
          const event = events.find((e) => e.id === s.event_id);
          const leaderId = sectors.find((sec) => sec.name === s.sector_name)?.leader_id;
          const leader = leaderId ? userById(leaderId)?.name : "A definir";
          return (
            <article key={s.id} className="rounded-xl bg-card p-5 shadow-card">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                <h2 className="truncate text-lg font-semibold text-foreground">{event?.title}</h2>
                <StatusBadge status={s.status} />
              </div>

              <div className="mt-3 space-y-1.5 text-sm text-muted-foreground">
                <p className="flex items-center gap-2 capitalize">
                  <CalendarDays className="h-4 w-4 shrink-0 text-accent" />
                  {event ? formatLongDate(event.date_time) : ""}
                </p>
                <p className="flex items-center gap-2">
                  <Clock className="h-4 w-4 shrink-0 text-accent" />
                  {event ? formatTime(event.date_time) : ""} · {s.role_label}
                </p>
                <p className="flex items-center gap-2">
                  <UserCircle2 className="h-4 w-4 shrink-0 text-accent" />
                  Líder: {leader}
                </p>
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <button
                  onClick={() => {
                    setScheduleStatus(s.id, "confirmed");
                    pushNotification(`${me?.name} confirmou presença em ${event?.title}.`, "confirm");
                    toast.success("Presença confirmada!");
                  }}
                  className="rounded-lg bg-success px-4 py-3 text-sm font-bold text-success-foreground transition hover:opacity-90"
                >
                  ACEITAR
                </button>
                <button
                  onClick={() => setSwapFor(s.id)}
                  className="rounded-lg border-2 border-warning px-4 py-3 text-sm font-bold text-warning-foreground transition hover:bg-warning/10"
                >
                  SOLICITAR SUBSTITUIÇÃO
                </button>
              </div>
            </article>
          );
        })}
        {mine.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground">Você não tem escalas no momento.</p>
        ) : null}
      </div>

      {swapFor ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-foreground/40 p-4"
          onClick={() => setSwapFor(null)}
        >
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-xl bg-card p-6 shadow-card">
            <h2 className="text-lg font-semibold text-foreground">Solicitar substituição</h2>

            <label className="mt-4 block text-sm font-medium text-foreground">Motivo</label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring"
            >
              {reasons.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>

            <label className="mt-4 block text-sm font-medium text-foreground">Sugerir substituto</label>
            <select
              value={substitute}
              onChange={(e) => setSubstitute(e.target.value)}
              className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Sem sugestão</option>
              {users
                .filter((u) => u.id !== currentMember && u.status === "Ativo")
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
            </select>

            <div className="mt-6 grid gap-2 sm:grid-cols-2">
              <button
                onClick={() => setSwapFor(null)}
                className="rounded-lg border border-input px-4 py-2.5 text-sm font-semibold text-foreground transition hover:bg-secondary"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  setScheduleStatus(swapFor, "swap_requested");
                  const sub = users.find((u) => u.id === substitute)?.name;
                  pushNotification(
                    `${me?.name} solicitou substituição (${reason})${sub ? ` sugerindo ${sub}` : ""}.`,
                    "swap",
                  );
                  setSwapFor(null);
                  toast.success("Solicitação enviada ao líder do setor.");
                }}
                className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground transition hover:opacity-90"
              >
                Enviar solicitação
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}
