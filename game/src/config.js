// config.js — every shared constant for Marisol Vice lives here: world geometry,
// tuning numbers and the sun-baked palette the renderer paints with.

export const WORLD_SIZE = 2560;      // the island is a square, world units are pixels
export const ROAD_PITCH = 512;        // distance between neighbouring road centrelines
export const ROAD_HALF = 46;          // half the width of a road
export const ROAD_CENTRES = [256, 768, 1280, 1792, 2304];
export const SIDEWALK = 18;           // pavement width around each city block

export const PLAYER_RADIUS = 10;
export const PLAYER_WALK_SPEED = 118;
export const PLAYER_SPRINT_SPEED = 196;
export const CAR_RADIUS = 20;

export const HEAT_MAX = 500;          // wanted heat: 100 points per star, five stars
export const HEAT_DECAY_PER_SEC = 5;  // heat lost per second while no cop has eyes on you
export const BUST_TIME = 2.4;         // seconds a cop must stay close to a slow player

export const SAVE_KEY = 'marisol-vice-save-v1';

export const PALETTE = {
  water: '#1d6f8e',
  waterDeep: '#175a76',
  sand: '#e8cf9f',
  ground: '#b9b3a4',
  sidewalk: '#cfc9ba',
  road: '#3c4048',
  roadEdge: '#f2e3ac',
  laneDash: '#e8e4d8',
  crosswalk: '#d8d4c8',
  park: '#69a860',
  parkDark: '#55853f',
  palmTrunk: '#8a6a44',
  palmLeaf: '#3f7d3a',
  buildingWall: '#8f7f72',
  buildingShade: '#6f6156',
  playerShirt: '#ffcf4d',
  playerSkin: '#c98a5e',
  pedShirts: ['#d96b5f', '#5f8fd9', '#62b06e', '#c9c2b4', '#9a6fd0', '#e0913d', '#4fb3a9'],
  carPaints: ['#c94f42', '#3f6fb5', '#e0e3e6', '#2f3338', '#d9a441', '#5d9c6e', '#7a4f9e', '#b5651d', '#4fb3a9', '#e8e8f0'],
  sportPaint: '#17b6c9',
  taxiPaint: '#f2b827',
  vanPaint: '#d8d8dc',
  copPaint: '#22262e',
  copStripe: '#f2f2f2',
};

export const CAR_KINDS = {
  sedan: { length: 46, width: 22, accel: 215, topSpeed: 268, grip: 2.0 },
  sport: { length: 48, width: 22, accel: 285, topSpeed: 352, grip: 2.2 },
  taxi: { length: 46, width: 22, accel: 215, topSpeed: 268, grip: 2.0 },
  van: { length: 58, width: 25, accel: 175, topSpeed: 228, grip: 1.8 },
  cop: { length: 48, width: 23, accel: 268, topSpeed: 338, grip: 2.25 },
};
