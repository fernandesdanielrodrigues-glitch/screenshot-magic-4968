import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Camera, Trash2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { SkillTag } from "@/components/Badges";
import { initials, roleLabel, useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/perfil")({
  head: () => ({
    meta: [
      { title: "Meu Perfil — SyncMídia" },
      { name: "description", content: "Edite sua foto, telefone/WhatsApp e senha no SyncMídia." },
      { property: "og:title", content: "Meu Perfil — SyncMídia" },
      { property: "og:description", content: "Edite sua foto, telefone/WhatsApp e senha no SyncMídia." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PerfilPage,
});

const PHONE_RE = /^\+?[\d\s()-]{8,20}$/;

function resizeImage(file: File, size = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = size;
      c.height = size;
      const ctx = c.getContext("2d");
      if (!ctx) return reject(new Error("canvas"));
      const m = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, size, size);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => reject(new Error("Imagem inválida"));
    img.src = URL.createObjectURL(file);
  });
}

const inputCls =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring";
const btnCls =
  "rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-50";

function PerfilPage() {
  const { user, refresh } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [phone, setPhone] = useState("");
  const [savingPhone, setSavingPhone] = useState(false);
  const [savingAvatar, setSavingAvatar] = useState(false);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [savingPw, setSavingPw] = useState(false);

  useEffect(() => setPhone(user?.phone ?? ""), [user?.phone]);

  if (!user) return null;

  const saveAvatar = async (url: string | null) => {
    if (!user.profileId) { toast.error("Seu perfil ainda não está vinculado."); return; }
    setSavingAvatar(true);
    const { error } = await supabase.from("profiles").update({ avatar_url: url }).eq("id", user.profileId);
    setSavingAvatar(false);
    if (error) { toast.error("Não foi possível salvar a foto: " + error.message); return; }
    await refresh();
    toast.success(url ? "Foto atualizada!" : "Foto removida.");
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) { toast.error("Escolha um arquivo de imagem."); return; }
    if (f.size > 8 * 1024 * 1024) { toast.error("Imagem muito grande (máx. 8 MB)."); return; }
    try {
      await saveAvatar(await resizeImage(f));
    } catch {
      toast.error("Não foi possível ler a imagem.");
    }
  };

  const savePhone = async () => {
    const v = phone.trim();
    if (v && !PHONE_RE.test(v)) { toast.error("Telefone inválido. Ex.: +55 11 99999-0000"); return; }
    if (!user.profileId) { toast.error("Seu perfil ainda não está vinculado."); return; }
    setSavingPhone(true);
    const { error } = await supabase.from("profiles").update({ phone: v || null }).eq("id", user.profileId);
    setSavingPhone(false);
    if (error) { toast.error("Não foi possível salvar: " + error.message); return; }
    await refresh();
    toast.success("Telefone atualizado!");
  };

  const savePassword = async () => {
    if (pw.length < 6) { toast.error("A senha deve ter pelo menos 6 caracteres."); return; }
    if (pw !== pw2) { toast.error("As senhas não coincidem."); return; }
    setSavingPw(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setSavingPw(false);
    if (error) {
      const m = /pwned|leaked|weak/i.test(error.message)
        ? "Essa senha é fraca ou já vazou em outro site. Escolha outra."
        : /different from the old/i.test(error.message)
          ? "A nova senha deve ser diferente da atual."
          : error.message;
      { toast.error(m); return; }
    }
    setPw("");
    setPw2("");
    toast.success("Senha alterada com sucesso!");
  };

  return (
    <AppShell title="Meu Perfil" subtitle="Seus dados e nível de acesso">
      <div className="grid max-w-3xl gap-6">
        <div className="rounded-xl bg-card p-6 shadow-card">
          <div className="flex items-center gap-4">
            <div className="relative">
              {user.avatarUrl ? (
                <img src={user.avatarUrl} alt={user.name} className="h-20 w-20 rounded-full object-cover" />
              ) : (
                <div className="grid h-20 w-20 place-items-center rounded-full bg-accent text-2xl font-bold text-accent-foreground">
                  {initials(user.name)}
                </div>
              )}
              <button
                type="button"
                aria-label="Alterar foto"
                disabled={savingAvatar}
                onClick={() => fileRef.current?.click()}
                className="absolute -bottom-1 -right-1 grid h-8 w-8 place-items-center rounded-full bg-primary text-primary-foreground shadow-card disabled:opacity-50"
              >
                <Camera className="h-4 w-4" />
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  void onFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </div>
            <div className="min-w-0">
              <p className="truncate text-lg font-bold text-foreground">{user.name}</p>
              <p className="truncate text-sm text-muted-foreground">{user.email}</p>
              <span className="mt-1 inline-block rounded-full bg-secondary px-2.5 py-0.5 text-xs font-semibold text-secondary-foreground">
                {roleLabel(user)}
              </span>
              {user.avatarUrl ? (
                <button
                  type="button"
                  onClick={() => void saveAvatar(null)}
                  className="mt-2 flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-3 w-3" /> Remover foto
                </button>
              ) : null}
            </div>
          </div>
          <p className="mt-6 text-sm font-semibold text-foreground">Competências</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {user.skills.map((s) => (
              <SkillTag key={s} skill={s} />
            ))}
          </div>
        </div>

        <div className="rounded-xl bg-card p-6 shadow-card">
          <p className="font-semibold text-foreground">Telefone / WhatsApp</p>
          <p className="text-xs text-muted-foreground">Usado para enviar suas convocações e lembretes.</p>
          <div className="mt-3 flex gap-2">
            <input
              type="tel"
              maxLength={20}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+55 11 99999-0000"
              className={inputCls}
            />
            <button type="button" className={btnCls} disabled={savingPhone} onClick={() => void savePhone()}>
              {savingPhone ? "Salvando..." : "Salvar"}
            </button>
          </div>
        </div>

        <div className="rounded-xl bg-card p-6 shadow-card">
          <p className="font-semibold text-foreground">Alterar senha</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <input type="password" autoComplete="new-password" placeholder="Nova senha" value={pw} onChange={(e) => setPw(e.target.value)} className={inputCls} />
            <input type="password" autoComplete="new-password" placeholder="Confirmar nova senha" value={pw2} onChange={(e) => setPw2(e.target.value)} className={inputCls} />
          </div>
          <button type="button" className={`${btnCls} mt-3`} disabled={savingPw || !pw} onClick={() => void savePassword()}>
            {savingPw ? "Salvando..." : "Alterar senha"}
          </button>
        </div>
      </div>
    </AppShell>
  );
}
