-- Round the day/week TOTAL up once, not every event: per-event ceil turned a
-- 0.06c call into 1c and a 2.01c call into 3c, roughly doubling metered usage
-- (owner account 2026-10-03: 96.30c real, 189c counted = 38% of CrokPro's $5/day).
CREATE OR REPLACE FUNCTION public.usage_status_for_user(p_user_id uuid)
 RETURNS TABLE(plan plan_type, status text, daily_used bigint, daily_limit bigint, weekly_used bigint, weekly_limit bigint, balance_cents bigint, allowed boolean, reason text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_plan public.plan_type; v_status text; v_daily bigint; v_weekly bigint;
  v_dlim bigint; v_wlim bigint; v_bal bigint;
begin
  select s.plan, s.status into v_plan, v_status
  from public.subscriptions s
  where s.user_id = p_user_id and s.status in ('active','trialing')
  order by s.created_at desc limit 1;

  select coalesce(b.balance_cents,0) into v_bal
  from public.credit_balances b where b.user_id = p_user_id;
  v_bal := coalesce(v_bal, 0);

  if v_plan is null then
    return query select null::public.plan_type, coalesce(v_status,'none'),
      null::bigint, null::bigint, null::bigint, null::bigint,
      v_bal, (v_bal > 0), case when v_bal > 0 then 'ok' else 'no_credits' end;
    return;
  end if;

  select l.daily_cents, l.weekly_cents into v_dlim, v_wlim
  from public.plan_limits l where l.plan = v_plan;

  select coalesce(ceil(sum(cost_cents))::bigint,0) into v_daily
  from public.usage_events
  where user_id = p_user_id and created_at >= date_trunc('day', now());

  select coalesce(ceil(sum(cost_cents))::bigint,0) into v_weekly
  from public.usage_events
  where user_id = p_user_id and created_at >= date_trunc('week', now());

  return query select v_plan, coalesce(v_status,'active'),
    v_daily, v_dlim, v_weekly, v_wlim, v_bal,
    (v_daily < v_dlim and v_weekly < v_wlim),
    case
      when v_weekly >= v_wlim then 'weekly_limit'
      when v_daily >= v_dlim then 'daily_limit'
      else 'ok'
    end;
end;
$function$;

revoke all on function public.usage_status_for_user(uuid) from public, anon, authenticated;
