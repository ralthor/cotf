/** PGN fixtures for repertoire import. */

/** Variations three deep, comments before/after moves and before the first move, shapes, evals, clocks, NAGs. */
export const ANNOTATED = `[Event "Italian ideas"]
[White "?"]
[Black "?"]
[Result "*"]
[Orientation "white"]

{ Start here. [%csl Ge4] }
1. e4 { King's pawn. [%cal Ge2e4,Rd7d5] [%eval 0.3] [%clk 0:05:00] } 1... e5 $1 2. Nf3 Nc6
( 2... d6 { Philidor. } 3. d4 ( 3. Bc4 Be7 ( 3... Nf6 $5 4. Ng5 ) 4. d4 ) 3... exd4 )
( { Petroff: } 2... Nf6 3. Nxe5 )
3. Bc4!? { The Italian. [%eval #-2] } Bc5 $16 *`;

export const TRANSPOSITION = `[Event "Order A"]
[Orientation "black"]

1. d4 Nf6 2. c4 e6 *

[Event "Order B"]
[Orientation "black"]

1. c4 e6 2. d4 Nf6 *`;

export const FROM_POSITION = `[Event "Endgame drill"]
[SetUp "1"]
[FEN "4k3/8/8/8/8/8/4P3/4K3 w - - 0 40"]

40. e4 Kd7 *`;

export const BAD_GAMES = `[Event "Empty"]

*

[Event "Crazy"]
[Variant "Crazyhouse"]

1. e4 *

[Event "Illegal in variation"]

1. e4 e5 ( 1... Nc6 2. Ke3 ) ( 1... c5 2. Nf3 ) 2. Nf3 *`;

/** A Lichess study export (two chapters), shaped like /api/study/{id}.pgn output. */
export const LICHESS_STUDY = `[Event "My repertoire: Caro-Kann"]
[Site "https://lichess.org/study/AbCdEfGh/IjKlMnOp"]
[Result "*"]
[Variant "Standard"]
[ECO "B12"]
[Opening "Caro-Kann Defense: Advance Variation"]
[Annotator "https://lichess.org/@/someone"]
[StudyName "My repertoire"]
[ChapterName "Caro-Kann"]
[ChapterURL "https://lichess.org/study/AbCdEfGh/IjKlMnOp"]
[Orientation "black"]

{ The main idea is a quick ...c5. }
1. e4 c6 2. d4 d5 3. e5 { [%cal Gc8f5] } 3... Bf5 { Develop the bishop before ...e6. [%csl Gf5] } 4. Nf3 (4. h4 h5) 4... e6 *


[Event "My repertoire: Scandinavian"]
[Site "https://lichess.org/study/AbCdEfGh/QrStUvWx"]
[Result "*"]
[Variant "Standard"]
[StudyName "My repertoire"]
[ChapterName "Scandinavian"]
[ChapterURL "https://lichess.org/study/AbCdEfGh/QrStUvWx"]
[Orientation "white"]

1. e4 d5 2. exd5 Qxd5 3. Nc3 *
`;
