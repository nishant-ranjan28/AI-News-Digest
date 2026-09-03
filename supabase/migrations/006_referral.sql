-- Referral program: unique per-subscriber link + counter
alter table subscribers
  add column if not exists referral_code text unique,
  add column if not exists referred_by text,
  add column if not exists referral_count int not null default 0;

create index if not exists subscribers_referral_code_idx on subscribers (referral_code);
create index if not exists subscribers_referred_by_idx on subscribers (referred_by);
