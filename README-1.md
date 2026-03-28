# FlightAgent Proxy

Node.js/Express proxy that sits between your React frontend and the Duffel API.
Keeps your API token secure on the server side and handles CORS.

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
Edit `.env` — your Duffel token is already set. Update `ALLOWED_ORIGINS` for production:
```
DUFFEL_TOKEN=duffel_test_...
PORT=3001
ALLOWED_ORIGINS=https://yourapp.com
```

### 3. Run
```bash
# Development (auto-restarts on change)
npm run dev

# Production
npm start
```

The proxy starts at **http://localhost:3001**

---

## Endpoints

### `GET /health`
Returns `{ status: "ok" }` — use for uptime monitoring.

### `POST /search`
Search for flights via Duffel.

**Request body:**
```json
{
  "from": "SIN",
  "to": "LHR",
  "depDate": "2025-09-01",
  "retDate": "2025-09-15",
  "passengers": 1,
  "cabinClass": "economy",
  "preferredAirline": "Singapore Airlines"
}
```

**`cabinClass` values:** `economy` · `premium_economy` · `business` · `first`

**`preferredAirline` values:** `any` · `British Airways` · `Singapore Airlines` · `Emirates` · `Qatar Airways` · `Scoot`

**Response:**
```json
{
  "offers": [
    {
      "id": "off_...",
      "totalAmount": "850.00",
      "totalCurrency": "GBP",
      "expiresAt": "2025-...",
      "outbound": {
        "airline": "Singapore Airlines",
        "airlineIata": "SQ",
        "flightNumber": "SQ317",
        "departingAt": "2025-09-01T23:55:00",
        "arrivingAt": "2025-09-02T06:10:00",
        "origin": "SIN",
        "destination": "LHR",
        "cabinClass": "Economy",
        "stops": 0
      },
      "inbound": { ... }
    }
  ],
  "total": 3
}
```

### `GET /offer/:id`
Fetches a single up-to-date offer from Duffel (prices can change — always refresh before booking).

---

## Frontend Integration

In your React app, replace the Duffel direct call with:

```js
const res = await fetch("http://localhost:3001/search", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    from: "SIN", to: "LHR",
    depDate: "2025-09-01",
    passengers: 1,
    cabinClass: "economy",
    preferredAirline: "any",
  }),
});
const data = await res.json();
// data.offers = array of shaped flight offers
```

---

## Deploying to Production

### Railway (easiest — free tier available)
1. Push this folder to a GitHub repo
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Add environment variables in Railway dashboard (copy from `.env`)
4. Railway gives you a public URL — update `ALLOWED_ORIGINS` to your frontend URL

### Render
1. Push to GitHub
2. [render.com](https://render.com) → New Web Service → connect repo
3. Set start command: `node server.js`
4. Add env vars in Render dashboard

### Fly.io
```bash
npm install -g flyctl
flyctl launch
flyctl secrets set DUFFEL_TOKEN=duffel_test_...
flyctl deploy
```

---

## Going Live

1. Get a live Duffel token from your Duffel dashboard
2. Update `.env`: `DUFFEL_TOKEN=duffel_live_...`
3. Update `ALLOWED_ORIGINS` to your production frontend URL
4. Redeploy
