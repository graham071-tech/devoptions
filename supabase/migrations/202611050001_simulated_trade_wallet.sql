-- Atomic wallet accounting for simulated contracts.
-- Run this migration in the Supabase SQL Editor before enabling real-balance simulation.

create or replace function public.place_simulated_trade(
  p_user_id text,
  p_trade jsonb,
  p_mode text,
  p_stake numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric(18,2);
  v_trade_id text;
  v_now bigint := floor(extract(epoch from clock_timestamp()) * 1000);
begin
  if p_mode not in ('demo', 'real')
     or p_stake is null or p_stake <= 0
     or p_stake <> round(p_stake, 2)
     or jsonb_typeof(p_trade) <> 'object'
     or coalesce(p_trade->>'id', '') = ''
     or coalesce(p_trade->>'status', '') <> 'active'
     or coalesce((p_trade->>'stake')::numeric, -1) <> p_stake then
    raise exception 'Invalid simulated trade';
  end if;

  v_trade_id := p_trade->>'id';

  if p_mode = 'demo' then
    update public.users
       set demo_balance = demo_balance - p_stake
     where id = p_user_id and demo_balance >= p_stake
     returning demo_balance into v_balance;
  else
    update public.users
       set real_balance = real_balance - p_stake
     where id = p_user_id and real_balance >= p_stake
     returning real_balance into v_balance;
  end if;

  if not found then
    raise exception 'Insufficient balance';
  end if;

  insert into public.trades (id, user_id, trade_data, recorded_at)
  values (
    v_trade_id,
    p_user_id,
    p_trade || jsonb_build_object('userId', p_user_id, 'recordedAt', v_now),
    v_now
  );

  return jsonb_build_object('success', true, 'balance', v_balance, 'mode', p_mode);
exception
  when unique_violation then
    raise exception 'Trade already exists';
end;
$$;

create or replace function public.settle_simulated_trade(
  p_user_id text,
  p_trade_id text,
  p_settlement jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trade public.trades%rowtype;
  v_mode text;
  v_status text;
  v_payout numeric(18,2);
  v_balance numeric(18,2);
  v_now bigint := floor(extract(epoch from clock_timestamp()) * 1000);
begin
  if p_trade_id is null or p_settlement is null
     or jsonb_typeof(p_settlement) <> 'object'
     or p_settlement->>'status' not in ('won', 'lost') then
    raise exception 'Invalid simulated settlement';
  end if;

  select * into v_trade
    from public.trades
   where id = p_trade_id and user_id = p_user_id
   for update;

  if not found then
    raise exception 'Trade not found';
  end if;

  if v_trade.trade_data->>'status' <> 'active' then
    raise exception 'Trade already settled';
  end if;

  v_mode := v_trade.trade_data->>'mode';
  v_status := p_settlement->>'status';
  v_payout := coalesce((v_trade.trade_data->>'potentialPayout')::numeric, 0);

  if v_mode not in ('demo', 'real') or v_payout <= 0 then
    raise exception 'Stored trade data is invalid';
  end if;

  if v_status = 'won' then
    if v_mode = 'demo' then
      update public.users set demo_balance = demo_balance + v_payout
       where id = p_user_id returning demo_balance into v_balance;
    else
      update public.users set real_balance = real_balance + v_payout
       where id = p_user_id returning real_balance into v_balance;
    end if;
  else
    select case when v_mode = 'demo' then demo_balance else real_balance end
      into v_balance from public.users where id = p_user_id;
  end if;

  update public.trades
     set trade_data = trade_data || p_settlement || jsonb_build_object('settledAt', v_now),
         recorded_at = v_now
   where id = p_trade_id and user_id = p_user_id;

  return jsonb_build_object('success', true, 'balance', v_balance, 'mode', v_mode);
end;
$$;

revoke all on function public.place_simulated_trade(text, jsonb, text, numeric) from public, anon, authenticated;
revoke all on function public.settle_simulated_trade(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.place_simulated_trade(text, jsonb, text, numeric) to service_role;
grant execute on function public.settle_simulated_trade(text, text, jsonb) to service_role;
