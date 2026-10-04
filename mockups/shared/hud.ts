// Combat HUD overlay shared by every style mockup. Each mockup supplies a theme
// (CSS variables in hud.css) and a projection from grid tile to screen pixels.
import './hud.css';
import { units, activeId, targetId, previewPath, log, tileAt, type Unit } from './scene';
import { icon, archetypeIcon } from './icons';

export interface HudOptions {
  theme: 'minis' | 'toon' | 'pixel' | 'parchment';
  /** Screen position (CSS px) of the top of a unit standing on tile (x, y). */
  project: (x: number, y: number, h: number) => { x: number; y: number };
  /** Optional portrait image per unit id (data URL). Falls back to an icon disc. */
  portraits?: Record<string, string>;
  styleName: string;
  styleBlurb: string;
}

function portrait(u: Unit, opts: HudOptions, cls = ''): string {
  const img = opts.portraits?.[u.id];
  const inner = img ? `<img src="${img}" alt="">` : `<span class="glyph">${icon(archetypeIcon[u.archetype], 26)}</span>`;
  return `<div class="portrait side-${u.side} ${cls}">${inner}</div>`;
}

function hpBar(u: Unit): string {
  const pct = Math.round((u.hp / u.maxHp) * 100);
  return `<div class="hp"><div class="fill" style="width:${pct}%"></div><span>${u.hp} / ${u.maxHp}</span></div>`;
}

export function mountHud(opts: HudOptions): void {
  const root = document.createElement('div');
  root.className = `hud theme-${opts.theme}`;
  const active = units.find((u) => u.id === activeId)!;
  const target = units.find((u) => u.id === targetId)!;
  const order = [...units].sort((a, b) => b.initiative - a.initiative);

  const initiative = order
    .map((u) => `<div class="init ${u.id === activeId ? "active" : ""} side-${u.side}">${portrait(u, opts)}<div class="init-num">${u.initiative}</div></div>`)
    .join('');

  const party = units
    .filter((u) => u.side === 'party')
    .map((u) => `<div class="party-card ${u.id === activeId ? 'active' : ''}">${portrait(u, opts, 'lg')}<div class="party-info"><div class="pname">${u.name}${u.hidden ? `<span class="status" title="Hidden">${icon('hide', 14)}</span>` : ''}</div>${hpBar(u)}</div></div>`)
    .join('');

  const actions: [string, string, string, string?][] = [
    ['sword', 'Longsword', 'action'],
    ['javelin', 'Javelin', 'action'],
    ['shove', 'Shove', 'action'],
    ['dash', 'Dash', 'action'],
    ['disengage', 'Disengage', 'action'],
    ['dodge', 'Dodge', 'action'],
    ['secondWind', 'Second Wind', 'bonus', '2'],
    ['actionSurge', 'Action Surge', 'free', '1'],
  ];
  const slots = actions
    .map(([ic, label, kind, uses], i) => `<div class="slot ${kind} ${i === 0 ? 'selected' : ''}" title="${label}">${icon(ic, 28)}${uses ? `<span class="uses">${uses}</span>` : ''}<span class="key">${i + 1}</span></div>`)
    .join('');

  const logHtml = log.map((l) => `<div class="log-line ${l.kind}">${l.text}</div>`).join('');

  root.innerHTML = `
    <div class="style-tag"><div class="style-name">${opts.styleName}</div><div class="style-blurb">${opts.styleBlurb}</div></div>
    <div class="initiative"><div class="round">Round 2</div>${initiative}</div>
    <div class="party">${party}</div>
    <div class="log panel"><div class="panel-title">Combat Log</div>${logHtml}</div>
    <div class="hotbar panel">
      <div class="active-info">
        ${portrait(active, opts, 'xl')}
        <div>
          <div class="aname">${active.name}</div>
          <div class="atitle">${active.title} · AC ${active.ac}</div>
          ${hpBar(active)}
        </div>
      </div>
      <div class="hotbar-main">
        <div class="economy">
          <span class="pip action on" title="Action"></span><span class="lbl">Action</span>
          <span class="pip bonus on" title="Bonus Action"></span><span class="lbl">Bonus</span>
          <span class="pip reaction on" title="Reaction"></span><span class="lbl">Reaction</span>
          <div class="move"><div class="move-fill" style="width:100%"></div><span>30 / 30 ft</span></div>
        </div>
        <div class="slots">${slots}</div>
      </div>
      <div class="end-turn">${icon('hourglass', 22)}<span>End Turn</span></div>
    </div>
    <div class="target-tip panel" id="tip">
      <div class="tip-head"><span class="tname">${target.name}</span><span class="tcr">${target.title}</span></div>
      ${hpBar(target)}
      <div class="tip-row big"><span>Longsword</span><span class="chance">55%</span></div>
      <div class="tip-row"><span>+5 to hit vs AC ${target.ac}</span><span>1d8+3 slashing</span></div>
      <div class="tip-row mastery"><span>Mastery: Sap</span><span>its next attack has Disadv.</span></div>
    </div>
    <div class="path-tag" id="pathtag">10 ft</div>
  `;
  document.body.appendChild(root);

  const place = () => {
    const tip = root.querySelector<HTMLElement>('#tip')!;
    const tTile = tileAt(target.x, target.y)!;
    const p = opts.project(target.x, target.y, tTile.h);
    tip.style.left = `${p.x + 55}px`;
    tip.style.top = `${p.y - 175}px`;
    const end = previewPath[previewPath.length - 1];
    const q = opts.project(end[0], end[1], tileAt(end[0], end[1])!.h);
    const tag = root.querySelector<HTMLElement>('#pathtag')!;
    tag.style.left = `${q.x}px`;
    tag.style.top = `${q.y - 18}px`;
  };
  place();
  window.addEventListener('resize', place);
}
