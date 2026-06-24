-- Enable Row Level Security on all public tables.
--
-- Why: every table in the `public` schema is exposed through PostgREST. With RLS
-- disabled, anyone holding the public anon key (shipped to the browser as
-- NEXT_PUBLIC_SUPABASE_ANON_KEY) can read/write these tables directly — e.g. dump
-- every subscriber email. Enabling RLS with NO policies denies all access to the
-- `anon` and `authenticated` roles.
--
-- The app's server-side code (lib/db.ts) talks to these tables with the
-- service-role key, which has BYPASSRLS and is unaffected by these policies.
-- The browser only uses Supabase for OAuth, never to query these tables, so no
-- public policies are required.

alter table public.articles            enable row level security;
alter table public.subscribers         enable row level security;
alter table public.email_logs          enable row level security;
alter table public.repurposed_posts    enable row level security;
alter table public.newsletter_issues   enable row level security;
alter table public.extracted_signals   enable row level security;

-- finance_* tables are not owned by this project (they live on the same Supabase
-- instance). Locking them down clears the remaining advisor errors. If another
-- project reads them via the anon key it will need its own RLS policies.
alter table public.finance_articles    enable row level security;
alter table public.finance_subscribers enable row level security;
