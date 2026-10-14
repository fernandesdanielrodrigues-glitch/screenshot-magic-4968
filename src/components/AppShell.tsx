import { Link, useNavigate } from "@tanstack/react-router";
import { Bell, CalendarDays, LayoutDashboard, ListChecks, LogOut, Menu, Smartphone, User as UserIcon, Users, FlaskConical } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useStore } from "@/lib/store";
import { canAccess, initials, roleLabel, useAuth, type Role } from "@/lib/auth";
import type { NotificationItem } from "@/lib/mock-data";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/calendario", label: "Calendário", icon: CalendarDays },
  { to: "/equipe", label: "Equipe", icon: Users },
  { to: "/escalas/nova", label: "Criar Escala", icon: ListChecks },
  { to: "/minha-agenda", label: "Minha Agenda", icon: Smartphone },
] as const;

const kindLabels: Record<NotificationItem["kind"], { label: string; cls: string }> = {
  assignment: { label: "Escala", cls: "bg-primary/10 text-primary" },
  reminder: { label: "Lembrete", cls: "bg-warning/20 text-warning-foreground" },
  confirm: { label: "Confirmação", cls: "bg-success/15 text-success" },
  swap: { label: "Substituição", cls: "bg-ocean/12 text-ocean" },
  leader: { label: "Liderança", cls: "bg-accent/15 text-accent-foreground" },
  system: { label: "Sistema", cls: "bg-secondary text-secondary-foreground" },
};

export function AppShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const { notifications, markAllNotificationsRead } = useStore();
  const { user, signOut, testAs } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const today = new Date().toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  });

  if (!user) return null;

  const personal = notifications.filter((n) => n.user_id === user.authId);
  const unread = personal.filter((n) => !n.read_at).length;

  return (
    <div className="min-h-screen bg-background font-sans">
      <div className="flex flex-wrap items-center justify-center gap-2 bg-secondary px-4 py-1.5 text-xs text-secondary-foreground">
        <FlaskConical className="h-3.5 w-3.5" /> <span className="font-semibold">Modo teste:</span>
        {(
          [
            ["admin", "Admin"],
            ["leader", "Líder"],
            ["member", "Membro"],
          ] as [Role, string][]
        ).map(([r, l]) => (
          <button
            key={r}
            onClick={() => testAs(r)}
            className={cn(
              "rounded-md border border-border px-2 py-0.5 font-medium transition hover:bg-background",
              user.role === r && "bg-accent text-accent-foreground border-transparent",
            )}
          >
            Testar como {l}
          </button>
        ))}
      </div>
      <header style={{ background: "var(--gradient-header)" }} className="text-primary-foreground">
        <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-4 sm:flex sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent text-accent-foreground font-black">
              S
            </div>
            <div className="min-w-0">
              <p className="truncate text-lg font-bold tracking-tight">SyncMídia</p>
              <p className="truncate text-xs text-primary-foreground/70 capitalize">{today}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <button
                aria-label="Notificações"
                aria-expanded={bellOpen}
                onClick={() => setBellOpen((v) => !v)}
                className="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/10 transition hover:bg-white/20"
              >
                <Bell className="h-4 w-4" />
                {unread > 0 ? (
                  <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1 text-[10px] font-bold text-accent-foreground">
                    {unread}
                  </span>
                ) : null}
              </button>
              {bellOpen ? (
                <>
                  <div className="fixed inset-0 z-20" onClick={() => setBellOpen(false)} aria-hidden="true" />
                  <div className="absolute right-0 top-12 z-30 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-border bg-popover shadow-card">
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-border px-4 py-3">
                      <p className="text-sm font-semibold text-foreground">Notificações</p>
                      <button
                        onClick={() => {
                          void markAllNotificationsRead(user.authId).then(() =>
                            toast.success("Notificações marcadas como lidas."),
                          );
                        }}
                        disabled={unread === 0}
                        className="rounded-md border border-border px-2 py-1 text-xs font-semibold text-primary transition hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Marcar todas como lidas
                      </button>
                    </div>
                    <ul className="max-h-80 overflow-y-auto">
                      {personal.map((n) => (
                        <li key={n.id} className={cn("border-b border-border/60 px-4 py-3 last:border-b-0", !n.read_at && "bg-accent/5")}>
                          <div className="flex items-start gap-2">
                            <span className={cn("mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold", kindLabels[n.kind].cls)}>
                              {kindLabels[n.kind].label}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className={cn("text-sm text-foreground", !n.read_at && "font-semibold")}>{n.message}</p>
                              <p className="text-xs text-muted-foreground">{n.time}{n.read_at ? "" : " · não lida"}</p>
                            </div>
                            {!n.read_at ? <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" /> : null}
                          </div>
                        </li>
                      ))}
                      {personal.length === 0 ? (
                        <li className="px-4 py-6 text-center text-sm text-muted-foreground">Nenhuma notificação pessoal.</li>
                      ) : null}
                    </ul>
                  </div>
                </>
              ) : null}
            </div>
            <span className="hidden rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold sm:inline">
              {roleLabel(user)}
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label="Menu do perfil"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent/90 text-sm font-bold text-accent-foreground outline-none ring-white/40 focus-visible:ring-2"
              >
                {initials(user.name)}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <p className="truncate">{user.name}</p>
                  <p className="truncate text-xs font-normal text-muted-foreground">{roleLabel(user)}</p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => navigate({ to: "/perfil" })}>
                  <UserIcon className="h-4 w-4" /> Meu Perfil
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => navigate({ to: "/minha-agenda" })}>
                  <Smartphone className="h-4 w-4" /> Minha Agenda
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void signOut()} className="text-destructive">
                  <LogOut className="h-4 w-4" /> Sair
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <button
              aria-label="Abrir menu"
              onClick={() => setOpen((v) => !v)}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/10 sm:hidden"
            >
              <Menu className="h-4 w-4" />
            </button>
          </div>
        </div>

        <nav
          className={cn(
            "mx-auto max-w-6xl gap-1 px-4 pb-3 sm:flex",
            open ? "grid" : "hidden sm:flex",
          )}
        >
          {navItems.filter((i) => canAccess(user.role, i.to)).map((item) => (
            <Link
              key={item.to}
              to={item.to}
              onClick={() => setOpen(false)}
              activeOptions={{ exact: item.to === "/" }}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-primary-foreground/70 transition hover:bg-white/10 hover:text-primary-foreground data-[status=active]:bg-white/15 data-[status=active]:text-primary-foreground"
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
        <div className="mb-6 flex items-start gap-3">
          <CalendarDays className="mt-1 hidden h-5 w-5 shrink-0 text-accent sm:block" />
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{title}</h1>
            {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
          </div>
        </div>
        {children}
      </main>
    </div>
  );
}
