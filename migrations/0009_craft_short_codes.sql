-- 0009 craft short codes (ORG-04, QA-034): the seeded codes `PgM` and `PdM` broke the rule the craft form enforces
-- (2-4 capital letters or digits). Upper-case any code that becomes valid that way. The unique index is on
-- upper(short), so this can never collide. Idempotent: a second run matches nothing.
UPDATE crafts
SET short = upper(short), version = version + 1, updated_at = now()
WHERE short <> upper(short) AND upper(short) ~ '^[A-Z0-9]{2,4}$';
