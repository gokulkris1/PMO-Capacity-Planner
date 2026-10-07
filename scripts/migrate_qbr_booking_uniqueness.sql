-- Ensure a live QBR booking is unique even when scenario_id is NULL.
-- This is non-destructive: it aborts if legacy duplicate live bookings exist so
-- they can be reviewed rather than silently discarded.
CREATE UNIQUE INDEX IF NOT EXISTS idx_qbr_bookings_live_unique
    ON qbr_bookings(member_id, project_id, sprint_id)
    WHERE scenario_id IS NULL;
