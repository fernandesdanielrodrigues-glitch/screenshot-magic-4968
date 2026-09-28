import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Skill } from "./mock-data";

export interface AuthUser {
  name: string;
  email: string;
  skills: Skill[];
}

interface MockAccount extends AuthUser {
  password: string;
}

interface AuthCtx {
  user: AuthUser | null;
  ready: boolean;
  signIn: (email: string, password: string, remember: boolean) => string | null;
  signUp: (data: MockAccount) => string | null;
  signOut: () => void;
}

const ACCOUNTS_KEY = "syncmidia-accounts";
const SESSION_KEY = "syncmidia-session";
const DEMO: MockAccount = {
  name: "Marina Alves",
  email: "marina@syncmidia.app",
  password: "123456",
  skills: ["Slide", "Social"],
};

const Ctx = createContext<AuthCtx | null>(null);

function readAccounts(): MockAccount[] {
  try {
    const list = JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || "[]") as MockAccount[];
    return list.some((a) => a.email === DEMO.email) ? list : [DEMO, ...list];
  } catch {
    return [DEMO];
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const raw = localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY);
    if (raw) {
      try {
        setUser(JSON.parse(raw));
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
      persist({ name: acc.name, email: acc.email, skills: acc.skills }, remember);
      return null;
    },
    signUp: (data) => {
      const list = readAccounts();
      if (list.some((a) => a.email.toLowerCase() === data.email.toLowerCase()))
        return "Já existe uma conta com este e-mail.";
      localStorage.setItem(ACCOUNTS_KEY, JSON.stringify([...list, data]));
      persist({ name: data.name, email: data.email, skills: data.skills }, true);
      return null;
    },
    signOut: () => {
      localStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem(SESSION_KEY);
      setUser(null);
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
