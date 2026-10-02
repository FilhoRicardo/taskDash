# Recurrence support

TaskDash calendar expansion and recurrent-task completion use the same recurrence evaluator. Rules may be written as semicolon-separated `KEY=VALUE` parts, with `DTSTART:YYYYMMDD` as the start date.

Supported rules:

- `FREQ=DAILY` with an optional integer `INTERVAL` from 1 through 100.
- `FREQ=WEEKLY` with an optional integer `INTERVAL` from 1 through 100 and plain weekday values in `BYDAY` (for example, `MO,WE,FR`). Without `BYDAY`, the start weekday is used.
- `FREQ=MONTHLY` with an optional integer `INTERVAL` from 1 through 100, either the start day of month or ordinal weekdays such as `2MO` and `-1MO` in `BYDAY`.
- `FREQ=YEARLY` with an optional integer `INTERVAL` from 1 through 100, keeping the start month and day.
- Inclusive `UNTIL` and positive `COUNT` bounds for all supported frequencies.

Other frequencies, selectors, malformed intervals/counts, and ordinal weekdays outside monthly rules are unsupported. They deterministically produce no calendar occurrences; completing an instance records it in `complete_instances` and removes its due date when no supported next occurrence exists. When both `UNTIL` and `COUNT` are present, either bound ends the series.
