// Spell effects. They're real light sources (a Fire Bolt lights up the walls it
// passes) drawn with additive glows, so the pixel filter turns them into chunky
// sprites like everything else.
import * as THREE from 'three';
import type { PixelRenderer } from './pixel-renderer';

type P = { x: number; y: number };
const glow = (color: number, k = 2.2, opacity = 1) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending });

/** Colours per spell: [core, light]. */
export const SPELL_COLOR: Record<string, number> = {
  fireBolt: 0xff7a1a, burningHands: 0xff6a10, scorchingRay: 0xff5a10, rayOfFrost: 0x7fd8ff, shockingGrasp: 0x9fc8ff,
  magicMissile: 0xc07aff, sacredFlame: 0xffe7a0, tollTheDead: 0x8a5cff, guidingBolt: 0xfff0b0, inflictWounds: 0x7a40b0,
  sleep: 0xb08aff, healingWord: 0x7cff8a, cureWounds: 0x7cff8a, bless: 0xffe08a, shieldOfFaith: 0xfff3c0, shield: 0x8fd0ff,
  spiritualWeapon: 0x9fe8ff, aid: 0xfff3c0, mistyStep: 0xd0e0ff, divineSpark: 0xfff0b0, preserveLife: 0x9fffb0,
};

/**
 * Effect lights come from a fixed pool: three.js recompiles every material's shader
 * when the number of lights in the scene changes, so lights are never added or
 * removed mid-game, only switched on and off.
 */
class LightPool {
  private lights: { l: THREE.PointLight; until: number; token: number }[] = [];
  private now = 0;
  constructor(r: PixelRenderer, size: number) {
    for (let i = 0; i < size; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 5, 1.4);
      r.scene.add(l);
      this.lights.push({ l, until: 0, token: 0 });
    }
    r.onUpdate((dt) => { this.now += dt; });
  }
  /** Borrow the light that frees up soonest. `release` hands it back (if nobody took it since). */
  take(pos: THREE.Vector3, color: number, intensity: number, distance: number, dur: number) {
    const slot = this.lights.reduce((a, b) => (b.until < a.until ? b : a));
    slot.until = this.now + dur; slot.token++;
    const token = slot.token;
    slot.l.position.copy(pos); slot.l.color.setHex(color); slot.l.intensity = intensity; slot.l.distance = distance;
    return {
      light: slot.l,
      owned: () => slot.token === token,
      release: () => { if (slot.token === token) { slot.l.intensity = 0; slot.until = 0; } },
    };
  }
}

export class Effects {
  private weapons = new Map<string, THREE.Group>();
  private time = 0;
  private pool: LightPool;
  /** The spectral weapon's own light (one weapon at a time is all a party can have). */
  private weaponLight: THREE.PointLight;

  constructor(private r: PixelRenderer) {
    this.pool = new LightPool(r, 5);
    this.weaponLight = new THREE.PointLight(SPELL_COLOR.spiritualWeapon, 0, 3.5, 1.4);
    r.scene.add(this.weaponLight);
    r.onUpdate((dt) => {
      this.time += dt;
      const first = this.weapons.values().next().value;
      this.weaponLight.intensity = first ? 3 : 0;
      if (first) this.weaponLight.position.copy(first.position);
      for (const [, w] of this.weapons) {
        w.position.y = w.userData.baseY + Math.sin(this.time * 2.4 + w.userData.phase) * 0.08;
        w.rotation.y += dt * 1.2;
      }
    });
  }

  private at(p: P, h = 0.6) { return new THREE.Vector3(p.x, this.r.floorY(p.x, p.y) + h, p.y); }

  /** A light that fades out over `dur`. */
  private flashLight(pos: THREE.Vector3, color: number, intensity: number, dur: number, distance = 5) {
    const h = this.pool.take(pos, color, intensity, distance, dur);
    this.r.tween(dur, (k) => { if (h.owned()) h.light.intensity = intensity * (1 - k) ** 1.5; }).then(h.release);
  }

