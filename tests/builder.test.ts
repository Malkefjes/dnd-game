import { describe, expect, it } from 'vitest';
import { buildCharacter, pointBuyCost, validateChoices, type Choices } from '../src/data/build/builder';
import { SPECIES } from '../src/data/build/species';
import { BACKGROUNDS } from '../src/data/build/backgrounds';
import { CLASSES } from '../src/data/build/classes';
import { PRESET_CHOICES } from '../src/data/heroes';
import * as legacy from './fixtures/legacy-heroes';
import type { CreatureDef } from '../src/engine/types';
import { parseDice } from '../src/engine/dice';

const spellIds = (d: CreatureDef) => (d.spellcasting?.spells ?? []).filter((s) => !s.utility).map((s) => s.id).sort();
const attackSig = (d: CreatureDef) => d.attacks.map((a) => `${a.id} ${a.toHit} ${JSON.stringify(a.damage)} ${JSON.stringify(a.offhandDamage)} ${a.mastery ?? '-'}`);

describe('the presets, rebuilt from choices, match the hand-built heroes', () => {
  for (const id of ['torvald', 'nyx', 'maren', 'elowen'] as const) {
    for (const level of [1, 2, 3] as const) {
      it(`${id} at level ${level}`, () => {
        const old = legacy[id](level);
        const nu = buildCharacter(PRESET_CHOICES[id], level);
        expect(validateChoices(PRESET_CHOICES[id], level)).toEqual([]);
        expect(nu.abilities).toEqual(old.abilities);
        expect(nu.maxHp).toBe(old.maxHp);
        expect(nu.ac).toBe(old.ac);
        expect(nu.speed).toBe(old.speed);
        expect(nu.size).toBe(old.size);
        expect(nu.saveProfs).toEqual(old.saveProfs);
        expect(nu.sneakAttackDice).toBe(old.sneakAttackDice);
        expect(nu.description).toBe(old.description);
        for (const [s, v] of Object.entries(old.skills)) expect(nu.skills[s as keyof typeof old.skills], s).toBe(v);
        for (const f of old.features) expect(nu.features, f).toContain(f);
        for (const [k, v] of Object.entries(old.resources ?? {})) expect(nu.resources?.[k], k).toBe(v);
        expect(nu.inventory).toEqual(old.inventory);
        // the wizard now also carries her quarterstaff
        for (const a of attackSig(old)) expect(attackSig(nu)).toContain(a);
        expect(nu.spellcasting?.dc).toBe(old.spellcasting?.dc);
        expect(nu.spellcasting?.attack).toBe(old.spellcasting?.attack);
        expect(nu.spellcasting?.slots).toEqual(old.spellcasting?.slots);
        // the 2024 prepared counts let some heroes prepare one spell more than before
        for (const s of spellIds(old)) expect(spellIds(nu)).toContain(s);
      });
    }
    it(`${id} is legal and builds at level 4`, () => {
      expect(validateChoices(PRESET_CHOICES[id], 4)).toEqual([]);
      const d = buildCharacter(PRESET_CHOICES[id], 4);
      expect(d.level).toBe(4);
    });
  }

  it('level 4 adds the increase, the extra cantrip and preparation, and HP', () => {
    const t = buildCharacter(PRESET_CHOICES.torvald, 4);
    expect(t.abilities.str).toBe(19);
    expect(t.maxHp).toBe(31 + 6 + 2 + 1);
    expect(t.resources?.secondWind).toBe(3);
    expect(t.attacks.find((a) => a.id === 'longsword')!.toHit).toBe(4 + 2);
    const e = buildCharacter(PRESET_CHOICES.elowen, 4);
    expect(e.spellcasting!.dc).toBe(8 + 4 + 2);
    expect(e.spellcasting!.spells.map((s) => s.id)).toContain('chillTouch');
    expect(e.spellcasting!.slots).toEqual([0, 4, 3]);
  });

  it('Elowen\'s Magic Initiate spells are cast with Intelligence, and Mage Armor is free', () => {
    const e = buildCharacter(PRESET_CHOICES.elowen, 1);
    const ma = e.spellcasting!.spells.find((s) => s.id === 'mageArmor')!;
    expect(ma.free).toBe('magicInitiate0');
    expect(ma.castWith).toEqual({ ability: 'int', dc: 13, attack: 5 });
    expect(e.resources?.magicInitiate0).toBe(1);
    expect(e.spellcasting!.spells.filter((s) => s.id === 'mageArmor')).toHaveLength(1);
    expect(e.spellcasting!.spells.find((s) => s.id === 'prestidigitation')?.castWith?.ability).toBe('int');
  });
});

