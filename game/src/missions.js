// missions.js — the story of Marisol Vice, as data. Danny Cole, a dock courier
// who owes money all over Port Marisol, works it off one job at a time for
// Rosa Delgado of Cantina Rosa. Four missions chain together — an errand, a
// theft, a set-up and a bank-van score — and each is a list of steps the game
// interprets: go somewhere, steal a marked car, deliver it gently, shake the
// heat, stop a van, grab the bags. The MissionRunner walks the chain; the
// game performs each step's effects and checks.

export const STORY_CAST = {
  danny: 'Danny Cole — courier, driver, debtor.',
  rosa: 'Rosa Delgado — runs Cantina Rosa and half the favours in Marisol.',
  paco: 'Paco Ferrer — mechanic at Paco’s Garage. Cash only, no questions.',
};

export const MISSIONS = [
  {
    id: 'welcome',
    title: 'Welcome to Marisol',
    reward: 250,
    intro: [
      { who: 'Rosa', text: 'Danny Cole. You owe me two thousand and a gearbox, and you pay in favours now.' },
      { who: 'Rosa', text: 'A package waits at the Pier 9 warehouse. Bring it to my cantina. Do not open it.' },
      { who: 'Danny', text: 'Good to see you too, Rosa.' },
    ],
    steps: [
      { type: 'goto', at: 'docks', objective: 'Pick up Rosa’s package at Pier 9 Warehouse' },
      { type: 'goto', at: 'cantina', objective: 'Deliver the package to Cantina Rosa', effect: 'deliverPackage' },
    ],
    outro: [
      { who: 'Rosa', text: 'Heavier than it looks. So is the next job. There is a car I need, Danny…' },
    ],
  },
  {
    id: 'borrowed-wheels',
    title: 'Borrowed Wheels',
    reward: 400,
    intro: [
      { who: 'Rosa', text: 'A teal sports car sleeps in the Marina Lot. Its owner owes me more than you do.' },
      { who: 'Rosa', text: 'Take it to Paco at the garage. And Danny — bring it back beautiful.' },
    ],
    steps: [
      { type: 'goto', at: 'marina', objective: 'Go to the Marina Lot' },
      { type: 'steal', at: 'marina', objective: 'Steal the teal sports car', effect: 'spawnMissionCar' },
      { type: 'deliverCar', at: 'garage', objective: 'Deliver the car to Paco’s Garage — keep it in one piece' },
    ],
    outro: [
      { who: 'Paco', text: 'Beautiful indeed. Rosa says you drive like you were born angry. Good. She has a delivery.' },
    ],
  },
  {
    id: 'hot-corner',
    title: 'Hot Corner',
    reward: 600,
    intro: [
      { who: 'Rosa', text: 'One parcel, from my door to a man who pays in cash. Simple, yes?' },
      { who: 'Danny', text: 'With you, Rosa, “simple” is how the trouble starts.' },
    ],
    steps: [
      { type: 'goto', at: 'cantina', objective: 'Pick up the special delivery at Cantina Rosa', effect: 'ambush' },
      { type: 'escape', at: 'hideout', objective: 'Lose the heat, then reach the Harbor Hideout' },
    ],
    outro: [
      { who: 'Rosa', text: 'A set-up. Someone sold us both, Danny. The bank van, though — that one is real money.' },
    ],
  },
  {
    id: 'harbor-score',
    title: 'The Harbor Score',
    reward: 1500,
    intro: [
      { who: 'Rosa', text: 'Harbor Bank’s armoured van does its dawn run with the weekend takings.' },
      { who: 'Rosa', text: 'Stop it, take the bags, and get them to the boat at Pier 9. Then nobody owes anybody.' },
      { who: 'Danny', text: 'Then I am a free man with a fast car. Deal.' },
    ],
    steps: [
      { type: 'goto', at: 'bank', objective: 'Reach Harbor Bank before the van rolls' },
      { type: 'disableVan', at: 'bank', objective: 'Stop the armoured van — ram it or shoot it out', effect: 'spawnVan' },
      { type: 'collect', at: 'bank', objective: 'Grab the cash bags — all of them, on foot', count: 3 },
      { type: 'goto', at: 'docks', objective: 'Get the money to the boat at Pier 9', effect: 'finale' },
    ],
    outro: [
      { who: 'Rosa', text: 'Debt paid, Danny Cole. The harbour is yours now. Try not to buy it twice.' },
    ],
  },
];

export class MissionRunner {
  constructor() {
    this.index = 0;
    this.stepIndex = 0;
    this.active = false;
    this.storyComplete = false;
    this.steps = [];
  }

  get mission() {
    return MISSIONS[this.index] ?? null;
  }

  // Resolve a mission's steps against the city's landmarks and start walking.
  startMission(index, landmarks) {
    this.index = index;
    this.stepIndex = 0;
    this.active = true;
    const mission = this.mission;
    this.steps = mission.steps.map((step) => {
      const place = landmarks[step.at];
      return { ...step, x: place.x, y: place.y };
    });
    return mission.intro;
  }

  currentStep() {
    if (!this.active) return null;
    return this.steps[this.stepIndex] ?? null;
  }

  // Move to the next step. Returns 'step', 'mission' (mission finished) or
  // 'story' (the whole chain finished).
  advanceStep() {
    this.stepIndex++;
    if (this.stepIndex < this.steps.length) return 'step';
    this.active = false;
    if (this.index >= MISSIONS.length - 1) {
      this.storyComplete = true;
      return 'story';
    }
    return 'mission';
  }
}

// After the story, the cantina keeps Danny busy: endless courier jobs between
// landmarks, paying by distance. Returns a fresh two-leg job.
export function randomCourierJob(rng, landmarks) {
  const keys = Object.keys(landmarks).filter((key) => key !== 'hideout');
  const fromKey = keys[Math.floor(rng() * keys.length)];
  let toKey = keys[Math.floor(rng() * keys.length)];
  if (toKey === fromKey) toKey = keys[(keys.indexOf(fromKey) + 2) % keys.length];
  const from = landmarks[fromKey];
  const to = landmarks[toKey];
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  return {
    fromKey, toKey,
    fromX: from.x, fromY: from.y,
    toX: to.x, toY: to.y,
    reward: Math.round(90 + dist / 9),
    leg: 'pickup',
  };
}
