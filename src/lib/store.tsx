import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type {
  AppEvent,
  NotificationItem,
  Schedule,
  ScheduleStatus,
  Sector,
  Skill,
  User,
} from "./mock-data";

type MemberInput = {
  name: string;
  email: string;
  skills: Skill[];
  status: User["status"];
  leaderOf?: Skill | null;
};

interface StoreValue {
  loading: boolean;
  users: User[];
  sectors: Sector[];
  events: AppEvent[];
  schedules: Schedule[];
  notifications: NotificationItem[];
  userById: (id: string) => User | undefined;
  nameLeaderOfSector: (userId: string, sector: Skill) => Promise<void>;
  removeLeader: (userId: string) => Promise<void>;
  setUserRole: (userId: string, role: User["role"]) => Promise<void>;
  toggleMemberStatus: (userId: string) => Promise<void>;
  setScheduleStatus: (scheduleId: string, status: ScheduleStatus, reason?: string) => Promise<void>;
  publishSchedule: (eventId: string, assignments: Record<Skill, string[]>) => Promise<void>;
  pushNotification: (message: string, kind: NotificationItem["kind"]) => Promise<void>;
  addEvent: (data: {
    title: string;
    date_time: string;
    recurring: boolean;
    description?: string | undefined;
    category?: AppEvent["category"];
    end_time?: string | undefined;
  }) => Promise<string>;
  addMember: (data: MemberInput) => Promise<void>;
  updateMember: (userId: string, data: MemberInput) => Promise<void>;
  toggleUnavailable: (userId: string, date: string) => Promise<void>;
}

const StoreContext = createContext<StoreValue | null>(null);
const KEY = ["syncmidia-data"];

function relTime(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 60000;
  if (diff < 1) return "agora";
  if (diff < 60) return `há ${Math.round(diff)} min`;
  if (diff < 1440) return `há ${Math.round(diff / 60)} h`;
  return `há ${Math.round(diff / 1440)} dias`;
}

async function fetchAll() {
  const [p, r, s, e, sc, u, n] = await Promise.all([
    supabase.from("profiles").select("*").order("name"),
    supabase.from("user_roles").select("user_id, role"),
    supabase.from("sectors").select("*"),
    supabase.from("events").select("*").order("date_time"),
    supabase.from("schedules").select("*").order("created_at"),
    supabase.from("unavailability").select("*"),
    supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(20),
  ]);
  const err = [p, r, s, e, sc, u, n].find((x) => x.error)?.error;
  if (err) throw err;

  const rank = { member: 0, leader: 1, admin: 2 } as const;
  const roleOf = new Map<string, User["role"]>();
  for (const row of r.data ?? []) {
    const cur = roleOf.get(row.user_id);
    if (!cur || rank[row.role] > rank[cur]) roleOf.set(row.user_id, row.role);
  }
  const sectors: Sector[] = (s.data ?? []).map((x) => ({ id: x.name, name: x.name as Skill, leader_id: x.leader_id }));

  const users: User[] = (p.data ?? []).map((x) => {
    const leads = sectors.find((sec) => sec.leader_id === x.id)?.name ?? null;
    let role: User["role"] = (x.user_id && roleOf.get(x.user_id)) || "member";
    if (role === "member" && leads) role = "leader";
    return {
      id: x.id,
      auth_id: x.user_id,
      name: x.name,
      email: x.email,
      role,
      skills: (x.skills ?? []) as Skill[],
      is_leader_of_sector: leads,
      avatar_url: x.avatar_url,
      status: (x.status as User["status"]) ?? "Ativo",
      unavailable_dates: (u.data ?? []).filter((d) => d.profile_id === x.id).map((d) => d.date),
    };
  });

  const events: AppEvent[] = (e.data ?? []).map((x) => ({
    id: x.id,
    title: x.title,
    date_time: x.date_time.slice(0, 19).replace(" ", "T"),
    description: x.description,
    category: (x.category as AppEvent["category"]) ?? undefined,
    end_time: x.end_time ?? undefined,
  }));

  const schedules: Schedule[] = (sc.data ?? []).map((x) => ({
    id: x.id,
    event_id: x.event_id,
    user_id: x.profile_id,
    sector_name: x.sector as Skill,
    role_label: x.role_label,
    status: x.status as ScheduleStatus,
    swap_reason: x.swap_reason,
  }));

  const notifications: NotificationItem[] = (n.data ?? []).map((x) => ({
    id: x.id,
    message: x.message,
    time: relTime(x.created_at),
    kind: x.kind as NotificationItem["kind"],
  }));

  return { users, sectors, events, schedules, notifications };
}

