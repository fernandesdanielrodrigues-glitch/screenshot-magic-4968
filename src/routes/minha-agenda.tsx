import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Ban, CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, Clock, Download, List, UserCircle2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { buildIcs, googleLink } from "@/lib/ics";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { StatusBadge } from "@/components/Badges";
import { formatTime, type Schedule } from "@/lib/mock-data";
import { useStore } from "@/lib/store";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

type View = "list" | "calendar";

export const Route = createFileRoute("/minha-agenda")({
  validateSearch: (s: Record<string, unknown>): { view?: View } =>
    s["view"] === "calendar" ? { view: "calendar" } : s["view"] === "list" ? { view: "list" } : {},
  head: () => ({
    meta: [
      { title: "Minha Agenda — SyncMídia" },
      { name: "description", content: "Confirme presença, solicite substituição e informe indisponibilidade." },
      { property: "og:title", content: "Minha Agenda — SyncMídia" },
      { property: "og:description", content: "Portal do voluntário com escalas em lista ou calendário mensal." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MinhaAgenda,
});

const reasons = ["Viagem", "Trabalho", "Saúde", "Compromisso familiar", "Outro"];
const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const WEEK = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const pad = (n: number) => String(n).padStart(2, "0");
const keyOf = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const todayKey = () => {
  const t = new Date();
  return keyOf(t.getFullYear(), t.getMonth(), t.getDate());
};
function labelFor(key: string) {
  const [y = 0, m = 1, d = 1] = key.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const diff = Math.round((dt.getTime() - new Date(new Date().toDateString()).getTime()) / 86400000);
  const base = dt.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  if (diff === 0) return `Hoje · ${base}`;
  if (diff === 1) return `Amanhã · ${base}`;
  if (diff > 1 && diff < 7) return `Próximo(a) ${base}`;
  return base;
}

function MinhaAgenda() {
  const { schedules, events, users, userById, sectors, setScheduleStatus, pushNotification, toggleUnavailable } = useStore();
  const { view = "list" } = Route.useSearch();
  const navigate = useNavigate({ from: "/minha-agenda" });
  const { user } = useAuth();
  const me = user?.profileId ?? "";
  const meUser = userById(me);
  const unavailable = meUser?.unavailable_dates ?? [];

  const [swapFor, setSwapFor] = useState<string | null>(null);
  const [reason, setReason] = useState(reasons[0]);
  const [substitute, setSubstitute] = useState("");
  const [dayOpen, setDayOpen] = useState<string | null>(null);
  const [unavOpen, setUnavOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    if (!syncOpen || !me || token) return;
    void supabase.from("profiles").select("calendar_token").eq("id", me).maybeSingle().then(({ data }) => setToken(data?.calendar_token ?? null));
  }, [syncOpen, me, token]);
  const feedUrl = token && typeof window !== "undefined" ? `${window.location.origin}/api/public/agenda/${token}.ics` : "";
  const toItem = (s: Schedule, e: { id: string; title: string; date_time: string; end_time?: string | null; description?: string | null }) => ({
    id: s.id, title: e.title, date_time: e.date_time, end_time: e.end_time, description: e.description, role: s.role_label,
  });
  const downloadIcs = () => {
    const ics = buildIcs(upcoming.map(({ s, e }) => toItem(s, e!)));
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
    const a = document.createElement("a");
    a.href = url; a.download = "minha-agenda-syncmidia.ics"; a.click();
    URL.revokeObjectURL(url);
    toast.success("Arquivo de calendário baixado.");
  };
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });

  const mine = useMemo(
    () =>
      schedules
        .filter((s) => s.user_id === me)
        .map((s) => ({ s, e: events.find((e) => e.id === s.event_id) }))
        .filter((x) => x.e)
        .sort((a, b) => a.e!.date_time.localeCompare(b.e!.date_time)),
    [schedules, events, me],
  );
  const upcoming = mine.filter((x) => x.e!.date_time.slice(0, 10) >= todayKey());
  const byDay = new Map<string, typeof mine>();
  for (const x of mine) {
    const k = x.e!.date_time.slice(0, 10);
    byDay.set(k, [...(byDay.get(k) ?? []), x]);
  }
  const upcomingGroups = [...new Set(upcoming.map((x) => x.e!.date_time.slice(0, 10)))];

  const accept = (s: Schedule, title?: string) => {
    void setScheduleStatus(s.id, "confirmed");
    pushNotification(`${meUser?.name} confirmou presença em ${title}.`, "confirm");
    toast.success("Presença confirmada!");
  };
  const toggleDay = async (k: string) => {
    if (!me) return;
    const was = unavailable.includes(k);
    await toggleUnavailable(me, k);
    toast.success(was ? "Indisponibilidade removida." : "Indisponibilidade registrada.");
  };

  const ScheduleCard = ({ s, e }: { s: Schedule; e: NonNullable<(typeof mine)[number]["e"]> }) => {
    const leaderId = sectors.find((sec) => sec.name === s.sector_name)?.leader_id;
    const leader = leaderId ? userById(leaderId)?.name : "A definir";
    return (
      <article className="rounded-xl bg-card p-5 shadow-card">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-lg font-semibold text-foreground">{e.title}</h3>
            <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4 shrink-0 text-accent" />
              {formatTime(e.date_time)}
              {e.end_time ? ` - ${e.end_time}` : ""}
            </p>
          </div>
          <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">{s.role_label}</span>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <p className="flex items-center gap-2">
            <UserCircle2 className="h-4 w-4 shrink-0 text-accent" /> Líder: {leader}
          </p>
          <StatusBadge status={s.status} />
        </div>
        <a
          href={googleLink(toItem(s, e))}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
        >
          <CalendarPlus className="h-3.5 w-3.5" /> Adicionar ao Google Calendar
        </a>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <button
            onClick={() => accept(s, e.title)}
            disabled={s.status === "confirmed"}
            className="rounded-lg bg-accent px-4 py-3 text-sm font-bold text-accent-foreground transition hover:opacity-90 disabled:opacity-50"
          >
            Aceitar / Confirmar
          </button>
          <button
            onClick={() => setSwapFor(s.id)}
            className="rounded-lg border-2 border-warning px-4 py-3 text-sm font-bold text-warning-foreground transition hover:bg-warning/10"
          >
            Solicitar Substituição
          </button>
        </div>
      </article>
    );
  };

  const first = new Date(ym.y, ym.m, 1).getDay();
  const days = new Date(ym.y, ym.m + 1, 0).getDate();
  const cells = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const dot = (k: string) => {
    const list = byDay.get(k);
    if (list?.some((x) => x.s.status === "swap_requested" || x.s.status === "declined")) return "bg-destructive";
    if (list?.some((x) => x.s.status === "pending")) return "bg-warning";
    if (list?.length) return "bg-success";
    return null;
  };

  return (
    <AppShell title="Minha Agenda" subtitle={`Olá, ${meUser?.name ?? "voluntário"}. Confira suas escalas.`}>
      <div className="mx-auto max-w-3xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-lg bg-secondary p-1">
            {([
              ["list", "Lista / Próximas", List],
              ["calendar", "Calendário Mensal", CalendarDays],
            ] as const).map(([v, label, Icon]) => (
              <button
                key={v}
                onClick={() => navigate({ search: { view: v } })}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition",
                  view === v ? "bg-card text-foreground shadow-card" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" /> {label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setSyncOpen(true)}
              disabled={!me}
              className="flex items-center gap-2 rounded-lg border border-input bg-card px-4 py-2.5 text-sm font-semibold text-foreground transition hover:bg-secondary disabled:opacity-50"
            >
              <Download className="h-4 w-4" /> Exportar / Sincronizar
            </button>
            <button
              onClick={() => setUnavOpen(true)}
              disabled={!me}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
            >
              <CalendarPlus className="h-4 w-4" /> Informar Indisponibilidade
            </button>
          </div>
        </div>

        {view === "list" ? (
          upcomingGroups.length === 0 ? (
            <div className="rounded-xl bg-card p-10 text-center shadow-card">
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-accent/15">
                <CalendarDays className="h-8 w-8 text-accent" />
              </div>
              <h3 className="mt-4 text-lg font-semibold text-foreground">Nenhuma escala por enquanto</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {me ? "Avise com antecedência os dias em que não poderá servir." : "Seu perfil ainda não está ligado à equipe. Peça a um líder para cadastrar seu e-mail."}
              </p>
              {me ? (
                <button
                  onClick={() => setUnavOpen(true)}
                  className="mt-5 rounded-lg bg-accent px-4 py-2.5 text-sm font-bold text-accent-foreground hover:opacity-90"
                >
                  + Marcar Minha Indisponibilidade
                </button>
              ) : null}
            </div>
          ) : (
            upcomingGroups.map((k) => (
              <section key={k} className="space-y-3">
                <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground first-letter:uppercase">{labelFor(k)}</h2>
                {byDay.get(k)!.map(({ s, e }) => (
                  <ScheduleCard key={s.id} s={s} e={e!} />
                ))}
              </section>
            ))
          )
        ) : (
          <div className="rounded-xl bg-card p-4 shadow-card sm:p-6">
            <div className="mb-4 flex items-center justify-between">
              <button aria-label="Mês anterior" onClick={() => setYm(({ y, m }) => (m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }))} className="rounded-lg p-2 hover:bg-secondary">
                <ChevronLeft className="h-5 w-5" />
              </button>
              <h2 className="text-lg font-semibold text-foreground">{MONTHS[ym.m]} {ym.y}</h2>
              <button aria-label="Próximo mês" onClick={() => setYm(({ y, m }) => (m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }))} className="rounded-lg p-2 hover:bg-secondary">
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-muted-foreground">
              {WEEK.map((w) => <div key={w} className="py-1">{w}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {cells.map((d, i) => {
                if (!d) return <div key={i} />;
                const k = keyOf(ym.y, ym.m, d);
                const c = dot(k);
                const blocked = unavailable.includes(k);
                return (
                  <button
                    key={i}
                    onClick={() => setDayOpen(k)}
                    className={cn(
                      "flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border border-border text-sm transition hover:bg-secondary",
                      k === todayKey() && "ring-2 ring-accent",
                      blocked && "bg-muted text-muted-foreground",
                    )}
                  >
                    <span className="font-medium">{d}</span>
                    {c ? <span className={cn("h-2 w-2 rounded-full", c)} /> : blocked ? <Ban className="h-3 w-3" /> : <span className="h-2" />}
                  </button>
                );
              })}
            </div>
            <div className="mt-4 flex flex-wrap gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-success" /> Confirmado</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-warning" /> Pendente</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-destructive" /> Troca pendente</span>
              <span className="flex items-center gap-1.5"><Ban className="h-3 w-3" /> Indisponível</span>
            </div>
          </div>
        )}
      </div>

      {dayOpen ? (
        <Modal onClose={() => setDayOpen(null)}>
          <h2 className="text-lg font-semibold text-foreground first-letter:uppercase">{labelFor(dayOpen)}</h2>
          {byDay.get(dayOpen)?.length ? (
            <div className="mt-4 space-y-3">
              {byDay.get(dayOpen)!.map(({ s, e }) => <ScheduleCard key={s.id} s={s} e={e!} />)}
            </div>
          ) : (
            <>
              <p className="mt-2 text-sm text-muted-foreground">
                {unavailable.includes(dayOpen)
                  ? "Você marcou este dia como indisponível."
                  : "Marcar Indisponibilidade nesta Data? Os líderes serão avisados para não escalar você."}
              </p>
              <div className="mt-6 grid gap-2 sm:grid-cols-2">
                <button onClick={() => setDayOpen(null)} className="rounded-lg border border-input px-4 py-2.5 text-sm font-semibold hover:bg-secondary">Cancelar</button>
                <button
                  disabled={!me}
                  onClick={() => { void toggleDay(dayOpen); setDayOpen(null); }}
                  className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {unavailable.includes(dayOpen) ? "Remover indisponibilidade" : "Marcar indisponível"}
                </button>
              </div>
            </>
          )}
        </Modal>
      ) : null}

      {unavOpen ? (
        <Modal onClose={() => setUnavOpen(false)}>
          <h2 className="text-lg font-semibold text-foreground">Informar Indisponibilidade</h2>
          <p className="mt-1 text-sm text-muted-foreground">Toque nas datas em que você estará ausente.</p>
          <div className="mt-4 flex items-center justify-between">
            <button aria-label="Mês anterior" onClick={() => setYm(({ y, m }) => (m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }))} className="rounded-lg p-2 hover:bg-secondary"><ChevronLeft className="h-4 w-4" /></button>
            <span className="font-semibold">{MONTHS[ym.m]} {ym.y}</span>
            <button aria-label="Próximo mês" onClick={() => setYm(({ y, m }) => (m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }))} className="rounded-lg p-2 hover:bg-secondary"><ChevronRight className="h-4 w-4" /></button>
          </div>
          <div className="mt-2 grid grid-cols-7 gap-1 text-center text-xs">
            {WEEK.map((w) => <div key={w} className="py-1 font-semibold text-muted-foreground">{w}</div>)}
            {cells.map((d, i) => {
              if (!d) return <div key={i} />;
              const k = keyOf(ym.y, ym.m, d);
              const on = unavailable.includes(k);
              return (
                <button
                  key={i}
                  onClick={() => void toggleDay(k)}
                  className={cn("rounded-md py-2 text-sm transition", on ? "bg-primary text-primary-foreground" : "hover:bg-secondary")}
                >
                  {d}
                </button>
              );
            })}
          </div>
          <button onClick={() => setUnavOpen(false)} className="mt-5 w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-bold text-accent-foreground hover:opacity-90">Concluir</button>
        </Modal>
      ) : null}

      {syncOpen ? (
        <Modal onClose={() => setSyncOpen(false)}>
          <h2 className="text-lg font-semibold text-foreground">Exportar / Sincronizar agenda</h2>
          <div className="mt-4 space-y-5 text-sm">
            <section>
              <h3 className="font-semibold text-foreground">Sincronizar automaticamente</h3>
              <p className="mt-1 text-muted-foreground">Assine este link no seu calendário. Novas escalas aparecem sozinhas (o Google atualiza a cada poucas horas).</p>
              <input readOnly value={feedUrl || "Carregando…"} onFocus={(ev) => ev.target.select()} className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2 text-xs" />
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                <button disabled={!feedUrl} onClick={() => { void navigator.clipboard.writeText(feedUrl); toast.success("Link copiado!"); }} className="rounded-lg border border-input px-3 py-2 font-semibold hover:bg-secondary disabled:opacity-50">Copiar link</button>
                <a aria-disabled={!feedUrl} href={feedUrl ? `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(feedUrl.replace(/^https?:/, "webcal:"))}` : undefined} target="_blank" rel="noreferrer" className="rounded-lg bg-accent px-3 py-2 text-center font-semibold text-accent-foreground hover:opacity-90">Google Calendar</a>
                <a href={feedUrl ? feedUrl.replace(/^https?:/, "webcal:") : undefined} className="rounded-lg border border-input px-3 py-2 text-center font-semibold hover:bg-secondary">Apple / Outlook</a>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">Não compartilhe este link — quem tiver ele vê suas escalas.</p>
            </section>
            <section>
              <h3 className="font-semibold text-foreground">Exportar uma vez</h3>
              <p className="mt-1 text-muted-foreground">Baixe um arquivo .ics com suas próximas escalas e importe em qualquer calendário.</p>
              <button onClick={downloadIcs} disabled={!upcoming.length} className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">
                <Download className="h-4 w-4" /> Baixar arquivo (.ics)
              </button>
            </section>
          </div>
        </Modal>
      ) : null}

      {swapFor ? (
        <Modal onClose={() => setSwapFor(null)}>
          <h2 className="text-lg font-semibold text-foreground">Solicitar substituição</h2>
          <label className="mt-4 block text-sm font-medium text-foreground">Motivo</label>
          <select value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring">
            {reasons.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <label className="mt-4 block text-sm font-medium text-foreground">Sugerir substituto</label>
          <select value={substitute} onChange={(e) => setSubstitute(e.target.value)} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring">
            <option value="">Sem sugestão</option>
            {users.filter((u) => u.id !== me && u.status === "Ativo").map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <div className="mt-6 grid gap-2 sm:grid-cols-2">
            <button onClick={() => setSwapFor(null)} className="rounded-lg border border-input px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-secondary">Cancelar</button>
            <button
              onClick={() => {
                const sub = users.find((u) => u.id === substitute)?.name;
                void setScheduleStatus(swapFor, "swap_requested", `${reason}${sub ? ` · sugere ${sub}` : ""}`);
                pushNotification(`${meUser?.name} solicitou substituição (${reason})${sub ? ` sugerindo ${sub}` : ""}.`, "swap");
                setSwapFor(null);
                setDayOpen(null);
                toast.success("Solicitação enviada ao líder do setor.");
              }}
              className="rounded-lg bg-warning px-4 py-2.5 text-sm font-semibold text-warning-foreground hover:opacity-90"
            >
              Enviar solicitação
            </button>
          </div>
        </Modal>
      ) : null}
    </AppShell>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/40 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-card p-6 shadow-card">
        {children}
      </div>
    </div>
  );
}
