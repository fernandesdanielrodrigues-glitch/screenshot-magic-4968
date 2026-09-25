import { createFileRoute } from "@tanstack/react-router";
import { MoreHorizontal, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Avatar, LeaderBadge, MemberStatusBadge, SkillTag } from "@/components/Badges";
import { SKILLS, type Skill } from "@/lib/mock-data";
import { useStore } from "@/lib/store";

export const Route = createFileRoute("/equipe")({
  head: () => ({
    meta: [
      { title: "Gestão de Equipe — SyncMídia" },
      { name: "description", content: "Gerencie membros, competências e líderes de cada setor de mídia." },
      { property: "og:title", content: "Gestão de Equipe — SyncMídia" },
      { property: "og:description", content: "Busque membros, filtre por setor e nomeie líderes." },
    ],
  }),
  component: EquipePage,
});

function EquipePage() {
  const { users, schedules, events, nameLeaderOfSector, toggleMemberStatus, addMember, updateMember } = useStore();
  const [query, setQuery] = useState("");
  const [sector, setSector] = useState<Skill | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [leaderModal, setLeaderModal] = useState(false);
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [modalUser, setModalUser] = useState<string>(users[0]?.id ?? "");
  const [modalSector, setModalSector] = useState<Skill>("Slide");
  const [memberModal, setMemberModal] = useState<{ mode: "create" } | { mode: "edit"; userId: string } | null>(null);

  const filtered = useMemo(
    () =>
      users.filter((u) => {
        const matchesQuery =
          u.name.toLowerCase().includes(query.toLowerCase()) ||
          u.email.toLowerCase().includes(query.toLowerCase());
        const matchesSector = !sector || u.skills.includes(sector);
        return matchesQuery && matchesSector;
      }),
    [users, query, sector],
  );

  const historyUser = users.find((u) => u.id === historyFor);
  const history = schedules.filter((s) => s.user_id === historyFor);

  return (
    <AppShell title="Gestão de Equipe" subtitle="Membros, competências e liderança por setor.">
      <div className="rounded-xl bg-card p-5 shadow-card">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div className="relative min-w-0">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value.slice(0, 80))}
              placeholder="Buscar por nome ou e-mail"
              className="w-full rounded-lg border border-input bg-background py-2.5 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              onClick={() => setMemberModal({ mode: "create" })}
              className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
            >
              + Novo Membro
            </button>
            <button
              onClick={() => setLeaderModal(true)}
              className="rounded-lg border border-border bg-secondary px-4 py-2.5 text-sm font-semibold text-secondary-foreground transition hover:opacity-90"
            >
              Nomear Líder
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            onClick={() => setSector(null)}
            className={`rounded-full px-2.5 py-1 text-xs font-semibold transition ${
              sector === null ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"
            }`}
          >
            Todos
          </button>
          {SKILLS.map((s) => (
            <SkillTag key={s} skill={s} active={sector === s} onClick={() => setSector(sector === s ? null : s)} />
          ))}
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {filtered.map((u) => (
          <article key={u.id} className="relative rounded-xl bg-card p-5 shadow-card">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar name={u.name} />
                <div className="min-w-0">
                  <p className="truncate font-semibold text-foreground">{u.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                </div>
              </div>
              <button
                aria-label="Ações"
                onClick={() => setMenuFor(menuFor === u.id ? null : u.id)}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition hover:bg-secondary"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {u.skills.map((s) => (
                <SkillTag key={s} skill={s} />
              ))}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <MemberStatusBadge status={u.status} />
              {u.is_leader_of_sector ? <LeaderBadge sector={u.is_leader_of_sector} /> : null}
              {u.role === "admin" ? (
                <span className="rounded-full bg-ocean/12 px-2.5 py-1 text-xs font-semibold text-ocean">
                  Administrador
                </span>
              ) : null}
            </div>

            {menuFor === u.id ? (
              <div className="absolute right-4 top-14 z-10 w-56 overflow-hidden rounded-xl border border-border bg-popover text-sm shadow-card">
                {[
                  {
                    label: "Nomear como Líder",
                    action: () => {
                      setModalUser(u.id);
                      setModalSector(u.skills[0] ?? "Slide");
                      setLeaderModal(true);
                    },
                  },
                  {
                    label: "Editar Membro",
                    action: () => setMemberModal({ mode: "edit", userId: u.id }),
                  },
                  { label: "Ver Histórico de Escalas", action: () => setHistoryFor(u.id) },
                  {
                    label: u.status === "Ativo" ? "Desativar Membro" : "Reativar Membro",
                    action: () => {
                      toggleMemberStatus(u.id);
                      toast.success(`${u.name} atualizado(a).`);
                    },
                  },
                ].map((item) => (
                  <button
                    key={item.label}
                    onClick={() => {
                      item.action();
                      setMenuFor(null);
                    }}
                    className="block w-full px-4 py-2.5 text-left text-popover-foreground transition hover:bg-secondary"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ) : null}
          </article>
        ))}
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum membro encontrado.</p>
        ) : null}
      </div>

      {memberModal ? (
        <MemberModal
          key={memberModal.mode === "edit" ? memberModal.userId : "new"}
          editing={memberModal.mode === "edit" ? users.find((u) => u.id === memberModal.userId) : undefined}
          onClose={() => setMemberModal(null)}
          onSave={(data) => {
            if (memberModal.mode === "edit") {
              updateMember(memberModal.userId, data);
              toast.success("Membro atualizado.");
            } else {
              addMember(data);
              toast.success(`${data.name} adicionado(a) à equipe.`);
            }
            setMemberModal(null);
          }}
        />
      ) : null}

      {leaderModal ? (
        <Modal title="Nomear Líder de Setor" onClose={() => setLeaderModal(false)}>
          <label className="block text-sm font-medium text-foreground">Membro</label>
          <select
            value={modalUser}
            onChange={(e) => setModalUser(e.target.value)}
            className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring"
          >
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>

          <label className="mt-4 block text-sm font-medium text-foreground">Setor</label>
          <select
            value={modalSector}
            onChange={(e) => setModalSector(e.target.value as Skill)}
            className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring"
          >
            {SKILLS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          <button
            onClick={() => {
              nameLeaderOfSector(modalUser, modalSector);
              setLeaderModal(false);
              toast.success("Liderança atualizada.");
            }}
            className="mt-6 w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground transition hover:opacity-90"
          >
            Confirmar nomeação
          </button>
        </Modal>
      ) : null}

      {historyUser ? (
        <Modal title={`Histórico — ${historyUser.name}`} onClose={() => setHistoryFor(null)}>
          <ul className="space-y-3">
            {history.map((h) => (
              <li key={h.id} className="rounded-lg border border-border p-3 text-sm">
                <p className="font-medium text-foreground">
                  {events.find((e) => e.id === h.event_id)?.title}
                </p>
                <p className="text-muted-foreground">
                  {h.role_label} · {h.status}
                </p>
              </li>
            ))}
            {history.length === 0 ? (
              <li className="text-sm text-muted-foreground">Sem escalas registradas.</li>
            ) : null}
          </ul>
        </Modal>
      ) : null}
    </AppShell>
  );
}

