// city.js — builds Port Marisol: a square island city on a five-by-five road
// grid. Between the roads sit blocks of buildings, parks and parking lots; the
// rim of the island is a palm-lined promenade above the water. Landmark lots
// (the cantina, the garage, the bank, the police station, the hospital, the
// docks warehouse and the marina lot) are placed by hand so the story missions
// always have their stages; everything else is seeded and rebuilt identically
// on every load.

import { WORLD_SIZE, ROAD_CENTRES, ROAD_HALF, PALETTE } from './config.js';
import { mulberry32, randRange, randInt, pickRandom } from './rng.js';

const WALL_SHADES = ['#c9a689', '#b7c3c9', '#d9b8a3', '#a8b8a0', '#e3cfa8', '#c48f7d', '#9fb4c7', '#d6d0c2', '#bf9db0', '#e8e0cc'];
const ROOF_SHADES = ['#7d6a5c', '#5f707c', '#8a7a68', '#6e5a4e', '#7c8894', '#93765e'];

// The hand-placed stages of the story, keyed by block coordinates on the grid.
const LANDMARK_BLOCKS = {
  '1,0': 'cantina',
  '1,1': 'bank',
  '3,1': 'police',
  '0,2': 'hospital',
  '2,3': 'garage',
  '3,3': 'marina',
};

export const LANDMARK_INFO = {
  cantina: { name: 'Cantina Rosa', blurb: 'Rosa’s cantina — cold drinks, warm gossip, hot jobs.' },
  bank: { name: 'Harbor Bank', blurb: 'Harbor Bank of Marisol. The van leaves at dawn.' },
  police: { name: 'Marisol PD', blurb: 'Port Marisol Police Department.' },
  hospital: { name: 'St. Lucia Hospital', blurb: 'St. Lucia General Hospital.' },
  garage: { name: 'Paco’s Garage', blurb: 'Paco’s Garage — no questions, cash only.' },
  docks: { name: 'Pier 9 Warehouse', blurb: 'The old Pier 9 warehouse on the south docks.' },
  marina: { name: 'Marina Lot', blurb: 'Marina parking lot. Nice cars, careless owners.' },
  hideout: { name: 'Harbor Hideout', blurb: 'A quiet lock-up behind the garage row.' },
};

export function blockBounds(index) {
  const start = ROAD_CENTRES[index] + ROAD_HALF;
  const end = ROAD_CENTRES[index + 1] - ROAD_HALF;
  return { start, end, size: end - start };
}

export function isOnRoad(x, y) {
  if (x < 0 || y < 0 || x > WORLD_SIZE || y > WORLD_SIZE) return false;
  for (const centre of ROAD_CENTRES) {
    if (Math.abs(x - centre) <= ROAD_HALF || Math.abs(y - centre) <= ROAD_HALF) return true;
  }
  return false;
}

export function nearestRoadCentreline(x, y) {
  let bestX = ROAD_CENTRES[0];
  let bestY = ROAD_CENTRES[0];
  for (const centre of ROAD_CENTRES) {
    if (Math.abs(centre - x) < Math.abs(bestX - x)) bestX = centre;
    if (Math.abs(centre - y) < Math.abs(bestY - y)) bestY = centre;
  }
  return { x: bestX, y: bestY };
}

// Push a circle out of every building rectangle it overlaps. Returns the
// corrected position and whether anything was hit, so vehicles can take damage.
export function collideCircleWithSolids(x, y, radius, solids) {
  let hit = false;
  for (const rect of solids) {
    const nearestX = Math.max(rect.x, Math.min(x, rect.x + rect.w));
    const nearestY = Math.max(rect.y, Math.min(y, rect.y + rect.h));
    const dx = x - nearestX;
    const dy = y - nearestY;
    const distSq = dx * dx + dy * dy;
    if (distSq >= radius * radius) continue;
    hit = true;
    if (distSq > 0.0001) {
      const dist = Math.sqrt(distSq);
      x = nearestX + (dx / dist) * radius;
      y = nearestY + (dy / dist) * radius;
    } else {
      // Centre is inside the rect: push out through the nearest face.
      const left = x - rect.x;
      const right = rect.x + rect.w - x;
      const top = y - rect.y;
      const bottom = rect.y + rect.h - y;
      const smallest = Math.min(left, right, top, bottom);
      if (smallest === left) x = rect.x - radius;
      else if (smallest === right) x = rect.x + rect.w + radius;
      else if (smallest === top) y = rect.y - radius;
      else y = rect.y + rect.h + radius;
    }
  }
  return { x, y, hit };
}

