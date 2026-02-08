# Cache Money Casino API

This document describes the HTTP + WebSocket APIs used by the casino frontend.
All endpoints are hosted behind API Gateway and backed by Lambda in `backend-lambda/`.

## Base URLs

- HTTP API (REST): `https://<api-id>.execute-api.<region>.amazonaws.com`
- WebSocket API: `wss://<ws-id>.execute-api.<region>.amazonaws.com`

Locally (dev-local): see `scripts/dev-local.sh` output or `frontend/js/config.js`.

## Auth

### Bearer token

All game + account endpoints require a Bearer token:

```
Authorization: Bearer <token>
```

The token is returned by the auth endpoints and stored in DynamoDB sessions.

### CORS

CORS is controlled via `CORS_ORIGIN` in the Lambda environment.

## Error format

Most errors are JSON with `{ "error": "..." }` and HTTP status codes:

- `400` Bad Request (invalid payload)
- `401` Unauthorized (missing/invalid token)
- `404` Not found
- `500` Server error

## Hidden information rules

For card games, the backend stores full game state (including deck and hidden cards)
and only returns visible information.

- Blackjack: dealer hole card hidden until `revealDealer` is true
- 5-Card Poker: dealer hand hidden until `phase === "reveal"`
- Texas Hold'em: community cards only up to the current phase, dealer hole cards
  hidden until `phase === "showdown"`

The frontend should not send full state back to the server. Only minimal inputs
(e.g., bet amounts or discard indexes) are required.

## Auth API

### POST /api/auth/register
Create a new account.

**Body**
```
{ "username": "alice", "password": "Strong1!" }
```

**Response 200**
```
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
  "user": {
    "username": "alice",
    "balance": 1000,
    "stats": {
      "totals": { "bets": 0, "wins": 0, "losses": 0, "net": 0 },
      "games": {},
      "recent": []
    }
  }
}
```

### POST /api/auth/login
Log in with username/password.

**Body**
```
{ "username": "alice", "password": "Strong1!" }
```

**Response 200**
```
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
  "user": {
    "username": "alice",
    "balance": 900,
    "stats": {
      "totals": { "bets": 50, "wins": 2, "losses": 1, "net": 25 },
      "games": {
        "blackjack": { "bets": 50, "wins": 2, "losses": 1, "net": 25 }
      },
      "recent": [
        { "game": "blackjack", "bet": 10, "net": 10, "result": "win", "ts": "2026-02-07T00:00:00.000Z" },
        { "game": "blackjack", "bet": 10, "net": -10, "result": "loss", "ts": "2026-02-06T23:00:00.000Z" }
      ]
    }
  }
}
```

### POST /api/auth/guest
Create a guest session.

**Body**
```
{}
```

**Response 200**
```
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
  "user": { "username": "guest", "balance": 1000 }
}
```

## Account API

### GET /api/me
Return the authenticated user profile and stats.

**Response 200**
```
{
  "user": {
    "username": "alice",
    "balance": 900,
    "stats": {
      "totals": { "bets": 50, "wins": 2, "losses": 1, "net": 25 },
      "games": {
        "blackjack": { "bets": 50, "wins": 2, "losses": 1, "net": 25 }
      },
      "recent": [
        { "game": "blackjack", "bet": 10, "net": 10, "result": "win", "ts": "2026-02-07T00:00:00.000Z" }
      ],
      "favorite": "blackjack",
      "bestWinRate": "blackjack 67%"
    }
  }
}
```

### POST /api/balance
Set balance directly (used for admin/testing UI actions).

**Body**
```
{ "balance": 1000 }
```

**Response 200**
```
{ "ok": true }
```

### POST /api/stats/record
Record a stats entry.

**Body**
```
{ "game": "slots", "bet": 10, "net": 20, "result": "win" }
```

**Response 200**
```
{ "ok": true }
```

## Games API

### Game state

#### GET /api/games/{game}/state
Return the current server-side game state (sanitized) and whether the round is active.

**Response 200 (inactive)**
```
{
  "active": false,
  "balance": 1000,
  "state": null
}
```

**Response 200 (active)**
```
{
  "active": true,
  "balance": 980,
  "state": {
    "phase": "preflop",
    "inRound": true,
    "player": [
      { "rank": "A", "suit": "♠" },
      { "rank": "9", "suit": "♦" }
    ],
    "dealer": [
      { "rank": "?", "suit": "?" },
      { "rank": "?", "suit": "?" }
    ],
    "community": []
  }
}
```

### Roulette

#### POST /api/games/roulette/spin
Spin the wheel with a set of bets.

