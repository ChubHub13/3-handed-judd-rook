# 3-Handed Judd Rook v1.1.27

Three-player Judd Rook for Daryl, Cristi, and Cindy. Players select their name; no accounts or room codes are used. Any player who has not joined is treated as a bot when the game starts, and a disconnected live seat can become a bot.

## Render

- Runtime: Node
- Build command: `npm install`
- Start command: `node server.js`
- Root directory: blank
- Instance type: Free

## Current flow

1. A player selects Daryl, Cristi, or Cindy and starts the game.
2. The server deals 12 cards to each player and a 9-card kitty.
3. Cards are sorted by color, then by number, matching the solitaire sorting approach.
4. The bidding status is shown to every player. The selected bid remains stable while the live table refreshes.
5. When the bidder wins, the bidder sees the 9-card kitty on the table and clicks **Accept Kitty**.
6. The 9 cards are added to the bidder's 12-card hand, making 21 cards.
7. The bidder clicks **Choose Trump** and can choose Red, Yellow, Green, Black, or No Trump. The Rook follows the selected trump color (or Red in No Trump) and has the Solitaire 10.5 rank.
8. The bidder returns exactly 9 cards to the kitty. Each tap selects only that individual card.
9. The completed trick remains visible for 3 seconds before the next trick begins.
10. The winning bidder can use **Go Down** during the hand to concede the bid immediately; the remaining cards are shown with the hand score.
11. Chat is available to all three players. Bots use the same follow-suit, Rook, point-feeding, guarded-14, and defender-team rules as the Solitaire game.

Before the first bid, Bitter Bunch proceeds in bidding order: each next player may agree, but anyone who does not agree must open the bidding. Bot bidders favor two working colors, protect their final trump for the last trick, and return non-winning side-color 10s and 5s to the kitty when practical. After taking a bidder-led side-color trick, a defending bot leads a different non-trump color when one is available. After a bot is set twice, it must pass for the next three hands.

The server is authoritative for dealing, bidding, kitty state, trump, discards, turns, tricks, scoring, bots, and chat.
