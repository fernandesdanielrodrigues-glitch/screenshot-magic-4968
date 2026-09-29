import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { SkillTag } from "@/components/Badges";
import { initials, roleLabel, useAuth } from "@/lib/auth";

export const Route = createFileRoute("/perfil")({
  head: () => ({
    meta: [
      { title: "Meu Perfil — SyncMídia" },
      { name: "description", content: "Seus dados, competências e nível de acesso no SyncMídia." },
      { property: "og:title", content: "Meu Perfil — SyncMídia" },
      { property: "og:description", content: "Seus dados, competências e nível de acesso no SyncMídia." },
    ],
  }),
  component: PerfilPage,
});

function PerfilPage() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <AppShell title="Meu Perfil" subtitle="Seus dados e nível de acesso">
      <div className="max-w-lg rounded-xl bg-card p-6 shadow-card">
        <div className="flex items-center gap-4">
          <div className="grid h-16 w-16 place-items-center rounded-full bg-accent text-xl font-bold text-accent-foreground">
            {initials(user.name)}
          </div>
          <div className="min-w-0">
            <p className="truncate text-lg font-bold text-foreground">{user.name}</p>
            <p className="truncate text-sm text-muted-foreground">{user.email}</p>
            <span className="mt-1 inline-block rounded-full bg-secondary px-2.5 py-0.5 text-xs font-semibold text-secondary-foreground">
              {roleLabel(user)}
            </span>
          </div>
        </div>
        <p className="mt-6 text-sm font-semibold text-foreground">Competências</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {user.skills.map((s) => (
            <SkillTag key={s} skill={s} />
          ))}
        </div>
      </div>
    </AppShell>
  );
}
