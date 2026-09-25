import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import {
  events as seedEvents,
  initialNotifications,
  initialSchedules,
  sectors as seedSectors,
  users as seedUsers,
  type AppEvent,
  type NotificationItem,
  type Schedule,
  type ScheduleStatus,
  type Sector,
  type Skill,
  type User,
} from "./mock-data";

interface StoreValue {
  users: User[];
  sectors: Sector[];
  events: AppEvent[];
  schedules: Schedule[];
  notifications: NotificationItem[];
  userById: (id: string) => User | undefined;
  nameLeaderOfSector: (userId: string, sector: Skill) => void;
  toggleMemberStatus: (userId: string) => void;
  setScheduleStatus: (scheduleId: string, status: ScheduleStatus) => void;
  publishSchedule: (eventId: string, assignments: Record<Skill, string[]>) => void;
  pushNotification: (message: string, kind: NotificationItem["kind"]) => void;
  addMember: (data: {
    name: string;
    email: string;
    skills: Skill[];
    status: User["status"];
    leaderOf?: Skill | null;
  }) => void;
  updateMember: (
    userId: string,
    data: {
      name: string;
      email: string;
      skills: Skill[];
      status: User["status"];
      leaderOf?: Skill | null;
    },
  ) => void;
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [users, setUsers] = useState<User[]>(seedUsers);
  const [sectors, setSectors] = useState<Sector[]>(seedSectors);
  const [events] = useState<AppEvent[]>(seedEvents);
  const [schedules, setSchedules] = useState<Schedule[]>(initialSchedules);
  const [notifications, setNotifications] = useState<NotificationItem[]>(initialNotifications);

  const value = useMemo<StoreValue>(() => {
    const pushNotification: StoreValue["pushNotification"] = (message, kind) =>
      setNotifications((prev) => [
        { id: `n${Date.now()}`, message, time: "agora", kind },
        ...prev,
      ]);

    return {
      users,
      sectors,
      events,
      schedules,
      notifications,
      userById: (id) => users.find((u) => u.id === id),
      pushNotification,
      addMember: (data) => {
        const id = `u${Date.now()}`;
        setUsers((prev) => [
          ...prev,
          {
            id,
            name: data.name,
            email: data.email,
            role: data.leaderOf ? "leader" : "member",
            skills: data.skills,
            status: data.status,
            is_leader_of_sector: data.leaderOf ?? null,
            avatar_url: null,
            unavailable_dates: [],
          },
        ]);
        if (data.leaderOf) {
          setUsers((prev) =>
            prev.map((u) =>
              u.id !== id && u.is_leader_of_sector === data.leaderOf
                ? { ...u, role: "member", is_leader_of_sector: null }
                : u,
            ),
          );
          setSectors((prev) =>
            prev.map((s) => (s.name === data.leaderOf ? { ...s, leader_id: id } : s)),
          );
        }
        pushNotification(`${data.name} foi adicionado(a) à equipe.`, "system");
      },
      updateMember: (userId, data) => {
        setUsers((prev) =>
          prev.map((u) => {
            if (u.id === userId) {
              return {
                ...u,
                name: data.name,
                email: data.email,
                skills: data.skills,
                status: data.status,
                role:
                  u.role === "admin"
                    ? "admin"
                    : data.leaderOf
                      ? "leader"
                      : "member",
                is_leader_of_sector: data.leaderOf ?? null,
              };
            }
            if (data.leaderOf && u.is_leader_of_sector === data.leaderOf)
              return { ...u, role: "member", is_leader_of_sector: null };
            return u;
          }),
        );
        setSectors((prev) =>
          prev.map((s) => {
            if (s.name === data.leaderOf) return { ...s, leader_id: userId };
            if (s.leader_id === userId && s.name !== data.leaderOf)
              return { ...s, leader_id: null };
            return s;
          }),
        );
        pushNotification(`Perfil de ${data.name} atualizado.`, "system");
      },
      nameLeaderOfSector: (userId, sector) => {
        setUsers((prev) =>
          prev.map((u) => {
            if (u.id === userId)
              return { ...u, role: "leader", is_leader_of_sector: sector };
            if (u.is_leader_of_sector === sector)
              return { ...u, role: "member", is_leader_of_sector: null };
            return u;
          }),
        );
        setSectors((prev) =>
          prev.map((s) => (s.name === sector ? { ...s, leader_id: userId } : s)),
        );
        const name = users.find((u) => u.id === userId)?.name ?? "Membro";
        pushNotification(`${name} foi nomeado(a) líder do setor ${sector}.`, "leader");
      },
      toggleMemberStatus: (userId) =>
        setUsers((prev) =>
          prev.map((u) =>
            u.id === userId
              ? { ...u, status: u.status === "Ativo" ? "Indisponível" : "Ativo" }
              : u,
          ),
        ),
      setScheduleStatus: (scheduleId, status) =>
        setSchedules((prev) =>
          prev.map((s) => (s.id === scheduleId ? { ...s, status } : s)),
        ),
      publishSchedule: (eventId, assignments) => {
        setSchedules((prev) => {
          const kept = prev.filter((s) => s.event_id !== eventId);
          const created: Schedule[] = [];
          (Object.keys(assignments) as Skill[]).forEach((sector) => {
            assignments[sector].forEach((userId, index) => {
              created.push({
                id: `sc-${eventId}-${sector}-${userId}`,
                event_id: eventId,
                user_id: userId,
                sector_name: sector,
                role_label: sector === "Câmera" ? `Câmera ${index + 1}` : sector,
                status: "pending",
              });
            });
          });
          return [...kept, ...created];
        });
        const title = events.find((e) => e.id === eventId)?.title ?? "Evento";
        pushNotification(`Escala de ${title} publicada e notificações enviadas.`, "system");
      },
    };
  }, [users, sectors, events, schedules, notifications]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside StoreProvider");
  return ctx;
}
