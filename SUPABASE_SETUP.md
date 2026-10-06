# A-Zpace Supabase setup

A-Zpace is a static multi-page application. Authentication and server-owned account decisions run through one Supabase client and the SQL RPCs in this project; there is no trusted server or payment processor in the current release.

## 1. Create and configure a Supabase project

1. Create a Supabase project and keep its database password private.
2. In **Authentication → Providers**, enable **Email**. For a public beta, keep email confirmation enabled.
3. In **Authentication → URL Configuration**, set the production HTTPS domain as the Site URL and add the exact production and preview URLs ending in `/login.html` to Redirect URLs. Include `/login.html?mode=recovery` as an allowed recovery redirect if your project requires exact URL matching.
4. Configure the confirmation and password-reset email templates to link back to the deployed `login.html`. For password reset, the redirect must preserve `mode=recovery`.
5. Set the project URL and the project's **publishable key** (or legacy anon key) in `supabase-config.js`. This key is public by design. Never put a service-role key in this file or in any browser-delivered code.
6. Deploy all project files together over HTTPS on a static host. Do not open the site using `file://`; Supabase redirect URLs require an allowed HTTP(S) origin.

The repository's Supabase URL and publishable key are configured. Until the schema migrations and deployed HTTPS redirect configuration are complete, workspace pages fail closed or account features report the missing database configuration.

## 2. Install the database schema

Apply both migrations, in filename order, to the Supabase project's database through **SQL Editor**:

1. `supabase/migrations/20261006000000_azpace_accounts.sql`
2. `supabase/migrations/20261006000001_azpace_referrals_and_plans.sql`

If using the Supabase CLI instead, initialize/link the CLI project first, then apply the migrations with the CLI.

The migration creates:

- `profiles`, linked to `auth.users`, with the requested profile and plan fields. A trigger creates profiles for new users and backfills existing accounts.
- `workspace_items`, keyed by the authenticated user's Supabase UUID. The application stores each existing localStorage item as a cloud row; RLS enforces owner-only reads and writes.
- An initially empty `feature_catalog`. No existing feature is Pro-locked. To mark a future feature, add its stable key with `required_plan = 'pro'`; call `isFeatureAvailable(key)` in the UI and also enforce the entitlement in any protected database operation or RLS policy.
- Pro grant history, promo codes, and unique per-user promo redemptions.
- Referral codes and email-confirmed referral attributions. Each 15th distinct verified signup awards a 30-day Pro grant to the referrer, with uniqueness and grant accounting enforced in the database.
- Subscription plan catalog and owner-readable subscription records, ready to be updated by a future verified payment webhook. This does not create checkout or claim payment.
- RLS policies and SQL functions for entitlement checks, redemption, and administrator operations.

Users may update only `display_name` and `avatar_url` in their own profile. Plan fields and promo/grant tables are not writable by a browser client. Pro checks, grants, revocations, and code redemption run in PostgreSQL.

Migration 2 marks the existing advanced Writer running headers, footers and page numbers; PDF merge and signatures; XLSX workbook export; and PPTX/slide-image export as Pro. Normal editing and the remaining core workspace stay Free. These browser-only operations are gated against the database entitlement; do not treat the client UI as a way to protect a future server-side API.

For example, after deciding to make a different feature Pro-only, an administrator can configure it in SQL with `insert into public.feature_catalog (feature_name, required_plan) values ('your_feature_key', 'pro') on conflict (feature_name) do update set required_plan = excluded.required_plan;`.

## 3. Assign the first administrator

1. Sign up and verify your own account through the deployed app.
2. In the Supabase Dashboard, open **Authentication → Users**, select your account, and set **app_metadata** to include `"role": "admin"` (for example, `{"role":"admin"}`). Do not put this value in user-editable metadata and do not add a frontend admin flag.
3. Sign out and sign back in to refresh the signed JWT. The Admin Console link then appears in the account menu.

The admin page is only a user interface convenience. Every admin RPC independently checks the signed JWT's trusted `app_metadata.role`; requests from other accounts are rejected by the database.

## 4. Grant beta access, referrals, and promo codes

- From **Admin Console**, search for an account by email or display name. Grant/extend Pro for a number of days, or set an exact future expiration. Choose a source (`founder_gift`, `beta_access`, or `admin`) to retain the access origin in the profile and grant history.
- Create or update promo codes with a duration, redemption limit, and optional code expiration. Redemption is case-insensitive, rate-limited by the atomic maximum-redemption counter, and unique per user per code.
- Signed-in users have a referral link in the account menu. New signups may use its code on the signup form. Referral rewards are recorded only when Supabase marks the new account's email confirmed; one referred account counts once, self-referrals are rejected, and every 15 verified referrals grants 30 days of Pro. Test this using separate accounts and real email verification before launch.
- Payment is not yet integrated. Migration 2 includes disabled-by-default monthly/yearly plan records and private subscription state, but there is no checkout, payment webhook, or provider configured. Stripe, Razorpay, and JazzCash can be represented in the subscription schema, but a personal JazzCash wallet is not merchant-gateway credentials. For JazzCash, obtain merchant approval and confirm with JazzCash whether your merchant integration supports recurring billing before enabling monthly/yearly subscriptions. If only one-time charges are supported, renewals need a real payment reminder and verified payment flow rather than pretending to auto-renew. Choose the provider, currency, prices, merchant credentials, and webhook configuration before enabling plan records; only a verified server-side payment callback may grant subscription Pro.

## 5. Existing data and privacy

On the first authenticated use on a device, an account menu action is offered if legacy, unscoped browser data is present. Import is explicit; it uploads those keys to the signed-in account and can replace cloud values with matching keys. Do not approve that action on a shared device if its old browser data belongs to someone else.

The app keeps an account-UUID-scoped local cache only for pending/offline synchronization. The Supabase workspace rows and RLS are the server-side ownership boundary. The temporary IndexedDB file-import handoff is separated by authenticated user ID and remains browser-local. Exported files remain under the user's control.

## 6. Launch checks that require the real project

After configuring Supabase, test signup with email confirmation, login/logout, session refresh, password recovery, profile updates, and direct access to each editor while signed out. Also test two accounts for data isolation; an expired Pro account; admin grant, extension, custom expiry and revoke; promo redemption, duplicate redemption, inactive/expired codes, redemption limits; and both authorized and unauthorized access to every admin RPC.

The repository has no project credentials, email provider configuration, live users, or deployed URL, so those external-service tests cannot run until the steps above are completed. Do not enable public signup or launch until the cross-account RLS checks pass.
