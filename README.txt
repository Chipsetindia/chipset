CHIPSET — SUPABASE CONNECTED VERSION

1. Open assets/supabase-config.js
2. Replace the two placeholders with your Supabase Project URL and Publishable/anon key.
3. Never put a service_role/secret key in this file.
4. Open index.html through a local web server (recommended) rather than file:// for production-like testing.
5. Customer registration/login uses Supabase Auth.
6. Customer profile is created by the database trigger from the SQL setup.
7. Customer enquiries are stored in investment_enquiries.
8. Admin pages require profiles.role = 'admin'.

To create the first admin after registering a user, run in Supabase SQL Editor:
UPDATE public.profiles
SET role = 'admin'
WHERE id = (SELECT id FROM auth.users WHERE email = 'YOUR_ADMIN_EMAIL');

Do not publish service_role/secret keys in browser code.


ADMIN ENQUIRY STATUS
- Admin can change enquiry status from Pending, Contacted, Approved, or Rejected.
- The update writes directly to public.investment_enquiries.status.
- Customer dashboard reads the same status, so it will show the updated value after refresh.
- If Supabase Row Level Security blocks admin updates, add an UPDATE policy for admins in the Supabase SQL Editor. Example:

CREATE POLICY "Admins can update investment enquiries"
ON public.investment_enquiries
FOR UPDATE
TO authenticated
USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

STATUS FIX (2026-09-03): Admin status updates are normalized to the exact Supabase allowed values: pending, contacted, approved, rejected, completed. The admin script also verifies the returned status after update and includes a cache-busting query so browsers load the fixed script.


LATEST ADMIN FEATURES
- Admin can rename the Home investment table headers from Plan Management > Investment Table Headers.
- Admin can add, edit, activate/deactivate, and delete investment plan rows.
- Customer registration can be made instant by disabling Supabase Authentication > Providers > Email > Confirm email. This is a project-level Supabase setting and cannot safely be bypassed from browser code with the public key.


V34 FINAL AUDIT NOTES
- Agreement section is visible on the customer dashboard.
- New payment acknowledgement timestamp/version is stored.
- Payment page uses the active database plan instead of trusting URL amount/name.
- Existing approved investments are backfilled by V32; historical terms are only as accurate as the stored transaction/plan data.
- Run V32 agreement SQL, then V34 hardening SQL after the final daily earning migration.

V35 FINAL LIVE HARDENING
- Agreement schema/approval trigger/backfill applied to production.
- Sensitive SECURITY DEFINER RPCs no longer executable anonymously.
- Wallet credit RPC aligned with wallet_transactions schema.
- Referral first qualifying approved transaction uses configured percentage.
- Customer wallet/principal helper RPCs enforce user/admin scope.
- See V35-LIVE-DEPLOYMENT-NOTE.txt.
