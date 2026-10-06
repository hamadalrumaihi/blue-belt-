-- Lets the owner mark an operational incident "Done" (acknowledged) in the app.
-- Additive and nullable: existing rows and the incident runner keep working
-- before and after. Acknowledging does not resolve the incident; it only says
-- the owner has seen it and acted. A new cycle of the same problem (after a
-- recovery) clears the mark again so it is shown, and alerted, afresh.
alter table public.photo_incidents add column if not exists acknowledged_at timestamptz;
