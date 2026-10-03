import { createFileRoute } from "@tanstack/react-router";
import { buildIcs } from "@/lib/ics";

export const Route = createFileRoute("/api/public/agenda/$token")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const token = params.token.replace(/\.ics$/, "");
        if (!/^[0-9a-f-]{36}$/i.test(token)) return new Response("Not found", { status: 404 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: prof } = await supabaseAdmin.from("profiles").select("id").eq("calendar_token", token).maybeSingle();
        if (!prof) return new Response("Not found", { status: 404 });
        const { data: rows } = await supabaseAdmin
          .from("schedules")
          .select("id, role_label, events(id, title, date_time, end_time, description)")
          .eq("profile_id", prof.id);
        const items = (rows ?? [])
          .filter((r: any) => r.events)
          .map((r: any) => ({ id: r.id, title: r.events.title, date_time: String(r.events.date_time).replace(" ", "T"), end_time: r.events.end_time, description: r.events.description, role: r.role_label }));
        return new Response(buildIcs(items), {
          headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "no-cache" },
        });
      },
    },
  },
});
