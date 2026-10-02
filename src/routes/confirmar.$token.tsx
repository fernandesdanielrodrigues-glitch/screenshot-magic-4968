import { createFileRoute } from "@tanstack/react-router";
import { CalendarDays, CheckCircle2, Clock, Repeat, User, Video } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type Invite = {
  member_name: string;
  event_title: string;
  event_date: string;
  sector: string;
  role_label: string;
  leader_name: string | null;
  status: string;
};

export const Route = createFileRoute("/confirmar/$token")({
  head: () => ({
    meta: [
      { title: "Confirmar presença — SyncMídia" },
      { name: "description", content: "Confirme sua presença na escala ou peça substituição em um clique." },
      { property: "og:title", content: "Confirmar presença — SyncMídia" },
      { property: "og:description", content: "Responda ao convite da escala de mídia em um clique." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  validateSearch: (s: Record<string, unknown>): { action?: "accept" | "swap" } =>
    s["action"] === "accept" || s["action"] === "swap" ? { action: s["action"] } : {},
  component: ConfirmPage,
});

const isUuid = (t: string) => /^[0-9a-f-]{36}$/i.test(t);

function ConfirmPage() {
  const { token } = Route.useParams();
  const { action } = Route.useSearch();
  const [invite, setInvite] = useState<Invite | null>(null);
  const [state, setState] = useState<"loading" | "invalid" | "ready" | "confirmed" | "swapped">("loading");
  const [swapOpen, setSwapOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const auto = useRef(false);

  async function respond(kind: "accept" | "swap", why?: string) {
    setBusy(true);
    setErr(null);
    const { error } = await supabase.rpc("respond_invite", { _token: token, _action: kind, _reason: why ?? null });
    setBusy(false);
    if (error) return setErr("Não foi possível registrar sua resposta. Tente novamente.");
    setSwapOpen(false);
    setState(kind === "accept" ? "confirmed" : "swapped");
  }

  useEffect(() => {
    if (!isUuid(token)) return setState("invalid");
    supabase.rpc("get_invite", { _token: token }).then(({ data, error }) => {
      const row = (data as Invite[] | null)?.[0];
      if (error || !row) return setState("invalid");
      setInvite(row);
      setState("ready");
      if (auto.current) return;
      auto.current = true;
      if (action === "accept") void respond("accept");
      if (action === "swap") setSwapOpen(true);
    });
  }, [token]);

  const d = invite ? new Date(invite.event_date.replace(" ", "T")) : null;

  return (
    <div className="grid min-h-screen place-items-center bg-[image:var(--gradient-header)] bg-primary p-4">
      <div className="w-full max-w-md rounded-xl bg-card p-6 shadow-card">
        <p className="text-center text-sm font-bold tracking-wide text-primary">SyncMídia</p>
        {state === "loading" ? <p className="mt-6 text-center text-sm text-muted-foreground">Carregando convite…</p> : null}
        {state === "invalid" ? (
          <p className="mt-6 text-center text-sm text-destructive">Link inválido ou expirado. Fale com o líder do seu setor.</p>
        ) : null}
        {invite && state !== "invalid" && state !== "loading" ? (
          <>
            <h1 className="mt-3 text-center text-xl font-semibold text-foreground">Olá, {invite.member_name.split(" ")[0]}!</h1>
            <ul className="mt-5 space-y-2.5 rounded-lg border border-border p-4 text-sm text-foreground">
              <li className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-muted-foreground" /> <b>{invite.event_title}</b></li>
              <li className="flex items-center gap-2 capitalize"><CalendarDays className="h-4 w-4 text-muted-foreground" />
                {d?.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}</li>
              <li className="flex items-center gap-2"><Clock className="h-4 w-4 text-muted-foreground" />
                {d?.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</li>
              <li className="flex items-center gap-2"><Video className="h-4 w-4 text-muted-foreground" /> Setor: {invite.role_label}</li>
              <li className="flex items-center gap-2"><User className="h-4 w-4 text-muted-foreground" /> Líder: {invite.leader_name ?? "—"}</li>
            </ul>

            {state === "confirmed" ? (
              <div className="mt-6 text-center">
                <CheckCircle2 className="mx-auto h-12 w-12 text-success" />
                <p className="mt-2 text-lg font-semibold text-foreground">Presença Confirmada com Sucesso! 🎉</p>
              </div>
            ) : state === "swapped" ? (
              <div className="mt-6 text-center">
                <Repeat className="mx-auto h-10 w-10 text-warning" />
                <p className="mt-2 font-semibold text-foreground">Pedido de substituição enviado ao líder.</p>
              </div>
            ) : (
              <div className="mt-6 grid gap-2">
                <button disabled={busy} onClick={() => respond("accept")}
                  className="rounded-lg bg-success px-4 py-3 text-sm font-semibold text-success-foreground transition hover:opacity-90 disabled:opacity-60">
                  Confirmar Presença
                </button>
                <button disabled={busy} onClick={() => setSwapOpen(true)}
                  className="rounded-lg bg-warning px-4 py-3 text-sm font-semibold text-warning-foreground transition hover:opacity-90 disabled:opacity-60">
                  Solicitar Substituição
                </button>
              </div>
            )}
            {err ? <p className="mt-3 text-center text-sm text-destructive">{err}</p> : null}
          </>
        ) : null}
      </div>

      {swapOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/40 p-4" onClick={() => setSwapOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-xl bg-card p-6 shadow-card">
            <h2 className="text-lg font-semibold text-foreground">Motivo da substituição</h2>
            <textarea value={reason} onChange={(e) => setReason(e.target.value.slice(0, 500))} rows={4}
              placeholder="Ex.: viagem a trabalho neste fim de semana"
              className="mt-3 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
            <div className="mt-4 flex gap-2">
              <button onClick={() => setSwapOpen(false)} className="flex-1 rounded-lg bg-secondary px-4 py-2.5 text-sm font-semibold text-secondary-foreground">Cancelar</button>
              <button disabled={busy || !reason.trim()} onClick={() => respond("swap", reason.trim())}
                className="flex-1 rounded-lg bg-warning px-4 py-2.5 text-sm font-semibold text-warning-foreground disabled:opacity-60">Enviar pedido</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
