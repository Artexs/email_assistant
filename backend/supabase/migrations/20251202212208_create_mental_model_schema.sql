/*
  20251202212208_create_mental_model_schema.sql
  
  Description:
    Creates the initial schema for the Mental Model module.
    
  Tables:
    - users (public profile linking to auth.users)
    - mailboxes (connected email accounts)
    - secrets (encrypted credentials for services)
    - categories (contact groups/styles)
    - contacts (sender knowledge base)
    - delegates (delegation targets)
    
  Notes:
    - RLS is enabled on all tables.
    - UUIDs are used for PKs.
    - 'updated_at' columns are included with auto-update triggers.
*/

-- Create a function to update updated_at timestamp if it doesn't exist
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- 1.1. users
create table public.users (
  id uuid not null primary key references auth.users(id),
  email text not null unique,
  full_name text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

comment on table public.users is 'Centralna tabela użytkowników, powiązana z systemem uwierzytelniania.';

alter table public.users enable row level security;

create policy "Users can view their own profile"
  on public.users for select
  using ( auth.uid() = id );

create policy "Users can update their own profile"
  on public.users for update
  using ( auth.uid() = id );

create policy "Users can insert their own profile"
  on public.users for insert
  with check ( auth.uid() = id );
  
-- Trigger for updated_at
create trigger on_auth_user_updated
  before update on public.users
  for each row execute procedure public.handle_updated_at();


-- 1.2. mailboxes
create table public.mailboxes (
  id uuid not null primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  email text not null,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, email)
);

comment on table public.mailboxes is 'Reprezentuje skrzynki pocztowe podpięte przez użytkownika.';

alter table public.mailboxes enable row level security;

create policy "Users can view their own mailboxes"
  on public.mailboxes for select
  using ( auth.uid() = user_id );

create policy "Users can insert their own mailboxes"
  on public.mailboxes for insert
  with check ( auth.uid() = user_id );

create policy "Users can update their own mailboxes"
  on public.mailboxes for update
  using ( auth.uid() = user_id );

create policy "Users can delete their own mailboxes"
  on public.mailboxes for delete
  using ( auth.uid() = user_id );

create index idx_mailboxes_user_id on public.mailboxes(user_id);

create trigger on_mailbox_updated
  before update on public.mailboxes
  for each row execute procedure public.handle_updated_at();