  /** A glowing orb (with its own light and a short trail) flying from a to b. */
  async bolt(from: THREE.Vector3, to: THREE.Vector3, color: number, size = 0.12, speed = 14, arc = 0) {
    const g = new THREE.Group();
    const core = new THREE.Mesh(new THREE.SphereGeometry(size, 8, 6), glow(0xffffff, 1.5));
    const halo = new THREE.Mesh(new THREE.SphereGeometry(size * 1.9, 8, 6), glow(color, 1.8, 0.75));
    g.add(core, halo);
    const trail: THREE.Mesh[] = [];
    for (let i = 0; i < 4; i++) { const t = new THREE.Mesh(new THREE.SphereGeometry(size * (1.2 - i * 0.22), 6, 4), glow(color, 1.6, 0.5 - i * 0.1)); trail.push(t); this.r.addFx(t); }
    const h = this.pool.take(from, color, 6, 5, 3);
    this.r.addFx(g);
    const dist = from.distanceTo(to);
    const pos = (k: number) => from.clone().lerp(to, k).add(new THREE.Vector3(0, Math.sin(Math.PI * k) * arc, 0));
    await this.r.tween(Math.max(0.15, dist / speed), (k) => {
      g.position.copy(pos(k));
      if (h.owned()) h.light.position.copy(g.position);
      trail.forEach((t, i) => t.position.copy(pos(Math.max(0, k - (i + 1) * 0.05))));
    });
    this.r.removeFx(g); h.release();
    trail.forEach((t) => this.r.removeFx(t));
    this.burst(to, color, 14, 0.5);
  }

  /** A straight beam that flickers for a moment (Ray of Frost, Scorching Ray). */
  async beam(from: THREE.Vector3, to: THREE.Vector3, color: number, width = 0.07, dur = 0.3) {
    const len = from.distanceTo(to);
    const geo = new THREE.CylinderGeometry(width, width, len, 6, 1, true);
    geo.rotateX(Math.PI / 2);
    const m = new THREE.Mesh(geo, glow(color, 2.4, 0.9));
    m.position.copy(from).lerp(to, 0.5);
    m.lookAt(to);
    this.r.addFx(m);
    this.flashLight(m.position, color, 7, dur + 0.2, 6);
    await this.r.tween(dur, (k) => { m.scale.set(1 - k * 0.7, 1 - k * 0.7, 1); (m.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k * 0.6); });
    this.r.removeFx(m);
    this.burst(to, color, 10, 0.4);
  }

  /** Sparks flying outward from a point, with a flash of light. */
  burst(at: THREE.Vector3, color: number, count = 18, dur = 0.55, spread = 1.4, light = true) {
    const pos = new Float32Array(count * 3), vel: THREE.Vector3[] = [];
    for (let i = 0; i < count; i++) {
      vel.push(new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize().multiplyScalar(spread * (0.4 + Math.random() * 0.6)));
      pos.set([at.x, at.y, at.z], i * 3);
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: new THREE.Color(color).multiplyScalar(2), size: 3, sizeAttenuation: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const pts = new THREE.Points(geo, mat);
    this.r.addFx(pts);
    if (light) this.flashLight(at, color, 8, dur, 4);
    let last = 0;
    this.r.tween(dur, (k) => {
      const dt = (k - last) * dur; last = k;
      const a = geo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < count; i++) { vel[i].y -= dt * 2; a.setXYZ(i, a.getX(i) + vel[i].x * dt, a.getY(i) + vel[i].y * dt, a.getZ(i) + vel[i].z * dt); }
      a.needsUpdate = true; mat.opacity = 1 - k;
    }).then(() => this.r.removeFx(pts));
  }

