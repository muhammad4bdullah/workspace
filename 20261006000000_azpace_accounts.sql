create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    email text not null,
    display_name text,
    avatar_url text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    plan text not null default 'free' check (plan in ('free', 'pro')),
    plan_status text not null default 'free' check (plan_status in ('free', 'active', 'expired')),
    pro_expires_at timestamptz,
    pro_source text check (pro_source is null or pro_source in ('admin', 'founder_gift', 'beta_access', 'promo_code', 'payment'))
);

alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, avatar_url) on public.profiles to authenticated;

drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile"
    on public.profiles for select to authenticated
    using (id = (select auth.uid()));

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
    on public.profiles for update to authenticated
    using (id = (select auth.uid()))
    with check (id = (select auth.uid()));

create or replace function public.create_profile_for_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.profiles (id, email, display_name)
    values (
        new.id,
        coalesce(new.email, ''),
        nullif(trim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), '')
    )
    on conflict (id) do update
        set email = excluded.email,
            updated_at = now();
    return new;
end;
$$;

drop trigger if exists on_auth_user_created_azpace on auth.users;
create trigger on_auth_user_created_azpace
    after insert or update of email on auth.users
    for each row execute function public.create_profile_for_user();

insert into public.profiles (id, email, display_name)
select id,
       coalesce(email, ''),
       nullif(trim(coalesce(raw_user_meta_data ->> 'display_name', '')), '')
  from auth.users
on conflict (id) do update
    set email = excluded.email,
        updated_at = now();

create or replace function public.touch_profile_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
    before update on public.profiles
    for each row execute function public.touch_profile_updated_at();

create table if not exists public.workspace_items (
    user_id uuid not null references auth.users(id) on delete cascade,
    item_key text not null check (length(item_key) between 1 and 512),
    item_value text not null,
    updated_at timestamptz not null default now(),
    primary key (user_id, item_key)
);

alter table public.workspace_items enable row level security;
revoke all on public.workspace_items from anon, authenticated;
grant select, insert, update, delete on public.workspace_items to authenticated;

drop policy if exists "Users can read their own workspace data" on public.workspace_items;
create policy "Users can read their own workspace data"
    on public.workspace_items for select to authenticated
    using (user_id = (select auth.uid()));

drop policy if exists "Users can insert their own workspace data" on public.workspace_items;
create policy "Users can insert their own workspace data"
    on public.workspace_items for insert to authenticated
    with check (user_id = (select auth.uid()));

drop policy if exists "Users can update their own workspace data" on public.workspace_items;
create policy "Users can update their own workspace data"
    on public.workspace_items for update to authenticated
    using (user_id = (select auth.uid()))
    with check (user_id = (select auth.uid()));

drop policy if exists "Users can delete their own workspace data" on public.workspace_items;
create policy "Users can delete their own workspace data"
    on public.workspace_items for delete to authenticated
    using (user_id = (select auth.uid()));

create table if not exists public.pro_grants (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    granted_by uuid references auth.users(id) on delete set null,
    source text not null check (source in ('admin', 'founder_gift', 'beta_access', 'promo_code', 'payment')),
    source_detail text,
    granted_at timestamptz not null default now(),
    expires_at timestamptz,
    revoked_at timestamptz
);

alter table public.pro_grants enable row level security;
revoke all on public.pro_grants from anon, authenticated;
grant select on public.pro_grants to authenticated;

drop policy if exists "Users can read their own Pro grant history" on public.pro_grants;
create policy "Users can read their own Pro grant history"
    on public.pro_grants for select to authenticated
    using (user_id = (select auth.uid()));

create index if not exists pro_grants_user_id_granted_at_idx
    on public.pro_grants (user_id, granted_at desc);

create table if not exists public.promo_codes (
    id uuid primary key default gen_random_uuid(),
    code text not null unique check (code = upper(trim(code)) and length(code) between 3 and 64),
    duration_days integer not null check (duration_days between 1 and 36500),
    max_redemptions integer not null check (max_redemptions > 0),
    redemption_count integer not null default 0 check (redemption_count >= 0 and redemption_count <= max_redemptions),
    is_active boolean not null default true,
    expires_at timestamptz,
    created_at timestamptz not null default now()
);

