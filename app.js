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
const sceneCanvas = document.getElementById("scene");
const sceneCaption = document.getElementById("scene-caption");

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
    zone,
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
  renderScene(forecast, analysis);
}

// ---------------------------------------------------------------------------
// 8-bit scene: a pixel character dressed for the weather, on a 64x64 canvas.
// ---------------------------------------------------------------------------

const SCENE_W = 64;
const SCENE_H = 64;
const GROUND_Y = 57;
const COLORS = {
  ink: "#0f0f1b",
  skin: "#eec39a",
  hair: "#5d275d",
  white: "#f4f4f4",
  red: "#b13e53",
  yellow: "#ffcd75",
  green: "#38b764",
  blue: "#3b5dc9",
  lightBlue: "#41a6f6",
  navy: "#333c57",
  gray: "#94b0c2",
  brown: "#7a4841",
};

let sceneRaf = null;
const reduceMotion =
  window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Decide what the character wears from the analysis.
function outfitFor(analysis) {
  const { zone, stats } = analysis;
  const o = {
    top: COLORS.blue,
    sleeves: "long",
    legs: "pants",
    pants: COLORS.navy,
    shoes: COLORS.brown,
    bootsTall: false,
    hat: null, // null | "beanie" | "brim" | "hood"
    hatColor: COLORS.red,
    scarf: false,
    gloves: false,
    sunglasses: false,
    umbrella: false,
    caption: "",
  };

  switch (zone) {
    case "extreme-cold":
      o.top = COLORS.red;
      o.hat = "beanie";
      o.hatColor = COLORS.yellow;
      o.scarf = true;
      o.gloves = true;
      o.bootsTall = true;
      o.shoes = COLORS.ink;
      o.caption = "FULL WINTER ARMOR EQUIPPED";
      break;
    case "cold":
      o.top = COLORS.green;
      o.hat = "beanie";
      o.gloves = true;
      o.caption = "HEAVY COAT EQUIPPED";
      break;
    case "cool":
      o.top = COLORS.blue;
      o.caption = "LIGHT JACKET EQUIPPED";
      break;
    case "mild":
      o.top = COLORS.lightBlue;
      o.caption = "LONG SLEEVES EQUIPPED";
      break;
    case "warm":
      o.top = COLORS.green;
      o.sleeves = "short";
      o.legs = "shorts";
      o.sunglasses = true;
      o.caption = "TEE + SHORTS EQUIPPED";
      break;
    default: // hot
      o.top = COLORS.white;
      o.sleeves = "short";
      o.legs = "shorts";
      o.pants = COLORS.lightBlue;
      o.sunglasses = true;
      o.hat = "brim";
      o.hatColor = COLORS.yellow;
      o.caption = "SUN GEAR EQUIPPED";
  }

  if (stats.maxPrecipPct >= 50) {
    // Rain slicker overrides the outer layer.
    o.top = COLORS.yellow;
    o.sleeves = "long";
    o.hat = "hood";
    o.hatColor = COLORS.yellow;
    o.sunglasses = false;
    o.bootsTall = true;
    o.shoes = COLORS.green;
    o.umbrella = true;
    o.caption =
      stats.dominantPrecip === "snow"
        ? "SNOW SHIELD EQUIPPED"
        : "RAIN SLICKER EQUIPPED";
  } else if (stats.maxPrecipPct >= 30) {
    o.umbrella = true;
    o.caption += " +UMBRELLA";
  }

  return o;
}

function buildSceneState(forecast, analysis) {
  const code = forecast.current.weathercode;
  const hour = new Date(forecast.current.time).getHours();
  const night = hour < 6 || hour >= 20;
  const precip = precipType(code);
  const cloudy = [2, 3, 45, 48].includes(code) || precip != null;
  const foggy = [45, 48].includes(code);
  const storm = [95, 96, 99].includes(code);
  const windSlant = Math.min(forecast.current.windMph / 15, 2);
  const snowGround =
    precip === "snow" || analysis.stats.dominantPrecip === "snow";

  // Falling weather particles.
  const particles = [];
  const count = precip === "snow" ? 28 : precip === "drizzle" ? 16 : precip ? 36 : 0;
  for (let i = 0; i < count; i++) {
    particles.push({
      x: Math.random() * SCENE_W,
      y: Math.random() * SCENE_H,
      speed: precip === "snow" ? 0.25 + Math.random() * 0.25 : 1.2 + Math.random(),
      drift: Math.random() * Math.PI * 2,
    });
  }

  return {
    outfit: outfitFor(analysis),
    night,
    precip,
    cloudy,
    foggy,
    storm,
    windSlant,
    snowGround,
    particles,
  };
}