**Body**
```
{
  "bets": {
    "numbers": { "0": 5, "00": 5, "17": 10 },
    "colors": { "red": 5, "black": 0 },
    "parities": { "odd": 0, "even": 5 }
  },
  "paid": false
}
```

- `paid`: if `false`, the server deducts `totalBet` from balance before payout

**Response 200**
```
{
  "resultNumber": 17,
  "totalBet": 25,
  "payout": 70,
  "profit": 45,
  "balance": 1045,
  "win": true
}
```

### Craps

#### POST /api/games/craps/roll
Roll the dice with the current set of bets.

**Body**
```
{
  "bets": {
    "pass": 10,
    "dont": 0,
    "field": 5,
    "come": 0,
    "place": { "4": 0, "5": 0, "6": 6, "8": 6, "9": 0, "10": 0 },
    "hardways": { "4": 0, "6": 5, "8": 0, "10": 0 },
    "comePoints": { "4": 0, "5": 0, "6": 0, "8": 0, "9": 0, "10": 0 }
  },
  "paid": false,
  "tableOn": true
}
```

- `paid`: if `false`, the server deducts `wager` from balance before payout
- `tableOn`: if `false`, table bets are turned OFF for this roll (place/hard/come points do not resolve)

**Response 200**
```
{
  "state": {
    "point": 6,
    "tableOn": true,
    "bets": {
      "pass": 10,
      "dont": 0,
      "field": 0,
      "come": 0,
      "place": { "4": 0, "5": 0, "6": 6, "8": 6, "9": 0, "10": 0 },
      "hardways": { "4": 0, "6": 0, "8": 0, "10": 0 },
      "comePoints": { "4": 0, "5": 0, "6": 0, "8": 0, "9": 0, "10": 0 }
    },
    "inRound": true
  },
  "balance": 1008,
  "roll": 6,
  "payout": 23,
  "wager": 27,
  "win": true
}
```

### Memory

#### POST /api/games/memory/start
Start a 6x4 memory round with a bet.

**Body**
```
{ "bet": 25 }
```

**Response 200**
```
{
  "state": {
    "rows": 4,
    "cols": 6,
    "bet": 25,
    "moves": 0,
    "matches": 0,
    "completed": false,
    "inRound": true,
    "cards": [
      { "value": null, "revealed": false, "matched": false },
      { "value": null, "revealed": false, "matched": false }
    ]
  },
  "balance": 975
}
```

#### POST /api/games/memory/flip
Flip a card by index (0-23).

**Body**
```
{ "index": 7 }
```

**Response 200**
```
{
  "state": {
    "rows": 4,
    "cols": 6,
    "bet": 25,
    "moves": 3,
    "matches": 2,
    "completed": false,
    "inRound": true,
    "cards": [
      { "value": "🍒", "revealed": true, "matched": true },
      { "value": null, "revealed": false, "matched": false }
    ]
  },
  "balance": 975,
  "matched": true,
  "completed": false,
  "payout": 0,
  "profit": 0,
  "multiplier": 0
}
```

### Slots

#### POST /api/games/slots/spin
Spin the slots.

**Body**
```
{ "bet": 5 }
```

**Response 200**
```
{
  "symbols": ["🍒", "🍒", "🍒"],
  "outcome": { "hasThreeKind": true, "hasTwoKind": true, "tripleSymbol": "🍒", "twoSymbol": "🍒", "multiplier": 6, "key": "3-cherry" },
  "payout": 35,
  "profit": 30,
  "balance": 1030,
  "wipeBalance": false
}
```

### Blackjack

#### POST /api/games/blackjack/deal
Start a round.

**Body**
```
{ "bet": 10 }
```

**Response 200**
```
{
  "state": {
    "hands": [[{ "rank": "K", "suit": "♠" }, { "rank": "6", "suit": "♦" }]],
    "dealer": [{ "rank": "?", "suit": "?" }, { "rank": "9", "suit": "♣" }],
    "bets": [10],
    "doubled": [false],
    "busted": [false],
    "activeHand": 0,
    "splitUsed": false,
    "inRound": true,
    "revealDealer": false
  },
  "balance": 990,
  "message": null
}
```

#### POST /api/games/blackjack/hit
Draw a card for the active hand.

**Body**
```
{}
```

