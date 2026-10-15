// S2 — Lembretes server-side (24h/2h). Cron do VPS: Bearer CRON_SECRET.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const WEBHOOK = Deno.env.get("NOTIFY_WEBHOOK_URL") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_TZ = Deno.env.get("APP_TIMEZONE") ?? "America/Sao_Paulo";

function tzOffsetMs(tz: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = Object.fromEntries(dtf.formatToParts(at).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour === 24 ? 0 : +p.hour, +p.minute, +p.second);
  return asUtc - at.getTime();
}
// Converte horário de parede (armazenado sem fuso, no fuso do app) para instante UTC.
function wallToInstant(wall: string): Date {
  const naive = new Date(wall + "Z").getTime();
  const t = naive - tzOffsetMs(APP_TZ, new Date(naive));
  return new Date(naive - tzOffsetMs(APP_TZ, new Date(t)));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function authOk(req: Request): boolean {
  const m = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "");
  return !!m && timingSafeEqual(m[1], CRON_SECRET);
}

Deno.serve(async (req) => {
  if (req.method !== "POST" || !authOk(req)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }
  const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const now = new Date();
  // Fetch WIDE (now−36h..now+54h em dígitos crus): events.date_time guarda horário de
  // parede (APP_TZ) sem fuso, e o SQL não faz a conversão tz-correta — o filtro
  // preciso das janelas acontece em JS via wallToInstant (abaixo). Os limites largos
  // cobrem o pior deslocamento de fuso das janelas 24h/2h.
  const fetchSince = new Date(now.getTime() - 36 * 3600e3).toISOString();
  const fetchUntil = new Date(now.getTime() + 54 * 3600e3).toISOString();
  const windows: Array<{ key: "24h" | "2h"; hours: number }> = [
    { key: "24h", hours: 24 },
    { key: "2h", hours: 2 },
  ];
  let processed = 0, sent = 0, simulated = 0, failed = 0;

  for (const w of windows) {
    const { data: rows, error } = await db
      .from("schedules")
      .select("id, role_label, status, notified_at, events!inner(id, title, date_time), profiles!inner(id, user_id, phone, email, name)")
      .in("status", ["pending", "confirmed"])
      .gt("events.date_time", fetchSince)
      .lte("events.date_time", fetchUntil);
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

    for (const row of rows ?? []) {
      const ev = row.events as { title: string; date_time: string };
      // Janela tz-correta: instante real = horário de parede convertido com APP_TZ.
      // Fora da janela → pula sem registrar nada (o filtro SQL é só a peneira larga).
      const start = wallToInstant(ev.date_time).getTime();
      const hoursAhead = (start - Date.now()) / 3600e3;
      if (!(hoursAhead > 0 && hoursAhead <= w.hours)) continue;
      const prof = row.profiles as { user_id: string | null; phone: string | null; email: string | null; name: string };
      // In-app primeiro: o canal 'inapp' marca a janela ANTES de qualquer efeito (idempotência por schedule+window).
      const { data: inappLogged, error: inappErr } = await db
        .from("reminder_log")
        .upsert(
          { schedule_id: row.id, window: w.key, channel: "inapp", status: "sent" },
          { onConflict: "schedule_id,window,channel", ignoreDuplicates: true },
        )
        .select("id");
      if (inappErr || !inappLogged || inappLogged.length === 0) continue; // já processado nesta janela — idempotência
      if (prof.user_id) {
        await db.from("notifications").insert({
          user_id: prof.user_id,
          message: `Lembrete: ${row.role_label} no evento ${ev.title} (veja horário no app).`,
          kind: "reminder",
        });
      }
      const channels: Array<{ channel: "whatsapp" | "email"; to: string }> = [];
      if (prof.phone) channels.push({ channel: "whatsapp", to: prof.phone });
      if (prof.email) channels.push({ channel: "email", to: prof.email });
      if (channels.length === 0) {
        await db.from("reminder_log").upsert(
          { schedule_id: row.id, window: w.key, channel: "email", status: "skipped", error: "sem contato" },
          { onConflict: "schedule_id,window,channel", ignoreDuplicates: true },
        );
        continue;
      }
      for (const ch of channels) {
        const { data: logged, error: logErr } = await db
          .from("reminder_log")
          .upsert(
            { schedule_id: row.id, window: w.key, channel: ch.channel, status: "sent" },
            { onConflict: "schedule_id,window,channel", ignoreDuplicates: true },
          )
          .select("id");
        if (logErr || !logged || logged.length === 0) continue; // já disparado — idempotência
        const message =
          `Olá ${prof.name.split(" ")[0]}! Lembrete (${w.key === "24h" ? "24 horas" : "2 horas"}): você está escalado para ` +
          `${row.role_label} no evento ${ev.title} em ` +
          `${wallToInstant(ev.date_time).toLocaleString("pt-BR", { timeZone: APP_TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}.`;
        let status = "simulated";
        let errText: string | null = null;
        if (WEBHOOK) {
          try {
            const res = await fetch(WEBHOOK, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ channel: ch.channel, to: ch.to, message, scheduleId: row.id, window: w.key }),
            });
            status = res.ok ? "sent" : "failed";
            if (!res.ok) errText = `HTTP ${res.status}`;
          } catch (e) {
            status = "failed";
            errText = e instanceof Error ? e.message : String(e);
          }
        }
        if (status === "sent") sent++;
        else if (status === "failed") failed++;
        else simulated++;
        await db.from("reminder_log").update({ status, error: errText }).eq("id", logged[0].id);
      }
      await db.from("schedules").update({ notified_at: new Date().toISOString() }).eq("id", row.id);
      processed++;
    }
  }
  return new Response(JSON.stringify({ processed, sent, simulated, failed }), {
    headers: { "Content-Type": "application/json" },
  });
});