function renderScene(forecast, analysis) {
  if (!sceneCanvas) return;
  const state = buildSceneState(forecast, analysis);
  sceneCaption.textContent = state.outfit.caption;

  const ctx = sceneCanvas.getContext("2d");
  if (sceneRaf) cancelAnimationFrame(sceneRaf);
  if (reduceMotion) {
    drawFrame(ctx, state, 0);
    return;
  }
  let frame = 0;
  const loop = () => {
    drawFrame(ctx, state, frame++);
    sceneRaf = requestAnimationFrame(loop);
  };
  loop();
}

function drawFrame(ctx, state, frame) {
  const px = (x, y, w, h, c) => {
    ctx.fillStyle = c;
    ctx.fillRect(Math.round(x), Math.round(y), w, h);
  };

  // Sky
  px(0, 0, SCENE_W, SCENE_H, state.night ? "#10122b" : state.cloudy ? "#5a6988" : "#41a6f6");

  if (state.night) {
    // Stars (skip when overcast) + moon
    if (!state.cloudy) {
      const stars = [[6, 8], [18, 4], [30, 10], [44, 6], [56, 12], [12, 16], [50, 20]];
      stars.forEach(([x, y], i) => {
        if ((frame >> 5) % 2 === i % 2) px(x, y, 1, 1, COLORS.white);
      });
      px(48, 5, 8, 8, COLORS.yellow);
      px(46, 7, 2, 4, COLORS.yellow);
      px(50, 7, 4, 4, "#10122b"); // crescent bite
    }
  } else if (!state.cloudy) {
    // Sun with blinking rays
    px(7, 7, 8, 8, COLORS.yellow);
    px(9, 5, 4, 12, COLORS.yellow);
    px(5, 9, 12, 4, COLORS.yellow);
    if ((frame >> 4) % 2 === 0) {
      px(3, 10, 2, 2, COLORS.yellow);
      px(17, 10, 2, 2, COLORS.yellow);
      px(10, 3, 2, 2, COLORS.yellow);
      px(10, 17, 2, 2, COLORS.yellow);
    }
  }

  if (state.cloudy) {
    const drift = reduceMotion ? 0 : Math.floor(frame / 12) % (SCENE_W + 24);
    drawCloud(px, ((8 + drift) % (SCENE_W + 24)) - 12, 6, state.night);
    drawCloud(px, ((40 + drift) % (SCENE_W + 24)) - 12, 14, state.night);
  }

  // Lightning flash
  if (state.storm && frame % 160 < 6) {
    px(0, 0, SCENE_W, SCENE_H, "rgba(255,255,255,0.35)");
    px(12, 0, 3, 14, COLORS.yellow);
    px(9, 14, 3, 10, COLORS.yellow);
    px(12, 24, 3, 8, COLORS.yellow);
  }

  // Ground
  px(0, GROUND_Y, SCENE_W, SCENE_H - GROUND_Y, state.snowGround ? COLORS.white : state.night ? "#1e3a2f" : COLORS.green);
  px(0, GROUND_Y, SCENE_W, 1, state.snowGround ? COLORS.gray : "#2a8a4a");

  drawCharacter(px, state.outfit, frame);

  // Fog overlay
  if (state.foggy) {
    for (let y = 18; y < 54; y += 8) {
      const off = reduceMotion ? 0 : Math.floor(frame / 8 + y) % 16;
      px(0, y + (off > 8 ? 1 : 0), SCENE_W, 3, "rgba(244,244,244,0.25)");
    }
  }

  // Precipitation particles
  for (const p of state.particles) {
    if (!reduceMotion) {
      p.y += p.speed;
      if (state.precip === "snow") {
        p.x += Math.sin((frame + p.drift * 60) / 20) * 0.3 + state.windSlant * 0.2;
      } else {
        p.x += state.windSlant * 0.4;
      }
      if (p.y > GROUND_Y) {
        p.y = -2;
        p.x = Math.random() * SCENE_W;
      }
      if (p.x > SCENE_W) p.x -= SCENE_W;
    }
    if (state.precip === "snow") {
      px(p.x, p.y, 1, 1, COLORS.white);
    } else {
      px(p.x, p.y, 1, 2, COLORS.lightBlue);
    }
  }
}

