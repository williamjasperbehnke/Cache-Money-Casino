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
- Texas Hold'em: community cards only up to the current phase, opponents' hole
  cards hidden until `phase === "showdown"`

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

### Yahtzee

#### POST /api/games/yahtzee/start
Start a Yahtzee round with a flat bet.

**Body**
```
{ "bet": 25 }
```

**Response 200**
```
{
  "state": {
    "bet": 25,
    "inRound": true,
    "phase": "player",
    "rollsLeft": 3,
    "dice": [3, 5, 2, 6, 1],
    "holds": [false, false, false, false, false],
    "playerScores": {
      "ones": null,
      "twos": null,
      "threes": null,
      "fours": null,
      "fives": null,
      "sixes": null,
      "threeKind": null,
      "fourKind": null,
      "fullHouse": null,
      "smallStraight": null,
      "largeStraight": null,
      "yahtzee": null,
      "chance": null
    },
    "dealerScores": {
      "ones": null,
      "twos": null,
      "threes": null,
      "fours": null,
      "fives": null,
      "sixes": null,
      "threeKind": null,
      "fourKind": null,
      "fullHouse": null,
      "smallStraight": null,
      "largeStraight": null,
      "yahtzee": null,
      "chance": null
    }
  },
  "balance": 975
}
```

#### POST /api/games/yahtzee/roll
Roll the dice again, optionally holding some dice.

**Body**
```
{ "holds": [true, false, false, true, false] }
```

**Response 200**
```
{
  "state": {
    "bet": 25,
    "inRound": true,
    "phase": "player",
    "rollsLeft": 2,
    "dice": [3, 1, 4, 6, 2],
    "holds": [true, false, false, true, false],
    "playerScores": {
      "ones": null,
      "twos": null,
      "threes": null,
      "fours": null,
      "fives": null,
      "sixes": null,
      "threeKind": null,
      "fourKind": null,
      "fullHouse": null,
      "smallStraight": null,
      "largeStraight": null,
      "yahtzee": null,
      "chance": null
    },
    "dealerScores": {
      "ones": null,
      "twos": null,
      "threes": null,
      "fours": null,
      "fives": null,
      "sixes": null,
      "threeKind": null,
      "fourKind": null,
      "fullHouse": null,
      "smallStraight": null,
      "largeStraight": null,
      "yahtzee": null,
      "chance": null
    }
  }
}
```

#### POST /api/games/yahtzee/score
Score a category for the player. Dealer will automatically score a category.

**Body**
```
{ "category": "fours" }
```

**Response 200 (round continues)**
```
{
  "state": {
    "bet": 25,
    "inRound": true,
    "phase": "player",
    "rollsLeft": 3,
    "dice": [2, 5, 2, 3, 6],
    "holds": [false, false, false, false, false],
    "playerScores": {
      "ones": null,
      "twos": null,
      "threes": null,
      "fours": 8,
      "fives": null,
      "sixes": null,
      "threeKind": null,
      "fourKind": null,
      "fullHouse": null,
      "smallStraight": null,
      "largeStraight": null,
      "yahtzee": null,
      "chance": null
    },
    "dealerScores": {
      "ones": null,
      "twos": null,
      "threes": null,
      "fours": null,
      "fives": null,
      "sixes": null,
      "threeKind": null,
      "fourKind": null,
      "fullHouse": null,
      "smallStraight": null,
      "largeStraight": null,
      "yahtzee": null,
      "chance": 18
    }
  },
  "messages": [
    { "text": "You scored 8 on fours.", "tone": "win", "duration": 1600 },
    { "text": "Dealer scored 18 on chance.", "tone": "danger", "duration": 1600 }
  ]
}
```

