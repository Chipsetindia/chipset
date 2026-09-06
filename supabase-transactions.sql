create table if not exists public.investment_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  customer_name text not null,
  phone text not null,
  email text,
  plan_id uuid references public.investment_plans(id) on delete set null,
  plan_name text,
  amount numeric(14,2) not null check (amount > 0),
  type text not null check (type in ('debit','credit')),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  payment_method text not null default 'upi_manual',
  utr text,
  slip_path text,
  note text,
  created_at timestamptz not null default now(),
  verified_at timestamptz,
  verified_by uuid references auth.users(id) on delete set null
);

create index if not exists investment_transactions_user_idx on public.investment_transactions(user_id, created_at desc);
create index if not exists investment_transactions_status_idx on public.investment_transactions(status, created_at desc);

alter table public.investment_transactions enable row level security;

drop policy if exists "customers read own transactions" on public.investment_transactions;
create policy "customers read own transactions" on public.investment_transactions
for select to authenticated
using (user_id = auth.uid());

drop policy if exists "customers create own transactions" on public.investment_transactions;
create policy "customers create own transactions" on public.investment_transactions
for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists "admins read transactions" on public.investment_transactions;
create policy "admins read transactions" on public.investment_transactions
for select to authenticated
using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

drop policy if exists "admins update transactions" on public.investment_transactions;
create policy "admins update transactions" on public.investment_transactions
for update to authenticated
using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

drop policy if exists "admins insert transactions" on public.investment_transactions;
create policy "admins insert transactions" on public.investment_transactions
for insert to authenticated
with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

insert into storage.buckets (id, name, public) values ('payment-slips','payment-slips',false)
on conflict (id) do update set public=false;

drop policy if exists "customers upload payment slips" on storage.objects;
create policy "customers upload payment slips" on storage.objects
for insert to authenticated
with check (bucket_id = 'payment-slips' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "admins read payment slips" on storage.objects;
create policy "admins read payment slips" on storage.objects
for select to authenticated
using (bucket_id = 'payment-slips' and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

drop policy if exists "customers read own payment slips" on storage.objects;
create policy "customers read own payment slips" on storage.objects
for select to authenticated
using (bucket_id = 'payment-slips' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "guests create payment transactions" on public.investment_transactions;
create policy "guests create payment transactions" on public.investment_transactions
for insert to anon
with check (user_id is null and type = 'debit' and status = 'pending');

drop policy if exists "guests upload payment slips" on storage.objects;
create policy "guests upload payment slips" on storage.objects
for insert to anon
with check (bucket_id = 'payment-slips' and (storage.foldername(name))[1] = 'guest');

-- Allow the payment page to attach the uploaded slip to the transaction it just created.
drop policy if exists "customers update own pending transactions" on public.investment_transactions;
create policy "customers update own pending transactions"
on public.investment_transactions for update to authenticated
using (user_id = auth.uid() and status = 'pending')
with check (user_id = auth.uid() and status = 'pending');

drop policy if exists "guests update guest pending transactions" on public.investment_transactions;
create policy "guests update guest pending transactions"
on public.investment_transactions for update to anon
using (user_id is null and status = 'pending')
with check (user_id is null and status = 'pending');

drop policy if exists "guests delete guest pending transactions" on public.investment_transactions;
create policy "guests delete guest pending transactions"
on public.investment_transactions for delete to anon
using (user_id is null and status = 'pending');

drop policy if exists "customers delete own pending transactions" on public.investment_transactions;
create policy "customers delete own pending transactions"
on public.investment_transactions for delete to authenticated
using (user_id = auth.uid() and status = 'pending');

-- Guest payment tracking: a human-readable Payment ID + secure lookup by Payment ID and phone.
alter table public.investment_transactions
  add column if not exists payment_ref text;

create unique index if not exists investment_transactions_payment_ref_uidx
  on public.investment_transactions(payment_ref)
  where payment_ref is not null;

-- Securely expose only the fields needed for a guest to track their own payment.
create or replace function public.track_guest_payment(p_payment_ref text default null, p_phone text default null)
returns table (
  payment_ref text,
  customer_name text,
  plan_name text,
  amount numeric,
  status text,
  created_at timestamptz,
  note text
)
language sql
security definer
set search_path = public
as $$
  select t.payment_ref, t.customer_name, t.plan_name, t.amount, t.status, t.created_at, t.note
  from public.investment_transactions t
  where (
    (nullif(trim(p_payment_ref),'') is not null
      and upper(t.payment_ref) = upper(trim(p_payment_ref)))
    or
    (nullif(regexp_replace(coalesce(p_phone,''), '\D', '', 'g'),'') is not null
      and regexp_replace(t.phone, '\D', '', 'g') = regexp_replace(p_phone, '\D', '', 'g'))
  )
  order by t.created_at desc
  limit 20;
$$;
grant execute on function public.track_guest_payment(text,text) to anon, authenticated;


-- Link guest payments to a registered customer when the same email and/or phone is used.
create or replace function public.link_guest_transactions_to_user(p_email text, p_phone text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  changed integer := 0;
  norm_email text := lower(trim(coalesce(p_email,'')));
  norm_phone text := regexp_replace(coalesce(p_phone,''), '\D', '', 'g');
begin
  if uid is null then raise exception 'Authentication required'; end if;
  update public.investment_transactions t
     set user_id = uid
   where t.user_id is null
     and (
       (norm_email <> '' and lower(trim(coalesce(t.email,''))) = norm_email)
       or
       (norm_phone <> '' and regexp_replace(coalesce(t.phone,''), '\D', '', 'g') = norm_phone)
     );
  get diagnostics changed = row_count;
  return changed;
end;
$$;
grant execute on function public.link_guest_transactions_to_user(text,text) to authenticated;

-- Admin-only customer deletion. Related application data is removed first; Auth user is removed last.
create or replace function public.admin_delete_customer(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  is_admin boolean;
begin
  select exists(select 1 from public.profiles where id=auth.uid() and role='admin') into is_admin;
  if not is_admin then raise exception 'Not authorized'; end if;
  if p_user_id = auth.uid() then raise exception 'Admin account cannot be deleted here'; end if;

  if to_regclass('public.investment_transactions') is not null then delete from public.investment_transactions where user_id=p_user_id; end if;
  if to_regclass('public.investment_enquiries') is not null then delete from public.investment_enquiries where user_id=p_user_id; end if;
  if to_regclass('public.wallet_transactions') is not null then delete from public.wallet_transactions where user_id=p_user_id; end if;
  if to_regclass('public.promo_redemptions') is not null then delete from public.promo_redemptions where user_id=p_user_id; end if;
  if to_regclass('public.wallets') is not null then delete from public.wallets where user_id=p_user_id; end if;
  if to_regclass('public.profiles') is not null then delete from public.profiles where id=p_user_id; end if;
  delete from auth.users where id=p_user_id;
end;
$$;
grant execute on function public.admin_delete_customer(uuid) to authenticated;
