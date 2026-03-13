# Dropbox Automation Server

Lightweight Node.js service intended to run on Vercel's serverless platform. It automates the
creation of Dropbox accounts using guerrillamail temporary emails, performs registration flows
with Puppeteer, and exposes simple HTTP endpoints to drive the process.

## Available Endpoints

All of the routes below are served from `/api/index.js` when deployed to Vercel. Locally they
are reachable at `http://localhost:3000/<route>` after running `npm start` or `npm run dev`.

| Route             | Method | Description                                                                       |
| ----------------- | ------ | --------------------------------------------------------------------------------- |
| `/generate-email` | GET    | Creates a temporary guerrillamail address and returns `email` plus `sid_token`.   |
| `/check-inbox`    | GET    | Requires `sid_token` query param; lists messages in that inbox.                   |
| `/get-otp`        | GET    | Requires `sid_token`; fetches the latest email and extracts a 6‑digit code.       |
| `/register`       | POST   | Takes `{ email }` in JSON body and runs a headless Puppeteer script to register a |
|                   |        | Dropbox account (uses random name and fixed password).                            |

> The server uses Puppeteer so running the registration flow on Vercel may require additional
> configuration (chromium binary, larger function memory, etc.). For local development the
> browser is non‑headless by default for easier debugging.

## Running Locally

```bash
npm install
npm run dev    # nodemon watches for changes
# or
npm start      # plain node server
```

## Deploying to Vercel

1. Install the [Vercel CLI](https://vercel.com/docs/cli) or connect your GitHub repo via the
   Vercel dashboard.
2. Ensure `vercel.json` is present (it already routes all traffic to `api/index.js`).
3. Push to your Git remote and let Vercel build; the `@vercel/node` runtime will pick up
   the Express app via `serverless-http`.

> Note: because the code uses Puppeteer, you may need to bump the function's memory limit and
> enable the `chrome` binary in the environment. See [Vercel docs on the Node.js runtime].

## Configuration

- `PORT` – the local port when running with Express
- `VERCEL` – automatically set by the platform; toggles headless mode in Puppeteer

Happy automating! 🚀
