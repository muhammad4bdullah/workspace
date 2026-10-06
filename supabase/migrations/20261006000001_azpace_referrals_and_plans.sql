alter table public.profiles
    drop constraint if exists profiles_pro_source_check;
alter table public.profiles
    add constraint profiles_pro_source_check
    check (pro_source is null or pro_source in (
        'admin',
        'founder_gift',
        'beta_access',
        'promo_code',
        'payment',
        'referral'
    ));

alter table public.pro_grants
    drop constraint if exists pro_grants_source_check;
alter table public.pro_grants
    add constraint pro_grants_source_check
    check (source in (
        'admin',
        'founder_gift',
        'beta_access',
        'promo_code',
        'payment',
        'referral'
    ));

create table if not exists public.referral_codes (
    user_id uuid primary key references auth.users(id) on delete cascade,
    code text not null unique check (code = upper(code) and length(code) between 6 and 24),
    created_at timestamptz not null default now()
);

create table if not exists public.referral_attributions (
    id uuid primary key default gen_random_uuid(),
    referrer_id uuid not null references auth.users(id) on delete cascade,
    referred_user_id uuid not null unique references auth.users(id) on delete cascade,
    referral_code text not null,
    verified_at timestamptz not null,
    created_at timestamptz not null default now(),
    check (referrer_id <> referred_user_id)
);

create index if not exists referral_attributions_referrer_idx
    on public.referral_attributions (referrer_id, verified_at);

create table if not exists public.referral_rewards (
    id uuid primary key default gen_random_uuid(),
    referrer_id uuid not null references auth.users(id) on delete cascade,
    verified_referral_count integer not null check (verified_referral_count > 0 and verified_referral_count % 15 = 0),
    grant_id uuid not null references public.pro_grants(id) on delete restrict,
    created_at timestamptz not null default now(),
    unique (referrer_id, verified_referral_count)
);

alter table public.referral_codes enable row level security;
alter table public.referral_attributions enable row level security;
alter table public.referral_rewards enable row level security;
revoke all on public.referral_codes, public.referral_attributions, public.referral_rewards
    from anon, authenticated;
grant select on public.referral_codes, public.referral_attributions, public.referral_rewards
    to authenticated;

drop policy if exists "Users can read their own referral code" on public.referral_codes;
create policy "Users can read their own referral code"
    on public.referral_codes for select to authenticated
    using (user_id = (select auth.uid()));

drop policy if exists "Referrers can read their verified referrals" on public.referral_attributions;
create policy "Referrers can read their verified referrals"
    on public.referral_attributions for select to authenticated
    using (referrer_id = (select auth.uid()));

drop policy if exists "Users can read their referral rewards" on public.referral_rewards;
create policy "Users can read their referral rewards"
    on public.referral_rewards for select to authenticated
    using (referrer_id = (select auth.uid()));

insert into public.referral_codes (user_id, code)
select p.id,
       'AZ-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
  from public.profiles p
on conflict (user_id) do nothing;

create or replace function public.handle_azpace_referral_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_code text;
    v_referrer_id uuid;
    v_referral_count integer;
    v_perpetual boolean;
    v_base_expiration timestamptz;
    v_expiration timestamptz;
    v_grant_id uuid;
begin
    if tg_op = 'UPDATE' and (
        old.email_confirmed_at is not null or new.email_confirmed_at is null
    ) then
        return new;
    end if;

    insert into public.referral_codes (user_id, code)
    values (
        new.id,
        'AZ-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
    )
    on conflict (user_id) do nothing;

    if new.email_confirmed_at is null then
        return new;
    end if;

    v_code := upper(trim(coalesce(new.raw_user_meta_data ->> 'referral_code', '')));
    if v_code = '' then
        return new;
    end if;

    select rc.user_id
      into v_referrer_id
      from public.referral_codes rc
     where rc.code = v_code
     for update;

    if not found or v_referrer_id = new.id then
        return new;
    end if;

    insert into public.referral_attributions (
        referrer_id,
        referred_user_id,
        referral_code,
        verified_at
    )
    values (v_referrer_id, new.id, v_code, new.email_confirmed_at)
    on conflict (referred_user_id) do nothing;

    if not found then
        return new;
    end if;

    select count(*)::integer
      into v_referral_count
      from public.referral_attributions ra
     where ra.referrer_id = v_referrer_id;

    if v_referral_count % 15 <> 0 then
        return new;
    end if;

    select p.plan = 'pro'
           and p.plan_status = 'active'
           and p.pro_expires_at is null,
           case when p.plan = 'pro'
                     and p.plan_status = 'active'
                     and p.pro_expires_at is not null
                then greatest(now(), p.pro_expires_at)
                else now() end
      into v_perpetual, v_base_expiration
      from public.profiles p
     where p.id = v_referrer_id
     for update;

    if not found then
        raise exception 'Referral owner profile not found.';
    end if;

    v_expiration := case
        when v_perpetual then null
        else v_base_expiration + interval '30 days'
    end;

    update public.profiles
       set plan = 'pro',
           plan_status = 'active',
           pro_expires_at = v_expiration,
           pro_source = 'referral'
     where id = v_referrer_id;

    insert into public.pro_grants (user_id, granted_by, source, source_detail, expires_at)
    values (
        v_referrer_id,
        null,
        'referral',
        v_referral_count::text || ' verified referrals',
        v_expiration
    )
    returning id into v_grant_id;

    insert into public.referral_rewards (referrer_id, verified_referral_count, grant_id)
    values (v_referrer_id, v_referral_count, v_grant_id);

    return new;
