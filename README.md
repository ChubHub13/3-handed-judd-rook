# 3-Handed Judd Rook v1.0.4

Three-player multiplayer Judd Rook for Daryl, Cristi, and Cindy.

## Render

- Runtime: Node
- Build Command: `npm install`
- Start Command: `node server.js`
- Instance Type: Free

No database or external Node packages are required.

## Game flow

1. Select Daryl, Cristi, or Cindy.
2. Any player can start the game.
3. Any name not currently connected is represented by a bot.
4. Three-player deal: 12 cards each plus a 9-card kitty.
5. The winning bidder receives the kitty into their hand BEFORE choosing trump.
6. Trump choice includes Red, Yellow, Green, Black, and No Trump.
7. The bidder returns exactly 9 cards. Tap cards to select them; press and hold a card to select that color.
8. The last completed trick remains visible for 3 seconds.
9. All players see the current bid and bidder status, and can chat.

The bot bidding model and key play safeguards are based on the earlier Rook Solitaire behavior.
