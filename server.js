require("dotenv").config();
const express = require("express");
const cors    = require("cors");
const fetch   = require("node-fetch");

const app  = express();
const PORT = process.env.PORT || 3001;
const DUFFEL_TOKEN = process.env.DUFFEL_TOKEN;
const DUFFEL_BASE  = "https://api.duffel.com";

// ── CORS ──────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "*").split(",").map(o => o.trim());
app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (e.g. mobile apps, curl, Postman)
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
      return cb(null, true);
    }
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

app.use(express.json());

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ── Helper: forward a request to Duffel ──────────────────────────────────────
async function duffelRequest(method, path, body) {
  const url = `${DUFFEL_BASE}${path}`;
  const options = {
    method,
    headers: {
      "Content-Type":   "application/json",
      "Accept":         "application/json",
      "Duffel-Version": "v2",
      "Authorization":  `Bearer ${DUFFEL_TOKEN}`,
    },
  };
  if (body) options.body = JSON.stringify(body);

  const res  = await fetch(url, options);
  const json = await res.json();
  return { status: res.status, json };
}

// ── POST /search ──────────────────────────────────────────────────────────────
// Body: { from, to, depDate, retDate?, passengers, cabinClass, preferredAirline? }
app.post("/search", async (req, res) => {
  const { from, to, depDate, retDate, passengers = 1, cabinClass = "economy", preferredAirline } = req.body;

  if (!from || !to || !depDate) {
    return res.status(400).json({ error: "from, to and depDate are required" });
  }

  // Build slices
  const slices = [{ origin: from, destination: to, departure_date: depDate }];
  if (retDate) slices.push({ origin: to, destination: from, departure_date: retDate });

  // Build passengers
  const paxArr = Array.from({ length: parseInt(passengers) }, () => ({ type: "adult" }));

  const offerRequestBody = {
    data: {
      slices,
      passengers: paxArr,
      cabin_class: cabinClass,
    },
  };

  try {
    // 1. Create offer request
    const { status, json } = await duffelRequest(
      "POST",
      "/air/offer_requests?return_offers=true&supplier_timeout=15000",
      offerRequestBody
    );

    if (status !== 201 && status !== 200) {
      return res.status(status).json({ error: json?.errors?.[0]?.message || "Duffel error", raw: json });
    }

    let offers = json?.data?.offers || [];

    // 2. Filter by preferred airline IATA code
    const airlineMap = {
      "British Airways":    "BA",
      "Singapore Airlines": "SQ",
      "Emirates":           "EK",
      "Qatar Airways":      "QR",
      "Scoot":              "TR",
    };

    if (preferredAirline && preferredAirline !== "any" && airlineMap[preferredAirline]) {
      const iata = airlineMap[preferredAirline];
      offers = offers.filter(o =>
        o.slices?.some(s =>
          s.segments?.some(seg =>
            seg.operating_carrier?.iata_code === iata ||
            seg.marketing_carrier?.iata_code === iata
          )
        )
      );
    }

    // 3. Sort cheapest first, return top 5
    offers.sort((a, b) => parseFloat(a.total_amount) - parseFloat(b.total_amount));
    const top = offers.slice(0, 5);

    // 4. Shape response — only what the frontend needs
    const shaped = top.map(offer => {
      const slice  = offer.slices?.[0];
      const seg    = slice?.segments?.[0];
      const retSlice = offer.slices?.[1];
      const retSeg   = retSlice?.segments?.[0];

      return {
        id:            offer.id,
        totalAmount:   offer.total_amount,
        totalCurrency: offer.total_currency,
        expiresAt:     offer.expires_at,
        outbound: {
          airline:      seg?.marketing_carrier?.name || seg?.operating_carrier?.name || "Unknown",
          airlineIata:  seg?.marketing_carrier?.iata_code || seg?.operating_carrier?.iata_code,
          flightNumber: seg ? `${seg.marketing_carrier?.iata_code || ""}${seg.marketing_carrier_flight_number || ""}` : null,
          departingAt:  seg?.departing_at,
          arrivingAt:   seg?.arriving_at,
          origin:       seg?.origin?.iata_code,
          destination:  seg?.destination?.iata_code,
          cabinClass:   seg?.passengers?.[0]?.cabin_class_marketing_name,
          stops:        (slice?.segments?.length || 1) - 1,
        },
        inbound: retSeg ? {
          airline:      retSeg?.marketing_carrier?.name || retSeg?.operating_carrier?.name,
          flightNumber: retSeg ? `${retSeg.marketing_carrier?.iata_code || ""}${retSeg.marketing_carrier_flight_number || ""}` : null,
          departingAt:  retSeg?.departing_at,
          arrivingAt:   retSeg?.arriving_at,
        } : null,
      };
    });

    return res.json({ offers: shaped, total: shaped.length });

  } catch (err) {
    console.error("Proxy error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── GET /offer/:id — fetch a single up-to-date offer before booking ───────────
app.get("/offer/:id", async (req, res) => {
  try {
    const { status, json } = await duffelRequest("GET", `/air/offers/${req.params.id}`);
    return res.status(status).json(json);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✈  Flight proxy running on http://localhost:${PORT}`);
  console.log(`   Health:  GET  http://localhost:${PORT}/health`);
  console.log(`   Search:  POST http://localhost:${PORT}/search`);
  console.log(`   Duffel token: ${DUFFEL_TOKEN ? DUFFEL_TOKEN.slice(0, 20) + "..." : "NOT SET"}\n`);
});
