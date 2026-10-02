import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Skill } from "./mock-data";

export type Role = "admin" | "leader" | "member";

export interface AuthUser {
  profileId: string | null;
  name: string;
  email: string;
  skills: Skill[];
  role: Role;
  realRole: Role;
  leaderOf?: Skill | undefined;
}

export function homeFor(role: Role) {
  return role === "member" ? "/minha-agenda" : "/";
}

const PUBLIC = ["/login", "/reset-password"];
export function isPublic(path: string) {
  return PUBLIC.includes(path) || path.startsWith("/confirmar/");
}

export function canAccess(role: Role, path: string) {
  if (isPublic(path) || path === "/perfil" || path === "/minha-agenda") return true;
  if (role === "admin") return true;
  if (role === "leader") return ["/", "/dashboard", "/equipe", "/escalas/nova", "/calendario"].includes(path);
  return false;
}

export function roleLabel(u: AuthUser) {
  if (u.role === "admin") return "Admin";
  if (u.role === "leader") return `Líder - ${u.leaderOf === "Câmera" ? "Câmeras" : (u.leaderOf ?? "Setor")}`;
  return "Membro";
}

interface AuthCtx {
  user: AuthUser | null;
  ready: boolean;
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (d: { name: string; email: string; password: string; skills: Skill[] }) => Promise<string | null>;
  resetPassword: (email: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  testAs: (role: Role | null) => void;
}

const TEST_KEY = "syncmidia-test-role";
const Ctx = createContext<AuthCtx | null>(null);

function translate(msg: string) {
  if (/invalid login/i.test(msg)) return "E-mail ou senha incorretos.";
  if (/not confirmed/i.test(msg)) return "Confirme seu e-mail antes de entrar (verifique sua caixa de entrada).";
  if (/already registered/i.test(msg)) return "Já existe uma conta com este e-mail.";
  if (/pwned|leaked|weak/i.test(msg)) return "Essa senha é fraca ou já vazou em outro site. Escolha outra.";
  return msg;
}

async function loadUser(uid: string, email: string): Promise<AuthUser> {
  const [{ data: prof }, { data: roles }] = await Promise.all([
    supabase.from("profiles").select("id, name, email, skills").eq("user_id", uid).maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", uid),
  ]);
  let leaderOf: Skill | undefined;
  if (prof) {
    const { data: sec } = await supabase.from("sectors").select("name").eq("leader_id", prof.id).maybeSingle();
    leaderOf = (sec?.name as Skill) ?? undefined;
  }
  const rs = (roles ?? []).map((r) => r.role);
  const realRole: Role = rs.includes("admin") ? "admin" : rs.includes("leader") || leaderOf ? "leader" : "member";
  const test = typeof localStorage !== "undefined" ? (localStorage.getItem(TEST_KEY) as Role | null) : null;
  return {
    profileId: prof?.id ?? null,
    name: prof?.name ?? email.split("@")[0]!,
    email: prof?.email ?? email,
    skills: (prof?.skills ?? []) as Skill[],
    realRole,
    role: test ?? realRole,
    leaderOf: leaderOf ?? (test === "leader" ? "Câmera" : undefined),
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    const { data } = await supabase.auth.getUser();
    if (data.user) setUser(await loadUser(data.user.id, data.user.email ?? ""));
    else setUser(null);
    setReady(true);
  }, []);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        setTimeout(() => {
          void refresh();
          if (event !== "SIGNED_OUT") qc.invalidateQueries();
        }, 0);
      }
    });
    void refresh();
    return () => sub.subscription.unsubscribe();
  }, [refresh, qc]);

  const value: AuthCtx = {
    user,
    ready,
    signIn: async (email, password) => {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      return error ? translate(error.message) : null;
    },
    signUp: async ({ name, email, password, skills }) => {
      const { error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { emailRedirectTo: window.location.origin, data: { name, skills } },
      });
      return error ? translate(error.message) : null;
    },
    resetPassword: async (email) => {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      return error ? translate(error.message) : null;
    },
    signOut: async () => {
      await qc.cancelQueries();
      qc.clear();
      localStorage.removeItem(TEST_KEY);
      await supabase.auth.signOut();
      setUser(null);
    },
    testAs: (role) => {
      if (!user) return;
      if (role && role !== user.realRole) localStorage.setItem(TEST_KEY, role);
      else localStorage.removeItem(TEST_KEY);
      const r = role ?? user.realRole;
      setUser({ ...user, role: r, leaderOf: user.leaderOf ?? (r === "leader" ? "Câmera" : undefined) });
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
