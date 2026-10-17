# Daily NYC weather

Every course is in NYC, so one forecast for a fixed central point (40.73, -73.94) covers
them all; borough-to-borough differences in a daily high are a degree or two. The device's
location is never requested.

Weather is always on. Each date chip in the tee-time search panel shows a daily icon and
high, nothing more; chips fit five across and scroll for the rest. NYC booking dates
remain calendar date strings and match the forecast's local dates directly, without UTC
conversion. No forecast is substituted for an unavailable date. The only setting is
°F/°C (Fahrenheit by default) in Profile → Weather, alongside the attribution.

The unit is a member preference (`members.temperature_unit`), so it follows the member
across devices; `golf.weather.v1` in localStorage keeps a copy plus the forecast cache,
which never enters the member API. If storage is blocked they last for the current visit.

The browser calls Open-Meteo directly, without credentials or a referrer, for daily
weather_code, temperature_2m_max and temperature_2m_min, Celsius, timezone=auto,
forecast_days=16. Models are omitted to retain the default best match. Requests are
limited to ten seconds.

Forecasts are fresh for three hours, stale for up to 24 hours, and hidden afterward.
Opening, resuming or reconnecting refetches anything not fresh; offline skips the
request. A failed request keeps the previous forecast, and chips without data show
nothing. Past dates are hidden, even in an old cache. Null daily values and unknown WMO
codes show unavailable; malformed structure, dates, units, nonnumeric temperatures, or
inverted high/low values reject the response.

## Sources and terms checked 2026-10-17

- [Forecast documentation](https://open-meteo.com/en/docs): up to 16 days, default
  best match, daily WMO codes and high/low Celsius temperatures, auto timezone.
- [Terms](https://open-meteo.com/en/terms) and [pricing](https://open-meteo.com/en/pricing):
  the free endpoint is for non-commercial use, with limits below 600 calls/minute,
  5,000/hour, 10,000/day and 300,000/month. More than two weeks can count as multiple
  calls. This private group app uses the free endpoint without an API key.
- [Data license](https://open-meteo.com/en/licence): CC BY 4.0. An adjacent attribution
  and license link appear in Profile → Weather.
- [Provider privacy](https://open-meteo.com/en/terms): Open-Meteo may retain request
  logs for up to 90 days. Requests carry only the fixed NYC point, never a device location.
- [Meteocons](https://github.com/basmilius/meteocons), Bas Milius, MIT. Verified npm
  package `@meteocons/svg-static` 0.1.0 contains Flat static SVGs and `LICENSE`.
  Only 13 needed, unmodified colored SVGs are vendored in `public/weather`, along with
  the original copyright/license notice. `python3 tools/vendor-weather.py` reproduces
  them after checking the npm archive's SHA-512 integrity. No runtime icon dependency,
  CDN requests, animations, emoji, or icon recoloring are used. Lucide controls remain.

The workspace has no protected spec or Geist font assets. Existing app typography is
retained. No spec file is changed by this feature.