export function buildCity(seed) {
  const rng = mulberry32(seed);
  const buildings = [];
  const parks = [];
  const lots = [];
  const trees = [];
  const parkedCarSpawns = [];
  const landmarks = {};

  function addBuilding(x, y, w, h, options = {}) {
    const building = {
      x, y, w, h,
      height: options.height ?? randRange(rng, 14, 46),
      wall: options.wall ?? pickRandom(rng, WALL_SHADES),
      roof: options.roof ?? pickRandom(rng, ROOF_SHADES),
      name: options.name ?? null,
      landmark: options.landmark ?? null,
    };
    buildings.push(building);
    return building;
  }

  function addPark(x, y, w, h) {
    parks.push({ x, y, w, h });
    const count = randInt(rng, 3, 6);
    for (let i = 0; i < count; i++) {
      trees.push({ x: randRange(rng, x + 16, x + w - 16), y: randRange(rng, y + 16, y + h - 16), size: randRange(rng, 0.8, 1.3) });
    }
  }

  function addParkingLot(x, y, w, h, carCount) {
    lots.push({ x, y, w, h });
    for (let i = 0; i < carCount; i++) {
      const vertical = rng() > 0.5;
      parkedCarSpawns.push({
        x: randRange(rng, x + 30, x + w - 30),
        y: randRange(rng, y + 30, y + h - 30),
        angle: vertical ? Math.PI / 2 : 0,
        kind: rng() > 0.82 ? 'sport' : 'sedan',
      });
    }
  }

  // The sixteen blocks between the roads.
  for (let bx = 0; bx < 4; bx++) {
    for (let by = 0; by < 4; by++) {
      const xb = blockBounds(bx);
      const yb = blockBounds(by);
      const landmarkKind = LANDMARK_BLOCKS[`${bx},${by}`];
      if (landmarkKind) {
        buildLandmarkBlock(landmarkKind, xb.start, yb.start, xb.size);
        continue;
      }
      // A plain block: four lots in a two-by-two split with an alley cross.
      const half = xb.size / 2;
      const lotSize = half - 14;
      for (let lx = 0; lx < 2; lx++) {
        for (let ly = 0; ly < 2; ly++) {
          const x = xb.start + 7 + lx * half;
          const y = yb.start + 7 + ly * half;
          const roll = rng();
          if (roll < 0.52) {
            const inset = randRange(rng, 6, 20);
            addBuilding(x + inset, y + inset, lotSize - inset * 2, lotSize - inset * 2);
          } else if (roll < 0.74) {
            addParkingLot(x + 4, y + 4, lotSize - 8, lotSize - 8, randInt(rng, 1, 3));
          } else {
            addPark(x + 4, y + 4, lotSize - 8, lotSize - 8);
          }
        }
      }
    }
  }

  function buildLandmarkBlock(kind, x, y, size) {
    const info = LANDMARK_INFO[kind];
    if (kind === 'marina') {
      // The marina lot is one big car park: the story's sports car waits here.
      addParkingLot(x + 6, y + 6, size - 12, size - 12, 4);
      landmarks.marina = { x: x + size / 2, y: y + size / 2, kind };
      return;
    }
    const building = addBuilding(x + 60, y + 60, size - 170, size - 190, {
      height: kind === 'bank' ? 52 : 34,
      wall: kind === 'bank' ? '#d8cfb8' : kind === 'police' ? '#aebfc9' : kind === 'hospital' ? '#e8ecec' : '#c9855f',
      name: info.name,
      landmark: kind,
    });
    addParkingLot(x + size - 96, y + 60, 84, size - 130, 2);
    addPark(x + 60, y + size - 108, size - 170, 52);
    landmarks[kind] = { x: building.x + building.w / 2, y: building.y + building.h + 26, kind, building };
  }

  // The docks warehouse stands on the south promenade, and the hideout is a
  // lock-up on the east promenade; both are stages the story walks to.
  const warehouse = addBuilding(1130, 2406, 300, 96, { height: 26, wall: '#9c8468', name: LANDMARK_INFO.docks.name, landmark: 'docks' });
  landmarks.docks = { x: warehouse.x + warehouse.w / 2, y: warehouse.y - 24, kind: 'docks', building: warehouse };
  const lockup = addBuilding(2412, 1130, 96, 220, { height: 20, wall: '#8d8578', name: LANDMARK_INFO.hideout.name, landmark: 'hideout' });
  landmarks.hideout = { x: lockup.x - 24, y: lockup.y + lockup.h / 2, kind: 'hideout', building: lockup };

  // Palms ring the promenade between the coast road and the sand.
  for (let p = 90; p < WORLD_SIZE - 60; p += 118) {
    trees.push({ x: p + randRange(rng, -8, 8), y: 168, size: randRange(rng, 0.85, 1.25) });
    trees.push({ x: p + randRange(rng, -8, 8), y: WORLD_SIZE - 168, size: randRange(rng, 0.85, 1.25) });
    trees.push({ x: 168, y: p + randRange(rng, -8, 8), size: randRange(rng, 0.85, 1.25) });
    trees.push({ x: WORLD_SIZE - 168, y: p + randRange(rng, -8, 8), size: randRange(rng, 0.85, 1.25) });
  }

  // A few cars parked along the coast roads so the player always has a ride.
  for (const centre of ROAD_CENTRES) {
    parkedCarSpawns.push({ x: centre - 30, y: 420 + randRange(rng, 0, 1500), angle: Math.PI / 2, kind: 'sedan' });
    parkedCarSpawns.push({ x: 420 + randRange(rng, 0, 1500), y: centre + 30, angle: 0, kind: rng() > 0.7 ? 'taxi' : 'sedan' });
  }

  return {
    buildings,
    parks,
    lots,
    trees,
    parkedCarSpawns,
    landmarks,
    solids: buildings,
    palette: PALETTE,
  };
}

// A random point on a road, between minDist and maxDist from (fromX, fromY) —
// used to spawn traffic and police just out of sight.
export function randomRoadPoint(rng, fromX, fromY, minDist, maxDist) {
  for (let tries = 0; tries < 24; tries++) {
    const vertical = rng() > 0.5;
    const centre = ROAD_CENTRES[Math.floor(rng() * ROAD_CENTRES.length)];
    const along = randRange(rng, 60, WORLD_SIZE - 60);
    const x = vertical ? centre : along;
    const y = vertical ? along : centre;
    const dist = Math.hypot(x - fromX, y - fromY);
    if (dist >= minDist && dist <= maxDist) return { x, y };
  }
  return { x: ROAD_CENTRES[0], y: ROAD_CENTRES[0] };
}
