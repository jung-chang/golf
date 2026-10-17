// Display preferences belong to the member, not the device. The server copy wins; the
// device keeps a copy for instant paint and offline use.
import type { Member, MemberUpdate } from '@/schemas/group';
import { api } from './api';
import { getTheme, setTheme } from './theme';
import { getTemperatureUnit, setTemperatureUnit } from './weather-store';

const OWNER_KEY = 'golf.prefs.owner';

export function syncPrefs(m: Member) {
  let owner: string | null = null;
  try { owner = localStorage.getItem(OWNER_KEY); localStorage.setItem(OWNER_KEY, m.email); } catch { /* this visit only */ }
  // A member who never chose keeps this device's choice only if it was theirs; anyone else starts from defaults.
  const mine = owner === null || owner === m.email;
  const upload: MemberUpdate = {};
  if (m.theme) setTheme(m.theme);
  else if (mine && getTheme() !== 'system') upload.theme = getTheme();
  else setTheme('system');
  if (m.temperatureUnit) setTemperatureUnit(m.temperatureUnit);
  else if (mine && getTemperatureUnit() !== 'fahrenheit') upload.temperatureUnit = getTemperatureUnit();
  else setTemperatureUnit('fahrenheit');
  if (Object.keys(upload).length) void api('/me', { method: 'PUT', body: upload }).catch(() => { /* retried next launch */ });
}
