# Dama rules (plain language)

## Board and setup

- 10×10 board, only the dark squares are in play.
- Each side starts with 20 pieces, filling the dark squares of the 4 rows closest to them.
  The two middle rows start empty.
- **Light moves first.**

## Men

- A man moves one square diagonally **forward** (toward the far row).
- A man **captures** by jumping an adjacent enemy piece and landing on the empty square
  directly behind it — and this works **forward or backward**.
- Capturing is **compulsory**: if any piece of yours can capture, you must capture.
- **Multi-jumps are mandatory to finish**: once a piece starts capturing, it must keep
  capturing with that same piece for as long as another capture is available to it. The whole
  sequence is one move.
- Pieces that have been jumped stay on the board — physically blocking the path and immune
  to being jumped a second time — until the whole move is finished, at which point they're
  all removed together.
- **Promotion**: a man becomes a king only if its move **ends** on the farthest row. If a
  capture sequence merely passes through the far row on its way to a further jump, the piece
  stays a man and keeps capturing with a man's rules.

## Kings

- A king moves any distance along a clear diagonal in any of the four directions.
- A king captures an enemy piece any distance away on a diagonal, as long as the squares
  between the king and that piece are empty, and lands on **any** empty square beyond it.
- A king cannot jump two pieces back to back — if there's no empty landing square between
  one enemy piece and the next obstruction, that capture isn't available.
- A king can never jump its own piece, or a piece that's already been captured earlier in the
  same move.

## Choosing a capture

- Normally, when more than one capture (or capture sequence) is available, you may choose
  freely which one to play.
- **Strict mode** (optional toggle, off by default): you must play a sequence that captures
  the **most** pieces, counted across your whole side — not just the most for one piece.

## Game end

- A player who cannot move at all — no pieces left, or every piece blocked — **loses**.
- The game is a **draw** after 50 consecutive moves (by either side) with no capture and no
  man moving (i.e. only kings shuffling back and forth).
- Not implemented yet: *nfakh* (forfeiting an opponent's piece that failed to take a
  compulsory capture). Planned for phase 2.

## Notation

Squares are named from Light's point of view: files **a–j** left to right, ranks **1–10**
bottom to top. A simple move is written `e5-f6`. A capture lists every landing square:
`c3xe5xg7` means the piece started on c3, captured something landing on e5, then captured
again landing on g7.
