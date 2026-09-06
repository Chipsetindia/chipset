-- Referral bonus + admin-managed festival/offer banner
alter table public.profiles add column if not exists referral_code text;
create unique index if not exists profiles_referral_code_uidx on public.profiles(referral_code) where referral_code is not null;

create table if not exists public.referral_rewards (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references auth.users(id) on delete cascade,
  referred_transaction_id uuid not null references public.investment_transactions(id) on delete cascade,
  referred_customer_name text,
  deposit_amount numeric(14,2) not null,
  bonus_amount numeric(14,2) not null check (bonus_amount > 0),
  status text not null default 'credited' check (status in ('credited','reversed')),
  created_at timestamptz not null default now(),
  unique(referrer_id, referred_transaction_id)
);
alter table public.referral_rewards enable row level security;
drop policy if exists "customers read own referral rewards" on public.referral_rewards;
create policy "customers read own referral rewards" on public.referral_rewards for select to authenticated using (referrer_id=auth.uid());
drop policy if exists "admins read referral rewards" on public.referral_rewards;
create policy "admins read referral rewards" on public.referral_rewards for select to authenticated using (exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'));

-- Create/read a referral code for the current customer.
create or replace function public.get_or_create_referral_code()
returns text
language plpgsql security definer set search_path=public
as $$
declare uid uuid := auth.uid(); code text; base text;
begin
  if uid is null then raise exception 'Authentication required'; end if;
  select referral_code into code from public.profiles where id=uid;
  if code is not null and trim(code)<>'' then return code; end if;
  base := upper(substr(regexp_replace(coalesce((select full_name from public.profiles where id=uid), 'USER'),'[^A-Za-z0-9]','','g'),1,4));
  base := coalesce(nullif(base,''),'USER');
  loop
    code := base || upper(substr(encode(gen_random_bytes(4),'hex'),1,6));
    exit when not exists(select 1 from public.profiles where referral_code=code);
  end loop;
  update public.profiles set referral_code=code where id=uid;
  return code;
end;
$$;
grant execute on function public.get_or_create_referral_code() to authenticated;

-- Generate codes for existing customer profiles that don't have one.
do $$
declare r record; code text; base text;
begin
  for r in select id,full_name from public.profiles where referral_code is null loop
    base := upper(substr(regexp_replace(coalesce(r.full_name,'USER'),'[^A-Za-z0-9]','','g'),1,4));
    base := coalesce(nullif(base,''),'USER');
    loop
      code := base || upper(substr(encode(gen_random_bytes(4),'hex'),1,6));
      exit when not exists(select 1 from public.profiles where referral_code=code);
    end loop;
    update public.profiles set referral_code=code where id=r.id;
  end loop;
end $$;

alter table public.investment_transactions add column if not exists referral_code text;
create index if not exists investment_transactions_referral_code_idx on public.investment_transactions(referral_code);

-- Admin approves/rejects a payment. On approval, a qualifying referral bonus is credited once.
create or replace function public.admin_set_transaction_status(p_transaction_id uuid, p_status text)
returns jsonb
language plpgsql security definer set search_path=public,auth
as $$
declare
  admin_id uuid := auth.uid(); t public.investment_transactions%rowtype;
  min_deposit numeric := coalesce(nullif((select value from public.site_settings where key='referral_min_deposit'),'')::numeric,0);
  bonus numeric := coalesce(nullif((select value from public.site_settings where key='referral_bonus_amount'),'')::numeric,0);
  referrer uuid; reward_id uuid;
  self_match boolean := false;
begin
  if not exists(select 1 from public.profiles where id=admin_id and role='admin') then raise exception 'Not authorized'; end if;
  if p_status not in ('approved','rejected') then raise exception 'Invalid status'; end if;
  select * into t from public.investment_transactions where id=p_transaction_id for update;
  if not found then raise exception 'Transaction not found'; end if;
  update public.investment_transactions set status=p_status, verified_at=now(), verified_by=admin_id where id=p_transaction_id;
  if p_status='approved' and t.type='debit' and coalesce(t.referral_code,'')<>'' and t.amount>=min_deposit and bonus>0 then
    select id into referrer from public.profiles where upper(referral_code)=upper(trim(t.referral_code)) and role='customer' limit 1;
    if referrer is not null then
      self_match := (t.user_id is not null and t.user_id=referrer);
      if not self_match then
        if t.user_id is null then
          self_match := exists(select 1 from public.profiles p left join auth.users u on u.id=p.id where p.id=referrer and ((nullif(lower(trim(coalesce(t.email,''))),'') is not null and lower(trim(coalesce(u.email,'')))=lower(trim(t.email))) or (nullif(regexp_replace(coalesce(t.phone,''),'\\D','','g'),'') is not null and regexp_replace(coalesce(p.phone,''),'\\D','','g')=regexp_replace(t.phone,'\\D','','g'))));
        end if;
      end if;
      if not self_match and not exists(select 1 from public.referral_rewards where referred_transaction_id=t.id) then
        insert into public.referral_rewards(referrer_id,referred_transaction_id,referred_customer_name,deposit_amount,bonus_amount)
        values(referrer,t.id,t.customer_name,t.amount,bonus) returning id into reward_id;
        insert into public.investment_transactions(user_id,customer_name,phone,email,amount,type,status,payment_method,note,verified_at,verified_by)
        select p.id,p.full_name,p.phone,u.email,bonus,'credit','approved','referral_bonus','Referral bonus for '||coalesce(t.customer_name,'customer')||' (Payment ID '||coalesce(t.payment_ref,'')||')',now(),admin_id
        from public.profiles p left join auth.users u on u.id=p.id where p.id=referrer;
      end if;
    end if;
  end if;
  return jsonb_build_object('ok',true,'reward_id',reward_id,'status',p_status);
end;
$$;
grant execute on function public.admin_set_transaction_status(uuid,text) to authenticated;

-- Offer/banner storage. Admin uploads; public site reads the resulting public URL from site_settings.
insert into storage.buckets(id,name,public) values('site-offers','site-offers',true) on conflict(id) do update set public=true;
drop policy if exists "admins upload site offers" on storage.objects;
create policy "admins upload site offers" on storage.objects for insert to authenticated with check(bucket_id='site-offers' and exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'));
drop policy if exists "admins update site offers" on storage.objects;
create policy "admins update site offers" on storage.objects for update to authenticated using(bucket_id='site-offers' and exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin')) with check(bucket_id='site-offers' and exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'));
drop policy if exists "admins delete site offers" on storage.objects;
create policy "admins delete site offers" on storage.objects for delete to authenticated using(bucket_id='site-offers' and exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'));

insert into public.site_settings(key,value) values
('referral_bonus_amount','500'),('referral_min_deposit','10000'),
('offer_enabled','false'),('offer_title','Special Offer'),('offer_text','Limited-time offer'),('offer_date',''),('offer_image_url','')
on conflict(key) do nothing;

insert into public.site_settings(key,value) values
('referral_message','Join using my referral link. Deposit the minimum amount and I will receive a referral bonus.')
on conflict(key) do nothing;