**Response 200**
```
{
  "state": {
    "hands": [[{ "rank": "K", "suit": "♠" }, { "rank": "6", "suit": "♦" }, { "rank": "2", "suit": "♣" }]],
    "dealer": [{ "rank": "?", "suit": "?" }, { "rank": "9", "suit": "♣" }],
    "bets": [10],
    "doubled": [false],
    "busted": [false],
    "activeHand": 0,
    "splitUsed": false,
    "inRound": true,
    "revealDealer": false
  },
  "messages": []
}
```

#### POST /api/games/blackjack/stand
Stand on the active hand.

**Body**
```
{}
```

**Response 200**
```
{
  "state": {
    "hands": [[{ "rank": "K", "suit": "♠" }, { "rank": "6", "suit": "♦" }]],
    "dealer": [{ "rank": "10", "suit": "♥" }, { "rank": "7", "suit": "♣" }],
    "bets": [10],
    "doubled": [false],
    "busted": [false],
    "activeHand": 0,
    "splitUsed": false,
    "inRound": false,
    "revealDealer": true
  },
  "outcomes": [{ "index": 0, "result": "win", "net": 10 }],
  "payoutTotal": 20,
  "messages": [],
  "balance": 1010
}
```

#### POST /api/games/blackjack/double
Double down on the active hand.

**Body**
```
{}
```

#### POST /api/games/blackjack/split
Split the active hand when allowed.

**Body**
```
{}
```

### 5-Card Poker

#### POST /api/games/poker/deal
Deal a new hand.

**Body**
```
{ "blind": 5 }
```

**Response 200**
```
{
  "state": {
    "blind": 5,
    "pot": 10,
    "playerPaid": 5,
    "betAmount": 0,
    "bet1": 0,
    "bet2": 0,
    "bet3": 0,
    "betRaise": 0,
    "pendingCall": 0,
    "awaitingRaise": false,
    "phase": "bet1",
    "drawRound": 0,
    "discards": [],
    "player": [
      { "rank": "J", "suit": "♠" },
      { "rank": "7", "suit": "♦" },
      { "rank": "5", "suit": "♥" },
      { "rank": "3", "suit": "♣" },
      { "rank": "2", "suit": "♠" }
    ],
    "dealer": [
      { "rank": "?", "suit": "?" },
      { "rank": "?", "suit": "?" },
      { "rank": "?", "suit": "?" },
      { "rank": "?", "suit": "?" },
      { "rank": "?", "suit": "?" }
    ],
    "inRound": true,
  },
  "balance": 995
}
```

#### POST /api/games/poker/bet
Place a bet in the current betting phase.

**Body**
```
{ "betAmount": 10 }
```

**Response 200**
```
{
  "state": {
    "pot": 30,
    "playerPaid": 15,
    "bet1": 10,
    "bet2": 0,
    "bet3": 0,
    "betRaise": 0,
    "pendingCall": 0,
    "awaitingRaise": false,
    "phase": "discard1",
    "player": [
      { "rank": "J", "suit": "♠" },
      { "rank": "7", "suit": "♦" },
      { "rank": "5", "suit": "♥" },
      { "rank": "3", "suit": "♣" },
      { "rank": "2", "suit": "♠" }
    ],
    "dealer": [
      { "rank": "?", "suit": "?" },
      { "rank": "?", "suit": "?" },
      { "rank": "?", "suit": "?" },
      { "rank": "?", "suit": "?" },
      { "rank": "?", "suit": "?" }
    ]
  },
  "balance": 985,
  "messages": [{ "text": "Dealer calls.", "tone": "win", "duration": 1200 }]
}
```

#### POST /api/games/poker/draw
Discard selected cards.

**Body**
```
{ "discards": [0, 3] }
```

**Response 200**
```
{
  "state": {
    "phase": "bet2",
    "player": [
      { "rank": "A", "suit": "♣" },
      { "rank": "7", "suit": "♦" },
      { "rank": "5", "suit": "♥" },
      { "rank": "K", "suit": "♠" },
      { "rank": "2", "suit": "♠" }
    ],
    "dealer": [
      { "rank": "?", "suit": "?" },
      { "rank": "?", "suit": "?" },
      { "rank": "?", "suit": "?" },
      { "rank": "?", "suit": "?" },
      { "rank": "?", "suit": "?" }
    ]
  },
  "dealerDiscarded": 2
}
```

#### POST /api/games/poker/call
Call a dealer raise.

**Body**
```
{}
```

