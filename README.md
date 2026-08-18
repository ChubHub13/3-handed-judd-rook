# 3-Handed Judd Rook

This version uses an authoritative Node.js server. The server is the source of truth for rooms, player seats, cards, bids, trump, discards, turns, trick winners, and scoring.

## Files

- `index.html` - browser client
- `server.js` - authoritative room/game server

## Run locally

```bash
node server.js
```

Then open `http://localhost:8080/` in three browser tabs/devices.

The host creates a room and shares the `ROOK-XXXX` code. Other players join with that code. Only three seats exist. Any missing seat becomes a bot when the host starts, and a disconnected live seat is replaced by a bot while the game is in progress.

## GitHub hosting note

GitHub can store these files, but GitHub Pages cannot run `server.js`. The Node server needs to be deployed to a service that runs Node.js, and the three players should open the client from that deployed server URL.
