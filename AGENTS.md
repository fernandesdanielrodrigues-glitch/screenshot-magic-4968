## Architecture rules
- All app data lives in Postgres tables on the self-hosted Supabase instance (profiles, user_roles, sectors, events, schedules, unavailability, notifications, teams, team_members, event_teams); `src/lib/store.tsx` loads via React Query and refreshes on realtime changes — single shared data source.
- Roles live only in `user_roles`; sector leadership is `sectors.leader_id`. The "Testar como" switcher only changes UI, never DB permissions — security stays server-side.
- First signup becomes admin; signups whose e-mail matches a pre-created profile get linked to it (trigger `handle_new_user`).

- Scheduling is team-based: `teams`/`team_members`/`event_teams` hold pre-built teams (1 leader, max 1 volunteer per sector, volunteer in one team); schedules carry `team_id` + `adjusted` for per-event overrides. `sectors` is only the function catalog (leader_id deprecated). Why: admin assigns whole teams instead of individuals.
