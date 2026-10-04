import { describe, expect, it } from 'vitest';
import { complete, newChoices, placeScores, rollScores, standardFor } from '../src/data/build/defaults';
import { buildCharacter, validateChoices, type Choices } from '../src/data/build/builder';
import { SPECIES } from '../src/data/build/species';
import { BACKGROUNDS } from '../src/data/build/backgrounds';
import { CLASSES, type ClassId } from '../src/data/build/classes';
import { PRESET_CHOICES } from '../src/data/heroes';

describe('creator defaults', () => {
  it('a new character is legal', () => {
    const c = newChoices('Ada');
    expect(validateChoices(c, 1)).toEqual([]);
  });

  it('every species × class × background completes to a legal level 1 character', () => {
    for (const sp of SPECIES) for (const cls of Object.keys(CLASSES) as ClassId[]) for (const bg of BACKGROUNDS) {
      const c = complete({ ...newChoices('X'), species: sp.id, cls, background: bg.id });
      expect(validateChoices(c, 1), `${sp.id} ${cls} ${bg.id}`).toEqual([]);
      expect(buildCharacter(c, 1).maxHp).toBeGreaterThan(0);
    }
  });

  it('keeps legal picks when something else changes', () => {
    const c = complete({ ...newChoices('X'), cls: 'rogue', skills: ['deception', 'sleightOfHand', 'insight', 'acrobatics'] });
    const d = complete({ ...c, background: 'criminal' }); // Criminal gives Sleight of Hand and Stealth
    expect(d.skills).toContain('deception');
    expect(d.skills).not.toContain('sleightOfHand');
    expect(d.skills).toHaveLength(4);
    expect(validateChoices(d, 1)).toEqual([]);
  });

  it('switching class re-places the standard array and drops what no longer applies', () => {
    const w = complete({ ...newChoices('X'), cls: 'wizard', base: standardFor('fighter') });
    expect(w.base).toEqual(standardFor('fighter')); // still a legal standard array: kept
    const p = complete({ ...w, cls: 'paladin' });
    expect(p.cantrips).toEqual([]);
    expect(p.scholar).toBeUndefined();
    expect(p.fightingStyle).toBeDefined();
    expect(validateChoices(p, 1)).toEqual([]);
  });

  it('the presets are already complete', () => {
    for (const [id, c] of Object.entries(PRESET_CHOICES)) {
      const d: Choices = complete(c);
      expect(buildCharacter(d, 3), id).toEqual(buildCharacter(c, 3));
    }
  });

  it('4d6 drop lowest', () => {
    const dice = [6, 6, 6, 1, 1, 1, 1, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 2, 2, 2, 3, 3, 3, 3];
    let i = 0;
    const vals = rollScores(() => dice[i++ % dice.length]);
    expect(vals.slice(0, 4)).toEqual([18, 3, 12, 15]);
    expect(placeScores([8, 18, 10, 12, 14, 9], 'wizard').int).toBe(18);
  });
});
