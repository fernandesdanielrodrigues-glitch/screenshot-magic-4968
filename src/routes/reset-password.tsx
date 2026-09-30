import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Nova senha — SyncMídia" },
      { name: "description", content: "Defina uma nova senha para sua conta SyncMídia." },
      { property: "og:title", content: "Nova senha — SyncMídia" },
      { property: "og:description", content: "Defina uma nova senha para sua conta SyncMídia." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResetPassword,
});

function ResetPassword() {
  const navigate = useNavigate();
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pw.length < 6) return toast.error("A senha precisa ter pelo menos 6 caracteres.");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Senha atualizada!");
    navigate({ to: "/", replace: true });
  };
  return (
    <div className="flex min-h-screen items-center justify-center bg-primary-deep px-4 font-sans">
      <form onSubmit={submit} className="w-full max-w-md space-y-4 rounded-xl bg-card p-8 shadow-2xl">
        <h1 className="text-xl font-bold text-foreground">Definir nova senha</h1>
        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="Nova senha"
          className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent/30"
        />
        <button disabled={busy} className="w-full rounded-lg bg-accent py-2.5 text-sm font-semibold text-primary-foreground hover:bg-accent/90 disabled:opacity-60">
          Salvar nova senha
        </button>
      </form>
    </div>
  );
}
