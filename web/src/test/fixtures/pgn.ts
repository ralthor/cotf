export const ITALIAN_CASTLING = `[Event "Fixture: castling"]
[Site "Local"]
[Date "2026.11.01"]
[White "Alpha"]
[Black "Beta"]
[Result "*"]

1. e4 {[%clk 0:05:00]} e5 {[%clk 0:05:00]} 2. Nf3 Nc6 3. Bc4 Bc5 4. O-O Nf6 5. d3 O-O *`;

export const EN_PASSANT = `[Event "Fixture: en passant"]
[White "Gamma"]
[Black "Delta"]
[Result "*"]

1. e4 Nf6 2. e5 d5 3. exd6 cxd6 *`;

export const PROMOTION_FROM_FEN = `[Event "Fixture: promotion from FEN"]
[White "Epsilon"]
[Black "Zeta"]
[Result "1-0"]
[SetUp "1"]
[FEN "8/P7/8/8/8/8/8/k6K w - - 0 1"]

1. a8=Q+ Kb2 2. Qb7+ Kc3 1-0`;

export const WITH_VARIATIONS_AND_NAGS = `[Event "Fixture: variations"]
[White "Eta"]
[Black "Theta"]
[Result "1-0"]

1. e4 $1 e5 (1... c5 2. Nf3 d6) 2. Qh5!? {A comment} Nc6 3. Bc4 Nf6?? 4. Qxf7# 1-0`;

export const ILLEGAL = `[Event "Fixture: illegal"]
[White "Iota"]
[Black "Kappa"]
[Result "*"]

1. e4 e5 2. Ke3 Ke6 3. Qh8 *`;

export const CHESS960 = `[Event "Fixture: 960"]
[Variant "Chess960"]
[White "Lambda"]
[Black "Mu"]
[FEN "bbqnnrkr/pppppppp/8/8/8/8/PPPPPPPP/BBQNNRKR w HFhf - 0 1"]
[Result "*"]

1. e4 *`;

export const MULTI = [ITALIAN_CASTLING, EN_PASSANT, PROMOTION_FROM_FEN].join('\n\n');
