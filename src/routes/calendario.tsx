import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Clock, Plus, Users, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Avatar, StatusBadge } from "@/components/Badges";
import { SKILLS, dateKey, formatLongDate, formatTime, type AppEvent, type EventCategory } from "@/lib/mock-data";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/calendario")({
  head: () => ({
    meta: [
      { title: "Calendário — SyncMídia" },
      { name: "description", content: "Calendário mensal e semanal de eventos e escalas da equipe de mídia." },
      { property: "og:title", content: "Calendário — SyncMídia" },
      { property: "og:description", content: "Veja eventos por cor, estado da escala e crie novos eventos com um clique." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CalendarPage,
});

const CATS: Record<EventCategory, { label: string; cls: string; dot: string }> = {
  domingo: { label: "Culto de Domingo", cls: "bg-primary text-primary-foreground", dot: "bg-primary" },
  semana: { label: "Semana / Reunião", cls: "bg-primary-deep text-primary-foreground", dot: "bg-primary-deep" },
  especial: { label: "Evento Especial", cls: "bg-ocean text-primary-foreground", dot: "bg-ocean" },
};
const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const pad = (n: number) => String(n).padStart(2, "0");
const toKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const REQUIRED = 5; // Slide 1, Telão 1, Câmera 2, Social 1

export function categoryOf(e: AppEvent): EventCategory {
  if (e.category) return e.category;
  return new Date(e.date_time).getDay() === 0 ? "domingo" : "semana";
}

function CalendarPage() {
  const { events, schedules } = useStore();
  const [view, setView] = useState<"month" | "week">("month");
  const [cursor, setCursor] = useState(() => new Date(2026, 8, 27));
  const [newDate, setNewDate] = useState<string | null>(null);
  const [openEvent, setOpenEvent] = useState<AppEvent | null>(null);

  const days = useMemo(() => {
    const start = new Date(cursor);
    if (view === "month") {
      start.setDate(1);
      start.setDate(1 - start.getDay());
      return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
    }
    start.setDate(start.getDate() - start.getDay());
    return Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  }, [cursor, view]);

  const fill = (id: string) => {
    const n = Math.min(schedules.filter((s) => s.event_id === id).length, REQUIRED);
    return n >= REQUIRED ? "bg-success" : n === 0 ? "bg-destructive" : "bg-warning";
  };

  function move(dir: number) {
    const d = new Date(cursor);
    if (view === "month") d.setMonth(d.getMonth() + dir); else d.setDate(d.getDate() + 7 * dir);
    setCursor(d);
  }
  const todayKey = toKey(new Date());

  return (
    <AppShell title="Calendário" subtitle="Clique num dia vazio para criar um evento, ou num evento para gerir a escala.">
      <div className="rounded-xl bg-card p-4 shadow-card sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button onClick={() => move(-1)} aria-label="Anterior" className="rounded-lg border border-border p-2 hover:bg-secondary"><ChevronLeft className="h-4 w-4" /></button>
            <button onClick={() => move(1)} aria-label="Seguinte" className="rounded-lg border border-border p-2 hover:bg-secondary"><ChevronRight className="h-4 w-4" /></button>
            <h2 className="ml-2 text-lg font-semibold text-foreground">
              {MONTHS[cursor.getMonth()]} {cursor.getFullYear()}
            </h2>
          </div>
          <div className="flex rounded-lg bg-secondary p-1 text-sm font-semibold">
            {(["month", "week"] as const).map((v) => (
              <button key={v} onClick={() => setView(v)} className={cn("rounded-md px-3 py-1.5", view === v ? "bg-card text-foreground shadow-sm" : "text-muted-foreground")}>
                {v === "month" ? "Mês" : "Semana"}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {Object.values(CATS).map((c) => (
            <span key={c.label} className="flex items-center gap-1.5"><span className={cn("h-2.5 w-2.5 rounded-full", c.dot)} />{c.label}</span>
          ))}
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-success" />Escala completa</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-warning" />Vagas abertas</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-destructive" />Sem equipa</span>
        </div>

        <div className="mt-4 grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-border bg-border">
          {WEEKDAYS.map((w) => (
            <div key={w} className="bg-secondary py-2 text-center text-xs font-semibold text-muted-foreground">{w}</div>
          ))}
          {days.map((d) => {
            const key = toKey(d);
            const dayEvents = events.filter((e) => dateKey(e.date_time) === key);
            const outside = view === "month" && d.getMonth() !== cursor.getMonth();
            return (
              <div
                key={key}
                role="button"
                tabIndex={0}
                aria-label={`Criar evento em ${key}`}
                onClick={() => setNewDate(key)}
                onKeyDown={(e) => e.key === "Enter" && setNewDate(key)}
                className={cn(
                  "group flex cursor-pointer flex-col gap-1 bg-card p-1.5 text-left transition hover:bg-secondary/60",
                  view === "month" ? "min-h-24" : "min-h-56",
                  outside && "bg-muted/40 text-muted-foreground",
                )}
              >
                <div className="flex items-center justify-between">
                  <span className={cn("grid h-6 w-6 place-items-center rounded-full text-xs font-semibold", key === todayKey && "bg-accent text-accent-foreground")}>{d.getDate()}</span>
                  <Plus className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100" />
                </div>
                {dayEvents.map((e) => (
                  <button
                    key={e.id}
                    onClick={(ev) => { ev.stopPropagation(); setOpenEvent(e); }}
                    className={cn("flex w-full items-center gap-1 truncate rounded-md px-1.5 py-1 text-left text-[11px] font-semibold", CATS[categoryOf(e)].cls)}
                  >
                    <span className={cn("h-2 w-2 shrink-0 rounded-full ring-1 ring-card", fill(e.id))} />
                    <span className="hidden shrink-0 sm:inline">{formatTime(e.date_time)}</span>
                    <span className="truncate">{e.title}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {newDate ? <NewEventModal date={newDate} onClose={() => setNewDate(null)} /> : null}
      {openEvent ? <EventDetailsModal event={openEvent} onClose={() => setOpenEvent(null)} /> : null}
    </AppShell>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-card p-5 shadow-card" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-foreground">{title}</h3>
          <button onClick={onClose} aria-label="Fechar" className="rounded-md p-1 hover:bg-secondary"><X className="h-4 w-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

const inputCls = "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring";

function NewEventModal({ date, onClose }: { date: string; onClose: () => void }) {
  const { addEvent } = useStore();
  const isSunday = new Date(`${date}T12:00:00`).getDay() === 0;
  const [title, setTitle] = useState(isSunday ? "Culto de Domingo" : "");
  const [start, setStart] = useState(isSunday ? "10:00" : "19:30");
  const [end, setEnd] = useState(isSunday ? "12:00" : "21:00");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<EventCategory>(isSunday ? "domingo" : "semana");

  function save() {
    if (!title.trim()) { toast.error("Indique o nome do evento."); return; }
    if (end <= start) { toast.error("O horário de fim deve ser depois do início."); return; }
    addEvent({ title: title.trim(), date_time: `${date}T${start}:00`, end_time: end, description: description.trim(), category, recurring: false });
    toast.success("Evento criado.");
    onClose();
  }

  return (
    <Modal title="Novo Evento" onClose={onClose}>
      <p className="mb-4 text-sm capitalize text-muted-foreground">{formatLongDate(`${date}T12:00:00`)}</p>
      <div className="space-y-3">
        <label className="block text-sm font-medium text-foreground">Nome do Evento
          <input className={cn(inputCls, "mt-1")} list="ev-sugs" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Encontro de Jovens" autoFocus />
          <datalist id="ev-sugs"><option value="Culto de Domingo" /><option value="Encontro de Jovens" /><option value="Ensaio" /><option value="Reunião de Equipe" /></datalist>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm font-medium text-foreground">Início<input type="time" className={cn(inputCls, "mt-1")} value={start} onChange={(e) => setStart(e.target.value)} /></label>
          <label className="block text-sm font-medium text-foreground">Fim<input type="time" className={cn(inputCls, "mt-1")} value={end} onChange={(e) => setEnd(e.target.value)} /></label>
        </div>
        <label className="block text-sm font-medium text-foreground">Breve Descrição
          <textarea className={cn(inputCls, "mt-1 min-h-20")} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Detalhes do evento" />
        </label>
        <div>
          <p className="text-sm font-medium text-foreground">Cor / Categoria</p>
          <div className="mt-1 grid grid-cols-3 gap-2">
            {(Object.keys(CATS) as EventCategory[]).map((c) => (
              <button key={c} type="button" onClick={() => setCategory(c)}
                className={cn("flex items-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-semibold", category === c ? "border-foreground" : "border-border")}>
                <span className={cn("h-3 w-3 shrink-0 rounded-full", CATS[c].dot)} />{CATS[c].label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-semibold text-muted-foreground hover:bg-secondary">Cancelar</button>
        <button onClick={save} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">Salvar</button>
      </div>
    </Modal>
  );
}

function EventDetailsModal({ event, onClose }: { event: AppEvent; onClose: () => void }) {
  const { schedules, userById } = useStore();
  const navigate = useNavigate();
  const assigned = schedules.filter((s) => s.event_id === event.id);
  const cat = CATS[categoryOf(event)];
  const open = SKILLS.filter((sk) => !assigned.some((s) => s.sector_name === sk));

  return (
    <Modal title={event.title} onClose={onClose}>
      <span className={cn("inline-block rounded-full px-2.5 py-1 text-xs font-semibold", cat.cls)}>{cat.label}</span>
      <p className="mt-3 flex items-center gap-2 text-sm capitalize text-muted-foreground">
        <Clock className="h-4 w-4" />{formatLongDate(event.date_time)} · {formatTime(event.date_time)}{event.end_time ? ` – ${event.end_time}` : ""}
      </p>
      {event.description ? <p className="mt-2 text-sm text-foreground">{event.description}</p> : null}

      <div className="mt-4 rounded-lg border border-border p-3">
        <p className="flex items-center gap-2 text-sm font-semibold text-foreground"><Users className="h-4 w-4" />Resumo da Escala · {Math.min(assigned.length, REQUIRED)}/{REQUIRED}</p>
        <ul className="mt-2 space-y-2">
          {assigned.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <Avatar name={userById(s.user_id)?.name ?? "?"} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{userById(s.user_id)?.name}</p>
                  <p className="text-xs text-muted-foreground">{s.role_label}</p>
                </div>
              </div>
              <StatusBadge status={s.status} />
            </li>
          ))}
          {assigned.length === 0 ? <li className="text-sm text-muted-foreground">Ninguém escalado ainda.</li> : null}
        </ul>
        {open.length ? <p className="mt-2 text-xs font-medium text-warning-foreground">Setores em aberto: {open.join(", ")}</p> : null}
      </div>

      <button
        onClick={() => navigate({ to: "/escalas/nova", search: { evento: event.id } })}
        className="mt-5 w-full rounded-lg bg-primary px-4 py-3 text-sm font-bold text-primary-foreground hover:opacity-90"
      >
        Atribuir Funções / Gerenciar Escala
      </button>
    </Modal>
  );
}
