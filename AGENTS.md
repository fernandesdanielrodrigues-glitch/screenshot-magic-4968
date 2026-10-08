<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture rules
- All app data lives in Lovable Cloud tables (profiles, user_roles, sectors, events, schedules, unavailability, notifications); `src/lib/store.tsx` loads via React Query and refreshes on realtime changes — single shared data source.
- Roles live only in `user_roles`; sector leadership is `sectors.leader_id`. The "Testar como" switcher only changes UI, never DB permissions — security stays server-side.
- First signup becomes admin; signups whose e-mail matches a pre-created profile get linked to it (trigger `handle_new_user`).

- Scheduling is team-based: `teams`/`team_members`/`event_teams` hold pre-built teams (1 leader, max 1 volunteer per sector, volunteer in one team); schedules carry `team_id` + `adjusted` for per-event overrides. `sectors` is only the function catalog (leader_id deprecated). Why: admin assigns whole teams instead of individuals.
