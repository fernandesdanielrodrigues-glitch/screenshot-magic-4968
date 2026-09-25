export type Skill = "Slide" | "Telão" | "Câmera" | "Social";
export type UserRole = "admin" | "leader" | "member";
export type UserStatus = "Ativo" | "Indisponível";
export type ScheduleStatus = "confirmed" | "pending" | "declined" | "swap_requested";

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  skills: Skill[];
  is_leader_of_sector: string | null;
  avatar_url: string | null;
  status: UserStatus;
  unavailable_dates: string[];
}

export interface Sector {
  id: string;
  name: Skill;
  leader_id: string | null;
}

export interface AppEvent {
  id: string;
  title: string;
  date_time: string;
  description: string;
}

export interface Schedule {
  id: string;
  event_id: string;
  user_id: string;
  sector_name: Skill;
  role_label: string;
  status: ScheduleStatus;
}

export interface NotificationItem {
  id: string;
  message: string;
  time: string;
  kind: "confirm" | "swap" | "leader" | "system";
}

export const SKILLS: Skill[] = ["Slide", "Telão", "Câmera", "Social"];

export const users: User[] = [
  {
    id: "u1",
    name: "Marina Alves",
    email: "marina@syncmidia.app",
    role: "admin",
    skills: ["Slide", "Social"],
    is_leader_of_sector: null,
    avatar_url: null,
    status: "Ativo",
    unavailable_dates: [],
  },
  {
    id: "u2",
    name: "Rafael Souza",
    email: "rafael@syncmidia.app",
    role: "leader",
    skills: ["Câmera", "Telão"],
    is_leader_of_sector: "Câmera",
    avatar_url: null,
    status: "Ativo",
    unavailable_dates: ["2026-10-04"],
  },
  {
    id: "u3",
    name: "Beatriz Lima",
    email: "beatriz@syncmidia.app",
    role: "leader",
    skills: ["Slide"],
    is_leader_of_sector: "Slide",
    avatar_url: null,
    status: "Ativo",
    unavailable_dates: [],
  },
  {
    id: "u4",
    name: "Diego Martins",
    email: "diego@syncmidia.app",
    role: "member",
    skills: ["Telão", "Slide"],
    is_leader_of_sector: null,
    avatar_url: null,
    status: "Ativo",
    unavailable_dates: ["2026-09-27"],
  },
  {
    id: "u5",
    name: "Carolina Reis",
    email: "carolina@syncmidia.app",
    role: "member",
    skills: ["Social"],
    is_leader_of_sector: null,
    avatar_url: null,
    status: "Ativo",
    unavailable_dates: [],
  },
  {
    id: "u6",
    name: "Tiago Ferreira",
    email: "tiago@syncmidia.app",
    role: "member",
    skills: ["Câmera"],
    is_leader_of_sector: null,
    avatar_url: null,
    status: "Indisponível",
    unavailable_dates: ["2026-09-27", "2026-10-04"],
  },
  {
    id: "u7",
    name: "Juliana Prado",
    email: "juliana@syncmidia.app",
    role: "member",
    skills: ["Câmera", "Social"],
    is_leader_of_sector: null,
    avatar_url: null,
    status: "Ativo",
    unavailable_dates: [],
  },
  {
    id: "u8",
    name: "Lucas Moreira",
    email: "lucas@syncmidia.app",
    role: "member",
    skills: ["Telão"],
    is_leader_of_sector: null,
    avatar_url: null,
    status: "Ativo",
    unavailable_dates: [],
  },
  {
    id: "u9",
    name: "Paula Nogueira",
    email: "paula@syncmidia.app",
    role: "leader",
    skills: ["Social", "Slide"],
    is_leader_of_sector: "Social",
    avatar_url: null,
    status: "Ativo",
    unavailable_dates: [],
  },
];

export const sectors: Sector[] = [
  { id: "s1", name: "Slide", leader_id: "u3" },
  { id: "s2", name: "Telão", leader_id: null },
  { id: "s3", name: "Câmera", leader_id: "u2" },
  { id: "s4", name: "Social", leader_id: "u9" },
];

export const events: AppEvent[] = [
  {
    id: "e1",
    title: "Culto de Domingo",
    date_time: "2026-09-27T10:00:00",
    description: "Transmissão completa com 3 câmeras.",
  },
  {
    id: "e2",
    title: "Encontro de Jovens",
    date_time: "2026-09-30T19:30:00",
    description: "Formato compacto, foco em redes sociais.",
  },
  {
    id: "e3",
    title: "Culto de Domingo",
    date_time: "2026-10-04T10:00:00",
    description: "Programação especial de louvor.",
  },
];

export const initialSchedules: Schedule[] = [
  { id: "sc1", event_id: "e1", user_id: "u3", sector_name: "Slide", role_label: "Slide Principal", status: "confirmed" },
  { id: "sc2", event_id: "e1", user_id: "u8", sector_name: "Telão", role_label: "Telão", status: "pending" },
  { id: "sc3", event_id: "e1", user_id: "u2", sector_name: "Câmera", role_label: "Câmera 1", status: "confirmed" },
  { id: "sc4", event_id: "e1", user_id: "u7", sector_name: "Câmera", role_label: "Câmera 2", status: "swap_requested" },
  { id: "sc5", event_id: "e1", user_id: "u5", sector_name: "Social", role_label: "Redes Sociais", status: "pending" },
  { id: "sc6", event_id: "e2", user_id: "u9", sector_name: "Social", role_label: "Redes Sociais", status: "confirmed" },
  { id: "sc7", event_id: "e2", user_id: "u4", sector_name: "Slide", role_label: "Slide Principal", status: "pending" },
  { id: "sc8", event_id: "e3", user_id: "u7", sector_name: "Câmera", role_label: "Câmera 1", status: "pending" },
  { id: "sc9", event_id: "e3", user_id: "u4", sector_name: "Telão", role_label: "Telão", status: "declined" },
];

export const initialNotifications: NotificationItem[] = [
  { id: "n1", message: "Rafael Souza confirmou presença em Culto de Domingo (27/09).", time: "há 12 min", kind: "confirm" },
  { id: "n2", message: "Juliana Prado solicitou substituição para Câmera 2.", time: "há 1 h", kind: "swap" },
  { id: "n3", message: "Paula Nogueira foi nomeada líder do setor Social.", time: "ontem", kind: "leader" },
  { id: "n4", message: "Escala do Encontro de Jovens publicada.", time: "há 2 dias", kind: "system" },
];

export const currentMember = "u7";

export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export function formatLongDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  });
}

export function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function dateKey(iso: string) {
  return iso.slice(0, 10);
}
