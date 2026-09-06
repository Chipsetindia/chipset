-- Site-wide public contact/payment settings
create table if not exists public.site_settings (
  key text primary key,
  value text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.site_settings enable row level security;

drop policy if exists "Public can read site settings" on public.site_settings;
create policy "Public can read site settings"
on public.site_settings for select
to anon, authenticated
using (true);

drop policy if exists "Admins can insert site settings" on public.site_settings;
create policy "Admins can insert site settings"
on public.site_settings for insert
to authenticated
with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

drop policy if exists "Admins can update site settings" on public.site_settings;
create policy "Admins can update site settings"
on public.site_settings for update
to authenticated
using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

insert into public.site_settings(key,value) values
('whatsapp_number','7739325562'),
('instagram_url',''),
('business_upi_id','9101416423@okbizaxis'),
('payment_name','Chipset')
on conflict (key) do nothing;


insert into public.site_settings(key,value) values
('plan_header_plan','PLAN'),
('plan_header_investment','INVESTMENT'),
('plan_header_payout','MONTHLY PAYOUT'),
('plan_header_total','12 MONTH TOTAL*'),
('plan_header_action','ACTION')
on conflict (key) do nothing;

-- Admins can delete investment plans from Plan Management.
drop policy if exists "Admins can delete investment plans" on public.investment_plans;
create policy "Admins can delete investment plans"
on public.investment_plans for delete
to authenticated
using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));