const base: Choices = {
  name: 'Test', species: 'human', speciesSkill: 'perception', versatileFeat: 'tough', cls: 'paladin', background: 'acolyte',
  scoreMethod: 'pointBuy', base: { str: 15, dex: 10, con: 13, int: 8, wis: 10, cha: 15 }, boosts: { cha: 2, wis: 1 },
  skills: ['athletics', 'medicine'], fightingStyle: 'greatWeapon', masteries: ['greatsword', 'javelin'], kit: 'greatsword',
  feats: [{ cantrips: ['sacredFlame', 'guidance'], spell: 'bless' }], spells: ['divineFavor', 'cureWounds', 'heroism', 'shieldOfFaith', 'protectionFromEvilAndGood'],
  level4: { asi: { str: 1, cha: 1 } },
};

describe('building characters', () => {
  it('point buy costs follow the 2024 table', () => {
    expect(pointBuyCost({ str: 15, dex: 15, con: 15, int: 8, wis: 8, cha: 8 })).toBe(27);
    expect(pointBuyCost(base.base)).toBe(9 + 2 + 5 + 0 + 2 + 9);
    expect(validateChoices({ ...base, base: { ...base.base, dex: 12 } }, 1).join()).toContain('Point buy costs 29');
  });

  it('a human paladin of Devotion, levels 1–4', () => {
    expect(validateChoices(base, 4)).toEqual([]);
    const p1 = buildCharacter(base, 1);
    // d10 + CON 1 + Tough 2
    expect(p1.maxHp).toBe(13);
    expect(p1.ac).toBe(16);
    expect(p1.speed).toBe(30);
    expect(p1.resources).toMatchObject({ layOnHands: 5 });
    expect(p1.spellcasting!.slots).toEqual([0, 2]);
    expect(p1.spellcasting!.dc).toBe(8 + 3 + 2);
    // Fighting Style arrives at level 2
    expect(p1.features).not.toContain('fightingStyleGreatWeapon');
    expect(p1.attacks.find((a) => a.id === 'greatsword')!.gwf).toBeUndefined();
    const ids = (d: CreatureDef) => d.spellcasting!.spells.map((s) => s.id);
    expect(ids(p1)).toEqual(expect.arrayContaining(['divineFavor', 'cureWounds', 'bless', 'layOnHands', 'sacredFlame', 'guidance']));
    expect(ids(p1)).not.toContain('heroism');
    const p3 = buildCharacter(base, 3);
    expect(p3.features).toEqual(expect.arrayContaining(['fightingStyleGreatWeapon', 'paladinsSmite', 'channelDivinity', 'sacredWeapon']));
    expect(p3.attacks.find((a) => a.id === 'greatsword')!.gwf).toBe(true);
    expect(p3.resources).toMatchObject({ layOnHands: 15, paladinsSmite: 1, channelDivinity: 2 });
    const smite = p3.spellcasting!.spells.find((s) => s.id === 'divineSmite')!;
    expect(smite).toMatchObject({ always: true, free: 'paladinsSmite' });
    // oath spells don't take a prepared place: 4 chosen + Divine Smite + 2 oath spells + Bless (Magic Initiate)
    expect(ids(p3)).toEqual(expect.arrayContaining(['divineFavor', 'cureWounds', 'heroism', 'shieldOfFaith', 'protectionFromEvilAndGood', 'divineSmite', 'sacredWeapon']));
    expect(p3.description).toBe('Human Paladin 3 (Devotion)');
    const p4 = buildCharacter(base, 4);
    expect(p4.abilities).toMatchObject({ str: 16, cha: 18 });
    expect(p4.spellcasting!.slots).toEqual([0, 3]);
  });

  it('species traits: breath weapons, resistances, speed and lineage spells', () => {
    const db = buildCharacter({ ...base, species: 'dragonborn', lineage: 'silver', speciesSkill: undefined, versatileFeat: undefined }, 1);
    expect(db.resist).toEqual(['cold']);
    const breath = db.spellcasting!.spells.filter((s) => s.uses === 'breathWeapon');
    expect(breath.map((s) => s.damage?.type)).toEqual(['cold', 'cold']);
    expect(breath[0].castWith).toEqual({ ability: 'con', dc: 8 + 1 + 2, attack: 3 });
    expect(db.resources?.breathWeapon).toBe(2);

    const tf = buildCharacter({ ...base, species: 'tiefling', lineage: 'infernal', speciesAbility: 'cha', speciesSkill: undefined, versatileFeat: undefined }, 1);
    expect(tf.resist).toEqual(['fire']);
    expect(tf.spellcasting!.spells.find((s) => s.id === 'fireBolt')!.castWith).toEqual({ ability: 'cha', dc: 13, attack: 5 });

    const we = buildCharacter({ ...base, species: 'elf', lineage: 'wood', speciesSkill: 'survival', versatileFeat: undefined }, 1);
    expect(we.speed).toBe(35);
    const gol = buildCharacter({ ...base, species: 'goliath', lineage: 'stone', speciesSkill: undefined, versatileFeat: undefined }, 1);
    expect(gol.speed).toBe(35);
    expect(gol.features).toContain('stonesEndurance');
    expect(gol.resources?.giantAncestry).toBe(2);
    const orc = buildCharacter({ ...base, species: 'orc', speciesSkill: undefined, versatileFeat: undefined }, 1);
    expect(orc.resources).toMatchObject({ adrenalineRush: 2, relentlessEndurance: 1 });
    const aas = buildCharacter({ ...base, species: 'aasimar', speciesSkill: undefined, versatileFeat: undefined }, 1);
    expect(aas.resist).toEqual(['necrotic', 'radiant']);
    expect(aas.spellcasting!.spells.find((s) => s.id === 'healingHands')!.heal?.dice).toBe('2d4');
  });

  it('heavy armor without the Strength it needs costs 10 ft of speed', () => {
    const weak = buildCharacter({ ...base, base: { str: 12, dex: 10, con: 14, int: 10, wis: 10, cha: 15 } }, 1);
    expect(weak.abilities.str).toBe(12);
    expect(weak.speed).toBe(20);
  });

  it('fighting styles change the attack profiles', () => {
    const f: Choices = {
      name: 'F', species: 'dwarf', cls: 'fighter', background: 'soldier', scoreMethod: 'standard',
      base: { str: 15, dex: 14, con: 13, int: 8, wis: 12, cha: 10 }, boosts: { str: 2, con: 1 }, skills: ['perception', 'history'],
      fightingStyle: 'dueling', masteries: ['longsword', 'javelin', 'shortsword'], kit: 'swordAndShield',
    };
    expect(validateChoices(f, 1)).toEqual([]);
    const duel = buildCharacter(f, 1);
    expect(duel.attacks.find((a) => a.id === 'longsword')!.damage.bonus).toBe(3 + 2);
    expect(duel.attacks.find((a) => a.id === 'javelin-throw')!.damage.bonus).toBe(3);
    expect(duel.ac).toBe(18);
    const archer = buildCharacter({ ...f, fightingStyle: 'archery', kit: 'archer' }, 1);
    expect(archer.attacks.find((a) => a.id === 'longbow')!.toHit).toBe(2 + 2 + 2);
    expect(archer.ac).toBe(12 + 2);
    const twf = buildCharacter({ ...f, fightingStyle: 'twoWeapon', kit: 'archer' }, 1);
    expect(twf.attacks.find((a) => a.id === 'scimitar')!.offhandDamage!.bonus).toBe(3);
    const def = buildCharacter({ ...f, fightingStyle: 'defense', kit: 'greatsword' }, 1);
    expect(def.ac).toBe(17);
  });

  it('origin feats: Skilled, Tavern Brawler, Thaumaturge', () => {
    const c: Choices = {
      name: 'C', species: 'human', speciesSkill: 'athletics', versatileFeat: 'tavernBrawler', cls: 'cleric', background: 'noble',
      scoreMethod: 'standard', base: { str: 13, dex: 10, con: 14, int: 12, wis: 15, cha: 8 }, boosts: { int: 1, str: 1, cha: 1 },
      skills: ['medicine', 'insight'], divineOrder: 'thaumaturge', kit: 'cleric', feats: [{ skills: ['stealth', 'arcana', 'survival'] }],
      cantrips: ['sacredFlame', 'tollTheDead', 'light', 'thaumaturgy'], spells: ['bless', 'healingWord', 'guidingBolt', 'cureWounds'],
    };
    expect(validateChoices(c, 1)).toEqual([]);
    const d = buildCharacter(c, 1);
    expect(d.skills.stealth).toBe(0 + 2);
    // Arcana: INT 13 → +1, proficient +2, Thaumaturge + WIS 2
    expect(d.skills.arcana).toBe(1 + 2 + 2);
    expect(d.attacks.find((a) => a.id === 'unarmed')!.damage).toEqual(parseDice('1d4+2'));
    expect(d.spellcasting!.spells.map((s) => s.id)).toContain('thaumaturgy');
    expect(d.ac).toBe(13 + 0 + 2);
  });

  it('validation catches illegal choices', () => {
    const errs = (c: Partial<Choices>, level = 1) => validateChoices({ ...base, ...c }, level).join(' | ');
    expect(errs({ boosts: { str: 2, cha: 1 } })).toContain('Acolyte raises only');
    expect(errs({ boosts: { cha: 2, wis: 2 } })).toContain('+2 and +1');
    expect(errs({ skills: ['athletics', 'stealth'] })).toContain('aren\'t all Paladin skills');
    expect(errs({ skills: ['insight', 'medicine'] })).toContain('picked twice');
    expect(errs({ fightingStyle: undefined }, 2)).toContain('Fighting Style');
    expect(errs({ fightingStyle: undefined }, 1)).not.toContain('Fighting Style');
    expect(errs({ masteries: ['greatsword'] })).toContain('Weapon Mastery');
    expect(errs({ versatileFeat: undefined })).toContain('Versatile');
    expect(errs({ species: 'elf', lineage: undefined, speciesSkill: undefined, versatileFeat: undefined })).toContain('Elven Lineage');
    expect(errs({ level4: undefined }, 4)).toContain('Level 4');
    expect(errs({ feats: [{ cantrips: ['fireBolt', 'guidance'], spell: 'bless' }] })).toContain('two cleric cantrips');
    expect(validateChoices({ ...base, cls: 'wizard', kit: 'wizard', spells: ['magicMissile'], cantrips: ['fireBolt', 'light', 'mending'], skills: ['arcana', 'history'] }, 1).join()).toContain('spellbook needs 6');
    expect(validateChoices({ ...base, cls: 'cleric', divineOrder: 'thaumaturge', kit: 'protector', skills: ['history', 'medicine'], cantrips: ['sacredFlame', 'light', 'mending', 'tollTheDead'], spells: ['bless'] }, 1).join()).toContain('needs the Protector order');
  });

  it('every species, background and class builds a legal level 1 character', () => {
    for (const sp of SPECIES) for (const bg of BACKGROUNDS) for (const cls of Object.values(CLASSES)) {
      const c: Choices = {
        name: 'X', species: sp.id, lineage: sp.lineages?.[0].id, speciesSkill: sp.skillChoice ? (Array.isArray(sp.skillChoice) ? sp.skillChoice[0] : 'survival') : undefined,
        versatileFeat: sp.originFeat ? (bg.feat === 'tough' ? 'alert' : 'tough') : undefined, cls: cls.id, background: bg.id,
        scoreMethod: 'standard', base: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 }, boosts: { [bg.abilities[0]]: 2, [bg.abilities[1]]: 1 },
        skills: cls.skillList.filter((s) => !bg.skills.includes(s) && s !== 'survival' && s !== 'insight' && s !== 'perception').slice(0, cls.skillCount),
        kit: cls.kits[0].id, fightingStyle: 'defense', masteries: ['dagger', 'shortbow', 'quarterstaff'], divineOrder: 'protector',
        cantrips: cls.casting?.cantripList.filter((id) => !['light', 'thaumaturgy', 'prestidigitation', 'druidcraft', 'dancingLights', 'minorIllusion', 'mending', 'fireBolt', 'poisonSpray', 'chillTouch'].includes(id)).slice(0, 3),
        spells: cls.casting?.list, expertise: undefined,
        feats: bg.feat === 'magicInitiate' ? [{ cantrips: ['mending', 'guidance'].filter((x) => x !== 'guidance' || bg.magicList !== 'wizard').concat(bg.magicList === 'wizard' ? ['light'] : []), spell: 'protectionFromEvilAndGood' }]
          : bg.feat === 'skilled' ? [{ skills: ['nature', 'performance', 'medicine'].filter((s) => !bg.skills.includes(s as never)).concat(['religion']).slice(0, 3) as never }] : undefined,
      };
      if (cls.id === 'rogue') c.expertise = [bg.skills[0], bg.skills[1]];
      const errs = validateChoices(c, 1).filter((e) => !e.includes('picked twice'));
      expect(errs, `${sp.id} ${bg.id} ${cls.id}`).toEqual([]);
      const d = buildCharacter(c, 1);
      expect(d.maxHp, `${sp.id} ${bg.id} ${cls.id}`).toBeGreaterThan(0);
      expect(d.ac).toBeGreaterThanOrEqual(10);
    }
  });
});
