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
