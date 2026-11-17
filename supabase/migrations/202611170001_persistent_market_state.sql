-- Persistent market simulation snapshots across server restarts and serverless invocations.
create table if not exists public.market_states (
  symbol text primary key,
  state jsonb not null,
  updated_at bigint not null
);

alter table public.market_states enable row level security;

revoke all on table public.market_states from public, anon, authenticated;
grant all on table public.market_states to service_role;
