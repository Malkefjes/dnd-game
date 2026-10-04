// Backgrounds and origin feats from the 2024 Player's Handbook.
import type { Ability, FeatureId, Skill } from '../../engine/types';

export type OriginFeatId = 'alert' | 'crafter' | 'healer' | 'lucky' | 'magicInitiate' | 'musician' | 'savageAttacker' | 'skilled' | 'tavernBrawler' | 'tough';

export interface OriginFeat {
  id: OriginFeatId;
  name: string;
  text: string;
  implemented: boolean;
  feature?: FeatureId;
}

export const ORIGIN_FEATS: Record<OriginFeatId, OriginFeat> = {
  alert: { id: 'alert', name: 'Alert', feature: 'alert', implemented: true, text: 'Add your Proficiency Bonus to Initiative. (Swapping Initiative with an ally isn\'t in yet.)' },
  crafter: { id: 'crafter', name: 'Crafter', implemented: false, text: 'Tool proficiencies, discounts and fast crafting. No use in a fight.' },
  healer: { id: 'healer', name: 'Healer', feature: 'healer', implemented: true, text: 'Healing Rerolls: reroll 1s on healing dice. (Battle Medic comes with Hit Dice in a later phase.)' },
  lucky: { id: 'lucky', name: 'Lucky', feature: 'lucky', implemented: false, text: 'Luck Points equal to your Proficiency Bonus: Advantage on your d20 Tests, or Disadvantage on an attack against you.' },
  magicInitiate: { id: 'magicInitiate', name: 'Magic Initiate', feature: 'magicInitiate', implemented: true, text: 'Two cantrips and one 1st-level spell from the Cleric, Druid or Wizard list. Cast the spell once per Long Rest without a slot (or with your slots).' },
  musician: { id: 'musician', name: 'Musician', implemented: false, text: 'Play a song on a rest to give allies Heroic Inspiration.' },
  savageAttacker: { id: 'savageAttacker', name: 'Savage Attacker', feature: 'savageAttacker', implemented: true, text: 'Once per turn, roll a weapon\'s damage dice twice and use either roll.' },
  skilled: { id: 'skilled', name: 'Skilled', feature: 'skilled', implemented: true, text: 'Proficiency in any three skills.' },
  tavernBrawler: { id: 'tavernBrawler', name: 'Tavern Brawler', feature: 'tavernBrawler', implemented: true, text: 'Unarmed Strikes deal 1d4 + STR and reroll 1s; push the target 5 ft once per turn on a hit.' },
  tough: { id: 'tough', name: 'Tough', feature: 'tough', implemented: true, text: 'Your Hit Point maximum increases by 2 per level.' },
};

export interface BackgroundDef {
  id: string;
  name: string;
  /** The three abilities it can raise: +2/+1 to two of them, or +1 to all three. */
  abilities: [Ability, Ability, Ability];
  skills: [Skill, Skill];
  feat: OriginFeatId;
  /** Magic Initiate's spell list, fixed by the background. */
  magicList?: 'cleric' | 'druid' | 'wizard';
  blurb: string;
}

const B = (id: string, name: string, abilities: [Ability, Ability, Ability], skills: [Skill, Skill], feat: OriginFeatId, blurb: string, magicList?: BackgroundDef['magicList']): BackgroundDef =>
  ({ id, name, abilities, skills, feat, blurb, magicList });

export const BACKGROUNDS: BackgroundDef[] = [
  B('acolyte', 'Acolyte', ['int', 'wis', 'cha'], ['insight', 'religion'], 'magicInitiate', 'You served in a temple, performing rites in honour of a god.', 'cleric'),
  B('artisan', 'Artisan', ['str', 'dex', 'int'], ['investigation', 'persuasion'], 'crafter', 'You learned a craft from a master and know the value of good work.'),
  B('charlatan', 'Charlatan', ['dex', 'con', 'cha'], ['deception', 'sleightOfHand'], 'skilled', 'You made your living with forged papers and false promises.'),
  B('criminal', 'Criminal', ['dex', 'con', 'int'], ['sleightOfHand', 'stealth'], 'alert', 'You learned to survive in the gutters, by stealth and nerve.'),
  B('entertainer', 'Entertainer', ['str', 'dex', 'cha'], ['acrobatics', 'performance'], 'musician', 'You performed in taverns and fairs for coin and applause.'),
  B('farmer', 'Farmer', ['str', 'con', 'wis'], ['animalHandling', 'nature'], 'tough', 'You grew up close to the land, strong from honest work.'),
  B('guard', 'Guard', ['str', 'int', 'wis'], ['athletics', 'perception'], 'alert', 'You stood watch on walls and gates, alert to every threat.'),
  B('guide', 'Guide', ['dex', 'con', 'wis'], ['stealth', 'survival'], 'magicInitiate', 'You led travellers through the wilds and learned a little nature magic.', 'druid'),
  B('hermit', 'Hermit', ['con', 'wis', 'cha'], ['medicine', 'religion'], 'healer', 'You lived apart, tending the sick and pondering mysteries.'),
  B('merchant', 'Merchant', ['con', 'int', 'cha'], ['animalHandling', 'persuasion'], 'lucky', 'You bought and sold, and fortune smiled on you more often than not.'),
  B('noble', 'Noble', ['str', 'int', 'cha'], ['history', 'persuasion'], 'skilled', 'You were raised in wealth and taught to lead.'),
  B('sage', 'Sage', ['con', 'int', 'wis'], ['arcana', 'history'], 'magicInitiate', 'You spent years in libraries and learned the rudiments of magic.', 'wizard'),
  B('sailor', 'Sailor', ['str', 'dex', 'wis'], ['acrobatics', 'perception'], 'tavernBrawler', 'You worked the decks of ships and the brawls of harbour taverns.'),
  B('scribe', 'Scribe', ['dex', 'int', 'wis'], ['investigation', 'perception'], 'skilled', 'You copied texts and kept records with a careful eye.'),
  B('soldier', 'Soldier', ['str', 'dex', 'con'], ['athletics', 'intimidation'], 'savageAttacker', 'You trained for war and fought in the line.'),
  B('wayfarer', 'Wayfarer', ['dex', 'wis', 'cha'], ['insight', 'stealth'], 'lucky', 'You grew up on the streets and roads, surviving on luck and wits.'),
];

export const backgroundById = (id: string) => BACKGROUNDS.find((b) => b.id === id)!;

/** Spells Magic Initiate can teach, by list (the implemented ones). */
export const MAGIC_INITIATE: Record<'cleric' | 'druid' | 'wizard', { cantrips: string[]; spells: string[] }> = {
  cleric: { cantrips: ['sacredFlame', 'tollTheDead', 'spareTheDying', 'guidance', 'light', 'thaumaturgy', 'mending'], spells: ['bless', 'cureWounds', 'guidingBolt', 'healingWord', 'inflictWounds', 'shieldOfFaith', 'protectionFromEvilAndGood'] },
  druid: { cantrips: ['produceFlame', 'guidance', 'druidcraft', 'poisonSpray', 'mending'], spells: ['cureWounds', 'healingWord', 'protectionFromEvilAndGood'] },
  wizard: { cantrips: ['fireBolt', 'rayOfFrost', 'shockingGrasp', 'chillTouch', 'poisonSpray', 'light', 'mageHand', 'prestidigitation', 'minorIllusion', 'dancingLights', 'mending'], spells: ['magicMissile', 'shield', 'burningHands', 'sleep', 'mageArmor', 'protectionFromEvilAndGood'] },
};
