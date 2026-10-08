import { Pencil, Plus, Trash2, Users, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Avatar, SkillTag } from "@/components/Badges";
import { SKILLS, type Skill } from "@/lib/mock-data";
import { useStore, type Team } from "@/lib/store";

const COLORS = ["#2BB6A3", "#3B82F6", "#3B185F", "#F59E0B", "#EF4444", "#10B981", "#EC4899", "#64748B"];

export function TeamsPanel({ canEdit }: { canEdit: boolean }) {
  const { teams, users, userById, deleteTeam, teamOfUser } = useStore();
  const [editing, setEditing] = useState<Team | "new" | null>(null);
  const free = users.filter((u) => !teamOfUser(u.id) && u.status === "Ativo");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {teams.length} equipe(s) · {teams.filter((t) => t.status === "active").length} ativa(s)
        </p>
        {canEdit ? (
          <button
            onClick={() => setEditing("new")}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> Nova Equipe
          </button>
        ) : null}
      </div>

      {teams.length === 0 ? (
        <div className="rounded-xl bg-card p-10 text-center shadow-card">
          <Users className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-2 font-semibold text-foreground">Nenhuma equipe ainda</p>
          <p className="text-sm text-muted-foreground">Monte a primeira equipe com um líder e um voluntário por função.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {teams.map((t) => {
            const leader = t.leader_id ? userById(t.leader_id) : undefined;
            return (
              <div key={t.id} className="overflow-hidden rounded-xl bg-card shadow-card">
                <div className="h-1.5" style={{ backgroundColor: t.color }} />
                <div className="p-5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-semibold text-foreground">{t.name}</h3>
                      <p className="text-xs text-muted-foreground">Líder: {leader?.name ?? "—"}</p>
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        t.status === "active" ? "bg-accent/15 text-accent" : "bg-warning/15 text-warning"
                      }`}
                    >
                      {t.status === "active" ? "Ativa" : "Incompleta"} · {t.members.length}/5
                    </span>
                  </div>
                  {t.description ? <p className="mt-2 text-sm text-muted-foreground">{t.description}</p> : null}
                  <ul className="mt-3 space-y-1.5">
                    {SKILLS.map((sk) => {
                      const m = t.members.find((x) => x.sector === sk);
                      const u = m ? userById(m.user_id) : undefined;
                      return (
                        <li key={sk} className="flex items-center justify-between gap-2 text-sm">
                          <SkillTag skill={sk} />
                          <span className={u ? "text-foreground" : "text-muted-foreground italic"}>{u?.name ?? "vaga"}</span>
                        </li>
                      );
                    })}
                  </ul>
                  {canEdit ? (
                    <div className="mt-4 flex gap-2">
                      <button onClick={() => setEditing(t)} className="inline-flex items-center gap-1 rounded-lg bg-secondary px-3 py-1.5 text-xs font-semibold text-secondary-foreground">
                        <Pencil className="h-3.5 w-3.5" /> Editar
                      </button>
                      <button
                        onClick={async () => {
                          if (!window.confirm(`Excluir a equipe ${t.name}?`)) return;
                          await deleteTeam(t.id);
                          toast.success("Equipe excluída.");
                        }}
                        className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Excluir
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="rounded-xl bg-card p-5 shadow-card">
        <h3 className="font-semibold text-foreground">Voluntários sem equipe ({free.length})</h3>
        <div className="mt-3 flex flex-wrap gap-3">
          {free.length === 0 ? <p className="text-sm text-muted-foreground">Todos os voluntários ativos estão numa equipe.</p> : null}
          {free.map((u) => (
            <div key={u.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
              <Avatar name={u.name} />
              <div>
                <p className="text-sm font-medium text-foreground">{u.name}</p>
                <div className="flex flex-wrap gap-1">{u.skills.map((s) => <SkillTag key={s} skill={s} />)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {editing ? <TeamModal team={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

function TeamModal({ team, onClose }: { team: Team | null; onClose: () => void }) {
  const { users, teams, saveTeam, teamOfUser } = useStore();
  const [name, setName] = useState(team?.name ?? "");
  const [description, setDescription] = useState(team?.description ?? "");
  const [color, setColor] = useState(team?.color ?? COLORS[teams.length % COLORS.length]!);
  const [slots, setSlots] = useState<Record<Skill, string>>(() => {
    const base = { Slide: "", "Telão": "", "Câmera": "", Social: "", Foto: "" } as Record<Skill, string>;
    team?.members.forEach((m) => (base[m.sector] = m.user_id));
    return base;
  });
  const [leader, setLeader] = useState(team?.leader_id ?? "");
  const [busy, setBusy] = useState(false);

  const chosen = new Set(Object.values(slots).filter(Boolean));
  const inOtherTeam = (id: string) => {
    const t = teamOfUser(id);
    return !!t && t.id !== team?.id;
  };
  const leadsOther = (id: string) => teams.some((t) => t.leader_id === id && t.id !== team?.id);
  const optionsFor = (sk: Skill) =>
    users.filter(
      (u) => u.status === "Ativo" && u.skills.includes(sk) && !inOtherTeam(u.id) && (!chosen.has(u.id) || slots[sk] === u.id),
    );
  const leaderOptions = users.filter((u) => u.status === "Ativo" && !leadsOther(u.id) && (!inOtherTeam(u.id) || chosen.has(u.id)));
  const filled = SKILLS.filter((s) => slots[s]).length;

  async function save() {
    const n = name.trim();
    if (!n) { toast.error("Dê um nome à equipe."); return; }
    if (n.length > 60) { toast.error("Nome muito longo (máx. 60)."); return; }
    if (teams.some((t) => t.name.toLowerCase() === n.toLowerCase() && t.id !== team?.id)) { toast.error("Já existe uma equipe com esse nome."); return; }
    setBusy(true);
    try {
      await saveTeam(team?.id ?? null, {
        name: n,
        description: description.trim().slice(0, 300),
        color,
        leader_id: leader || null,
        members: SKILLS.filter((s) => slots[s]).map((s) => ({ user_id: slots[s], sector: s })),
      });
      toast.success(filled === 5 && leader ? "Equipe salva e Ativa." : "Equipe salva como Incompleta.");
      onClose();
    } catch {
      /* toast já exibido */
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-card p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">{team ? "Editar Equipe" : "Nova Equipe"}</h2>
          <button onClick={onClose} aria-label="Fechar"><X className="h-5 w-5 text-muted-foreground" /></button>
        </div>
        <div className="mt-4 space-y-4">
          <div>
            <label className="text-sm font-medium text-foreground">Nome</label>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Ex.: Equipe Azul" className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
          </div>
          <div>
            <label className="text-sm font-medium text-foreground">Descrição (opcional)</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
          </div>
          <div>
            <label className="text-sm font-medium text-foreground">Cor</label>
            <div className="mt-1 flex gap-2">
              {COLORS.map((c) => (
                <button key={c} onClick={() => setColor(c)} aria-label={c} className={`h-7 w-7 rounded-full ring-offset-2 ${color === c ? "ring-2 ring-ring" : ""}`} style={{ backgroundColor: c }} />
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">Funções ({filled}/5)</p>
            {SKILLS.map((sk) => (
              <div key={sk} className="grid grid-cols-[90px_1fr] items-center gap-2">
                <SkillTag skill={sk} />
                <select value={slots[sk]} onChange={(e) => setSlots((p) => ({ ...p, [sk]: e.target.value }))} className="rounded-lg border border-input bg-background px-3 py-2 text-sm">
                  <option value="">— vaga —</option>
                  {optionsFor(sk).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">Só aparecem voluntários Ativos, com a competência e sem outra equipe.</p>
          </div>
          <div>
            <label className="text-sm font-medium text-foreground">Líder da equipe</label>
            <select value={leader} onChange={(e) => setLeader(e.target.value)} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm">
              <option value="">— escolher —</option>
              {leaderOptions.map((u) => <option key={u.id} value={u.id}>{u.name}{chosen.has(u.id) ? " (nesta equipe)" : ""}</option>)}
            </select>
          </div>
          {filled < 5 || !leader ? (
            <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">A equipe ficará Incompleta até ter líder e as 5 funções preenchidas — só equipes Ativas podem ir para escalas.</p>
          ) : null}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-semibold text-muted-foreground">Cancelar</button>
          <button onClick={save} disabled={busy} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground disabled:opacity-50">
            {busy ? "Salvando..." : "Salvar Equipe"}
          </button>
        </div>
      </div>
    </div>
  );
}
