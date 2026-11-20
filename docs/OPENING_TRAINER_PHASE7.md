# Opening trainer, phase 7: traps and reasoning questions

Status: implemented, 20 Nov 2026. Builds on [phase 6](OPENING_TRAINER_PHASE6.md); the overall plan is in
[OPENING_TRAINER.md](OPENING_TRAINER.md).

## Explanations come from your studies

There is still no free, well-licensed dataset of opening explanations and traps that is good enough
to ship (Wikibooks' *Chess Opening Theory* is CC BY-SA but uneven and needs editing). So the
explanations are the ones in your own studies: their comments, arrows, highlighted squares and move
symbols, shown in Browse and during training, with the move symbols' names on hover. Phase 7 turns that
content into questions and traps instead of adding outside text.

## Traps

- A **trap** is an opponent move the study marks as a mistake (`?`, `??` or `?!`), followed by your
  repertoire's answer. Found by position, so a trap reached in several chapters is listed once.
- **Train → Traps in your repertoire** lists them (worst first: `??`, then `?`, then `?!`) with the
  punishing move; **Traps** mode asks them as single positions, graded and scheduled like Review.

## Reasoning questions

After a right answer (not while a move is being shown in Learn), the trainer may ask about the idea
behind the move, built from that move's content in the chapter, in this order:

1. **The author's question**: a comment written as `Q: … A: …`. The answer is revealed on request.
2. **Where is the plan aimed?** When the move has arrows or circled squares other than the move
   itself, click the square; right if it is a target of one of them.
3. **Fill the gap**: a move (or else a square) from the comment is blanked out, with three choices: the
   answer and two legal moves with the same piece (or nearby squares). The choices are the same every
   time for a position.

Rules:

- At most two questions per line in Learn and Memorise, so lines keep their pace; in Review and Traps
  every position can have one.
- The move's comment and arrows stay hidden until the question is answered or skipped.
- Questions are not graded for spaced repetition: the move answer already was.
- **Questions about plans** (Train options) turns them off; the choice is remembered.

## Files

- `core/repertoire/questions.ts` (`questionFor`), `core/repertoire/traps.ts` (`findTraps`), tested in
  `questions.test.ts`.
- `features/repertoire/useTrainer.ts`: mode `traps`, the `question` phase.
- `features/repertoire/TrainerView.tsx`: the options switch, the Traps mode and list, the question panel.

## Checked (20 Nov 2026)

In the browser with a small study containing an author question, a comment naming a move, arrows on a
move and two marked opponent mistakes: Learn showed the moves, then the replay asked the author
question and the fill-the-gap question (right and wrong answers), with the move's comment hidden until
answered; a mistake at that move brought it back in Review with the plan question (arrows hidden until
answered); Traps listed both traps and practised them. The test repertoire was then deleted.
