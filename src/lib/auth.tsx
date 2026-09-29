import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Skill } from "./mock-data";

export interface AuthUser {
  name: string;
  email: string;
  skills: Skill[];
  role: Role;
  leaderOf?: Skill | undefined;
}

export type Role = "admin" | "leader" | "member";

export function homeFor(role: Role) {
  return role === "member" ? "/minha-agenda" : "/";
}

export function canAccess(role: Role, path: string) {
  if (path === "/login" || path === "/perfil" || path === "/minha-agenda") return true;
  if (role === "admin") return true;
  if (role === "leader") return ["/", "/dashboard", "/equipe", "/escalas/nova", "/calendario"].includes(path);
  return false;
}

export function roleLabel(u: AuthUser) {
  if (u.role === "admin") return "Admin";
  if (u.role === "leader") return `Líder - ${u.leaderOf === "Câmera" ? "Câmeras" : (u.leaderOf ?? "Setor")}`;
  return "Membro";
}

interface MockAccount extends AuthUser {
  password: string;
}

interface AuthCtx {
  user: AuthUser | null;
  ready: boolean;
  signIn: (email: string, password: string, remember: boolean) => string | null;
  signUp: (data: Omit<MockAccount, "role">) => string | null;
  signOut: () => void;
  testAs: (role: Role) => void;
}

const ACCOUNTS_KEY = "syncmidia-accounts";
const SESSION_KEY = "syncmidia-session";
const DEMO: MockAccount = {
  name: "Marina Alves",
  email: "marina@syncmidia.app",
  password: "123456",
  skills: ["Slide", "Social"],
  role: "admin",
};
const SEEDS: MockAccount[] = [
  DEMO,
  { name: "Rafael Souza", email: "rafael@syncmidia.app", password: "123456", skills: ["Câmera"], role: "leader", leaderOf: "Câmera" },
  { name: "Juliana Prado", email: "juliana@syncmidia.app", password: "123456", skills: ["Slide", "Telão"], role: "member" },
];

const Ctx = createContext<AuthCtx | null>(null);

function readAccounts(): MockAccount[] {
  try {
    const list = (JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || "[]") as MockAccount[]).filter(
      (a) => !SEEDS.some((s) => s.email === a.email),
    );
    return [...SEEDS, ...list.map((a) => ({ ...a, role: a.role ?? "member" }))];
  } catch {
    return SEEDS;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const raw = localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY);
    if (raw) {
      try {
        const u = JSON.parse(raw) as AuthUser;
        setUser({ ...u, role: u.role ?? "member" });
      } catch {
        /* ignore */
      }
    }
    setReady(true);
  }, []);

  const persist = (u: AuthUser, remember: boolean) => {
    const s = JSON.stringify(u);
    (remember ? localStorage : sessionStorage).setItem(SESSION_KEY, s);
    setUser(u);
  };

  const value: AuthCtx = {
    user,
    ready,
    signIn: (email, password, remember) => {
      const acc = readAccounts().find((a) => a.email.toLowerCase() === email.trim().toLowerCase());
      if (!acc || acc.password !== password) return "E-mail ou senha incorretos.";
      const { password: _p, ...u } = acc;
      persist(u, remember);
      return null;
    },
    signUp: (data) => {
      const list = readAccounts();
      if (list.some((a) => a.email.toLowerCase() === data.email.toLowerCase()))
        return "Já existe uma conta com este e-mail.";
      const acc: MockAccount = { ...data, role: "member" };
      localStorage.setItem(ACCOUNTS_KEY, JSON.stringify([...list, acc]));
      persist({ name: acc.name, email: acc.email, skills: acc.skills, role: "member" }, true);
      return null;
    },
    signOut: () => {
      localStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem(SESSION_KEY);
      setUser(null);
    },
    testAs: (role) => {
      const seed = SEEDS.find((a) => a.role === role)!;
      const { password: _p, ...u } = seed;
      persist(u, true);
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth outside AuthProvider");
  return c;
}

export function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}
