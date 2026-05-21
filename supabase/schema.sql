create table articles (
  id uuid default gen_random_uuid() primary key,
  title text not null,
  url text unique not null,
  summary text,
  content jsonb,
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

create table repurposed_posts (
  id uuid default gen_random_uuid() primary key,
  issue_date date not null,
  channel text not null check (channel in ('linkedin', 'twitter', 'threads', 'article')),
  content text not null,
  metadata jsonb,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  slug text,
  published_at timestamp,
  created_at timestamp default now(),
  updated_at timestamp default now(),
  unique (issue_date, channel)
);

create index repurposed_posts_issue_date_idx on repurposed_posts (issue_date desc);
create index repurposed_posts_status_idx on repurposed_posts (status);
create unique index repurposed_posts_slug_idx on repurposed_posts (slug) where slug is not null;

create table newsletter_issues (
  id uuid default gen_random_uuid() primary key,
  issue_date date not null unique,
  composed jsonb not null,
  subject text,
  created_at timestamp default now()
);

create index newsletter_issues_issue_date_idx on newsletter_issues (issue_date desc);

create table extracted_signals (
  id uuid default gen_random_uuid() primary key,
  issue_date date not null unique,
  anchor_headline text not null,
  fact text not null,
  shift text not null,
  why_care text not null,
  created_at timestamp default now()
);

create index extracted_signals_issue_date_idx on extracted_signals (issue_date desc);
