import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { condition, type TemperatureUnit } from '@/lib/weather';
import type { useWeather } from '@/lib/weather-store';

type Weather = ReturnType<typeof useWeather>;
export function DailyWeatherIcon({ code }: { code?: number }) {
  return <img src={`/weather/${condition(code).icon}.svg`} alt="" width="32" height="32" className="size-8" />;
}

export function TemperatureToggle({ weather, onChange }: { weather: Weather; onChange: (unit: TemperatureUnit) => void }) {
  return <ToggleGroup type="single" variant="outline" aria-label="Temperature" value={weather.unit} onValueChange={value => { if (value === 'fahrenheit' || value === 'celsius') onChange(value); }}>
    <ToggleGroupItem value="fahrenheit" aria-label="Fahrenheit" className="min-h-11 min-w-11">°F</ToggleGroupItem>
    <ToggleGroupItem value="celsius" aria-label="Celsius" className="min-h-11 min-w-11">°C</ToggleGroupItem>
  </ToggleGroup>;
}

export const WeatherCredit = () => <>
  NYC forecast by <a className="underline" href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a> (<a className="underline" href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>)
</>;
