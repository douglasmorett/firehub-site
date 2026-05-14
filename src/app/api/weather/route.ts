import { NextResponse } from "next/server";

// Geocoding + Weather via Open-Meteo (100% gratuito, sem API key)
const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast";

// Cache simples em memória (5 min)
let cache: { key: string; data: any; ts: number } | null = null;

function weatherCodeToInfo(code: number): { icon: string; text: string } {
  if (code === 0) return { icon: "☀️", text: "Céu limpo" };
  if (code <= 3) return { icon: "⛅", text: "Parcialmente nublado" };
  if (code <= 48) return { icon: "☁️", text: "Nublado" };
  if (code <= 57) return { icon: "🌧️", text: "Garoa" };
  if (code <= 67) return { icon: "🌧️", text: "Chuva" };
  if (code <= 77) return { icon: "❄️", text: "Neve" };
  if (code <= 82) return { icon: "🌧️", text: "Pancadas de chuva" };
  if (code <= 86) return { icon: "❄️", text: "Neve intensa" };
  if (code <= 99) return { icon: "⛈️", text: "Tempestade" };
  return { icon: "🌤️", text: "Bom tempo" };
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const city = searchParams.get("city") || "São Paulo";
    const latParam = searchParams.get("lat");
    const lngParam = searchParams.get("lng");

    const cacheKey = latParam ? `${latParam},${lngParam}` : city;

    // Check cache
    if (cache && cache.key === cacheKey && Date.now() - cache.ts < 5 * 60 * 1000) {
      return NextResponse.json(cache.data);
    }

    let latitude: number, longitude: number, timezone = "America/Sao_Paulo", name = city, admin1 = "";

    if (latParam && lngParam) {
      // Use coordinates directly - reverse geocode for city name
      latitude = parseFloat(latParam);
      longitude = parseFloat(lngParam);
      try {
        const revRes = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&accept-language=pt-BR`);
        const revData = await revRes.json();
        name = revData.address?.city || revData.address?.town || revData.address?.village || city;
        admin1 = revData.address?.state || "";
      } catch {}
    } else {
      // Geocode city name
      const geoRes = await fetch(`${GEOCODING_URL}?name=${encodeURIComponent(city)}&count=1&language=pt&format=json`);
      const geoData = await geoRes.json();
      if (!geoData.results || geoData.results.length === 0) {
        return NextResponse.json({ error: "Cidade não encontrada" }, { status: 404 });
      }
      ({ latitude, longitude, timezone, name, admin1 } = geoData.results[0]);
    }

    // 2) Get weather
    const weatherRes = await fetch(
      `${WEATHER_URL}?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=${encodeURIComponent(timezone)}&forecast_days=3`
    );
    const weatherData = await weatherRes.json();

    const current = weatherData.current;
    const daily = weatherData.daily;

    const result = {
      city: name,
      state: admin1 || "",
      timezone,
      current: {
        temp: Math.round(current.temperature_2m),
        ...weatherCodeToInfo(current.weather_code),
        humidity: current.relative_humidity_2m,
        wind: Math.round(current.wind_speed_10m),
      },
      forecast: daily.time.slice(1, 3).map((date: string, i: number) => ({
        date,
        tempMax: Math.round(daily.temperature_2m_max[i + 1]),
        tempMin: Math.round(daily.temperature_2m_min[i + 1]),
        rainChance: daily.precipitation_probability_max[i + 1] || 0,
        ...weatherCodeToInfo(daily.weather_code[i + 1]),
      })),
    };

    cache = { key: cacheKey, data: result, ts: Date.now() };
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
