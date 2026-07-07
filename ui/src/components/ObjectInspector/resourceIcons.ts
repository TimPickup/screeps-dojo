// Screeps resource icons, hotlinked from the game CDN and keyed by resource id
// (energy, H, O, OH, G, commodities, …). Pure URL builder so it can be unit-
// tested; the <ResourceIcon> chip (pieces.tsx) falls back to a coloured text
// label via onError, so an offline machine or an unknown key still reads fine.
const ICON_BASE = 'https://s3.amazonaws.com/static.screeps.com/upload/mineral-icons/';

export function resourceIconUrl(resource: string): string {
  return ICON_BASE + encodeURIComponent(resource) + '.png';
}

// Fallback chip colours for the common resources (used only when the icon image
// fails to load). Anything unlisted gets a neutral grey.
const RESOURCE_COLOR: Record<string, string> = {
  energy: '#FFE87B',
  power: '#f41f33',
  ops: '#f41f33',
  G: '#ffffff',
  H: '#8fc0e0', O: '#8fc0e0', U: '#50d7f9', L: '#00f4a2', K: '#a306e0', Z: '#f9a825', X: '#f45cc4',
};

export function resourceColor(resource: string): string {
  return RESOURCE_COLOR[resource] ?? '#8891a0';
}
