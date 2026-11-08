ITALIAN = """[Event "Fixture"]
[Site "https://www.chess.com/game/live/1"]
[Date "2026.11.01"]
[White "example_player"]
[Black "Beta"]
[Result "1-0"]
[WhiteElo "1500"]
[BlackElo "1480"]
[TimeControl "600"]
[ECO "C50"]

1. e4 {[%clk 0:10:00]} e5 2. Nf3 Nc6 3. Bc4 Bc5 4. O-O Nf6 5. d3 O-O 1-0"""

QUEEN_BLUNDER = """[Event "Blunder"]
[White "example_player"]
[Black "Opp"]
[Date "2026.11.02"]
[Result "0-1"]
[TimeControl "180+2"]

1. e4 d5 2. Qg4 Bxg4 0-1"""

ILLEGAL = """[Event "Bad"]
[White "a"]
[Black "b"]

1. e4 e5 2. Ke3 Ke6 3. Qh8 *"""