function drawCloud(px, x, y, night) {
  const c = night ? "#3a4466" : "#dfe9f5";
  px(x + 2, y + 2, 16, 4, c);
  px(x + 5, y, 8, 2, c);
  px(x, y + 4, 20, 2, c);
}

// The character: drawn around x=19..45, standing on the ground line.
function drawCharacter(px, o, frame) {
  const bob = reduceMotion ? 0 : (frame >> 4) % 2; // idle animation
  const y = (v) => v + bob;

  // Umbrella (behind the body)
  if (o.umbrella) {
    px(43, y(12), 2, 28, COLORS.navy); // pole
    px(40, y(6), 8, 2, COLORS.red);
    px(36, y(8), 16, 2, COLORS.red);
    px(33, y(10), 22, 2, COLORS.red);
    px(33, y(12), 22, 1, "#7d2a3b");
  }

  // Legs
  if (o.legs === "shorts") {
    px(25, y(42), 6, 5, o.pants);
    px(33, y(42), 6, 5, o.pants);
    px(26, y(47), 4, 5, COLORS.skin);
    px(34, y(47), 4, 5, COLORS.skin);
  } else {
    px(25, y(42), 6, 10, o.pants);
    px(33, y(42), 6, 10, o.pants);
  }

  // Shoes / boots (feet stay planted, so no bob)
  if (o.bootsTall) {
    px(24, 49 + bob, 7, 8 - bob, o.shoes);
    px(33, 49 + bob, 7, 8 - bob, o.shoes);
  } else {
    px(24, 53, 7, 4, o.shoes);
    px(33, 53, 7, 4, o.shoes);
  }

  // Torso
  px(24, y(28), 16, 14, o.top);
  px(24, y(40), 16, 2, shade(o.top)); // hem

  // Arms
  if (o.sleeves === "short") {
    px(19, y(29), 5, 4, o.top);
    px(40, y(29), 5, 4, o.top);
    px(20, y(33), 4, 8, COLORS.skin);
    px(40, y(33), 4, 8, COLORS.skin);
  } else {
    px(19, y(29), 5, 12, o.top);
    px(40, y(29), 5, 12, o.top);
  }
  // Hands / gloves
  const handColor = o.gloves ? COLORS.red : COLORS.skin;
  px(20, y(41), 4, 3, handColor);
  px(40, y(41), 4, 3, handColor);

  // Head
  px(26, y(15), 12, 12, COLORS.skin);

  // Hair / hat
  if (o.hat === "beanie") {
    px(25, y(12), 14, 5, o.hatColor);
    px(25, y(16), 14, 2, shade(o.hatColor)); // fold
    px(31, y(10), 3, 3, COLORS.white); // pompom
  } else if (o.hat === "brim") {
    px(28, y(10), 8, 6, o.hatColor);
    px(22, y(15), 20, 2, o.hatColor);
  } else if (o.hat === "hood") {
    px(25, y(12), 14, 5, o.hatColor);
    px(24, y(15), 3, 11, o.hatColor);
    px(37, y(15), 3, 11, o.hatColor);
  } else {
    px(26, y(13), 12, 4, COLORS.hair);
    px(26, y(17), 2, 3, COLORS.hair);
    px(36, y(17), 2, 3, COLORS.hair);
  }

  // Face
  if (o.sunglasses) {
    px(27, y(20), 10, 3, COLORS.ink);
    px(26, y(20), 1, 1, COLORS.ink);
    px(37, y(20), 1, 1, COLORS.ink);
  } else {
    px(28, y(20), 2, 2, COLORS.ink);
    px(34, y(20), 2, 2, COLORS.ink);
  }
  px(30, y(24), 4, 1, "#c98a68"); // mouth

  // Scarf
  if (o.scarf) {
    px(25, y(26), 14, 3, COLORS.green);
    px(35, y(29), 4, 6, COLORS.green);
  }
}

// Slightly darker version of a hex color, for hems and folds.
function shade(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(((n >> 16) & 255) - 48, 0);
  const g = Math.max(((n >> 8) & 255) - 48, 0);
  const b = Math.max((n & 255) - 48, 0);
  return `rgb(${r},${g},${b})`;
}

// Convenience: prefill with the example ZIP if URL has ?zip=
const params = new URLSearchParams(location.search);
const initialZip = params.get("zip");
if (initialZip && /^\d{5}$/.test(initialZip)) {
  zipInput.value = initialZip;
  runStylist(initialZip);
}
