// police.js — Marisol PD. PoliceControl keeps as many patrol cars on the
// street as the wanted level demands, spawning them on roads just out of
// sight. Each unit steers for the player's predicted position and tries to
// ram or box the player in; when the stars are gone the units peel away and
// despawn off-screen. Whether the player is seen, and how close the nearest
// unit is, drives the wanted decay and the bust meter in the game.

import { PALETTE } from './config.js';
import { Car } from './vehicles.js';
import { randomRoadPoint } from './city.js';
import { clamp, angleDifference, angleTowards } from './rng.js';

export class PoliceControl {
  constructor(rng) {
    this.rng = rng;
    this.units = [];
    this.spawnTimer = 0;
    this.nearestDistance = Infinity;
    this.eyesOnPlayer = false;
  }

  reset() {
    this.units = [];
    this.spawnTimer = 0;
    this.nearestDistance = Infinity;
    this.eyesOnPlayer = false;
  }

  desiredUnits(stars) {
    if (stars <= 0) return 0;
    return Math.min(2 + stars * 2, 9);
  }

  // focus: the thing being hunted — the player's car, or the player on foot.
  update(dt, focus, stars, solids) {
    this.spawnTimer -= dt;
    const wanted = this.desiredUnits(stars);
    if (stars > 0 && this.units.length < wanted && this.spawnTimer <= 0) {
      this.spawnTimer = 1.1;
      const spot = randomRoadPoint(this.rng, focus.x, focus.y, 580, 780);
      const unit = new Car(spot.x, spot.y, angleTowards(spot.x, spot.y, focus.x, focus.y), 'cop', PALETTE.copPaint);
      unit.driverAge = 0;
      unit.stuckTime = 0;
      this.units.push(unit);
    }

    this.nearestDistance = Infinity;
    this.eyesOnPlayer = false;
    const survivors = [];
    for (const unit of this.units) {
      unit.driverAge += dt;
      const dist = Math.hypot(focus.x - unit.x, focus.y - unit.y);
      if (!unit.dead) {
        this.nearestDistance = Math.min(this.nearestDistance, dist);
        if (dist < 430) this.eyesOnPlayer = true;
      }
      if (stars <= 0) {
        // Heat is gone: units break off. Once one is far away it is off duty.
        if (dist > 640 && unit.driverAge > 4) continue;
        const away = angleTowards(focus.x, focus.y, unit.x, unit.y);
        const ctl = this.steerTowards(unit, unit.x + Math.cos(away) * 300, unit.y + Math.sin(away) * 300, 170);
        unit.update(dt, ctl, solids);
        survivors.push(unit);
        continue;
      }
      if (unit.dead) {
        unit.update(dt, { accelerate: false, brake: false, steer: 0, handbrake: false }, solids);
        if (unit.driverAge > 0) survivors.push(unit); // wrecks stay as scenery for this chase
        continue;
      }
      // A unit hopelessly far behind teleports back into the hunt ring: the
      // player outran it, but the radio net is faster than any car.
      if (dist > 1050) {
        const spot = randomRoadPoint(this.rng, focus.x, focus.y, 560, 720);
        unit.x = spot.x;
        unit.y = spot.y;
        unit.angle = angleTowards(spot.x, spot.y, focus.x, focus.y);
        unit.speed = 120;
      }
      const lead = focus.speed ? 0.32 : 0.1;
      const targetX = focus.x + Math.cos(focus.angle ?? 0) * (focus.speed ?? 0) * lead;
      const targetY = focus.y + Math.sin(focus.angle ?? 0) * (focus.speed ?? 0) * lead;
      const ctl = this.steerTowards(unit, targetX, targetY, 340);
      // Ease off when nose-to-tail with a sibling unit, to avoid pile-ups.
      for (const other of this.units) {
        if (other === unit || other.dead) continue;
        const ahead = (other.x - unit.x) * Math.cos(unit.angle) + (other.y - unit.y) * Math.sin(unit.angle);
        const side = Math.abs((other.x - unit.x) * -Math.sin(unit.angle) + (other.y - unit.y) * Math.cos(unit.angle));
        if (ahead > 4 && ahead < 54 && side < 22) ctl.accelerate = false;
      }
      if (Math.abs(unit.speed) < 9 && dist > 130) {
        unit.stuckTime += dt;
        if (unit.stuckTime > 2.6) {
          // Wedged against a wall: reverse out, then rejoin the chase.
          unit.update(dt, { accelerate: false, brake: true, steer: unit.steerVisual >= 0 ? -1 : 1, handbrake: false }, solids);
          if (unit.stuckTime > 3.4) unit.stuckTime = 0;
          survivors.push(unit);
          continue;
        }
      } else {
        unit.stuckTime = 0;
      }
      unit.update(dt, ctl, solids);
      survivors.push(unit);
    }
    this.units = survivors;
  }

  steerTowards(unit, targetX, targetY, topSpeed) {
    const desired = angleTowards(unit.x, unit.y, targetX, targetY);
    const diff = angleDifference(unit.angle, desired);
    const dist = Math.hypot(targetX - unit.x, targetY - unit.y);
    let wanted = topSpeed;
    if (Math.abs(diff) > 0.7) wanted = 150;
    if (dist < 70) wanted = Math.min(wanted, 120 + dist);
    return {
      accelerate: unit.speed < wanted,
      brake: unit.speed > wanted + 24 || Math.abs(diff) > 2.4,
      steer: clamp(diff * 2.6, -1, 1),
      handbrake: Math.abs(diff) > 1.9 && unit.speed > 160,
    };
  }
}