interface MemberFormData {
  name: string;
  email: string;
  skills: Skill[];
  status: "Ativo" | "Indisponível";
  leaderOf: Skill | null;
}

function MemberModal({
  editing,
  onClose,
  onSave,
}: {
  editing?: (ReturnType<typeof useStore>["users"])[number] | undefined;
  onClose: () => void;
  onSave: (data: MemberFormData) => void;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [email, setEmail] = useState(editing?.email ?? "");
  const [skills, setSkills] = useState<Skill[]>(editing?.skills ?? []);
  const [status, setStatus] = useState<"Ativo" | "Indisponível">(editing?.status ?? "Ativo");
  const [leaderOf, setLeaderOf] = useState<Skill | null>(editing?.is_leader_of_sector ?? null);
  const [error, setError] = useState<string | null>(null);

  const toggleSkill = (s: Skill) =>
    setSkills((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  const save = () => {
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    if (!trimmedName) return setError("Informe o nome completo.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) return setError("Informe um e-mail válido.");
    if (skills.length === 0) return setError("Selecione ao menos uma competência.");
    onSave({ name: trimmedName.slice(0, 100), email: trimmedEmail.slice(0, 255), skills, status, leaderOf });
  };

  return (
    <Modal title={editing ? `Editar — ${editing.name}` : "Novo Membro"} onClose={onClose}>
      <label className="block text-sm font-medium text-foreground">Nome completo</label>
      <input
        value={name}
        onChange={(e) => setName(e.target.value.slice(0, 100))}
        placeholder="Ex.: Ana Souza"
        className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring"
      />

      <label className="mt-4 block text-sm font-medium text-foreground">E-mail</label>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value.slice(0, 255))}
        placeholder="ana@exemplo.com"
        className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring"
      />

      <p className="mt-4 text-sm font-medium text-foreground">Competências / Funções</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {SKILLS.map((s) => (
          <SkillTag key={s} skill={s} active={skills.includes(s)} onClick={() => toggleSkill(s)} />
        ))}
      </div>

      <label className="mt-4 block text-sm font-medium text-foreground">Atribuir liderança (opcional)</label>
      <select
        value={leaderOf ?? ""}
        onChange={(e) => setLeaderOf(e.target.value === "" ? null : (e.target.value as Skill))}
        className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring"
      >
        <option value="">Nenhum</option>
        {SKILLS.map((s) => (
          <option key={s} value={s}>
            Líder de {s}
          </option>
        ))}
      </select>

      <p className="mt-4 text-sm font-medium text-foreground">Status</p>
      <div className="mt-2 flex gap-2">
        {(["Ativo", "Indisponível"] as const).map((st) => (
          <button
            key={st}
            onClick={() => setStatus(st)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
              status === st
                ? st === "Ativo"
                  ? "bg-success/15 text-success ring-2 ring-success"
                  : "bg-muted text-muted-foreground ring-2 ring-muted-foreground"
                : "bg-secondary text-secondary-foreground"
            }`}
          >
            {st}
          </button>
        ))}
      </div>

      {error ? <p className="mt-3 text-sm font-medium text-destructive">{error}</p> : null}

      <button
        onClick={save}
        className="mt-6 w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
      >
        Salvar
      </button>
    </Modal>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/40 p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl bg-card p-6 shadow-card"
      >
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}
