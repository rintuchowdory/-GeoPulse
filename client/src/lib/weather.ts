export type WeatherNow = {
  lat: number;
  lng: number;
  temperature: number;
  apparentTemperature: number;
  relativeHumidity: number;
  precipitation: number;
  weatherCode: number;
  windSpeed: number;
  windDirection: number;
  validAt: string;
  timezone: string;
  fetchedAt: number;
};

export type WeatherCondition = {
  label: string;
  glyph: string;
  kind: "sun" | "cloud" | "fog" | "rain" | "snow" | "storm";
};

export function weatherCondition(code: number): WeatherCondition {
  if (code === 0) return { label: "Clear", glyph: "☀", kind: "sun" };
  if (code === 1 || code === 2)
    return { label: "Partly cloudy", glyph: "⛅", kind: "sun" };
  if (code === 3) return { label: "Overcast", glyph: "☁", kind: "cloud" };
  if (code === 45 || code === 48)
    return { label: "Fog", glyph: "≋", kind: "fog" };
  if (code >= 51 && code <= 57)
    return { label: "Drizzle", glyph: "☂", kind: "rain" };
  if (code >= 61 && code <= 67)
    return { label: "Rain", glyph: "☂", kind: "rain" };
  if (code >= 71 && code <= 77)
    return { label: "Snow", glyph: "❄", kind: "snow" };
  if (code >= 80 && code <= 82)
    return { label: "Rain showers", glyph: "☂", kind: "rain" };
  if (code === 85 || code === 86)
    return { label: "Snow showers", glyph: "❄", kind: "snow" };
  if (code >= 95 && code <= 99)
    return { label: "Thunderstorm", glyph: "ϟ", kind: "storm" };
  return { label: "Weather update", glyph: "◌", kind: "cloud" };
}

export function windDirectionLabel(degrees: number): string {
  const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const normalized = ((degrees % 360) + 360) % 360;
  return directions[Math.round(normalized / 45) % directions.length];
}