alter table public.promo_codes enable row level security;
revoke all on public.promo_codes from anon, authenticated;

create table if not exists public.promo_redemptions (
    id uuid primary key default gen_random_uuid(),
    promo_code_id uuid not null references public.promo_codes(id) on delete restrict,
    user_id uuid not null references auth.users(id) on delete cascade,
    redeemed_at timestamptz not null default now(),
    unique (promo_code_id, user_id)
);

alter table public.promo_redemptions enable row level security;
revoke all on public.promo_redemptions from anon, authenticated;
grant select on public.promo_redemptions to authenticated;

drop policy if exists "Users can read their own promo redemptions" on public.promo_redemptions;
create policy "Users can read their own promo redemptions"
    on public.promo_redemptions for select to authenticated
    using (user_id = (select auth.uid()));

create index if not exists promo_redemptions_user_id_idx
    on public.promo_redemptions (user_id);

create table if not exists public.feature_catalog (
    feature_name text primary key check (length(feature_name) between 1 and 120),
    required_plan text not null default 'free' check (required_plan in ('free', 'pro')),
    created_at timestamptz not null default now()
);

alter table public.feature_catalog enable row level security;
revoke all on public.feature_catalog from anon, authenticated;

create or replace function public.is_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
    select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false);
$$;

create or replace function public.has_pro_access()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null then
        return false;
    end if;

    update public.profiles
       set plan = 'free',
           plan_status = 'expired'
     where id = auth.uid()
       and plan = 'pro'
       and plan_status = 'active'
       and pro_expires_at is not null
       and pro_expires_at <= now();

    return exists (
        select 1
          from public.profiles p
         where p.id = auth.uid()
           and p.plan = 'pro'
           and p.plan_status = 'active'
           and (p.pro_expires_at is null or p.pro_expires_at > now())
    );
end;
$$;

