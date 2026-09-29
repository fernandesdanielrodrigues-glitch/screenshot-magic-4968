# SyncMídia v2 — Banco de dados real + setor Foto

## O que muda para você
- Novo 5º setor **Foto** em todo o app (filtros, competências, colunas da escala, botões "+ Foto").
- Login real com e-mail/senha (e Google) — contas ficam salvas no banco.
- Membros, eventos, escalas e indisponibilidades passam a ser salvos de verdade e atualizam na tela sem recarregar.
- Seletor "Testar como Admin/Líder/Membro" continua existindo (modo teste) para validar visualmente.

## Etapas
1. **Banco de dados**: tabelas de perfis, papéis (separados, por segurança), setores, eventos, escalas (atribuições) e indisponibilidades, com regras de acesso:
   - Admin: tudo. Líder: gerencia equipe/escalas do seu setor. Membro: vê e responde às próprias escalas.
   - Primeiro usuário cadastrado vira Admin automaticamente; os demais entram como Membro.
   - Dados de exemplo (setores, eventos, escalas) inseridos para a tela não começar vazia.
2. **Login**: trocar o login de teste pelo real; "Esqueci minha senha" envia e-mail + página para definir nova senha. Cadastro exige confirmar o e-mail.
3. **Telas ligadas ao banco**: Dashboard/Calendário (criar evento), Equipe (criar/editar membro, nomear/remover líder, status), Criador de Escalas (copiar anterior, automatizar, colunas de 5 setores, aviso "Indisponível nesta data"), Minha Agenda (Aceitar, Solicitar Substituição).
4. **Atualização ao vivo** das telas quando os dados mudarem.

## Detalhes técnicos
- Tabelas: `profiles`, `user_roles` (+ `has_role`), `sectors` (com `leader_id`), `profile_skills`, `events`, `schedules` (event_id, profile_id, sector, status pending/confirmed/swap_requested, swap_reason), `unavailability`. GRANTs + RLS em todas.
- Trigger `handle_new_user` cria perfil + papel.
- Membros criados pelo admin em "+ Novo Membro" são perfis sem login (convite futuro) — `profiles.user_id` nulo.
- `src/lib/store.tsx` reescrito sobre React Query + Supabase realtime; `src/lib/auth.tsx` sobre `supabase.auth`.
- Dev switcher: simula o papel apenas na interface (não altera permissões no banco).
