// Minimal hand-drawn SVG icon set (24x24, stroked).

const P: Record<string, string> = {
  sword: '<path d="M14.5 3.5 20.5 3.5 20.5 9.5 9 21 6 21 3 18 3 15 14.5 3.5Z"/><path d="M6 13l5 5M4 20l2.5-2.5"/>',
  javelin: '<path d="M3 21 17 7"/><path d="M15 4l5-1-1 5-2.5-1.5Z"/><path d="M5 17l2 2"/>',
  shove: '<path d="M8 12V6.5a1.5 1.5 0 0 1 3 0V11"/><path d="M11 10V5a1.5 1.5 0 0 1 3 0v6"/><path d="M14 10V6a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7L3 13.5a1.5 1.5 0 0 1 2.5-1.6L8 14"/>',
  dash: '<path d="M13 4a2 2 0 1 0 0 .1"/><path d="M9 21l3-6 3 2v4"/><path d="M6 12l3-4 5 1 3 4 3 1"/><path d="M12 15l-1-6"/><path d="M2 9h4M1 13h4"/>',
  disengage: '<path d="M4 12h11"/><path d="M11 8l4 4-4 4"/><path d="M19 4v16"/>',
  dodge: '<path d="M12 3 20 6v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6Z"/>',
  secondWind: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10Z"/><path d="M12 9v6M9 12h6"/>',
  actionSurge: '<path d="M13 2 5 13h6l-1 9 8-11h-6Z"/>',
  hide: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><path d="M4 4l16 16"/>',
  hourglass: '<path d="M6 3h12M6 21h12M7 3c0 5 10 5 10 9s-10 4-10 9M17 3c0 5-10 5-10 9s10 4 10 9"/>',
  bow: '<path d="M6 3c8 3 12 9 12 18"/><path d="M6 3l12 18"/><path d="M4 10l8 2 2-8"/>',
  axe: '<path d="M14 4c3 0 6 3 6 6l-6 1-1-7Z"/><path d="M15 9 4 20"/>',
  skull: '<path d="M12 3a7 7 0 0 0-7 7c0 2.4 1.2 4 3 5v3h8v-3c1.8-1 3-2.6 3-5a7 7 0 0 0-7-7Z"/><path d="M9.5 11h.01M14.5 11h.01M10 18v3M14 18v3"/>',
  dagger: '<path d="M18 3 9 12l3 3 9-9V3Z"/><path d="M7 10l7 7M8.5 15.5 4 20"/>',
  potion: '<path d="M9 3h6M10 3v5L5.5 16a4 4 0 0 0 3.5 6h6a4 4 0 0 0 3.5-6L14 8V3"/><path d="M7.5 14h9"/>',
  help: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10Z"/><path d="M8.5 11h2l1-2 1.5 4 1-2h1.5"/>',
  offhand: '<path d="M14 3 7 10l2 2 7-7V3Z"/><path d="M5 8l5 5M6 12l-3 3"/><path d="M21 13l-5 5"/><path d="M14 13l7 7"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l6 6"/>',
  stand: '<path d="M12 4a2 2 0 1 0 0 .1"/><path d="M12 7v7l-3 7M12 14l3 7M7 10h10"/>',
};

export function icon(name: keyof typeof P | string, size = 24): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${P[name] ?? ''}</svg>`;
}

export const archetypeIcon: Record<string, string> = {
  fighter: 'sword',
  rogue: 'dagger',
  goblin: 'axe',
  goblinArcher: 'bow',
  goblinBoss: 'skull',
};
