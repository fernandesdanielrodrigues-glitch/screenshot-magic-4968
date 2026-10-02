// Notification dispatch helper. Real providers (WhatsApp via Evolution API, e-mail via Resend)
// plug in through VITE_NOTIFY_WEBHOOK_URL; without it, sends are simulated.
export type NotifyChannel = "whatsapp" | "email";

export const APP_URL = typeof window !== "undefined" ? window.location.origin : "https://app.syncmidia.com";

export function confirmLinks(token: string) {
  const base = `${APP_URL}/confirmar/${token}`;
  return { accept: `${base}?action=accept`, swap: `${base}?action=swap` };
}

export function buildMessage(p: { name: string; sector: string; event: string; when: string; token: string }) {
  const l = confirmLinks(p.token);
  return `Olá ${p.name}! Você foi escalado para o setor ${p.sector} no evento ${p.event} em ${p.when}.\n\nConfirme sua presença ou peça substituição pelos links abaixo:\n🟢 Confirmar: ${l.accept}\n🟠 Pedir Troca: ${l.swap}`;
}

export async function sendScheduleNotification(
  scheduleId: string,
  channel: NotifyChannel,
  payload?: { to?: string; message?: string },
): Promise<{ ok: boolean; simulated: boolean }> {
  const url = import.meta.env["VITE_NOTIFY_WEBHOOK_URL"] as string | undefined;
  if (!url) {
    console.info(`[notify:simulado] ${channel} → schedule ${scheduleId}`);
    return { ok: true, simulated: true };
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scheduleId, channel, ...payload }),
  });
  return { ok: res.ok, simulated: false };
}