**Response 200**
```
{
  "state": {
    "pot": 40,
    "playerPaid": 20,
    "pendingCall": 0,
    "awaitingRaise": false,
    "phase": "discard1",
    "player": [
      { "rank": "J", "suit": "♠" },
      { "rank": "7", "suit": "♦" },
      { "rank": "5", "suit": "♥" },
      { "rank": "3", "suit": "♣" },
      { "rank": "2", "suit": "♠" }
    ],
    "dealer": [
      { "rank": "?", "suit": "?" },
      { "rank": "?", "suit": "?" },
      { "rank": "?", "suit": "?" },
      { "rank": "?", "suit": "?" },
      { "rank": "?", "suit": "?" }
    ]
  },
  "balance": 975
}
```

#### POST /api/games/poker/fold
Fold the current hand.

**Body**
```
{}
```

**Response 200**
```
{
  "state": {
    "phase": "reveal",
    "inRound": false,
  },
  "balance": 990,
  "messages": [{ "text": "You folded.", "tone": "danger", "duration": 2000 }]
}
```

### Texas Hold'em

#### POST /api/games/holdem/deal
Start a new hand (posts blinds).

**Body**
```
{ "state": { "blindSmall": 5, "blindBig": 10, "dealerButton": false } }
```

**Response 200**
```
{
  "state": {
    "pot": 15,
    "playerPaid": 10,
    "playerBet": 10,
    "dealerBet": 5,
    "currentBet": 10,
    "betAmount": 0,
    "blindSmall": 5,
    "blindBig": 10,
    "dealerButton": true,
    "awaitingRaise": false,
    "player": [
      { "rank": "A", "suit": "♠" },
      { "rank": "9", "suit": "♦" }
    ],
    "dealer": [
      { "rank": "?", "suit": "?" },
      { "rank": "?", "suit": "?" }
    ],
    "community": [],
    "phase": "preflop",
    "inRound": true,
    "dealerRaised": false
  },
  "balance": 990,
  "messages": [{ "text": "Blinds in. You: $10, Dealer: $5.", "tone": "win", "duration": 1600 }]
}
```

#### POST /api/games/holdem/action
Place a bet or call.

**Body**
```
{ "betAmount": 10 }
```

**Response 200**
```
{
  "state": {
    "pot": 35,
    "playerPaid": 20,
    "playerBet": 20,
    "dealerBet": 15,
    "currentBet": 20,
    "phase": "flop",
    "community": [
      { "rank": "K", "suit": "♣" },
      { "rank": "7", "suit": "♥" },
      { "rank": "2", "suit": "♦" }
    ],
    "dealer": [
      { "rank": "?", "suit": "?" },
      { "rank": "?", "suit": "?" }
    ],
    "awaitingRaise": false,
  },
  "balance": 980,
  "messages": [{ "text": "Flop dealt.", "tone": "win", "duration": 1400 }]
}
```

#### POST /api/games/holdem/fold
Fold the current hand.

**Body**
```
{}
```

**Response 200**
```
{
  "state": {
    "phase": "showdown",
    "inRound": false,
  },
  "balance": 980,
  "messages": [{ "text": "You folded. Dealer wins.", "tone": "danger", "duration": 2000 }]
}
```
**Response 200**
```
{
  "state": {
    "pot": 15,
    "playerPaid": 10,
    "playerBet": 10,
    "dealerBet": 5,
    "currentBet": 10,
    "blindSmall": 5,
    "blindBig": 10,
    "dealerButton": true,
    "phase": "preflop",
    "inRound": true
  },
  "balance": 980,
  "messages": [{ "text": "Pre-flop betting.", "tone": "win", "duration": 1400 }]
}
```

## WebSocket API

### Connect
`GET wss://<ws-id>.execute-api.<region>.amazonaws.com/<stage>?token=<token>`

Stores the connection in DynamoDB and associates it with the user (or "guest").

### Messages
Send JSON payloads:

```
{ "action": "join", "roomId": "lobby" }
{ "action": "leave" }
{ "action": "action", "payload": { "x": 1 } }
```

Server responses:

```
{ "type": "ROOM_JOINED", "roomId": "lobby" }
{ "type": "ROOM_LEFT" }
{ "type": "ACTION_ACK", "payload": { "x": 1 } }
```

### Disconnect
Connection is removed from DynamoDB.

## Data model (DynamoDB)

- `USERS_TABLE`: user profile + hashed password + stats
- `SESSIONS_TABLE`: token -> username (or guest) + balance
- `GAME_SESSIONS_TABLE`: token:game -> server-side game state
- `CONNECTIONS_TABLE`: websocket connections
- `ROOMS_TABLE`: websocket rooms

## Notes for clients

- Always send `Authorization: Bearer <token>`
- For card games, do not send full state back to the API
- Use returned `state` only for UI rendering
- Use `messages` array to show toasts in order
