// Wear4Weather: stylist + 6-hour weather analysis.
// Geocoding: api.zippopotam.us (free, no key, US ZIPs)
// Weather:   api.open-meteo.com (free, no key)

const form = document.getElementById("zip-form");
const zipInput = document.getElementById("zip");
const goBtn = document.getElementById("go-btn");
const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");
const placeEl = document.getElementById("place");
const nowEl = document.getElementById("now");
const summaryEl = document.getElementById("summary");
const outfitEl = document.getElementById("outfit");
const mustHavesEl = document.getElementById("must-haves");
const tipEl = document.getElementById("tip");
const forecastTbody = document.querySelector("#forecast-table tbody");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const zip = zipInput.value.trim();
  if (!/^\d{5}$/.test(zip)) {
    setStatus("Please enter a valid 5-digit US ZIP code.", true);
    return;
  }
  await runStylist(zip);
});

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle("error", isError);
}

async function runStylist(zip) {
  goBtn.disabled = true;
  resultEl.hidden = true;
  setStatus("Looking up location…");
  try {
    const place = await geocodeZip(zip);
    setStatus(`Fetching forecast for ${place.city}, ${place.state}…`);
    const forecast = await fetchForecast(place.lat, place.lon);
    const analysis = analyze(forecast);
    render(place, forecast, analysis);
    setStatus("");
  } catch (err) {
    console.error(err);
    setStatus(err.message || "Something went wrong. Try again.", true);
  } finally {
    goBtn.disabled = false;
  }
}

async function geocodeZip(zip) {
  const res = await fetch(`https://api.zippopotam.us/us/${zip}`);
  if (res.status === 404) throw new Error(`ZIP ${zip} not found.`);
  if (!res.ok) throw new Error(`Geocoding failed (${res.status}).`);
  const data = await res.json();
  const p = data.places && data.places[0];
  if (!p) throw new Error(`No place data for ZIP ${zip}.`);
  return {
    zip,
    city: p["place name"],
    state: p["state abbreviation"],
    lat: parseFloat(p.latitude),
    lon: parseFloat(p.longitude),
  };
}

async function fetchForecast(lat, lon) {
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    hourly:
      "temperature_2m,relative_humidity_2m,precipitation_probability,precipitation,weathercode,wind_speed_10m",
    current:
      "temperature_2m,relative_humidity_2m,precipitation,weathercode,wind_speed_10m",
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    precipitation_unit: "inch",
    timezone: "auto",
    forecast_days: 2,
  });
  const url = `https://api.open-meteo.com/v1/forecast?${params}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Weather fetch failed (${res.status}).`);
  const data = await res.json();

  // Slice the next 6 hours starting at the current local hour.
  const nowIso = data.current?.time;
  const times = data.hourly.time;
  let startIdx = times.indexOf(nowIso);
  if (startIdx === -1) {
    // Fall back: find the first hour >= now.
    const nowMs = Date.now();
    startIdx = times.findIndex((t) => new Date(t).getTime() >= nowMs);
    if (startIdx === -1) startIdx = 0;
  }
  const endIdx = Math.min(startIdx + 6, times.length);
  const slice = (arr) => arr.slice(startIdx, endIdx);

  const hours = slice(times).map((t, i) => ({
    time: t,
    tempF: data.hourly.temperature_2m[startIdx + i],
    humidity: data.hourly.relative_humidity_2m[startIdx + i],
    precipPct: data.hourly.precipitation_probability?.[startIdx + i] ?? 0,
    precipIn: data.hourly.precipitation?.[startIdx + i] ?? 0,
    weathercode: data.hourly.weathercode[startIdx + i],
    windMph: data.hourly.wind_speed_10m[startIdx + i],
  }));

  return {
    timezone: data.timezone,
    current: {
      tempF: data.current.temperature_2m,
      humidity: data.current.relative_humidity_2m,
      windMph: data.current.wind_speed_10m,
      weathercode: data.current.weathercode,
      time: data.current.time,
    },
    hours,
  };
}

