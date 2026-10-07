// Builds seed/setup.sql: the database table, its "owner only" lock, and the Block program.
// Usage: node tools/make-setup-sql.mjs <login-email> [program-file]
import { readFileSync, writeFileSync } from 'node:fs';

const email = process.argv[2];
const file = process.argv[3] ?? 'seed/block1.json';
if (!email) throw new Error('Pass the login email');
const program = JSON.stringify(JSON.parse(readFileSync(file, 'utf8')));
if (program.includes('$program$')) throw new Error('Program text clashes with the SQL quoting');

writeFileSync('seed/setup.sql', `-- Training app: one-time database set-up. Safe to run more than once.

create table if not exists public.records (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  kind       text        not null,
  id         text        not null,
  data       jsonb       not null,
  deleted    boolean     not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, kind, id)
);

create index if not exists records_changed on public.records (user_id, updated_at);

-- Only the signed-in owner of a row can read or change it.
alter table public.records enable row level security;
drop policy if exists "owner only" on public.records;
create policy "owner only" on public.records
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

revoke all on public.records from anon;
grant select, insert, update, delete on public.records to authenticated;

-- Load the training program for the one login.
insert into public.records (user_id, kind, id, data)
select u.id, 'meta', 'program', $program$${program}$program$::jsonb
from auth.users u
where u.email = '${email}'
on conflict (user_id, kind, id) do update set data = excluded.data, deleted = false, updated_at = now();

select count(*) as programs_loaded from public.records where kind = 'meta' and id = 'program';
`);
console.log('Wrote seed/setup.sql');
