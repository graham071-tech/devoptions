-- Core authentication, session, trade, and deposit tables with safe idempotent DDL.
-- Safe to run on existing databases: preserves all existing rows, balances, and constraints.

create table if not exists public.users (
  id text primary key,
  email text not null,
  phone text not null,
  password_hash text not null,
  salt text not null,
  role text not null default 'user',
  created_at bigint not null,
  email_verified boolean not null default false,
  phone_verified boolean not null default false,
  email_verification_code text,
  email_verification_expires bigint,
  phone_verification_code text,
  phone_verification_expires bigint,
  reset_password_token text,
  reset_password_expires bigint,
  demo_balance numeric(18,2) not null default 10000,
  real_balance numeric(18,2) not null default 0,
  full_name text,
  country text default 'International',
  theme text,
  sound_enabled boolean,
  token_valid_after bigint
);

alter table public.users add column if not exists role text not null default 'user';
alter table public.users add column if not exists email_verified boolean not null default false;
alter table public.users add column if not exists phone_verified boolean not null default false;
alter table public.users add column if not exists email_verification_code text;
alter table public.users add column if not exists email_verification_expires bigint;
alter table public.users add column if not exists phone_verification_code text;
alter table public.users add column if not exists phone_verification_expires bigint;
alter table public.users add column if not exists reset_password_token text;
alter table public.users add column if not exists reset_password_expires bigint;
alter table public.users add column if not exists demo_balance numeric(18,2) not null default 10000;
alter table public.users add column if not exists real_balance numeric(18,2) not null default 0;
alter table public.users add column if not exists full_name text;
alter table public.users add column if not exists country text default 'International';
alter table public.users add column if not exists theme text;
alter table public.users add column if not exists sound_enabled boolean;
alter table public.users add column if not exists token_valid_after bigint;

create index if not exists idx_users_email_lower on public.users (lower(email));
create index if not exists idx_users_phone on public.users (phone);

do $$
begin
  create unique index if not exists users_email_lower_uidx on public.users (lower(email));
exception
  when unique_violation then
    raise notice 'Skipped creating unique index users_email_lower_uidx due to pre-existing duplicate emails.';
end
$$;

do $$
begin
  create unique index if not exists users_phone_uidx on public.users (phone);
exception
  when unique_violation then
    raise notice 'Skipped creating unique index users_phone_uidx due to pre-existing duplicate phones.';
end
$$;

create table if not exists public.sessions (
  token text primary key,
  user_id text not null references public.users(id) on delete cascade,
  created_at bigint not null,
  expires_at bigint not null
);

create index if not exists idx_sessions_user_id on public.sessions (user_id);
create index if not exists idx_sessions_expires_at on public.sessions (expires_at);

create table if not exists public.trades (
  id text primary key,
  user_id text not null references public.users(id) on delete cascade,
  trade_data jsonb not null,
  recorded_at bigint not null
);

create index if not exists idx_trades_user_recorded on public.trades (user_id, recorded_at desc);

create table if not exists public.deposits (
  id text primary key,
  user_id text not null references public.users(id) on delete cascade,
  merchant_reference text not null,
  amount_kes numeric(18,2) not null,
  amount_subunits bigint not null,
  amount_usd numeric(18,2) not null,
  currency text not null default 'KES',
  session_id text,
  checkout_url text,
  provider_reference text,
  receipt_number text,
  status text not null default 'pending',
  failure_reason text,
  confirmed_amount_kes numeric(18,2),
  created_at bigint not null,
  updated_at bigint not null,
  confirmed_at bigint
);

create index if not exists idx_deposits_user_created on public.deposits (user_id, created_at desc);
create index if not exists idx_deposits_merchant_ref on public.deposits (merchant_reference);

-- Strict backend-only access via Row Level Security
alter table public.users enable row level security;
alter table public.sessions enable row level security;
alter table public.trades enable row level security;
alter table public.deposits enable row level security;

revoke all on table public.users from public, anon, authenticated;
revoke all on table public.sessions from public, anon, authenticated;
revoke all on table public.trades from public, anon, authenticated;
revoke all on table public.deposits from public, anon, authenticated;

grant select, insert, update, delete on table public.users to service_role;
grant select, insert, update, delete on table public.sessions to service_role;
grant select, insert, update, delete on table public.trades to service_role;
grant select, insert, update, delete on table public.deposits to service_role;
