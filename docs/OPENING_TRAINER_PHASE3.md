# Opening trainer, phase 3: progress, statistics and backups

Status: implemented, 20 Nov 2026. Builds on [phase 2](OPENING_TRAINER_PHASE2.md); the overall plan is in
[OPENING_TRAINER.md](OPENING_TRAINER.md).

## Scope

- A **Progress** sub-tab in Openings (next to Browse and Train), per repertoire and side.
- A **backup file** (JSON) with every repertoire, chapter, training card and answer, to download and
  restore, so progress can move to another device or survive the browser clearing its storage.
- A visible reminder when there is training progress and no recent backup.

Not in this phase: games and their analyses in the backup (they can be imported and analysed again),
statistics from real games (phase 4).

## Progress sub-tab

Everything comes from the training cards and the answer log of the selected repertoire and side.

- **Headline numbers**: positions learnt out of all positions, positions mastered (FSRS stability of at
  least 21 days), due now, first-time accuracy over the last 30 days with the change against the 30 days
  before.
- **Answers per day** for the last 30 days: one bar per day, hover or focus for the day's numbers, and a
  hidden table for screen readers.
- **Streaks and records**: days in a row with training (current and best), most answers in a day,
  longest run of right-first-time answers.
- **Per chapter**: positions learnt and mastered, and accuracy, for each chapter of that side, with a
  progress bar.
- **Hardest positions**: positions answered at least twice, highest share of wrong or shown answers
  first, each with a Practise button (Review mode on that position).

Definitions:

- *Learnt*: the position has a training card.
- *Mastered*: card stability ≥ 21 days.
- *First-time accuracy*: share of graded answers that were right first time with no hint.
- Days are local calendar days.

## Backup file

```json
{
  "format": "chess-on-the-fly/openings",
  "version": 1,
  "exportedAt": "2026-11-20T18:00:00.000Z",
  "repertoires": [],
  "chapters": [],
  "trainCards": [],
  "trainLog": []
}
```

Dates in cards are ISO strings in the file and turned back into dates on restore.

Restoring:

- validates the format and version (a newer version is refused with a message);
- replaces each repertoire in the file (its chapters and move graph), adds the others, and leaves
  repertoires that are not in the file alone;
- writes the training cards (a card in the file replaces the one in the browser);
- adds answers that are not already in the log (same repertoire, side, position and time);
- asks for confirmation first, naming how many repertoires it will replace.

The left column gets a **Backup** panel under the repertoire list: "Download backup", "Restore from
backup", and the date of the last download. When there is training progress and no backup in the last
7 days, the panel says so in the warning colour.

## Files

- `core/repertoire/stats.ts`: all statistics, pure and tested.
- `core/repertoire/backup.ts`: building and checking the backup file, pure and tested.
- `storage/db.ts`: `backupStore` (read everything, restore in one transaction).
- `features/repertoire/ProgressView.tsx`, `features/repertoire/BackupPanel.tsx`.
- `features/repertoire/OpeningsView.tsx`: the third sub-tab.