// Map Open-Meteo WMO weathercodes to a precipitation type.
function precipType(code) {
  if (code == null) return null;
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "snow";
  if ([51, 53, 55, 56, 57].includes(code)) return "drizzle";
  if ([61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(code)) return "rain";
  return null;
}

function analyze(forecast) {
  const hours = forecast.hours;
  const temps = hours.map((h) => h.tempF);
  const current = forecast.current.tempF;
  const high = Math.max(...temps, current);
  const low = Math.min(...temps, current);
  const avgHumidity =
    hours.reduce((s, h) => s + (h.humidity ?? 0), 0) / hours.length;
  const maxPrecipPct = Math.max(...hours.map((h) => h.precipPct ?? 0));
  const maxWind = Math.max(...hours.map((h) => h.windMph ?? 0));

  // Dominant precip type across the window.
  const precipCounts = {};
  for (const h of hours) {
    const t = precipType(h.weathercode);
    if (t) precipCounts[t] = (precipCounts[t] || 0) + 1;
  }
  const dominantPrecip =
    Object.entries(precipCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  // Temperature drop over the 6-hour window.
  const tempDrop = temps[0] - temps[temps.length - 1];

  // Comfort zone (°F).
  let zone, baseOutfit, vibe;
  if (current < 32) {
    zone = "extreme-cold";
    vibe = "Bone-chilling cold — bundle up like you mean it.";
    baseOutfit =
      "Heavy parka over thermal base layers, insulated pants, wool socks, sturdy winter boots, gloves, and a scarf.";
  } else if (current < 50) {
    zone = "cold";
    vibe = "Cold and crisp — layering weather.";
    baseOutfit =
      "A heavy coat or mid-weight jacket over a sweater or hoodie, long pants, and closed-toe boots or sneakers.";
  } else if (current < 60) {
    zone = "cool";
    vibe = "Cool with a bite — jacket vibes.";
    baseOutfit =
      "A light-to-medium jacket or thick sweater with jeans/chinos and sneakers.";
  } else if (current < 70) {
    zone = "mild";
    vibe = "Mild and easy — perfect transitional weather.";
    baseOutfit =
      "Long sleeves or a light cardigan/windbreaker over a tee, with pants and casual shoes.";
  } else if (current < 80) {
    zone = "warm";
    vibe = "Warm and pleasant — t-shirt territory.";
    baseOutfit =
      "T-shirt with light pants or shorts and breathable sneakers or canvas shoes.";
  } else {
    zone = "hot";
    vibe = "Hot — keep it loose and breathable.";
    baseOutfit =
      "Loose linen or cotton shirt, shorts or a breezy skirt, sandals or breathable sneakers, and sunglasses.";
  }

  // Humidity Factor.
  const humidityNotes = [];
  if (avgHumidity > 70 && current > 75) {
    humidityNotes.push(
      "It's humid — lean into moisture-wicking fabrics and loose-fitting cuts to dodge the sticky feeling."
    );
  }
  if (avgHumidity < 30 && current < 50) {
    humidityNotes.push(
      "Air is dry and cold — pack lip balm and moisturizer to protect your skin."
    );
  }

  // Precipitation Logic.
  const mustHaves = [];
  let precipNote = null;
  const precipLabel = dominantPrecip || "rain";
  if (maxPrecipPct >= 50) {
    precipNote = `High chance of ${precipLabel} (${maxPrecipPct}%) — make a waterproof raincoat your primary outer layer and wear waterproof footwear.`;
    mustHaves.push("Waterproof raincoat or shell");
    mustHaves.push(
      precipLabel === "snow" ? "Waterproof snow boots" : "Waterproof shoes/boots"
    );
  } else if (maxPrecipPct >= 30) {
    precipNote = `${maxPrecipPct}% chance of ${precipLabel} — carry an umbrella or stash a light rain shell just in case.`;
    mustHaves.push("Compact umbrella or packable rain shell");
  }

  // 6-Hour Rule (adaptable layers).
  let layerNote = null;
  if (tempDrop > 10) {
    layerNote = `Temps drop about ${Math.round(
      tempDrop
    )}°F over the next 6 hours — go with adaptable layers you can add as it cools off.`;
  } else if (tempDrop < -10) {
    layerNote = `Temps climb about ${Math.round(
      Math.abs(tempDrop)
    )}°F over the next 6 hours — start with a jacket you can shed by midday.`;
  }

  // Wind callout.
  if (maxWind >= 20 && zone !== "hot") {
    mustHaves.push("Wind-resistant outer layer");
  }

  // Sun callout.
  if (zone === "warm" || zone === "hot") {
    mustHaves.push("Sunglasses");
    if (zone === "hot") mustHaves.push("Sunscreen / wide-brim hat");
  }

  // Cold accessories.
  if (zone === "extreme-cold") {
    mustHaves.push("Insulated gloves", "Wool scarf", "Warm beanie");
  } else if (zone === "cold") {
    mustHaves.push("Gloves", "Beanie or knit hat");
  }

  // Compose the summary.
  const summary = `${vibe} Highs near ${Math.round(high)}°F, lows around ${Math.round(
    low
  )}°F over the next 6 hours.`;

  // Compose outfit + notes.
  const outfitParts = [baseOutfit];
  if (precipNote) outfitParts.push(precipNote);
  if (layerNote) outfitParts.push(layerNote);
  const outfit = outfitParts.join(" ");

  // Style tip.
  let tip;
  if (humidityNotes.length) {
    tip = humidityNotes.join(" ");
  } else if (zone === "extreme-cold" || zone === "cold") {
    tip =
      "Layer with intention: a moisture-wicking base, an insulating mid-layer, and a wind/water-resistant shell beats one bulky coat.";
  } else if (zone === "cool" || zone === "mild") {
    tip =
      "Pick one statement layer — a textured cardigan, denim jacket, or windbreaker — to anchor an otherwise simple fit.";
  } else if (zone === "warm") {
    tip =
      "Stick with breathable cotton or linen blends, and keep colors light to reflect the sun.";
  } else {
    tip =
      "Loose silhouettes and natural fibers (linen, cotton gauze) keep airflow up and the sticky factor down.";
  }
  if (maxWind >= 15 && zone !== "hot") {
    tip += ` Winds up to ${Math.round(maxWind)} mph — snug cuffs and a zip-up will hold their shape.`;
  }

  // De-dupe must-haves.
  const seen = new Set();
  const dedupedMustHaves = mustHaves.filter((m) => {
    const k = m.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return {
    summary,
    outfit,
    mustHaves: dedupedMustHaves.slice(0, 5),
    tip,
    stats: { high, low, avgHumidity, maxPrecipPct, maxWind, dominantPrecip },
  };
}

function render(place, forecast, analysis) {
  placeEl.textContent = `${place.city}, ${place.state} ${place.zip}`;
  const c = forecast.current;
  nowEl.textContent = `Now: ${Math.round(c.tempF)}°F · ${Math.round(
    c.humidity
  )}% humidity · wind ${Math.round(c.windMph)} mph`;

  summaryEl.textContent = analysis.summary;
  outfitEl.textContent = analysis.outfit;
  tipEl.textContent = analysis.tip;

  mustHavesEl.innerHTML = "";
  if (analysis.mustHaves.length === 0) {
    const li = document.createElement("li");
    li.textContent = "Nothing extra needed — you're set.";
    mustHavesEl.appendChild(li);
  } else {
    for (const item of analysis.mustHaves) {
      const li = document.createElement("li");
      li.textContent = item;
      mustHavesEl.appendChild(li);
    }
  }

  forecastTbody.innerHTML = "";
  for (const h of forecast.hours) {
    const tr = document.createElement("tr");
    const time = new Date(h.time).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
    tr.innerHTML = `
      <td>${time}</td>
      <td>${Math.round(h.tempF)}</td>
      <td>${Math.round(h.humidity)}%</td>
      <td>${Math.round(h.precipPct)}%</td>
      <td>${Math.round(h.windMph)}</td>
    `;
    forecastTbody.appendChild(tr);
  }

  resultEl.hidden = false;
}

// Convenience: prefill with the example ZIP if URL has ?zip=
const params = new URLSearchParams(location.search);
const initialZip = params.get("zip");
if (initialZip && /^\d{5}$/.test(initialZip)) {
  zipInput.value = initialZip;
  runStylist(initialZip);
}
