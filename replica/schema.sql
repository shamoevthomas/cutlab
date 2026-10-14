-- CutLab library index (SQLite, ~/Movies/CutLab/library.db).
-- Projects themselves are project.json documents; this index makes the home screen and search fast.

create table projects (
  id text primary key,                       -- uuid
  name text not null,
  path text not null unique,                 -- folder of project.json
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  fps_num integer not null, fps_den integer not null default 1,
  duration_us integer not null default 0,
  cover_path text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- UTC ISO
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at text                             -- soft delete (trash)
);
create index projects_updated on projects (updated_at desc) where deleted_at is null;

create table assets (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  kind text not null check (kind in ('video','image','audio','font','lut','sticker')),
  path text not null,
  proxy_path text,
  duration_us integer,
  width integer, height integer,
  has_audio integer not null default 0,
  transcript_text text,                      -- for search
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create index assets_project on assets (project_id);
create virtual table assets_fts using fts5 (transcript_text, content='assets', content_rowid='rowid');

create table presets (
  id text primary key,
  kind text not null check (kind in ('adjust','text','effect','export','caption')),
  name text not null,
  params text not null,                      -- json
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  unique (kind, name)
);

create table jobs (
  id text primary key,
  project_id text references projects(id) on delete cascade,
  kind text not null,                        -- export | proxy | asr | matte | reframe | ...
  status text not null default 'queued'
    check (status in ('queued','running','done','failed','cancelled')),
  progress real not null default 0 check (progress between 0 and 1),
  input text not null,                       -- json
  output text,                               -- json
  error text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create index jobs_status on jobs (status, created_at);

create table settings (key text primary key, value text not null);
