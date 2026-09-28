import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { useAuth } from "@/lib/auth";
import { SKILLS, type Skill } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Entrar — SyncMídia" },
      { name: "description", content: "Entre ou crie sua conta no SyncMídia para ver suas escalas de mídia." },
      { property: "og:title", content: "Entrar — SyncMídia" },
      { property: "og:description", content: "Acesse sua conta e gerencie as escalas da equipe de mídia." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LoginPage,
});

const signUpSchema = z.object({
  name: z.string().trim().min(2, "Informe seu nome completo").max(100),
  email: z.string().trim().email("E-mail inválido").max(255),
  password: z.string().min(6, "A senha precisa ter pelo menos 6 caracteres").max(72),
});

const inputCls =
  "w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/30";

function LoginPage() {
  const { signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<"in" | "up">("in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [skills, setSkills] = useState<Skill[]>([]);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (tab === "in") {
      const err = signIn(email, password, remember);
      if (err) return setError(err);
    } else {
      const parsed = signUpSchema.safeParse({ name, email, password });
      if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Dados inválidos");
      if (skills.length === 0) return setError("Selecione pelo menos uma competência.");
      const err = signUp({ ...parsed.data, skills });
      if (err) return setError(err);
      toast.success("Conta criada com sucesso!");
    }
    navigate({ to: "/", replace: true });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-primary-deep px-4 py-10 font-sans">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-primary-foreground">
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-accent text-2xl font-black text-primary-foreground shadow-lg">
            S
          </div>
          <p className="mt-3 text-2xl font-bold tracking-tight">SyncMídia</p>
          <p className="text-sm text-primary-foreground/70">Escalas da equipe de mídia, sem complicação</p>
        </div>

        <div className="rounded-xl bg-card p-6 shadow-2xl sm:p-8">
          <div className="mb-6 grid grid-cols-2 rounded-lg bg-muted p-1">
            {(["in", "up"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setTab(t);
                  setError(null);
                }}
                className={cn(
                  "rounded-md py-2 text-sm font-semibold transition",
                  tab === t ? "bg-card text-foreground shadow" : "text-muted-foreground",
                )}
              >
                {t === "in" ? "Entrar" : "Criar Conta"}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-4">
            {tab === "up" && (
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-foreground">Nome completo</span>
                <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
              </label>
            )}
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-foreground">E-mail</span>
              <input type="email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-foreground">Senha</span>
              <input type="password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} required />
            </label>

            {tab === "up" && (
              <div>
                <span className="mb-2 block text-sm font-medium text-foreground">Competências</span>
                <div className="flex flex-wrap gap-2">
                  {SKILLS.map((s) => {
                    const on = skills.includes(s);
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setSkills((p) => (on ? p.filter((x) => x !== s) : [...p, s]))}
                        className={cn(
                          "rounded-full border px-3 py-1.5 text-sm font-medium transition",
                          on ? "border-accent bg-accent text-primary-foreground" : "border-input text-muted-foreground hover:border-accent",
                        )}
                      >
                        {s}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {tab === "in" && (
              <div className="flex items-center justify-between text-sm">
                <label className="flex items-center gap-2 text-muted-foreground">
                  <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="accent-accent" />
                  Lembrar-me
                </label>
                <button
                  type="button"
                  onClick={() => toast.info("No modo de teste não enviamos e-mails. Use a conta de demonstração.")}
                  className="font-medium text-accent hover:underline"
                >
                  Esqueci minha senha
                </button>
              </div>
            )}

            {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

            <button type="submit" className="w-full rounded-lg bg-accent py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-accent/90">
              {tab === "in" ? "Entrar" : "Criar Conta"}
            </button>
          </form>

          <p className="mt-5 rounded-lg bg-muted px-3 py-2 text-center text-xs text-muted-foreground">
            Modo de teste · demo: marina@syncmidia.app / 123456
          </p>
        </div>
      </div>
    </div>
  );
}
