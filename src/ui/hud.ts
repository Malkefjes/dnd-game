// DOM HUD in the "Painted Miniatures" style: crisp text over the pixel-art scene.
import './hud.css';
import { icon } from './icons';

export interface InitEntry { id: string; name: string; side: 'party' | 'enemy'; initiative: number; hpFrac: number; dead: boolean; active: boolean; hidden: boolean }
export interface PartyCard { id: string; name: string; hp: number; maxHp: number; status: string; active: boolean; dead: boolean; side: 'party' | 'enemy' }
export interface Slot { key: string; icon: string; label: string; cost: 'action' | 'bonus' | 'free' | 'reaction'; enabled: boolean; selected: boolean; uses?: number; tip: string }
export interface HotbarState {
  id: string; name: string; title: string; hp: number; maxHp: number; ac: number; side: 'party' | 'enemy';
  actions: number; bonus: number; reaction: boolean; movement: number; speed: number; previewMove?: number;
  slots: Slot[]; waiting: boolean;
  /** Second row: spells and Channel Divinity. */
  spells?: Slot[];
  /** Spell slots by level: left of max. */
  pips?: { level: number; left: number; max: number }[];
  concentration?: string;
  /** Exploring instead of fighting: a hint line replaces the action economy, and there's no End Turn. */
  explore?: { hint: string };
  /** Upcast / multi-target picker shown above the hotbar while a spell is being aimed. */
  picker?: { title: string; options: { key: string; label: string; selected: boolean; enabled: boolean }[] };
}

/** Names that don't fit under a hotbar icon, shortened. */
const SHORT: Record<string, string> = {
  'Protection from Evil and Good': 'Protection from Evil', 'Breath Weapon (cone)': 'Breath (cone)', 'Breath Weapon (line)': 'Breath (line)',
  'Off-hand Attack': 'Off-hand',
};
export const shortName = (label: string) => SHORT[label] ?? label.replace(' (two hands)', ' (2H)').replace(' (thrown)', ' (throw)');