**Response 200 (final reveal)**
```
{
  "state": {
    "bet": 25,
    "inRound": false,
    "phase": "reveal",
    "rollsLeft": 3,
    "dice": [6, 6, 5, 2, 1],
    "holds": [false, false, false, false, false],
    "playerScores": {
      "ones": 3,
      "twos": 6,
      "threes": 9,
      "fours": 8,
      "fives": 20,
      "sixes": 12,
      "threeKind": 0,
      "fourKind": 0,
      "fullHouse": 0,
      "smallStraight": 30,
      "largeStraight": 40,
      "yahtzee": 0,
      "chance": 22
    },
    "dealerScores": {
      "ones": 1,
      "twos": 4,
      "threes": 12,
      "fours": 4,
      "fives": 10,
      "sixes": 18,
      "threeKind": 24,
      "fourKind": 0,
      "fullHouse": 25,
      "smallStraight": 30,
      "largeStraight": 0,
      "yahtzee": 0,
      "chance": 19
    }
  },
  "balance": 1050,
  "messages": [
    { "text": "You scored 22 on chance.", "tone": "win", "duration": 1600 },
    { "text": "Dealer scored 19 on chance.", "tone": "danger", "duration": 1600 },
    { "text": "You win! 150 to 147.", "tone": "win", "duration": 2200 }
  ],
  "result": "win",
  "playerTotal": 150,
  "dealerTotal": 147,
  "payout": 50
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

### Multiplayer Rooms (Blackjack + Hold'em)

These endpoints manage room lifecycle. In-hand actions are sent via WebSocket.

#### GET /api/games/blackjack/rooms
List public Blackjack rooms.

**Response 200**
```
{
  "rooms": [
    {
      "roomId": "bdf926c9",
      "name": "Blackjack Table",
      "host": "Guest aff8",
      "playerCount": 2,
      "maxPlayers": 5,
      "inRound": false,
      "createdAt": "2026-02-13T19:00:00.000Z"
    }
  ]
}
```

#### POST /api/games/blackjack/rooms
Create a Blackjack room.

**Body**
```
{
  "name": "Blackjack Table",
  "public": true,
  "maxPlayers": 5
}
```

**Response 200**
```
{ "roomId": "bdf926c9" }
```

#### GET /api/games/blackjack/rooms/{roomId}/state
Get sanitized Blackjack room state.

**Response 200**
```
{
  "state": {
    "game": "blackjack",
    "roomId": "bdf926c9",
    "hostId": "abc123",
    "players": [],
    "dealer": [],
    "inRound": false,
    "phase": "lobby"
  }
}
```

#### POST /api/games/blackjack/rooms/{roomId}/join
Join a Blackjack room.

**Body**
```
{}
```

**Response 200**
```
{
  "playerId": "4f2d0e18a9bc",
  "state": {
    "game": "blackjack",
    "roomId": "bdf926c9",
    "players": [{ "id": "4f2d0e18a9bc", "username": "Guest aff8" }]
  }
}
```

#### POST /api/games/blackjack/rooms/{roomId}/leave
Leave a Blackjack room.

**Body**
```
{}
```

**Response 200**
```
{
  "playerId": "4f2d0e18a9bc",
  "closed": false,
  "state": {
    "game": "blackjack",
    "roomId": "bdf926c9",
    "players": []
  }
}
```

#### GET /api/games/holdem/rooms
List public Hold'em rooms.

**Response 200**
```
{
  "rooms": [
    {
      "roomId": "d5729b42",
      "name": "Hold'em Table",
      "host": "Guest b482",
      "playerCount": 2,
      "maxPlayers": 6,
      "inRound": true,
      "createdAt": "2026-02-13T19:05:00.000Z"
    }
  ]
}
```

#### POST /api/games/holdem/rooms
Create a Hold'em room.

**Body**
```
{
  "name": "Hold'em Table",
  "public": true,
  "maxPlayers": 6
}
```

**Response 200**
```
{ "roomId": "d5729b42" }
```

#### GET /api/games/holdem/rooms/{roomId}/state
Get sanitized Hold'em room state (viewer-specific hidden cards).

**Response 200**
```
{
  "state": {
    "game": "holdem",
    "roomId": "d5729b42",
    "phase": "preflop",
    "community": [],
    "players": [
      { "id": "p1", "cards": [{ "rank": "A", "suit": "S" }, { "rank": "K", "suit": "D" }] },
      { "id": "p2", "cards": [{ "rank": "?", "suit": "?" }, { "rank": "?", "suit": "?" }] }
    ]
  }
}
```

#### POST /api/games/holdem/rooms/{roomId}/join
Join a Hold'em room.

**Body**
```
{}
```

**Response 200**
```
{
  "playerId": "4f2d0e18a9bc",
  "state": {
    "game": "holdem",
    "roomId": "d5729b42",
    "players": [{ "id": "4f2d0e18a9bc", "username": "Guest b482" }]
  }
}
```

#### POST /api/games/holdem/rooms/{roomId}/leave
Leave a Hold'em room.

**Body**
```
{}
```

**Response 200**
```
{
  "playerId": "4f2d0e18a9bc",
  "closed": false,
  "state": {
    "game": "holdem",
    "roomId": "d5729b42",
    "players": []
  }
}
```

## WebSocket API

### Connect
`GET wss://<ws-id>.execute-api.<region>.amazonaws.com/<stage>?token=<token>`

Stores the connection in DynamoDB and associates it with the user (or "guest").

### Client -> Server messages

Join/leave room:
```
{ "action": "join", "roomId": "bdf926c9" }
{ "action": "leave" }
```

Blackjack room action:
```
{
  "action": "action",
  "payload": { "game": "blackjack", "type": "HIT", "roomId": "bdf926c9" }
}
```
Valid Blackjack `type` values: `BET`, `START`, `HIT`, `STAND`, `DOUBLE`, `SPLIT`.

Hold'em room action:
```
{
  "action": "action",
  "payload": { "game": "holdem", "type": "RAISE", "roomId": "d5729b42", "amount": 10 }
}
```
Valid Hold'em `type` values: `START`, `CHECK`, `CALL`, `RAISE`, `FOLD`.

### Server -> Client messages
```
{ "type": "ROOM_JOINED", "roomId": "bdf926c9" }
{ "type": "ROOM_LEFT" }
{ "type": "BLACKJACK_STATE", "roomId": "bdf926c9", "state": { "...": "..." } }
{ "type": "HOLDEM_STATE", "roomId": "d5729b42", "state": { "...": "..." } }
{ "type": "BALANCE_UPDATE", "balance": 972 }
{ "type": "ERROR", "error": "Not your turn." }
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
