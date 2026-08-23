# 3-Handed Judd Rook v1.1.14

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
4. The bidding status is shown to every player.
5. When the bidder wins, the bidder sees the 9-card kitty on the table and clicks **Accept Kitty**.
6. The 9 cards are added to the bidder's 12-card hand, making 21 cards.
7. The bidder clicks **Choose Trump** and can choose Red, Yellow, Green, Black, or No Trump. The Rook follows the selected trump color (or Red in No Trump) and has the Solitaire 10.5 rank.
8. The bidder returns exactly 9 cards to the kitty. Tap to select; press and hold a card to select that entire color.
9. The completed trick remains visible for 3 seconds before the next trick begins.
10. Chat is available to all three players. Bots use the same follow-suit, Rook, point-feeding, guarded-14, and defender-team rules as the Solitaire game.

The server is authoritative for dealing, bidding, kitty state, trump, discards, turns, tricks, scoring, bots, and chat.
