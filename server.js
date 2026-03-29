require("dotenv").config();
const express = require("express");
const fetch   = require("node-fetch");
 
const app          = express();
const PORT         = process.env.PORT || 3001;
const DUFFEL_TOKEN = process.env.DUFFEL_TOKEN;
const DUFFEL_BASE  = "https://api.duffel.com";
 
// Hardcoded CORS — works on all platforms
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin",  "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header("Access-Control-Max-Age",       "86400");
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  next();
});
 
app.use(express.json());
 
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});
 
app.post("/search", async (req, res) => {
  const { from, to, depDate, retDate, passengers = 1, cabinClass = "economy", preferredAirline } = req.body;
 
  if (!from || !to || !depDate) {
    return res.status(400).json({ error: "from, to and depDate are required" });
  }
 
  const slices = [{ origin: from, destination: to, departure_date: depDate }];
  if (retDate) slices.push({ origin: to, destination: from, departure_date: retDate });
  const paxArr = Array.from({ length: parseInt(passengers) }, () => ({ type: "adult" }));
 
  try {
    const duffelRes = await fetch(
      `${DUFFEL_BASE}/air/offer_requests?return_offers=true&supplier_timeout=6000`,
      {
        method: "POST",
        headers: {
          "Content-Type":   "application/json",
          "Accept":         "application/json",
          "Duffel-Version": "v2",
          "Authorization":  `Bearer ${DUFFEL_TOKEN}`,
        },
        body: JSON.stringify({ data: { slices, passengers: paxArr, cabin_class: cabinClass } }),
      }
    );
 
    const json = await duffelRes.json();
 
    if (!duffelRes.ok) {
      return res.status(duffelRes.status).json({ error: json?.errors?.[0]?.message || "Duffel error" });
    }
 
    let offers = json?.data?.offers || [];
 
    const airlineIataMap = {
      "British Airways":    "BA",
      "Singapore Airlines": "SQ",
      "Emirates":           "EK",
      "Qatar Airways":      "QR",
      "Scoot":              "TR",
    };
 
    if (preferredAirline && preferredAirline !== "any" && airlineIataMap[preferredAirline]) {
      const iata = airlineIataMap[preferredAirline];
      offers = offers.filter(o =>
        o.slices?.some(s => s.segments?.some(seg =>
          seg.operating_carrier?.iata_code === iata || seg.marketing_carrier?.iata_code === iata
        ))
      );
    }
 
    offers.sort((a, b) => parseFloat(a.total_amount) - parseFloat(b.total_amount));
 
    const shaped = offers.slice(0, 5).map(offer => {
      const seg    = offer.slices?.[0]?.segments?.[0];
      const retSeg = offer.slices?.[1]?.segments?.[0];
      return {
        id:            offer.id,
        totalAmount:   offer.total_amount,
        totalCurrency: offer.total_currency,
        outbound: {
          airline:      seg?.marketing_carrier?.name || seg?.operating_carrier?.name || "Unknown",
          airlineIata:  seg?.marketing_carrier?.iata_code || seg?.operating_carrier?.iata_code,
          flightNumber: seg ? `${seg.marketing_carrier?.iata_code || ""}${seg.marketing_carrier_flight_number || ""}` : null,
          departingAt:  seg?.departing_at,
          arrivingAt:   seg?.arriving_at,
          cabinClass:   seg?.passengers?.[0]?.cabin_class_marketing_name,
          stops:        (offer.slices?.[0]?.segments?.length || 1) - 1,
        },
        inbound: retSeg ? {
          airline:      retSeg?.marketing_carrier?.name || retSeg?.operating_carrier?.name,
          flightNumber: `${retSeg?.marketing_carrier?.iata_code || ""}${retSeg?.marketing_carrier_flight_number || ""}`,
          departingAt:  retSeg?.departing_at,
        } : null,
      };
    });
 
    return res.json({ offers: shaped, total: shaped.length });
 
  } catch (err) {
    console.error("Error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});
 
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✈ Proxy running on port ${PORT}`);
  console.log(`  Token: ${DUFFEL_TOKEN ? DUFFEL_TOKEN.slice(0,22) + "..." : "NOT SET"}`);
});
 
