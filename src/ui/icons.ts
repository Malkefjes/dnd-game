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
  // spells
  fireBolt: '<path d="M14 3c1 3 4 4.5 4 8.5A6 6 0 0 1 6 12c0-2.5 1.5-4 3-5 0 2 1 3 2 3 0-3 1-5 3-7Z"/><path d="M3 21l5-5"/>',
  frost: '<path d="M12 2v20M3.5 7l17 10M3.5 17l17-10"/><path d="M9 4l3 2 3-2M9 20l3-2 3 2"/>',
  shock: '<path d="M13 2 6 13h5l-2 9 8-12h-5l3-8Z"/><path d="M3 9l2 1M19 15l2 1"/>',
  flame: '<path d="M12 21c-4 0-6-2.5-6-6 0-4 4-6 4-11 3 2 5 5 5 8 1-1 1.5-2 1.5-3 1.5 1.5 1.5 3.5 1.5 6 0 3.5-2 6-6 6Z"/><path d="M12 21c-1.5 0-2.5-1-2.5-2.5S12 15 12 14c1 1.5 2.5 2.5 2.5 4.5S13.5 21 12 21Z"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4Z"/><path d="M10 20a2 2 0 0 0 4 0"/><path d="M12 3v2"/>',
  missile: '<path d="M4 20 15 9"/><path d="M15 9l5-5-1 5-4 0Z"/><path d="M7 21l3-3M3 17l3-3"/><circle cx="18" cy="6" r="1"/>',
  shieldSpell: '<path d="M12 3 20 6v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6Z"/><path d="M12 7v10M8 11l4-4 4 4"/>',
  cone: '<path d="M4 12 20 4v16Z"/><path d="M10 12h2M14 9v6"/>',
  sleep: '<path d="M4 5h6l-6 7h6"/><path d="M13 11h5l-5 6h5"/><path d="M17 3h3l-3 4h3"/>',
  bolt: '<path d="M3 21 21 3"/><path d="M15 3h6v6"/><path d="M8 10l-3-3M14 16l3 3"/><circle cx="12" cy="12" r="2"/>',
  word: '<path d="M4 6h12a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-6l-4 4v-4H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z"/><path d="M10 9v4M8 11h4"/>',
  cure: '<path d="M7 12h10M12 7v10"/><circle cx="12" cy="12" r="9"/>',
  bless: '<path d="M12 2v6M9 5h6"/><path d="M5 22c0-6 3-9 7-9s7 3 7 9"/><path d="M8 14l-3-3M16 14l3-3"/>',
  faith: '<path d="M12 3 20 6v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6Z"/><path d="M12 8v8M9 11h6"/>',
  inflict: '<path d="M8 14V7a2 2 0 0 1 4 0v5"/><path d="M12 11V5a2 2 0 0 1 4 0v8"/><path d="M8 12c-2 0-3 1-3 3 0 4 3 6 7 6s6-2 6-6v-2"/><path d="M19 3l2 2M21 9h-2"/>',
  rays: '<path d="M3 21 20 6M3 21 21 12M3 21 14 3"/>',
  misty: '<path d="M4 14c2-2 4-2 6 0s4 2 6 0 3-1.5 4-1"/><path d="M4 18c2-2 4-2 6 0s4 2 6 0"/><path d="M12 3l2 4 4 .5-3 3 1 4-4-2-4 2 1-4-3-3 4-.5Z"/>',
  spiritual: '<path d="M6 3h7v5H6z"/><path d="M9.5 8v13"/><path d="M14 12c2-1 4-1 6 1M14 16c2-1 4-1 6 1"/>',
  aid: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10Z"/><path d="M12 9v5M9.5 11.5h5"/><path d="M4 3v3M2.5 4.5h3"/>',
  spark: '<path d="M12 2v5M12 17v5M2 12h5M17 12h5M5 5l3 3M16 16l3 3M19 5l-3 3M8 16l-3 3"/><circle cx="12" cy="12" r="2.5"/>',
  preserve: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2"/>',
  steadyAim: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4"/>',
  strike: '<path d="M6 3h7v5H6z"/><path d="M9.5 8v13"/><path d="M15 4l5 0M17 8l4 1M16 12h5"/>',
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
  cleric: 'bless',
  wizard: 'fireBolt',
  hobgoblin: 'sword',
  skeleton: 'skull',
  zombie: 'skull',
};