  /** Motes rising around a creature (healing, blessings). */
  rise(at: THREE.Vector3, color: number, count = 22, dur = 0.9) {
    const pos = new Float32Array(count * 3), speed: number[] = [];
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, rr = 0.15 + Math.random() * 0.3;
      pos.set([at.x + Math.cos(a) * rr, at.y + Math.random() * 0.3, at.z + Math.sin(a) * rr], i * 3);
      speed.push(0.6 + Math.random() * 0.8);
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: new THREE.Color(color).multiplyScalar(2), size: 3, sizeAttenuation: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const pts = new THREE.Points(geo, mat);
    this.r.addFx(pts);
    this.flashLight(at.clone().setY(at.y + 0.6), color, 5, dur, 3);
    let last = 0;
    return this.r.tween(dur, (k) => {
      const dt = (k - last) * dur; last = k;
      const a = geo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < count; i++) a.setY(i, a.getY(i) + speed[i] * dt);
      a.needsUpdate = true; mat.opacity = k < 0.7 ? 1 : (1 - k) / 0.3;
    }).then(() => this.r.removeFx(pts));
  }

  /** A pillar of light falling on a square (Sacred Flame, Divine Spark). */
  async column(p: P, color: number) {
    const base = this.at(p, 0);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 3, 10, 1, true), glow(color, 2.2, 0.85));
    m.position.copy(base).setY(base.y + 4);
    this.r.addFx(m);
    this.flashLight(base.clone().setY(base.y + 1), color, 9, 0.9, 5);
    await this.r.tween(0.22, (k) => { m.position.y = base.y + 4 - k * 2.5; });
    await this.r.tween(0.35, (k) => { (m.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - k); m.scale.set(1 + k, 1, 1 + k); });
    this.r.removeFx(m);
    this.burst(base.clone().setY(base.y + 0.3), color, 16, 0.5, 1);
  }

  /** A dark ring pulsing out from a creature (Toll the Dead, Inflict Wounds). */
  async pulse(p: P, color: number) {
    const base = this.at(p, 0.05);
    const m = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.32, 24), glow(color, 2, 0.9));
    m.rotation.x = -Math.PI / 2; m.position.copy(base);
    this.r.addFx(m);
    this.flashLight(base.clone().setY(base.y + 0.8), color, 6, 0.6, 3);
    await this.r.tween(0.5, (k) => { m.scale.setScalar(1 + k * 3); (m.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k); });
    this.r.removeFx(m);
  }

  /** Every square of an area lights up: flames for fire, mist for sleep. */
  async area(squares: P[], color: number, kind: 'fire' | 'mist' | 'holy') {
    if (!squares.length) return;
    const g = new THREE.Group();
    const tiles: THREE.Mesh[] = [];
    for (const s of squares) {
      const t = new THREE.Mesh(new THREE.PlaneGeometry(0.94, 0.94), glow(color, 1.6, 0));
      t.rotation.x = -Math.PI / 2; t.position.copy(this.at(s, 0.04));
      g.add(t); tiles.push(t);
      if (kind !== 'holy') this.burst(this.at(s, 0.2), color, kind === 'fire' ? 8 : 5, kind === 'fire' ? 0.6 : 1.1, kind === 'fire' ? 1.6 : 0.5, false);
    }
    this.r.addFx(g);
    const cx = squares.reduce((a, s) => a + s.x, 0) / squares.length, cy = squares.reduce((a, s) => a + s.y, 0) / squares.length;
    this.flashLight(this.at({ x: Math.round(cx), y: Math.round(cy) }, 0.8).setX(cx).setZ(cy), color, kind === 'fire' ? 18 : 8, kind === 'fire' ? 0.8 : 1.2, 7);
    await this.r.tween(kind === 'fire' ? 0.7 : 1.1, (k) => { for (const t of tiles) (t.material as THREE.MeshBasicMaterial).opacity = Math.sin(Math.PI * k) * 0.55; });
    this.r.removeFx(g);
  }

  /** A translucent dome around a creature (Shield). */
  async bubble(at: THREE.Vector3, color: number) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.62, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), glow(color, 1.4, 0.5));
    m.position.copy(at);
    this.r.addFx(m);
    this.flashLight(at.clone().setY(at.y + 0.6), color, 6, 0.8, 3);
    await this.r.tween(0.75, (k) => { m.scale.setScalar(0.8 + k * 0.3); (m.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - k); });
    this.r.removeFx(m);
  }

  // ------------------------------------------------------------ Spiritual Weapon

  /** A floating spectral mace with its own light. */
  summonWeapon(id: string, p: P) {
    const g = new THREE.Group();
    const mat = glow(SPELL_COLOR.spiritualWeapon, 1.8, 0.85);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.7, 6), mat);
    const head = new THREE.Mesh(new THREE.OctahedronGeometry(0.15, 0), mat);
    head.position.y = 0.38;
    const inner = new THREE.Group(); inner.add(shaft, head); inner.rotation.z = 0.5;
    g.add(inner);
    g.position.copy(this.at(p, 0.9));
    g.userData = { baseY: g.position.y, phase: Math.random() * 6 };
    this.r.addFx(g);
    this.weapons.set(id, g);
    this.burst(g.position.clone(), SPELL_COLOR.spiritualWeapon, 16, 0.5, 1);
  }

  async moveWeapon(id: string, to: P) {
    const g = this.weapons.get(id);
    if (!g) return;
    const from = g.position.clone(), dest = this.at(to, 0.9);
    await this.r.tween(Math.max(0.2, from.distanceTo(dest) / 8), (k) => { g.position.lerpVectors(from, dest, k); g.userData.baseY = g.position.y; });
  }

  /** The weapon swings at a target: a quick lunge and back. */
  async swingWeapon(id: string, target: THREE.Vector3) {
    const g = this.weapons.get(id);
    if (!g) return;
    const home = g.position.clone();
    const hit = home.clone().lerp(target, 0.6);
    await this.r.tween(0.14, (k) => { g.position.lerpVectors(home, hit, k); });
    this.burst(target, SPELL_COLOR.spiritualWeapon, 12, 0.4, 1);
    await this.r.tween(0.18, (k) => { g.position.lerpVectors(hit, home, k); });
  }

  weaponPos(id: string): THREE.Vector3 | undefined { return this.weapons.get(id)?.position.clone(); }

  unsummonWeapon(id: string) {
    const g = this.weapons.get(id);
    if (!g) return;
    this.weapons.delete(id);
    this.burst(g.position.clone(), SPELL_COLOR.spiritualWeapon, 14, 0.5, 0.8);
    this.r.removeFx(g);
  }
}
