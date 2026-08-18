# 3-Handed Judd Rook

Three-player Judd Rook for exactly Daryl, Cristi, and Cindy.

## Hosting

- Node.js 18+.
- Build command: `npm install`
- Start command: `node server.js`

## Multiplayer model

There are no game rooms. The server maintains one shared game for the three named players.

- Daryl, Cristi, and Cindy each choose their own name when opening the app.
- If one or more players are not connected when Daryl starts the game, the missing seats become bots.
- If a live player disconnects during a hand, the server continues that seat with a bot.
- The server owns cards, bidding, trump, discards, turns, trick results, scoring, and chat.
- The completed trick remains visible for 5 seconds before the next trick begins.
- Trump selection opens automatically for the live player immediately after that player wins the bid.
- Bot bidding uses the original three-player bidding model from Rook Solitaire, including its 150-170/175 range and the 200 full-coverage exception.

## Important

The game state is held in server memory. A server restart resets the current game.
