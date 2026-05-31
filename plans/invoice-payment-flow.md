# Invoice Payment Flow (No Wallet, No L402)

## Problem
Users without Sphinx or a WebLN extension have no way to get an initial L402 token. The current flows all require a browser extension or the Sphinx app to return the payment preimage.

## Existing Boltwall Endpoints
- `POST /buy_lsat` — returns 402 with `www-authenticate` header containing macaroon + invoice
- `GET /preimage?macaroon=<macaroon>` — returns preimage once invoice is paid
- `POST /top_up_lsat` — generates top-up invoice for existing L402
- `POST /top_up_confirm` — confirms top-up payment

## Proposed Flow

1. User clicks "Top Up" with no wallet detected
2. Frontend calls `POST /buy_lsat` with amount
3. Parse macaroon + invoice from `www-authenticate` header
4. Show invoice as QR code (scannable from any Lightning wallet)
5. Poll `GET /preimage?macaroon=<macaroon>` every 3 seconds
6. Once paid, server returns `{ success: true, preimage: "..." }`
7. Store `L402 macaroon:preimage` in localStorage
8. User is fully authenticated — no extension needed

## UX Questions (Unresolved)
- Should we show the raw L402 token to the user? They'd need it if they clear localStorage
- Should there be a way to paste/import an L402 token?
- How do we communicate that the token lives in localStorage and is session-tied?
- For CLI/agent users: they manage their own L402s, this flow is humans-only

## What's Already Built
- Multi-step budget modal with QR code support (qrcode.react installed)
- `topUpLsat()` and `topUpConfirm()` API functions in `src/lib/sphinx/payment.ts`
- Manual top-up flow for users who already have an L402

## What's Needed
- Frontend: Add buy_lsat QR flow to the "no wallet, no L402" state in budget modal
- Frontend: Poll `/preimage` endpoint instead of `/balance` for initial purchase
- No backend changes — all endpoints already exist
