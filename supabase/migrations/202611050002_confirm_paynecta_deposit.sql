-- Atomic, idempotent Paynecta deposit confirmation.
-- Only the trusted server-side service_role may execute this function.
-- A successful provider confirmation credits the user's real_balance exactly once.

create or replace function public.confirm_paynecta_deposit(
  p_deposit_id text,
  p_provider_reference text,
  p_receipt_number text,
  p_confirmed_amount_kes numeric,
  p_source text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deposit public.deposits%rowtype;
  v_real_balance numeric(18,2);
  v_now bigint := floor(extract(epoch from clock_timestamp()) * 1000);
begin
  if coalesce(trim(p_deposit_id), '') = ''
     or coalesce(trim(p_provider_reference), '') = ''
     or p_confirmed_amount_kes is null
     or p_confirmed_amount_kes <= 0
     or p_source is null
     or p_source not in ('verification', 'webhook') then
    return jsonb_build_object('success', false, 'error', 'Invalid deposit confirmation details.');
  end if;

  select * into v_deposit
    from public.deposits
   where id = p_deposit_id
   for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Deposit not found.');
  end if;

  -- Repeated webhook/verification calls must never credit the same deposit twice.
  if v_deposit.status = 'succeeded' then
    select real_balance into v_real_balance
      from public.users
     where id = v_deposit.user_id;

    if not found then
      return jsonb_build_object('success', false, 'error', 'Deposit account not found.');
    end if;

    return jsonb_build_object(
      'success', true,
      'alreadyCredited', true,
      'realBalance', v_real_balance
    );
  end if;

  if v_deposit.status <> 'pending' then
    return jsonb_build_object('success', false, 'error', 'Deposit is not pending.');
  end if;

  if round(p_confirmed_amount_kes, 2) <> round(v_deposit.amount_kes, 2)
     or round(v_deposit.amount_kes * 100) <> v_deposit.amount_subunits
     or v_deposit.currency <> 'KES'
     or v_deposit.amount_usd <= 0 then
    return jsonb_build_object('success', false, 'error', 'Confirmed payment amount or currency does not match the deposit.');
  end if;

  update public.users
     set real_balance = real_balance + v_deposit.amount_usd
   where id = v_deposit.user_id
   returning real_balance into v_real_balance;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Deposit account not found.');
  end if;

  update public.deposits
     set status = 'succeeded',
         provider_reference = p_provider_reference,
         receipt_number = nullif(trim(coalesce(p_receipt_number, '')), ''),
         confirmed_amount_kes = p_confirmed_amount_kes,
         confirmed_at = v_now,
         updated_at = v_now,
         failure_reason = null
   where id = p_deposit_id;

  return jsonb_build_object(
    'success', true,
    'alreadyCredited', false,
    'realBalance', v_real_balance
  );
end;
$$;

revoke all on function public.confirm_paynecta_deposit(text, text, text, numeric, text) from public, anon, authenticated;
grant execute on function public.confirm_paynecta_deposit(text, text, text, numeric, text) to service_role;
