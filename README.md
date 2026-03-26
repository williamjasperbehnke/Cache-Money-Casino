# Cache Money Casino

Cache Money Casino is a browser-based casino app with:

- Static frontend pages in `frontend/`
- Serverless backend handlers in `backend-lambda/` (HTTP + WebSocket)
- Terraform infrastructure in `infra/terraform/` for S3 + CloudFront + API Gateway + Lambda + DynamoDB

## Site

The site is currently deployed and accessible at [https://d1o5baixe6es5t.cloudfront.net](https://d1o5baixe6es5t.cloudfront.net)

## Games

- Singleplayer: Roulette, Slots, Craps, Yahtzee, 5-Card Poker, Memory
- Multiplayer: Blackjack, Texas Hold'em

## Project Structure

```text
.
├── frontend/           # HTML/CSS/JS game UI
├── backend-lambda/     # Lambda handlers, game logic, backend tests
├── infra/terraform/    # AWS infrastructure (modules + root stack)
├── docs/API.md         # API and WebSocket contract
└── scripts/dev-local.sh
```

## Prerequisites

- Node.js 18+ and npm
- Docker (for local DynamoDB in `scripts/dev-local.sh`)
- AWS CLI (used by `scripts/dev-local.sh` to create/check local DynamoDB table)
- Terraform 1.4+ (for infrastructure provisioning)

## Install

```sh
npm install
```

## Run Locally

Start local frontend + local DynamoDB helper script:

```sh
bash scripts/dev-local.sh
```

Notes:

- The script serves `frontend/` on port `8080` by default.
- It writes `frontend/js/config.js` with `window.API_BASE`.
- It does **not** start a local backend Lambda emulator; it expects an API endpoint (for example, the deployed AWS API).

### Frontend-Only Quick Run

```sh
cd frontend
python3 -m http.server 8080
```

## API Reference

- Full HTTP + WebSocket contract: [docs/API.md](docs/API.md)

## Testing

Run all tests:

```sh
npm test
```

Other useful targets:

```sh
npm run test:backend
npm run test:e2e
npm run test:coverage
```

## Deploy Infrastructure (AWS)

```sh
cd infra/terraform
terraform init
terraform apply -var="bucket_name=your-unique-bucket-name"
```

For custom domain setup and more details, see [infra/terraform/README.md](infra/terraform/README.md).

## Backend Overview

Backend handlers in `backend-lambda/` include:

- `auth.js` for register/login/guest auth
- `account.js` for profile/balance/stats
- `game.js` for game endpoints and room lifecycle
- `ws_connect.js`, `ws_message.js`, `ws_disconnect.js` for WebSocket flow

Game engines live under `backend-lambda/game/`.

## Notes

- `infra/terraform/README.md` mentions a `deploy.sh` uploader script, but no `deploy.sh` currently exists in this repository.
- `package.json` references `vitest.frontend.config.js`, but that file is not currently present.
