# Local competitions and manual tracking

Local events often use their own age groups and weight divisions, are not on
AJP or Smoothcomp, and may have no public bracket page. This mode covers them
without pretending anything is watched automatically.

## Event setup

- **Platform "Local competition"** (`LOCAL`). Choosing it switches the event to
  *Track by hand* and turns on its own division chart.
- **How brackets are followed** (`photo_events.tracking_mode`):
  - `watcher` — AJP / Smoothcomp pages are checked automatically; each client
    needs a bracket or profile URL.
  - `manual` — nothing is checked automatically. The event URL and every client
    URL are optional. The event, its cards and the watcher say **Tracked by hand**.
- **Own age groups and weight divisions** (`photo_events.division_rules`, JSON).
  Editable per event on the event form; the default chart is the local one
  (Kids 1 … Junior 2, each weight an "up to" maximum). Off → AJP Qatar National
  tables apply as before. No gender category is inferred from the chart.

## Clients on a local event

The client form asks for **birth date** (or **birth year**) and **weight in kg**,
then the event's **age group** and **weight division**. The age is counted on
the event date; each division's weight is its maximum. A mismatch shows a
warning (e.g. "37 kg is over the Heavy limit (up to 36 kg). It fits Superheavy")
and the owner can keep or change the choice — nothing is blocked. Stored as
`birth_date`, `birth_year`, `weight_kg`, `age_category` (group label),
`weight` (division label) and `division` (both).

CSV import accepts `birth_date`, `birth_year`, `weight_kg`, `age_group`
(alias of `age_category`) and `team` (alias of `academy`); group and division
names are mapped onto the event's chart.

## Entering brackets and matches

- **On a client's page:** *Add match* / *Edit match* — round, opponent, mat,
  date, time (event zone), status, result and next-round notes. Deleting is
  only possible for hand-entered rows.
- **`/events/<id>/brackets`** — *From a CSV* (columns `athlete, opponent, round,
  mat, time, date, status, result, next_round, match_number, age_group,
  division, team`; headers like `name`, `vs`, `stage` are understood) and
  *From a bracket photo* (below). Unknown names are skipped unless "Add unknown
  names as new clients" is ticked.
- Hand-entered matches are flagged `photo_matches.is_manual` and carry `round`,
  `result`, `next_round`. The watcher never changes or removes them
  (`photo_apply_refresh` only upserts by `external_match_id`). Edits write the
  same history rows as the watcher (`MAT_CHANGE`, `TIME_CHANGE`, …), so the
  history page and in-app alerts work; a new row is `MATCH_FOUND` labelled
  "Entered by hand". Nothing is ever reported as verified from a source.

## Bracket photos (optional)

`POST /api/brackets/extract` reads a bracket screenshot with Claude
(`@anthropic-ai/sdk`, structured JSON output) and returns rows for review. It is
off unless `ANTHROPIC_API_KEY` is set on the server (the page says so); the key
never reaches the browser. The image is shrunk in the browser first, limited to
6 MB, rate-limited per owner (20 per 10 minutes), and owner-only. The reading
is a draft: every cell is editable and nothing is saved until *Add matches*.

## Migration

`supabase/migrations/20261006130000_local_competitions.sql` — additive:
`LOCAL` platform, `tracking_mode`, `division_rules`, `birth_date`,
`birth_year`, `weight_kg`, and `is_manual` / `round` / `result` / `next_round`
on matches. Existing rows keep working unchanged.
