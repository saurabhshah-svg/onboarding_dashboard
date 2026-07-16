-- ============================================================
-- Spyne OB Dashboard — Supabase schema (run once in the SQL editor)
-- Daily snapshot of every OB account → history for change-tracking / trends.
-- Writes: the daily GitHub Action uses the service_role key (server-side only).
-- Reads : the dashboard uses the anon key (read-only, via the RLS policy below).
-- ============================================================

create table if not exists ob_snapshot (
  snapshot_date        date not null,
  row_key              text not null,   -- stable per rooftop: entId|rooftop|source
  account              text,
  rooftop              text,
  source               text,            -- 'vini' | 'amer' | 'apac'
  ob_poc               text,
  ae_name              text,
  arr                  numeric,
  stage                text,
  sub_stage            text,
  current_month_conf   text,
  blocked_owner        text,
  blocked_remarks      text,
  projection_date      date,
  go_live_date         date,
  drop_date            date,
  primary key (snapshot_date, row_key)  -- one row per account per day; upsert is idempotent
);

create index if not exists ob_snapshot_key_idx  on ob_snapshot (row_key, snapshot_date);
create index if not exists ob_snapshot_date_idx on ob_snapshot (snapshot_date);

-- Read-only access for the dashboard's anon key. (Writes require service_role, which bypasses RLS.)
alter table ob_snapshot enable row level security;
drop policy if exists read_anon on ob_snapshot;
create policy read_anon on ob_snapshot for select to anon using (true);

-- ── Per-account rollup (one row per account) — powers the account-level Trends views ──
create or replace view v_account_history as
with ordered as (
  select *,
    row_number() over (partition by row_key order by snapshot_date)      as rn_asc,
    row_number() over (partition by row_key order by snapshot_date desc) as rn_desc
  from ob_snapshot
)
select
  row_key,
  min(snapshot_date) as first_seen,
  max(snapshot_date) as last_seen,
  count(*)           as days_seen,
  -- latest (current) values
  max(account)            filter (where rn_desc = 1) as account,
  max(source)             filter (where rn_desc = 1) as source,
  max(ob_poc)             filter (where rn_desc = 1) as ob_poc,
  max(arr)                filter (where rn_desc = 1) as current_arr,
  max(stage)              filter (where rn_desc = 1) as current_stage,
  max(sub_stage)          filter (where rn_desc = 1) as current_sub_stage,
  max(current_month_conf) filter (where rn_desc = 1) as current_conf,
  max(blocked_owner)      filter (where rn_desc = 1) as current_blocked_owner,
  max(projection_date)    filter (where rn_desc = 1) as current_projection_date,
  max(go_live_date)       filter (where rn_desc = 1) as current_go_live_date,
  max(drop_date)          filter (where rn_desc = 1) as current_drop_date,
  -- earliest (original) values — captured the first day we saw the account
  max(arr)                filter (where rn_asc = 1)  as first_arr,
  max(projection_date)    filter (where rn_asc = 1)  as first_projection_date,
  max(go_live_date)       filter (where rn_asc = 1)  as first_go_live_date,
  max(stage)              filter (where rn_asc = 1)  as first_stage,
  max(current_month_conf) filter (where rn_asc = 1)  as first_conf,
  max(blocked_owner)      filter (where rn_asc = 1)  as first_blocked_owner,
  -- change signals
  count(distinct projection_date) filter (where projection_date is not null) as projection_variants,
  count(distinct go_live_date)    filter (where go_live_date    is not null) as go_live_variants,
  count(distinct blocked_owner)   filter (where blocked_owner is not null and blocked_owner <> '') as blocked_owner_variants
from ordered
group by row_key;

-- ── Per-day rollup (one row per day) — powers the time-series / funnel-flow views ──
create or replace view v_daily_rollup as
select
  snapshot_date,
  count(*)                                                          as accounts,
  round(sum(arr))                                                   as total_arr,
  round(sum(arr) filter (where stage ~* '^live'))                  as live_arr,
  count(*)       filter (where stage ~* '^live')                    as live_n,
  round(sum(arr) filter (where stage ~* 'drop|churn'))            as dropped_arr,
  round(sum(arr) filter (where stage !~* '^live' and stage !~* 'drop|churn')) as in_ob_arr,
  count(*)       filter (where stage !~* '^live' and stage !~* 'drop|churn')  as in_ob_n,
  round(sum(arr) filter (where current_month_conf = 'Confirmed' and stage !~* '^live|drop|churn')) as confirmed_arr
from ob_snapshot
group by snapshot_date
order by snapshot_date;
