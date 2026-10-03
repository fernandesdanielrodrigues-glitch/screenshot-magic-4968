export type IcsItem = { id: string; title: string; date_time: string; end_time?: string | null; description?: string | null; role?: string };

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
const stamp = (dt: string) => dt.slice(0, 19).replace(/[-:]/g, "");

export function endOf(i: IcsItem) {
  const start = i.date_time.slice(0, 19);
  if (i.end_time && /^\d{2}:\d{2}/.test(i.end_time)) return `${start.slice(0, 10)}T${i.end_time.slice(0, 5)}:00`;
  const d = new Date(start);
  d.setHours(d.getHours() + 2);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`;
}

export function buildIcs(items: IcsItem[], name = "SyncMídia — Minha Agenda") {
  const now = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//SyncMidia//Agenda//PT", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${esc(name)}`];
  for (const i of items) {
    const title = i.role ? `${i.title} (${i.role})` : i.title;
    lines.push("BEGIN:VEVENT", `UID:${i.id}@syncmidia`, `DTSTAMP:${now}`, `DTSTART:${stamp(i.date_time)}`, `DTEND:${stamp(endOf(i))}`, `SUMMARY:${esc(title)}`);
    if (i.description) lines.push(`DESCRIPTION:${esc(i.description)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

export function googleLink(i: IcsItem) {
  const p = new URLSearchParams({
    action: "TEMPLATE",
    text: i.role ? `${i.title} (${i.role})` : i.title,
    dates: `${stamp(i.date_time)}/${stamp(endOf(i))}`,
    details: i.description ?? "Escala SyncMídia",
  });
  return `https://calendar.google.com/calendar/render?${p}`;
}
