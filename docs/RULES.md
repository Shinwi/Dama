# Dama rules (plain language)

## Board and setup

- 10×10 board, only the dark squares are in play.
- Each side starts with 20 pieces, filling the dark squares of the 4 rows closest to them.
  The two middle rows start empty.
- The sides are **White** and **Black**. **White moves first.** (The code calls them Light and
  Dark: `LIGHT`/`DARK`, `data-color="light|dark"`.)

## Men

- A man moves one square diagonally **forward** (toward the far row).
- A man **captures** by jumping an adjacent enemy piece and landing on the empty square
  directly behind it — **forward only**, on every hop of a multi-jump. Men never capture
  backwards.
- Capturing is **optional**: you may play a plain move even when a capture is available — but
  then your opponent may punish it with *nfikh* (below).
- **Multi-jumps are mandatory to finish**: once a piece starts capturing, it must keep
  capturing with that same piece for as long as another capture is available to it. The whole
  sequence is one move.
- Pieces that have been jumped stay on the board — physically blocking the path and immune
  to being jumped a second time — until the whole move is finished, at which point they're
  all removed together.
- **Promotion**: a man becomes a king when its move **ends** on the farthest row. (Since men
  only capture forward, a capture that reaches the far row can't continue, so it always ends
  there.)

## Kings

- A king moves any distance along a clear diagonal in any of the four directions.
- A king captures an enemy piece any distance away on a diagonal, as long as the squares
  between the king and that piece are empty, and lands on **any** empty square beyond it.
- A king cannot jump two pieces back to back — if there's no empty landing square between
  one enemy piece and the next obstruction, that capture isn't available.
- A king can never jump its own piece, or a piece that's already been captured earlier in the
  same move.

## Nfikh (huffing)

- If a player could have captured but played a plain move instead, their opponent may, on
  the very next turn and **before moving**, take one of the pieces that could have captured
  off the board. (If the piece that could have captured is the one that moved, it's taken on
  the square it moved to.)
- Taking a piece this way does not use up the turn: the same player then plays a normal move,
  and only then does the turn pass.
- Only one piece can be taken, and only on that turn. Once the opponent moves instead, the
  chance is gone.
- Nothing on screen points out the missed capture: spotting it is up to the opponent. In the
  game, you take the piece by tapping it.

## Choosing a capture

- Normally, when more than one capture (or capture sequence) is available, you may choose
  freely which one to play.
- **Strict mode** (optional toggle, off by default): *if* you capture, you must play a
  sequence that captures the **most** pieces, counted across your whole side — not just the
  most for one piece. Plain moves stay legal (with the nfikh risk).

## Game end

- A player who cannot move at all — no pieces left, or every piece blocked, even after
  taking a piece by nfikh — **loses**.
- The game is a **draw** after 50 consecutive moves (by either side) with no capture and no
  man moving (i.e. only kings shuffling back and forth).

## Move timer

- Optional, picked on the home screen: no timer, 30 s (the default), 45 s or 1 min per move.
  Online, the player who creates the room picks it for both, and the server keeps the time.
- A player who runs out of time doesn't move: their turn is **skipped** and the opponent
  plays. A capture half tapped in is dropped, and taking a piece by nfikh doesn't stop the
  clock (it's part of the same turn). A chance to take a piece by nfikh is lost with the turn.
- A skipped turn isn't a move, so it doesn't count toward the 50-move draw.
- **Three skipped turns in a row lose the game.** Playing a move starts the count over.
- Against the computer, only the player has a clock.

## Notation

Squares are named from White's point of view: files **a–j** left to right, ranks **1–10**
bottom to top. A simple move is written `e5-f6`. A capture lists every landing square:
`c3xe5xg7` means the piece started on c3, captured something landing on e5, then captured
again landing on g7.
