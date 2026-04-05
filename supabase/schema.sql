create table articles (
  id uuid default gen_random_uuid() primary key,
  title text not null,
  url text unique not null,
  summary text,
  category text,
  importance_score int,
  source text,
  published_date date,
  created_at timestamp default now()
);

create table subscribers (
  id uuid default gen_random_uuid() primary key,
  email text unique not null,
  subscribed_at timestamp default now(),
  active boolean default true
);

create table email_logs (
  id uuid default gen_random_uuid() primary key,
  recipient text not null,
  status text not null,
  provider text not null,
  error_message text,
  created_at timestamp default now()
);
