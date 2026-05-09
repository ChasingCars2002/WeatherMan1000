# WeatherMan1000 &mdash; Wear4Weather

A tiny static web app: enter a US ZIP code, get a 6-hour forecast plus a
head-to-toe outfit recommendation from the Wear4Weather stylist.

## Run locally

It's pure HTML/CSS/JS &mdash; no build step. Serve the folder with any static
server, e.g.:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

Or just open `index.html` in a browser (some browsers require it to be served
over HTTP for `fetch` to behave).

## Try it

Type any 5-digit US ZIP (e.g. `49503`) and hit **Style me**. You can also
deep-link with `?zip=49503` to auto-run on load.

## How it works

1. **Geocode** &mdash; `api.zippopotam.us/us/{zip}` &rarr; lat/lon, city, state.
2. **Forecast** &mdash; `api.open-meteo.com/v1/forecast` &rarr; hourly temp,
   humidity, precip probability, weather code, wind. No API key required.
3. **Analyze** &mdash; client-side rules in `app.js`:
   - Temperature comfort zones (extreme cold &rarr; hot)
   - Humidity factor (sticky / dry-skin notes)
   - Precipitation logic (carry vs. waterproof everything)
   - 6-hour rule (adaptable layers when temps swing &gt;10&deg;F)
   - Wind + sun callouts
4. **Render** &mdash; Summary / Outfit / Must-Haves / Style Tip, plus an
   expandable hourly forecast table.

## Files

- `index.html` &mdash; UI
- `styles.css` &mdash; styling
- `app.js` &mdash; geocoding, forecast fetch, stylist logic, rendering
