-- Persistent risk-protection ledger exclusively for the protected administrator account.
create table if not exists public.admin_risk_states (
  user_id text primary key references public.users(id) on delete cascade,
  email text not null,
  state jsonb not null,
  updated_at bigint not null
);

alter table public.admin_risk_states enable row level security;

revoke all on table public.admin_risk_states from public, anon, authenticated;
grant select, insert, update, delete on table public.admin_risk_states to service_role;
