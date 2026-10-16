-- 0004 org structure and craft catalogue (ORG-01). Tribes, chapters, teams and crafts become tenant data.
-- Teams live in org_teams (PK org_id, id) because a legacy global `teams(id PRIMARY KEY, name)` table may exist
-- and v1.1 ids t1..t5 are reused by every org.

INSERT INTO migration_markers (name) VALUES ('0004_org_structure') ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS crafts (
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  short TEXT NOT NULL,
  description TEXT,
  family TEXT,
  archived BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID,
  PRIMARY KEY (org_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS crafts_org_short_uq ON crafts(org_id, upper(short));
CREATE UNIQUE INDEX IF NOT EXISTS crafts_org_name_uq ON crafts(org_id, lower(name));

CREATE TABLE IF NOT EXISTS tribes (
  id TEXT PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  lead_name TEXT,
  archived BOOLEAN NOT NULL DEFAULT false,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID
);
CREATE UNIQUE INDEX IF NOT EXISTS tribes_org_name_uq ON tribes(org_id, lower(name));

CREATE TABLE IF NOT EXISTS chapters (
  id TEXT PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  craft_id TEXT,
  lead_person_id TEXT,
  archived BOOLEAN NOT NULL DEFAULT false,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID
);
CREATE UNIQUE INDEX IF NOT EXISTS chapters_org_name_uq ON chapters(org_id, lower(name));

CREATE TABLE IF NOT EXISTS org_teams (
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  archived BOOLEAN NOT NULL DEFAULT false,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID,
  PRIMARY KEY (org_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS org_teams_org_name_uq ON org_teams(org_id, lower(name));

ALTER TABLE resources ADD COLUMN IF NOT EXISTS chapter_id TEXT;
ALTER TABLE resources ADD COLUMN IF NOT EXISTS home_tribe_id TEXT;
ALTER TABLE resources ADD COLUMN IF NOT EXISTS linked_user_id UUID;
-- Tribe affinity as tribe ids. craft_profile.tribeAffinity keeps the v1.1 names for rollback (dual-written).
ALTER TABLE resources ADD COLUMN IF NOT EXISTS tribe_affinity_ids TEXT[];
ALTER TABLE projects ADD COLUMN IF NOT EXISTS tribe_id TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS owner_user_id UUID;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';
CREATE INDEX IF NOT EXISTS idx_resources_linked_user ON resources(linked_user_id);
CREATE INDEX IF NOT EXISTS idx_projects_tribe ON projects(tribe_id);

-- A legacy FK resources.team_id -> teams(id) would reject org-scoped team ids. Relaxing it changes no data and
-- v1.1 does not depend on it.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT con.conname FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_class ref ON ref.oid = con.confrelid
    WHERE con.contype = 'f' AND rel.relname = 'resources' AND ref.relname = 'teams'
  LOOP
    EXECUTE format('ALTER TABLE resources DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

-- ORG-01#AC2: the 12 PMO crafts per org, ids unchanged.
INSERT INTO crafts (org_id, id, name, short, description, family, sort_order)
SELECT o.id, c.id, c.name, c.short, c.description, NULL, c.sort_order
FROM organizations o
CROSS JOIN (VALUES
  ('programme-mgmt', 'Programme Management', 'PgM', 'Multi-project programmes, benefits and governance', 1),
  ('project-mgmt', 'Project Management', 'PM', 'Plan, run and close a single project', 2),
  ('scrum-master', 'Scrum Master / Agile Delivery', 'SM', 'Sprint facilitation, flow, impediments', 3),
  ('product-mgmt', 'Product Management', 'PdM', 'Backlog ownership, discovery, roadmaps', 4),
  ('business-analysis', 'Business Analysis', 'BA', 'Requirements, process mapping, acceptance', 5),
  ('digital-planning', 'Digital Planning', 'DP', 'Portfolio sequencing, roadmap and demand planning', 6),
  ('change-mgmt', 'Change & Adoption', 'CM', 'Stakeholder readiness, comms, training', 7),
  ('pmo-analytics', 'PMO Analytics & Reporting', 'AN', 'Dashboards, status reporting, capacity data', 8),
  ('risk-governance', 'Risk, Governance & Compliance', 'RG', 'RAID, audit, regulatory gates', 9),
  ('vendor-mgmt', 'Vendor & Commercial Management', 'VM', 'Contracts, SOWs, supplier delivery', 10),
  ('release-coord', 'Release & Delivery Coordination', 'RC', 'Release trains, cutover, dependency tracking', 11),
  ('tooling-admin', 'Jira / Tooling Administration', 'JA', 'Jira, Planview and workflow configuration', 12)
) AS c(id, name, short, description, sort_order)
ON CONFLICT DO NOTHING;

-- Any other craft id referenced by v1.1 data becomes a catalogue entry so no reference dangles.
INSERT INTO crafts (org_id, id, name, short, sort_order)
SELECT ref.org_id, ref.craft_id, ref.craft_id, 'X' || upper(substr(md5(ref.craft_id), 1, 3)), 100
FROM (
  SELECT w.org_id, a.craft_id FROM allocations a JOIN workspaces w ON w.id = a.workspace_id
  WHERE coalesce(a.craft_id, '') <> ''
  UNION
  SELECT w.org_id, r.craft_profile ->> 'primaryCraft' FROM resources r JOIN workspaces w ON w.id = r.workspace_id
  WHERE coalesce(r.craft_profile ->> 'primaryCraft', '') <> ''
  UNION
  SELECT w.org_id, sc ->> 'craftId' FROM resources r JOIN workspaces w ON w.id = r.workspace_id
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(r.craft_profile -> 'secondaryCrafts') = 'array'
                                            THEN r.craft_profile -> 'secondaryCrafts' ELSE '[]'::jsonb END) sc
  WHERE coalesce(sc ->> 'craftId', '') <> ''
  UNION
  SELECT w.org_id, d ->> 'craftId' FROM projects p JOIN workspaces w ON w.id = p.workspace_id
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(p.craft_demand) = 'array'
                                            THEN p.craft_demand ELSE '[]'::jsonb END) d
  WHERE coalesce(d ->> 'craftId', '') <> ''
) ref
WHERE ref.org_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Tribes from distinct project client names, QBR tribes and tribe-affinity names (case-insensitive, trimmed).
INSERT INTO tribes (id, org_id, name)
SELECT gen_random_uuid()::text, src.org_id, min(src.name)
FROM (
  SELECT w.org_id, btrim(p.client_name) AS name FROM projects p JOIN workspaces w ON w.id = p.workspace_id
  WHERE btrim(coalesce(p.client_name, '')) <> ''
  UNION ALL
  SELECT w.org_id, btrim(t.name) FROM qbr_tribes t JOIN workspaces w ON w.id = t.workspace_id
  WHERE btrim(coalesce(t.name, '')) <> ''
  UNION ALL
  SELECT w.org_id, btrim(a.value) FROM resources r JOIN workspaces w ON w.id = r.workspace_id
  CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(r.craft_profile -> 'tribeAffinity') = 'array'
                                                 THEN r.craft_profile -> 'tribeAffinity' ELSE '[]'::jsonb END) a(value)
  WHERE btrim(coalesce(a.value, '')) <> ''
) src
WHERE src.org_id IS NOT NULL
GROUP BY src.org_id, lower(src.name)
ON CONFLICT DO NOTHING;

UPDATE projects p SET tribe_id = t.id
FROM workspaces w, tribes t
WHERE w.id = p.workspace_id AND t.org_id = w.org_id AND lower(t.name) = lower(btrim(p.client_name))
  AND p.tribe_id IS NULL AND btrim(coalesce(p.client_name, '')) <> '';

UPDATE resources r SET tribe_affinity_ids = sub.ids
FROM (
  SELECT r2.id, array_agg(t.id ORDER BY a.ord) AS ids
  FROM resources r2
  JOIN workspaces w ON w.id = r2.workspace_id
  CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(r2.craft_profile -> 'tribeAffinity') = 'array'
                                                 THEN r2.craft_profile -> 'tribeAffinity' ELSE '[]'::jsonb END)
    WITH ORDINALITY AS a(value, ord)
  JOIN tribes t ON t.org_id = w.org_id AND lower(t.name) = lower(btrim(a.value))
  GROUP BY r2.id
) sub
WHERE r.id = sub.id AND r.tribe_affinity_ids IS NULL;

-- Home tribe = first tribe affinity (ORG-01 note in handoff-WP0 §6).
UPDATE resources SET home_tribe_id = tribe_affinity_ids[1]
WHERE home_tribe_id IS NULL AND tribe_affinity_ids IS NOT NULL AND array_length(tribe_affinity_ids, 1) > 0;

-- ORG-01#AC3: teams for every team id in use; t1..t5 keep the v1.1 TEAMS names.
INSERT INTO org_teams (org_id, id, name)
SELECT DISTINCT ON (w.org_id, r.team_id) w.org_id, r.team_id,
       CASE r.team_id
         WHEN 't1' THEN 'Programme Management'
         WHEN 't2' THEN 'Digital Planning'
         WHEN 't3' THEN 'Product Management'
         WHEN 't4' THEN 'Delivery'
         WHEN 't5' THEN 'Project Management'
         ELSE r.team_id END
FROM resources r JOIN workspaces w ON w.id = r.workspace_id
WHERE coalesce(r.team_id, '') <> '' AND w.org_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- ORG-01#AC4: link people to login users of the same org by exact (case-insensitive) email.
UPDATE resources r SET linked_user_id = u.id
FROM workspaces w, users u
WHERE w.id = r.workspace_id AND u.org_id = w.org_id
  AND lower(u.email) = lower(btrim(r.email))
  AND r.linked_user_id IS NULL AND coalesce(r.email, '') <> '';

-- Projects imported from Planview in v1.1 carry a planview_id.
UPDATE projects SET source = 'planview'
WHERE planview_id IS NOT NULL AND source = 'manual'
  AND created_at <= (SELECT at FROM migration_markers WHERE name = '0004_org_structure');