export function StoreProvider({ children, enabled }: { children: ReactNode; enabled: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: KEY, queryFn: fetchAll, enabled });

  useEffect(() => {
    if (!enabled) return;
    const ch = supabase.channel("syncmidia-live");
    for (const t of ["profiles", "user_roles", "sectors", "events", "schedules", "unavailability", "notifications"]) {
      ch.on("postgres_changes", { event: "*", schema: "public", table: t }, () => {
        qc.invalidateQueries({ queryKey: KEY });
      });
    }
    ch.subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [enabled, qc]);

  const value = useMemo<StoreValue>(() => {
    const users = data?.users ?? [];
    const sectors = data?.sectors ?? [];
    const events = data?.events ?? [];
    const schedules = data?.schedules ?? [];
    const refresh = () => qc.invalidateQueries({ queryKey: KEY });
    const check = (error: { message: string } | null) => {
      if (error) {
        toast.error(`Não foi possível salvar: ${error.message}`);
        throw error;
      }
    };

    const pushNotification: StoreValue["pushNotification"] = async (message, kind) => {
      await supabase.from("notifications").insert({ message, kind });
      refresh();
    };

    const setLeader = async (profileId: string, sector: Skill | null | undefined) => {
      const { error: e1 } = await supabase.from("sectors").update({ leader_id: null }).eq("leader_id", profileId);
      check(e1);
      if (sector) {
        const { error } = await supabase.from("sectors").update({ leader_id: profileId }).eq("name", sector);
        check(error);
      }
    };

    return {
      loading: isLoading,
      users,
      sectors,
      events,
      schedules,
      notifications: data?.notifications ?? [],
      userById: (id) => users.find((u) => u.id === id),
      pushNotification,
      addEvent: async ({ title, date_time, recurring, description, category, end_time }) => {
        const count = recurring ? 4 : 1;
        const pad = (n: number) => String(n).padStart(2, "0");
        const rows = Array.from({ length: count }, (_, i) => {
          const d = new Date(date_time);
          d.setDate(d.getDate() + 7 * i);
          return {
            title,
            date_time: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`,
            description: description ?? (recurring ? "Evento recorrente semanal." : ""),
            category: category ?? null,
            end_time: end_time ?? null,
          };
        });
        const { data: created, error } = await supabase.from("events").insert(rows).select("id, date_time").order("date_time");
        check(error);
        await pushNotification(`Evento "${title}" criado${recurring ? " (recorrente, 4 semanas)" : ""}.`, "system");
        await refresh();
        return created![0]!.id;
      },
      addMember: async (d) => {
        const { data: row, error } = await supabase
          .from("profiles")
          .insert({ name: d.name, email: d.email.trim().toLowerCase(), skills: d.skills, status: d.status })
          .select("id")
          .single();
        check(error);
        if (d.leaderOf) await setLeader(row!.id, d.leaderOf);
        await pushNotification(`${d.name} entrou para a equipe.`, "system");
      },
      updateMember: async (userId, d) => {
        const { error } = await supabase
          .from("profiles")
          .update({ name: d.name, email: d.email.trim().toLowerCase(), skills: d.skills, status: d.status })
          .eq("id", userId);
        check(error);
        await setLeader(userId, d.leaderOf);
        await pushNotification(`Perfil de ${d.name} atualizado.`, "system");
      },
      nameLeaderOfSector: async (userId, sector) => {
        await setLeader(userId, sector);
        const name = users.find((u) => u.id === userId)?.name ?? "Membro";
        await pushNotification(`${name} foi nomeado(a) líder do setor ${sector}.`, "leader");
      },
      removeLeader: async (userId) => {
        await setLeader(userId, null);
        refresh();
      },
      setUserRole: async (userId, role) => {
        const u = users.find((x) => x.id === userId);
        if (!u?.auth_id) {
          toast.error("Este membro ainda não criou uma conta — o papel será aplicado quando ele se cadastrar.");
          return;
        }
        const { error: e1 } = await supabase.from("user_roles").delete().eq("user_id", u.auth_id);
        check(e1);
        const { error } = await supabase.from("user_roles").insert({ user_id: u.auth_id, role });
        check(error);
        refresh();
      },
      toggleMemberStatus: async (userId) => {
        const u = users.find((x) => x.id === userId);
        if (!u) return;
        const { error } = await supabase
          .from("profiles")
          .update({ status: u.status === "Ativo" ? "Indisponível" : "Ativo" })
          .eq("id", userId);
        check(error);
        refresh();
      },
      toggleUnavailable: async (userId, date) => {
        const u = users.find((x) => x.id === userId);
        if (u?.unavailable_dates.includes(date)) {
          const { error } = await supabase.from("unavailability").delete().eq("profile_id", userId).eq("date", date);
          check(error);
        } else {
          const { error } = await supabase.from("unavailability").insert({ profile_id: userId, date });
          check(error);
        }
        refresh();
      },
      setScheduleStatus: async (scheduleId, status, reason) => {
        const { error } = await supabase
          .from("schedules")
          .update({ status, ...(reason !== undefined ? { swap_reason: reason } : {}) })
          .eq("id", scheduleId);
        check(error);
        refresh();
      },
      publishSchedule: async (eventId, assignments) => {
        const prev = schedules.filter((s) => s.event_id === eventId);
        const rows: { event_id: string; profile_id: string; sector: Skill; role_label: string; status: string }[] = [];
        (Object.keys(assignments) as Skill[]).forEach((sector) => {
          assignments[sector].forEach((userId, index) => {
            const old = prev.find((s) => s.user_id === userId && s.sector_name === sector);
            rows.push({
              event_id: eventId,
              profile_id: userId,
              sector,
              role_label: sector === "Câmera" ? `Câmera ${index + 1}` : sector === "Social" ? "Redes Sociais" : sector,
              status: old?.status ?? "pending",
            });
          });
        });
        const { error: e1 } = await supabase.from("schedules").delete().eq("event_id", eventId);
        check(e1);
        if (rows.length) {
          const { error } = await supabase.from("schedules").insert(rows);
          check(error);
        }
        const title = events.find((e) => e.id === eventId)?.title ?? "Evento";
        await pushNotification(`Escala de ${title} publicada e notificações enviadas.`, "system");
      },
    };
  }, [data, isLoading, qc]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside StoreProvider");
  return ctx;
}
