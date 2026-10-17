-- 0012 tribe names and leads (QA-015; PO rule, docs/product/ACCEPTANCE_REPORT.md §7). 0004 created one tribe per
-- distinct name (case-insensitive) from project client names, QBR tribes and tribe affinities, but took the
-- alphabetically first spelling ("PAYMENTS" beats "Payments") and did not copy the QBR tribe lead. For every tribe
-- 0004 created and nobody has edited since (version 1, no updated_by):
--  * name: the v1.1 QBR tribe's spelling; otherwise the most common project client_name spelling (ties prefer a
--    mixed-case spelling over ALL CAPS or all lower case); otherwise the most common tribe-affinity spelling;
--  * lead: the v1.1 QBR tribe's lead_name, only where the tribe has no lead yet.
-- Only the casing changes (the match is case-insensitive), so the unique name index cannot collide. tribes is a 2.0
-- table: no v1.1 column is touched. Idempotent: an updated tribe is at version 2 and is not matched again.
WITH qbr AS (
  SELECT DISTINCT ON (w.org_id, lower(btrim(t.name)))
         w.org_id, lower(btrim(t.name)) AS k, btrim(t.name) AS name, nullif(btrim(t.lead_name), '') AS lead
  FROM qbr_tribes t JOIN workspaces w ON w.id = t.workspace_id
  WHERE btrim(coalesce(t.name, '')) <> '' AND w.org_id IS NOT NULL
  ORDER BY w.org_id, lower(btrim(t.name)), (nullif(btrim(t.lead_name), '') IS NULL), btrim(t.name)
),
spellings AS (
  SELECT w.org_id, btrim(p.client_name) AS name, 1 AS src
  FROM projects p JOIN workspaces w ON w.id = p.workspace_id
  WHERE btrim(coalesce(p.client_name, '')) <> '' AND w.org_id IS NOT NULL
  UNION ALL
  SELECT w.org_id, btrim(a.value), 2
  FROM resources r JOIN workspaces w ON w.id = r.workspace_id
  CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(r.craft_profile -> 'tribeAffinity') = 'array'
                                                 THEN r.craft_profile -> 'tribeAffinity' ELSE '[]'::jsonb END) a(value)
  WHERE btrim(coalesce(a.value, '')) <> '' AND w.org_id IS NOT NULL
),
common AS (
  SELECT DISTINCT ON (org_id, lower(name)) org_id, lower(name) AS k, name
  FROM (SELECT org_id, name, min(src) AS src, count(*) AS n FROM spellings GROUP BY org_id, name) s
  ORDER BY org_id, lower(name), src, n DESC, (name = upper(name)), (name = lower(name)), name
),
wanted AS (
  SELECT t.id, coalesce(q.name, c.name, t.name) AS name, coalesce(t.lead_name, q.lead) AS lead_name
  FROM tribes t
  LEFT JOIN qbr q ON q.org_id = t.org_id AND q.k = lower(btrim(t.name))
  LEFT JOIN common c ON c.org_id = t.org_id AND c.k = lower(btrim(t.name))
  WHERE t.version = 1 AND t.updated_by IS NULL
)
UPDATE tribes t
SET name = w.name, lead_name = w.lead_name, version = t.version + 1, updated_at = now()
FROM wanted w
WHERE t.id = w.id
  AND (t.name IS DISTINCT FROM w.name OR t.lead_name IS DISTINCT FROM w.lead_name);