create or replace function public.is_feature_available(p_feature_name text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_required_plan text;
begin
    if auth.uid() is null then
        return false;
    end if;

    select f.required_plan
      into v_required_plan
      from public.feature_catalog f
     where f.feature_name = p_feature_name;

    if not found or v_required_plan = 'free' then
        return true;
    end if;
    return public.has_pro_access();
end;
$$;

create or replace function public.redeem_promo_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := auth.uid();
    v_promo public.promo_codes%rowtype;
    v_expires_at timestamptz;
    v_perpetual boolean;
begin
    if v_user_id is null then
        raise exception 'Sign in to redeem a promo code.' using errcode = '42501';
    end if;

    select *
      into v_promo
      from public.promo_codes
     where code = upper(trim(coalesce(p_code, '')))
       and is_active
       and (expires_at is null or expires_at > now())
     for update;

    if not found then
        raise exception 'This promo code is invalid, inactive, or expired.' using errcode = '22023';
    end if;
    if v_promo.redemption_count >= v_promo.max_redemptions then
        raise exception 'This promo code has reached its redemption limit.' using errcode = '22023';
    end if;
    if exists (
        select 1 from public.promo_redemptions
         where promo_code_id = v_promo.id and user_id = v_user_id
    ) then
        raise exception 'You have already redeemed this promo code.' using errcode = '23505';
    end if;

    update public.promo_codes
       set redemption_count = redemption_count + 1
     where id = v_promo.id;

    insert into public.promo_redemptions (promo_code_id, user_id)
    values (v_promo.id, v_user_id);

    select p.plan = 'pro'
           and p.plan_status = 'active'
           and p.pro_expires_at is null,
           case when p.plan = 'pro'
                     and p.plan_status = 'active'
                     and p.pro_expires_at is not null
                then greatest(now(), p.pro_expires_at)
                else now() end
      into v_perpetual, v_expires_at
      from public.profiles p
     where p.id = v_user_id;
    if not found then
         raise exception 'User profile not found.' using errcode = 'P0002';
    end if;

    if not v_perpetual then
        v_expires_at := v_expires_at + make_interval(days => v_promo.duration_days);
    end if;

    update public.profiles
       set plan = 'pro',
           plan_status = 'active',
           pro_expires_at = v_expires_at,
           pro_source = 'promo_code'
     where id = v_user_id;

    insert into public.pro_grants (user_id, granted_by, source, source_detail, expires_at)
    values (v_user_id, null, 'promo_code', v_promo.code, v_expires_at);

    return jsonb_build_object('plan', 'pro', 'expires_at', v_expires_at);
end;
$$;

create or replace function public.admin_search_users(p_query text default '')
returns table (
    id uuid,
    email text,
    display_name text,
    plan text,
    plan_status text,
    pro_expires_at timestamptz,
    pro_source text,
    created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
    if not public.is_admin() then
        raise exception 'Administrator access required.' using errcode = '42501';
    end if;
    if length(trim(coalesce(p_query, ''))) > 200 then
        raise exception 'Search query is too long.' using errcode = '22023';
    end if;

    return query
    select p.id,
           p.email,
           p.display_name,
           case when p.plan = 'pro'
                     and p.plan_status = 'active'
                     and (p.pro_expires_at is null or p.pro_expires_at > now())
                then 'pro' else 'free' end,
           case when p.plan = 'pro'
                     and p.plan_status = 'active'
                     and p.pro_expires_at is not null
                     and p.pro_expires_at <= now()
                then 'expired' else p.plan_status end,
           p.pro_expires_at,
           p.pro_source,
           p.created_at
      from public.profiles p
     where trim(coalesce(p_query, '')) = ''
        or position(lower(trim(p_query)) in lower(p.email)) > 0
        or position(lower(trim(p_query)) in lower(coalesce(p.display_name, ''))) > 0
     order by p.created_at desc
     limit 100;
end;
$$;

create or replace function public.admin_grant_pro(
    p_user_id uuid,
    p_duration_days integer default null,
    p_expires_at timestamptz default null,
    p_source text default 'founder_gift',
    p_source_detail text default null
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_now timestamptz := now();
    v_base timestamptz;
    v_expiration timestamptz;
    v_source text := p_source;
    v_perpetual boolean;
begin
    if not public.is_admin() then
        raise exception 'Administrator access required.' using errcode = '42501';
    end if;
    if v_source is null or v_source not in ('admin', 'founder_gift', 'beta_access') then
        raise exception 'Unsupported Pro grant source.' using errcode = '22023';
    end if;
    if (p_duration_days is null) = (p_expires_at is null) then
        raise exception 'Provide either a duration in days or a custom expiration.' using errcode = '22023';
    end if;
    if p_duration_days is not null and p_duration_days not between 1 and 36500 then
        raise exception 'Duration must be between 1 and 36500 days.' using errcode = '22023';
    end if;

    select p.plan = 'pro'
           and p.plan_status = 'active'
           and p.pro_expires_at is null,
           case when p.plan = 'pro'
                     and p.plan_status = 'active'
                     and p.pro_expires_at is not null
                then greatest(v_now, p.pro_expires_at)
                else v_now end
      into v_perpetual, v_base
      from public.profiles p
     where p.id = p_user_id
     for update;
    if not found then
        raise exception 'User profile not found.' using errcode = 'P0002';
    end if;

    v_expiration := case
        when p_duration_days is not null and v_perpetual then null
        when p_duration_days is not null then v_base + make_interval(days => p_duration_days)
        else p_expires_at
    end;
    if v_expiration is not null and v_expiration <= v_now then
        raise exception 'Expiration must be in the future.' using errcode = '22023';
    end if;

    update public.profiles
       set plan = 'pro',
           plan_status = 'active',
           pro_expires_at = v_expiration,
           pro_source = v_source
     where id = p_user_id;

    insert into public.pro_grants (user_id, granted_by, source, source_detail, expires_at)
    values (p_user_id, auth.uid(), v_source, nullif(trim(p_source_detail), ''), v_expiration);

    return v_expiration;
end;
$$;

create or replace function public.admin_revoke_pro(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if not public.is_admin() then
        raise exception 'Administrator access required.' using errcode = '42501';
    end if;

    update public.profiles
       set plan = 'free',
           plan_status = case
               when pro_expires_at is not null and pro_expires_at <= now() then 'expired'
               else 'free'
           end
     where id = p_user_id;
    if not found then
        raise exception 'User profile not found.' using errcode = 'P0002';
    end if;

    update public.pro_grants
       set revoked_at = now()
     where user_id = p_user_id
       and revoked_at is null
       and (expires_at is null or expires_at > now());
end;
$$;

create or replace function public.admin_upsert_promo(
    p_code text,
    p_duration_days integer,
    p_max_redemptions integer,
    p_expires_at timestamptz default null,
    p_is_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_id uuid;
    v_code text := upper(trim(coalesce(p_code, '')));
begin
    if not public.is_admin() then
        raise exception 'Administrator access required.' using errcode = '42501';
    end if;
    if length(v_code) not between 3 and 64
       or p_duration_days is null
       or p_duration_days not between 1 and 36500
       or p_max_redemptions is null
       or p_max_redemptions < 1
       or p_is_active is null then
        raise exception 'Provide a valid code, duration, and redemption limit.' using errcode = '22023';
    end if;
    if p_expires_at is not null and p_expires_at <= now() then
        raise exception 'Promo code expiration must be in the future.' using errcode = '22023';
    end if;
    if exists (
        select 1
          from public.promo_codes c
         where c.code = v_code
           and c.redemption_count > p_max_redemptions
    ) then
        raise exception 'Redemption limit cannot be lower than its current redemption count.' using errcode = '22023';
    end if;

    insert into public.promo_codes (code, duration_days, max_redemptions, expires_at, is_active)
    values (v_code, p_duration_days, p_max_redemptions, p_expires_at, p_is_active)
    on conflict (code) do update
       set duration_days = excluded.duration_days,
           max_redemptions = excluded.max_redemptions,
           expires_at = excluded.expires_at,
           is_active = excluded.is_active
    returning id into v_id;
    return v_id;
end;
$$;

create or replace function public.admin_list_promos()
returns table (
    id uuid,
    code text,
    duration_days integer,
    max_redemptions integer,
    redemption_count integer,
    is_active boolean,
    expires_at timestamptz,
    created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
    if not public.is_admin() then
        raise exception 'Administrator access required.' using errcode = '42501';
    end if;
    return query
    select c.id, c.code, c.duration_days, c.max_redemptions,
           c.redemption_count, c.is_active, c.expires_at, c.created_at
      from public.promo_codes c
     order by c.created_at desc;
end;
$$;

create or replace function public.admin_set_promo_active(p_promo_id uuid, p_is_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if not public.is_admin() then
        raise exception 'Administrator access required.' using errcode = '42501';
    end if;
    update public.promo_codes set is_active = p_is_active where id = p_promo_id;
    if not found then
        raise exception 'Promo code not found.' using errcode = 'P0002';
    end if;
end;
$$;

revoke all on function public.is_admin() from public, anon;
revoke all on function public.has_pro_access() from public, anon;
revoke all on function public.is_feature_available(text) from public, anon;
revoke all on function public.redeem_promo_code(text) from public, anon;
revoke all on function public.admin_search_users(text) from public, anon;
revoke all on function public.admin_grant_pro(uuid, integer, timestamptz, text, text) from public, anon;
revoke all on function public.admin_revoke_pro(uuid) from public, anon;
revoke all on function public.admin_upsert_promo(text, integer, integer, timestamptz, boolean) from public, anon;
revoke all on function public.admin_list_promos() from public, anon;
revoke all on function public.admin_set_promo_active(uuid, boolean) from public, anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.has_pro_access() to authenticated;
grant execute on function public.is_feature_available(text) to authenticated;
grant execute on function public.redeem_promo_code(text) to authenticated;
grant execute on function public.admin_search_users(text) to authenticated;
grant execute on function public.admin_grant_pro(uuid, integer, timestamptz, text, text) to authenticated;
grant execute on function public.admin_revoke_pro(uuid) to authenticated;
grant execute on function public.admin_upsert_promo(text, integer, integer, timestamptz, boolean) to authenticated;
grant execute on function public.admin_list_promos() to authenticated;
grant execute on function public.admin_set_promo_active(uuid, boolean) to authenticated;