const LABELS_KEY = 'hollow-abbey-hotbar-labels';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export class Hud {
  readonly root = document.createElement('div');
  private initEl = el('div', 'initiative panel');
  private partyEl = el('div', 'party-frames');
  private logEl = el('div', 'log panel interactive');
  private logLines = el('div', 'log-lines');
  private hotbarEl = el('div', 'hotbar panel interactive');
  private tipEl = el('div', 'tip panel');
  private tagEl = el('div', 'cursor-tag panel');
  private slotTipEl = el('div', 'tip panel');
  private plates = new Map<string, HTMLDivElement>();
  /** Show each hotbar button's name under its icon (L toggles; remembered in this browser). */
  labels = true;
  private lastHotbar: [HotbarState | null, string | undefined] = [null, undefined];
  onSlot: (key: string) => void = () => {};
  onEndTurn: () => void = () => {};
  onPartyClick: (id: string) => void = () => {};

  constructor(private portraitFor: (id: string) => string | undefined) {
    this.root.className = 'hud';
    try { this.labels = localStorage.getItem(LABELS_KEY) !== 'off'; } catch { /* storage blocked: keep the default */ }
    this.logEl.innerHTML = '<div class="panel-title">Combat Log</div>';
    this.logEl.appendChild(this.logLines);
    for (const e of [this.tipEl, this.tagEl, this.slotTipEl]) e.style.display = 'none';
    this.root.append(this.initEl, this.partyEl, this.logEl, this.hotbarEl, this.tipEl, this.tagEl, this.slotTipEl);
    document.body.appendChild(this.root);
    // scale the panels with the window: designed for 900 px tall, readable from 720p to 4K
    const scale = () => document.documentElement.style.setProperty('--ui', String(Math.min(1.6, Math.max(0.85, innerHeight / 900))));
    scale(); addEventListener('resize', scale);
    this.hotbarEl.addEventListener('click', (ev) => {
      const t = (ev.target as HTMLElement).closest<HTMLElement>('[data-slot]');
      if ((ev.target as HTMLElement).closest('.label-toggle')) { this.toggleLabels(); return; }
      if (t && !t.classList.contains('disabled')) this.onSlot(t.dataset.slot!);
      if ((ev.target as HTMLElement).closest('.end-turn')) this.onEndTurn();
    });
    this.hotbarEl.addEventListener('mouseover', (ev) => {
      const t = (ev.target as HTMLElement).closest<HTMLElement>('[data-tip]');
      if (!t) { this.slotTipEl.style.display = 'none'; return; }
      this.slotTipEl.innerHTML = t.dataset.tip!;
      this.slotTipEl.style.display = 'block';
      // above the whole hotbar (and its picker), centred on the slot, so it never covers other slots
      const r = t.getBoundingClientRect();
      const bar = (this.hotbarEl.querySelector('.picker') ?? this.hotbarEl).getBoundingClientRect();
      const w = this.slotTipEl.offsetWidth;
      this.slotTipEl.style.left = `${Math.min(innerWidth - w - 10, Math.max(10, r.left + r.width / 2 - w / 2))}px`;
      this.slotTipEl.style.top = `${Math.min(bar.top, this.hotbarEl.getBoundingClientRect().top) - this.slotTipEl.offsetHeight - 10}px`;
    });
    this.hotbarEl.addEventListener('mouseleave', () => { this.slotTipEl.style.display = 'none'; });
    this.partyEl.addEventListener('click', (ev) => {
      const t = (ev.target as HTMLElement).closest<HTMLElement>('[data-id]');
      if (t) this.onPartyClick(t.dataset.id!);
    });
  }

  portrait(id: string, side: string, cls = '', dead = false): string {
    const img = this.portraitFor(id);
    return `<div class="portrait side-${side} ${cls} ${dead ? 'dead' : ''}">${img ? `<img src="${img}" alt="">` : ''}</div>`;
  }

  setInitiativeVisible(on: boolean) { this.initEl.style.display = on ? '' : 'none'; }

  renderInitiative(entries: InitEntry[], round: number) {
    const active = entries.find((e) => e.active);
    this.initEl.innerHTML = `<div class="round">Round ${round}${active ? `<span class="who side-${active.side}">${esc(active.name)}</span>` : ''}</div>` + entries.map((e) => `
      <div class="init ${e.active ? 'active' : ''} ${e.dead ? 'gone' : ''}" title="${esc(e.name)} — initiative ${e.initiative}">
        ${this.portrait(e.id, e.side, '', e.dead)}
        <div class="init-hp"><div style="width:${e.hidden ? 100 : Math.round(e.hpFrac * 100)}%"></div></div>
      </div>`).join('');
  }

  renderParty(cards: PartyCard[]) {
    this.partyEl.innerHTML = cards.map((c) => `
      <div class="party-card panel interactive ${c.active ? 'active' : ''}" data-id="${c.id}">
        ${this.portrait(c.id, c.side, 'lg', c.dead)}
        <div class="party-info">
          <div class="pname">${esc(c.name)}</div>
          ${hpBar(c.hp, c.maxHp, true)}
          <div class="pstatus">${esc(c.status)}</div>
        </div>
      </div>`).join('');
  }

  toggleLabels() {
    this.labels = !this.labels;
    try { localStorage.setItem(LABELS_KEY, this.labels ? 'on' : 'off'); } catch { /* not remembered */ }
    this.renderHotbar(...this.lastHotbar);
  }

  renderHotbar(s: HotbarState | null, enemyTurnName?: string) {
    this.lastHotbar = [s, enemyTurnName];
    this.hotbarEl.style.display = s || enemyTurnName ? 'flex' : 'none';
    if (!s) {
      this.hotbarEl.className = 'hotbar panel interactive waiting';
      this.hotbarEl.innerHTML = `<div class="enemy-turn">${enemyTurnName ? `${esc(enemyTurnName)} is acting…` : '…'}</div>`;
      return;
    }
    const movePct = Math.round((s.movement / Math.max(1, s.speed)) * 100);
    const prevPct = s.previewMove !== undefined ? Math.round((Math.max(0, s.movement - s.previewMove) / Math.max(1, s.speed)) * 100) : movePct;
    const slotHtml = (list: Slot[], prefix: string, extra = '') => list.map((sl, i) => `
      <div class="slot ${extra} cost-${sl.cost} ${sl.enabled ? '' : 'disabled'} ${sl.selected ? 'selected' : ''}" data-slot="${sl.key}" data-tip="${esc(sl.tip)}">
        ${icon(sl.icon, this.labels ? 21 : 26)}${this.labels ? `<span class="name">${esc(shortName(sl.label))}</span>` : ''}${sl.uses !== undefined ? `<span class="uses">${sl.uses}</span>` : ''}${i < 10 ? `<span class="key">${prefix}${(i + 1) % 10}</span>` : ''}
      </div>`).join('');
    const slots = slotHtml(s.slots, '');
    const spells = s.spells?.length ? `<div class="slots spells">${slotHtml(s.spells, '⇧', 'spell')}</div>` : '';
    const rowLabel = (t: string, hint: string) => `<div class="row-label" title="${esc(hint)}">${t}</div>`;
    const roman = ['', 'I', 'II', 'III', 'IV', 'V'];
    const pips = s.pips?.length ? `<span class="spell-pips" title="Spell slots">${s.pips.map((p) => `<span class="lvl">${roman[p.level]}</span>${'<i class="on"></i>'.repeat(p.left)}${'<i></i>'.repeat(Math.max(0, p.max - p.left))}`).join('')}</span>` : '';
    const conc = s.concentration ? `<span class="conc" title="Concentrating">◈ ${esc(s.concentration)}</span>` : '';
    const picker = s.picker ? `<div class="picker panel"><span class="ptitle">${esc(s.picker.title)}</span>${s.picker.options.map((o) => `<button class="pick ${o.selected ? 'selected' : ''} ${o.enabled ? '' : 'disabled'}" data-slot="${o.key}">${esc(o.label)}</button>`).join('')}</div>` : '';
    this.hotbarEl.className = `hotbar panel interactive ${s.waiting ? 'waiting' : ''} ${this.labels ? 'labeled' : ''}`;
    this.hotbarEl.innerHTML = `
      <div class="active-info">
        ${this.portrait(s.id, s.side, 'xl')}
        <div>
          <div class="aname">${esc(s.name)}</div>
          <div class="atitle">${esc(s.title)}</div>
          <div class="astats"><span class="ac" title="Armor Class">${icon('dodge', 15)}<b>${s.ac}</b></span>${hpBar(s.hp, s.maxHp, s.side === 'party')}</div>
        </div>
      </div>
      <div class="hotbar-main">
        ${s.explore ? `<div class="explore-hint">${s.explore.hint}</div>` : `<div class="economy">
          ${'<span class="pip action on" title="Action"></span>'.repeat(Math.max(1, s.actions)).replace(/ on/g, s.actions > 0 ? ' on' : '')}<span class="lbl">Action</span>
          <span class="pip bonus ${s.bonus > 0 ? 'on' : ''}" title="Bonus Action"></span><span class="lbl">Bonus</span>
          <span class="pip reaction ${s.reaction ? 'on' : ''}" title="Reaction"></span><span class="lbl">Reaction</span>
          <div class="move" title="Movement"><div class="move-fill" style="width:${movePct}%"></div><div class="move-preview" style="left:${prevPct}%; width:${movePct - prevPct}%"></div><span>${s.movement} / ${s.speed} ft</span></div>
          ${pips}${conc}
        </div>`}
        <div class="slot-row">${rowLabel('Act', 'Keys 1–0')}<div class="slots">${slots}</div><button class="label-toggle" data-tip="${this.labels ? 'Hide' : 'Show'} the names under the buttons. <i>(L)</i>">${this.labels ? 'Aa' : 'Aa'}</button></div>
        ${spells ? `<div class="slot-row">${rowLabel('Spell', 'Shift + 1–0')}${spells}</div>` : ''}
      </div>
      ${picker}
      ${s.explore ? '' : `<div class="end-turn ${s.actions <= 0 && s.bonus <= 0 ? 'suggest' : ''}" data-tip="End your turn. <i>(Space)</i>">${icon('hourglass', 21)}<span>End Turn</span></div>`}`;
  }

  log(text: string, tone = 'info') {
    const d = el('div', `log-line ${tone}`); d.textContent = text;
    this.logLines.appendChild(d);
    while (this.logLines.children.length > 200) this.logLines.firstChild!.remove();
    this.logLines.scrollTop = this.logLines.scrollHeight;
  }

  tooltip(html: string | null, x = 0, y = 0) {
    if (!html) { this.tipEl.style.display = 'none'; return; }
    this.tipEl.innerHTML = html;
    this.tipEl.style.display = 'block';
    const w = this.tipEl.offsetWidth, h = this.tipEl.offsetHeight;
    let left = x + 24, top = y - h - 8;
    if (left + w > innerWidth - 10) left = x - w - 24;
    if (top < 90) top = y + 24;
    this.tipEl.style.left = `${left}px`; this.tipEl.style.top = `${top}px`;
  }

  cursorTag(text: string | null, x = 0, y = 0, warn = false) {
    if (!text) { this.tagEl.style.display = 'none'; return; }
    this.tagEl.textContent = text;
    this.tagEl.className = `cursor-tag panel ${warn ? 'warn' : ''}`;
    this.tagEl.style.display = 'block';
    this.tagEl.style.left = `${x}px`; this.tagEl.style.top = `${y - 14}px`;
  }

  float(x: number, y: number, text: string, cls: string, delay = 0) {
    const d = el('div', `float ${cls}`); d.textContent = text;
    d.style.left = `${x}px`; d.style.top = `${y}px`; d.style.animationDelay = `${delay}s`; d.style.opacity = '0';
    this.root.appendChild(d);
    setTimeout(() => d.remove(), 1400 + delay * 1000);
  }

  banner(text: string, enemy = false) {
    const d = el('div', `banner ${enemy ? 'enemy' : ''}`); d.textContent = text;
    this.root.appendChild(d); setTimeout(() => d.remove(), 1500);
  }

  plate(id: string, side: string, x: number, y: number, hpFrac: number, icons: string, visible: boolean) {
    let p = this.plates.get(id);
    if (!p) { p = el('div', `plate ${side}`) as HTMLDivElement; p.innerHTML = '<div class="icons"></div><div class="bar"><div></div></div>'; this.root.insertBefore(p, this.initEl); this.plates.set(id, p); }
    p.style.display = visible ? 'block' : 'none';
    if (!visible) return;
    p.style.left = `${x}px`; p.style.top = `${y}px`;
    (p.lastElementChild!.firstElementChild as HTMLElement).style.width = `${Math.round(hpFrac * 100)}%`;
    const ic = p.firstElementChild as HTMLElement;
    if (ic.textContent !== icons) ic.textContent = icons;
  }

  /** A choice that doesn't cover the battlefield (reaction prompts). Resolves with the chosen button's index. */
  ask(html: string, buttons: { label: string; secondary?: boolean }[]): Promise<number> {
    return new Promise((resolve) => {
      const box = el('div', 'ask panel interactive'); box.innerHTML = html;
      const row = el('div', 'ask-row');
      buttons.forEach((b, i) => {
        const btn = el('button', `btn ${b.secondary ? 'secondary' : ''}`); btn.textContent = b.label;
        btn.addEventListener('click', () => { box.remove(); removeEventListener('keydown', key, true); resolve(i); });
        row.appendChild(btn);
      });
      // Y / N (or Enter / Escape) answer from the keyboard
      const key = (e: KeyboardEvent) => {
        const k = e.key.toLowerCase();
        const i = k === 'y' || k === 'enter' ? 0 : k === 'n' || k === 'escape' ? buttons.length - 1 : -1;
        if (i < 0) return;
        e.preventDefault(); e.stopImmediatePropagation();
        box.remove(); removeEventListener('keydown', key, true); resolve(i);
      };
      addEventListener('keydown', key, true);
      box.appendChild(row); this.root.appendChild(box);
    });
  }

  modal(html: string, buttons: { label: string; secondary?: boolean; onClick: () => void }[]): () => void {
    const back = el('div', 'modal-back');
    const box = el('div', 'modal panel'); box.innerHTML = html;
    const row = el('div', '');
    for (const b of buttons) {
      const btn = el('button', `btn ${b.secondary ? 'secondary' : ''}`); btn.textContent = b.label;
      btn.addEventListener('click', () => { close(); b.onClick(); });
      row.appendChild(btn);
    }
    box.appendChild(row); back.appendChild(box); document.body.appendChild(back);
    const close = () => back.remove();
    return close;
  }
}

function el(tag: string, cls: string): HTMLElement { const e = document.createElement(tag); e.className = cls; return e; }
/** HP bar. Party bars go green → amber → red so health reads at a glance; enemy bars stay red. */
export function hpBar(hp: number, max: number, party = false): string {
  const f = hp / max;
  const tone = !party ? '' : f > 0.5 ? 'ok' : f > 0.25 ? 'hurt' : 'low';
  return `<div class="hp ${tone}"><div class="fill" style="width:${Math.round(f * 100)}%"></div><span>${hp} / ${max}</span></div>`;
}
export { esc };