-- 1.3. secrets
create table public.secrets (
  id uuid not null primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  service_name text not null,
  credentials jsonb not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

comment on table public.secrets is 'Przechowuje wrażliwe dane uwierzytelniające.';

alter table public.secrets enable row level security;

create policy "Users can view their own secrets"
  on public.secrets for select
  using ( auth.uid() = user_id );

create policy "Users can insert their own secrets"
  on public.secrets for insert
  with check ( auth.uid() = user_id );

create policy "Users can update their own secrets"
  on public.secrets for update
  using ( auth.uid() = user_id );

create policy "Users can delete their own secrets"
  on public.secrets for delete
  using ( auth.uid() = user_id );

create index idx_secrets_user_id on public.secrets(user_id);

create trigger on_secret_updated
  before update on public.secrets
  for each row execute procedure public.handle_updated_at();


-- 1.4. categories
create table public.categories (
  id uuid not null primary key default gen_random_uuid(),
  mailbox_id uuid not null references public.mailboxes(id) on delete cascade,
  name text not null,
  base_style_prompt text,
  generated_style_prompt text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

comment on table public.categories is 'Definiuje grupy kontaktów i style komunikacji.';

alter table public.categories enable row level security;

create policy "Users can view categories for their mailboxes"
  on public.categories for select
  using ( exists (select 1 from public.mailboxes where mailboxes.id = mailbox_id and mailboxes.user_id = auth.uid()) );

create policy "Users can insert categories for their mailboxes"
  on public.categories for insert
  with check ( exists (select 1 from public.mailboxes where mailboxes.id = mailbox_id and mailboxes.user_id = auth.uid()) );

create policy "Users can update categories for their mailboxes"
  on public.categories for update
  using ( exists (select 1 from public.mailboxes where mailboxes.id = mailbox_id and mailboxes.user_id = auth.uid()) );

create policy "Users can delete categories for their mailboxes"
  on public.categories for delete
  using ( exists (select 1 from public.mailboxes where mailboxes.id = mailbox_id and mailboxes.user_id = auth.uid()) );

create index idx_categories_mailbox_id on public.categories(mailbox_id);

create trigger on_category_updated
  before update on public.categories
  for each row execute procedure public.handle_updated_at();


-- 1.5. contacts
create table public.contacts (
  id uuid not null primary key default gen_random_uuid(),
  mailbox_id uuid not null references public.mailboxes(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  email text not null,
  display_name text,
  trust_score integer default 0,
  last_interaction_at timestamptz,
  draft_audit jsonb default '[]'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(mailbox_id, email)
);

comment on table public.contacts is 'Baza wiedzy o nadawcach.';

alter table public.contacts enable row level security;

create policy "Users can view contacts for their mailboxes"
  on public.contacts for select
  using ( exists (select 1 from public.mailboxes where mailboxes.id = mailbox_id and mailboxes.user_id = auth.uid()) );

create policy "Users can insert contacts for their mailboxes"
  on public.contacts for insert
  with check ( exists (select 1 from public.mailboxes where mailboxes.id = mailbox_id and mailboxes.user_id = auth.uid()) );

create policy "Users can update contacts for their mailboxes"
  on public.contacts for update
  using ( exists (select 1 from public.mailboxes where mailboxes.id = mailbox_id and mailboxes.user_id = auth.uid()) );

create policy "Users can delete contacts for their mailboxes"
  on public.contacts for delete
  using ( exists (select 1 from public.mailboxes where mailboxes.id = mailbox_id and mailboxes.user_id = auth.uid()) );

create index idx_contacts_mailbox_id on public.contacts(mailbox_id);
create index idx_contacts_email on public.contacts(email);
create index idx_contacts_category_id on public.contacts(category_id);

create trigger on_contact_updated
  before update on public.contacts
  for each row execute procedure public.handle_updated_at();


-- 1.6. delegates
create table public.delegates (
  id uuid not null primary key default gen_random_uuid(),
  mailbox_id uuid not null references public.mailboxes(id) on delete cascade,
  email text not null,
  display_name text,
  competence_tags text[] default '{}',
  active boolean default true,
  draft_audit jsonb default '[]'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(mailbox_id, email)
);

comment on table public.delegates is 'Lista osób, do których można delegować zadania.';

alter table public.delegates enable row level security;

create policy "Users can view delegates for their mailboxes"
  on public.delegates for select
  using ( exists (select 1 from public.mailboxes where mailboxes.id = mailbox_id and mailboxes.user_id = auth.uid()) );

create policy "Users can insert delegates for their mailboxes"
  on public.delegates for insert
  with check ( exists (select 1 from public.mailboxes where mailboxes.id = mailbox_id and mailboxes.user_id = auth.uid()) );

create policy "Users can update delegates for their mailboxes"
  on public.delegates for update
  using ( exists (select 1 from public.mailboxes where mailboxes.id = mailbox_id and mailboxes.user_id = auth.uid()) );

create policy "Users can delete delegates for their mailboxes"
  on public.delegates for delete
  using ( exists (select 1 from public.mailboxes where mailboxes.id = mailbox_id and mailboxes.user_id = auth.uid()) );

create index idx_delegates_mailbox_id on public.delegates(mailbox_id);
create index idx_delegates_email on public.delegates(email);
create index idx_delegates_competence_tags on public.delegates using gin (competence_tags);

create trigger on_delegate_updated
  before update on public.delegates
  for each row execute procedure public.handle_updated_at();
