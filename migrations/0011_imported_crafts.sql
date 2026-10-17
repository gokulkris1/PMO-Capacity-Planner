-- 0011 imported crafts (QA-014). 0004 turned every craft id referenced by v1.1 data but missing from the catalogue
-- into a craft named after the raw id with a hash code ("X7AC · delivery-lead"), which showed in pickers, Demand,
-- the Marketplace and My plan. This repairs those rows, and any created the same way since:
--  * an id of the v1.1 catalogue (constants.ts PMO_CRAFTS: programme-mgmt, project-mgmt, scrum-master, product-mgmt,
--    business-analysis, digital-planning, change-mgmt, pmo-analytics, risk-governance, vendor-mgmt, release-coord,
--    tooling-admin) gets its 2.0 catalogue name, code and description (the ids are the same in 2.0);
--  * any other id becomes a craft named after it in words ("delivery-lead" -> "Delivery Lead"), with a 2-4 character
--    code taken from the name ("DL"; one word: its first three letters), flagged "Imported - review" in
--    Settings > Crafts (needs_review) until an Org Admin saves or archives it. imported_from keeps the v1.1 id.
-- Craft ids never change, so every person, booking and demand line keeps pointing at the same craft, and the v1.1
-- columns (craft_profile, craft_demand) are not touched. Additive and idempotent: a repaired row no longer matches
-- the "raw id + hash code" pattern, so a second run changes nothing; a craft an admin already renamed is left alone.
ALTER TABLE crafts ADD COLUMN IF NOT EXISTS needs_review BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE crafts ADD COLUMN IF NOT EXISTS imported_from TEXT;

-- Referenced but still missing (v1.1 data written after 0004, e.g. during a rollback): same rule as 0004, then the
-- repair below names them.
INSERT INTO crafts (org_id, id, name, short, sort_order)
SELECT ref.org_id, ref.craft_id, ref.craft_id, 'X' || upper(substr(md5(ref.craft_id), 1, 3)), 100
FROM (
  SELECT w.org_id, a.craft_id FROM allocations a JOIN workspaces w ON w.id = a.workspace_id
  WHERE coalesce(a.craft_id, '') <> ''
  UNION
  SELECT w.org_id, d.craft_id FROM demand_lines d JOIN workspaces w ON w.id = d.workspace_id
  WHERE coalesce(d.craft_id, '') <> ''
  UNION
  SELECT w.org_id, r.craft_profile ->> 'primaryCraft' FROM resources r JOIN workspaces w ON w.id = r.workspace_id
  WHERE coalesce(r.craft_profile ->> 'primaryCraft', '') <> ''
  UNION
  SELECT w.org_id, sc ->> 'craftId' FROM resources r JOIN workspaces w ON w.id = r.workspace_id
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(r.craft_profile -> 'secondaryCrafts') = 'array'
                                            THEN r.craft_profile -> 'secondaryCrafts' ELSE '[]'::jsonb END) sc
  WHERE coalesce(sc ->> 'craftId', '') <> ''
) ref
WHERE ref.org_id IS NOT NULL
ON CONFLICT DO NOTHING;

DO $$
DECLARE
  c record;
  k record;
  base_name text;
  nm text;
  words text[];
  code text;
  cand text;
  n integer;
BEGIN
  FOR c IN
    SELECT org_id, id FROM crafts
    WHERE name = id AND short = 'X' || upper(substr(md5(id), 1, 3))
    ORDER BY org_id, sort_order, id
  LOOP
    SELECT * INTO k FROM (VALUES
      ('programme-mgmt', 'Programme Management', 'PGM', 'Multi-project programmes, benefits and governance', 1),
      ('project-mgmt', 'Project Management', 'PM', 'Plan, run and close a single project', 2),
      ('scrum-master', 'Scrum Master / Agile Delivery', 'SM', 'Sprint facilitation, flow, impediments', 3),
      ('product-mgmt', 'Product Management', 'PDM', 'Backlog ownership, discovery, roadmaps', 4),
      ('business-analysis', 'Business Analysis', 'BA', 'Requirements, process mapping, acceptance', 5),
      ('digital-planning', 'Digital Planning', 'DP', 'Portfolio sequencing, roadmap and demand planning', 6),
      ('change-mgmt', 'Change & Adoption', 'CM', 'Stakeholder readiness, comms, training', 7),
      ('pmo-analytics', 'PMO Analytics & Reporting', 'AN', 'Dashboards, status reporting, capacity data', 8),
      ('risk-governance', 'Risk, Governance & Compliance', 'RG', 'RAID, audit, regulatory gates', 9),
      ('vendor-mgmt', 'Vendor & Commercial Management', 'VM', 'Contracts, SOWs, supplier delivery', 10),
      ('release-coord', 'Release & Delivery Coordination', 'RC', 'Release trains, cutover, dependency tracking', 11),
      ('tooling-admin', 'Jira / Tooling Administration', 'JA', 'Jira, Planview and workflow configuration', 12)
    ) AS v(id, name, short, description, sort_order) WHERE v.id = c.id;

    IF FOUND THEN
      base_name := k.name;
      code := k.short;
    ELSE
      base_name := initcap(btrim(regexp_replace(c.id, '[^A-Za-z0-9]+', ' ', 'g')));
      IF base_name = '' THEN base_name := 'Imported Craft'; END IF;
      words := regexp_split_to_array(upper(base_name), '\s+');
      IF array_length(words, 1) >= 2 THEN
        code := '';
        FOR i IN 1..least(4, array_length(words, 1)) LOOP
          code := code || left(words[i], 1);
        END LOOP;
      ELSE
        code := left(words[1], 3);
      END IF;
      IF length(code) < 2 THEN code := rpad(code, 2, 'X'); END IF;
    END IF;

    -- Names and codes are unique per organisation (case-insensitive).
    nm := base_name;
    n := 1;
    WHILE EXISTS (SELECT 1 FROM crafts x WHERE x.org_id = c.org_id AND lower(x.name) = lower(nm) AND x.id <> c.id) LOOP
      nm := base_name || ' (imported' || CASE WHEN n > 1 THEN ' ' || n ELSE '' END || ')';
      n := n + 1;
    END LOOP;
    cand := code;
    n := 2;
    WHILE EXISTS (SELECT 1 FROM crafts x WHERE x.org_id = c.org_id AND upper(x.short) = cand AND x.id <> c.id)
          AND n < 100 LOOP
      cand := CASE WHEN n < 10 THEN left(code, 3) ELSE left(code, 2) END || n;
      n := n + 1;
    END LOOP;

    UPDATE crafts SET
      name = nm,
      short = cand,
      description = CASE WHEN k.id IS NOT NULL THEN k.description ELSE description END,
      sort_order = CASE WHEN k.id IS NOT NULL THEN k.sort_order ELSE sort_order END,
      needs_review = (k.id IS NULL),
      imported_from = c.id,
      version = version + 1,
      updated_at = now()
    WHERE org_id = c.org_id AND id = c.id;
  END LOOP;
END $$;