end;
$$;

drop trigger if exists on_azpace_referral_signup on auth.users;
create trigger on_azpace_referral_signup
    after insert or update of email_confirmed_at on auth.users
    for each row execute function public.handle_azpace_referral_signup();

create or replace function public.my_referral_summary()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := auth.uid();
    v_code text;
    v_verified integer;
    v_rewards integer;
begin
    if v_user_id is null then
        raise exception 'Sign in to view referral details.' using errcode = '42501';
    end if;

    insert into public.referral_codes (user_id, code)
    values (
        v_user_id,
        'AZ-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
    )
    on conflict (user_id) do nothing;

    select rc.code into v_code
      from public.referral_codes rc
     where rc.user_id = v_user_id;

    select count(*)::integer into v_verified
      from public.referral_attributions ra
     where ra.referrer_id = v_user_id;

    select count(*)::integer into v_rewards
      from public.referral_rewards rr
     where rr.referrer_id = v_user_id;

    return jsonb_build_object(
        'code', v_code,
        'verified_referrals', v_verified,
        'referrals_to_next_reward', 15 - (v_verified % 15),
        'months_earned', v_rewards
    );
end;
$$;

revoke all on function public.handle_azpace_referral_signup() from public, anon, authenticated;
revoke all on function public.my_referral_summary() from public, anon;
grant execute on function public.my_referral_summary() to authenticated;

create table if not exists public.subscription_plans (
    plan_key text primary key check (plan_key in ('monthly', 'yearly')),
    display_name text not null,
    amount_minor_units integer not null check (amount_minor_units > 0),
    currency text not null check (currency = upper(currency) and length(currency) = 3),
    provider text check (provider is null or provider in ('stripe', 'razorpay', 'jazzcash')),
    provider_price_id text,
    is_available boolean not null default false,
    updated_at timestamptz not null default now()
);

alter table public.subscription_plans enable row level security;
revoke all on public.subscription_plans from anon, authenticated;
grant select on public.subscription_plans to authenticated;

drop policy if exists "Authenticated users can view published plan pricing" on public.subscription_plans;
create policy "Authenticated users can view published plan pricing"
    on public.subscription_plans for select to authenticated
    using (is_available);

create table if not exists public.subscriptions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    provider text not null check (provider in ('stripe', 'razorpay', 'jazzcash')),
    provider_customer_id text not null,
    provider_subscription_id text not null unique,
    plan_key text not null references public.subscription_plans(plan_key),
    status text not null check (status in ('pending', 'active', 'past_due', 'canceled', 'expired')),
    current_period_start timestamptz,
    current_period_end timestamptz,
    cancel_at_period_end boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.subscriptions enable row level security;
revoke all on public.subscriptions from anon, authenticated;
grant select on public.subscriptions to authenticated;

drop policy if exists "Users can read their own subscriptions" on public.subscriptions;
create policy "Users can read their own subscriptions"
    on public.subscriptions for select to authenticated
    using (user_id = (select auth.uid()));

create index if not exists subscriptions_user_id_idx
    on public.subscriptions (user_id, created_at desc);

create table if not exists public.processed_payment_events (
    provider text not null check (provider in ('stripe', 'razorpay', 'jazzcash')),
    event_id text not null,
    processed_at timestamptz not null default now(),
    primary key (provider, event_id)
);

alter table public.processed_payment_events enable row level security;
revoke all on public.processed_payment_events from anon, authenticated;

insert into public.feature_catalog (feature_name, required_plan)
values
    ('writer_running_headers', 'pro'),
    ('writer_running_footers', 'pro'),
    ('writer_page_numbers', 'pro'),
    ('pdf_merge', 'pro'),
    ('pdf_signature', 'pro'),
    ('sheets_xlsx_export', 'pro'),
    ('slides_pptx_export', 'pro'),
    ('slides_png_export', 'pro')
on conflict (feature_name) do nothing;
