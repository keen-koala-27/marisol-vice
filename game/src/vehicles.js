// vehicles.js — the Car: arcade driving physics (accelerate, brake, reverse,
// speed-sensitive steering, a handbrake that breaks the rear loose), building
// collision with impact damage, and all the canvas drawing for the five body
// styles. TrafficDriver is the law-abiding brain that steers Cars along the
// right-hand lanes from intersection to intersection.

import { CAR_KINDS, CAR_RADIUS, WORLD_SIZE, PALETTE } from './config.js';
import { collideCircleWithSolids } from './city.js';
import { clamp, angleDifference, angleTowards } from './rng.js';
import { ROAD_CENTRES, ROAD_PITCH } from './config.js';

let nextCarId = 1;

export class Car {
  constructor(x, y, angle, kind, paint) {
    this.id = nextCarId++;
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.kind = kind;
    this.paint = paint;
    this.speed = 0;
    this.steerVisual = 0;
    this.health = 100;
    this.dead = false;
    this.parked = false;
    this.missionCar = false;
    this.braking = false;
    this.lastImpact = 0;
    this.smokeAccumulator = 0;
    const spec = CAR_KINDS[kind];
    this.length = spec.length;
    this.width = spec.width;
  }

  get spec() {
    return CAR_KINDS[this.kind];
  }

  // ctl: { accelerate, brake, steer (-1..1), handbrake }
  update(dt, ctl, solids) {
    this.lastImpact = 0;
    if (this.dead) {
      this.speed -= this.speed * 3 * dt;
      this.x += Math.cos(this.angle) * this.speed * dt;
      this.y += Math.sin(this.angle) * this.speed * dt;
      return;
    }
    const spec = this.spec;
    if (ctl.accelerate) {
      const headroom = Math.max(0, 1 - Math.max(0, this.speed) / spec.topSpeed);
      this.speed += spec.accel * dt * (0.35 + headroom);
      if (this.speed < 0) this.speed += 260 * dt; // throttle also brakes a roll backwards
    }
    this.braking = false;
    if (ctl.brake) {
      this.braking = true;
      if (this.speed > 12) this.speed -= 420 * dt;
      else this.speed = Math.max(this.speed - 150 * dt, -98);
    }
    if (ctl.handbrake) this.speed -= this.speed * 2.4 * dt;
    this.speed -= this.speed * 0.5 * dt; // rolling drag
    if (!ctl.accelerate && !ctl.brake && Math.abs(this.speed) < 5) this.speed = 0;

    const turnAuthority = clamp(this.speed / 150, -1.25, 1.25);
    this.angle += ctl.steer * spec.grip * turnAuthority * dt * (ctl.handbrake ? 1.3 : 1);
    this.steerVisual = ctl.steer;

    let nx = this.x + Math.cos(this.angle) * this.speed * dt;
    let ny = this.y + Math.sin(this.angle) * this.speed * dt;
    nx = clamp(nx, 26, WORLD_SIZE - 26);
    ny = clamp(ny, 26, WORLD_SIZE - 26);
    const resolved = collideCircleWithSolids(nx, ny, CAR_RADIUS, solids);
    if (resolved.hit) {
      const impact = Math.abs(this.speed);
      this.lastImpact = impact;
      if (impact > 110) this.health -= (impact - 110) / 16;
      this.speed = impact > 60 ? -this.speed * 0.24 : this.speed * 0.3;
      if (this.health <= 0) {
        this.health = 0;
        this.dead = true;
      }
    }
    this.x = resolved.x;
    this.y = resolved.y;
  }

  damage(amount) {
    if (this.dead) return;
    this.health -= amount;
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
      this.speed *= 0.3;
    }
  }
}

export function drawCar(ctx, car, time) {
  const spec = car.spec;
  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.angle);
  // Ground shadow
  ctx.fillStyle = 'rgba(20,16,10,0.28)';
  ctx.beginPath();
  ctx.ellipse(3, 5, spec.length / 2, spec.width / 2 + 2, 0, 0, Math.PI * 2);
  ctx.fill();
  // Wheels
  ctx.fillStyle = '#17181c';
  const wx = spec.length / 2 - 10;
  const wy = spec.width / 2 - 2;
  for (const [wheelX, wheelY, front] of [[wx, -wy, 1], [wx, wy, 1], [-wx, -wy, 0], [-wx, wy, 0]]) {
    ctx.save();
    ctx.translate(wheelX, wheelY);
    if (front) ctx.rotate(car.steerVisual * 0.4);
    ctx.fillRect(-5, -2.5, 10, 5);
    ctx.restore();
  }
  // Body
  ctx.fillStyle = car.dead ? '#3a3a3e' : car.paint;
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(-spec.length / 2, -spec.width / 2, spec.length, spec.width, 6);
  ctx.fill();
  ctx.stroke();
  if (car.kind === 'cop') {
    ctx.fillStyle = PALETTE.copStripe;
    ctx.fillRect(-8, -spec.width / 2 + 1, 18, spec.width - 2);
    // Light bar: red and blue halves blink in turn.
    const phase = Math.floor(time * 5) % 2;
    ctx.fillStyle = phase ? '#ff3b30' : '#5a1f1c';
    ctx.fillRect(-3, -6, 7, 5);
    ctx.fillStyle = phase ? '#274b8f' : '#3d7bff';
    ctx.fillRect(-3, 1, 7, 5);
  }
  if (car.kind === 'taxi') {
    ctx.fillStyle = '#22262e';
    ctx.fillRect(-4, -4, 8, 8);
    ctx.fillStyle = '#ffe9a8';
    ctx.fillRect(-3, -3, 6, 6);
  }
  if (car.kind === 'sport' && !car.dead) {
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillRect(-spec.length / 2 + 4, -2, spec.length - 8, 4);
    ctx.fillStyle = '#22262e';
    ctx.fillRect(-spec.length / 2 + 1, -spec.width / 2 + 2, 4, spec.width - 4); // spoiler
  }
  if (car.kind === 'van') {
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(-spec.length / 2 + 6, -spec.width / 2 + 3, spec.length - 26, spec.width - 6);
  }
  // Cabin: windshield, roof, rear window
  ctx.fillStyle = '#1d2733';
  ctx.beginPath();
  ctx.roundRect(2, -spec.width / 2 + 3.5, 8, spec.width - 7, 2);
  ctx.fill();
  ctx.fillStyle = car.dead ? '#2c2c30' : shadeOf(car.paint, -18);
  ctx.beginPath();
  ctx.roundRect(-10, -spec.width / 2 + 3, 12, spec.width - 6, 3);
  ctx.fill();
  ctx.fillStyle = '#232d38';
  ctx.beginPath();
  ctx.roundRect(-15, -spec.width / 2 + 3.5, 5, spec.width - 7, 2);
  ctx.fill();
  // Headlights and brake lights
  ctx.fillStyle = '#fff6c9';
  ctx.fillRect(spec.length / 2 - 2, -spec.width / 2 + 3, 2.5, 4);
  ctx.fillRect(spec.length / 2 - 2, spec.width / 2 - 7, 2.5, 4);
  ctx.fillStyle = car.braking ? '#ff5147' : '#8f2f28';
  ctx.fillRect(-spec.length / 2 - 0.5, -spec.width / 2 + 3, 2.5, 4);
  ctx.fillRect(-spec.length / 2 - 0.5, spec.width / 2 - 7, 2.5, 4);
  // Battle scars
  if (car.health < 70 && !car.dead) {
    ctx.fillStyle = 'rgba(20,20,20,0.35)';
    ctx.fillRect(spec.length / 2 - 12, -4, 7, 8);
    if (car.health < 40) ctx.fillRect(-14, 2, 9, 6);
  }
  ctx.restore();
  if (car.missionCar) {
    // A pulsing ring so the player can spot the story car in a crowded lot.
    ctx.save();
    ctx.strokeStyle = `rgba(23,182,201,${0.55 + Math.sin(time * 4) * 0.3})`;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(car.x, car.y, 38 + Math.sin(time * 4) * 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

// Darken or lighten a #rrggbb paint by a small amount for the roof tone.
export function shadeOf(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp((n >> 16) + amount, 0, 255);
  const g = clamp(((n >> 8) & 0xff) + amount, 0, 255);
  const b = clamp((n & 0xff) + amount, 0, 255);
  return `rgb(${r},${g},${b})`;
}

// The law-abiding driver. It follows the right-hand lane of its road to the
// next intersection, then picks a way on (never a U-turn), and slows for
// anything in the lane ahead of it.
export class TrafficDriver {
  constructor(car, rng) {
    this.car = car;
    this.rng = rng;
    this.targetX = car.x;
    this.targetY = car.y;
    this.cruiseSpeed = car.kind === 'taxi' ? 158 : 138 + rng() * 26;
    this.honkCooldown = 0;
    this.stuckTime = 0;
    this.chooseNextTarget(true);
  }

  lanePoint(centreX, centreY, headingAngle, ahead) {
    const fx = Math.cos(headingAngle);
    const fy = Math.sin(headingAngle);
    const rx = -fy;
    const ry = fx;
    return {
      x: centreX + fx * ahead + rx * 27,
      y: centreY + fy * ahead + ry * 27,
    };
  }

  chooseNextTarget(first = false) {
    const car = this.car;
    // Snap the heading to the nearest compass direction: traffic drives the grid.
    const snapped = Math.round(car.angle / (Math.PI / 2)) * (Math.PI / 2);
    let heading = first ? snapped : this.pickTurn(snapped);
    const fx = Math.round(Math.cos(heading));
    const fy = Math.round(Math.sin(heading));
    // Find the intersection we are heading into.
    const fromX = nearestCentre(car.x);
    const fromY = nearestCentre(car.y);
    let ix = fromX;
    let iy = fromY;
    if (fx !== 0) ix = nextCentreAlong(fromX, fx);
    if (fy !== 0) iy = nextCentreAlong(fromY, fy);
    if (!first && fx === 0 && fy === 0) heading = snapped;
    const point = this.lanePoint(ix, iy, heading, ROAD_PITCH * 0.52);
    this.targetX = point.x;
    this.targetY = point.y;
    this.heading = heading;
  }

  pickTurn(currentHeading) {
    const roll = this.rng();
    if (roll < 0.52) return currentHeading;
    if (roll < 0.76) return currentHeading + Math.PI / 2;
    return currentHeading - Math.PI / 2;
  }

  update(dt, world) {
    const car = this.car;
    const distToTarget = Math.hypot(this.targetX - car.x, this.targetY - car.y);
    if (distToTarget < 52) this.chooseNextTarget();
    const desired = angleTowards(car.x, car.y, this.targetX, this.targetY);
    const diff = angleDifference(car.angle, desired);
    const steer = clamp(diff * 2.4, -1, 1);

    let wanted = this.cruiseSpeed;
    if (Math.abs(diff) > 0.45) wanted = Math.min(wanted, 92);
    let blocked = false;
    const fx = Math.cos(car.angle);
    const fy = Math.sin(car.angle);
    for (const other of world.obstacles) {
      if (other === car) continue;
      const relX = other.x - car.x;
      const relY = other.y - car.y;
      const ahead = relX * fx + relY * fy;
      const side = Math.abs(relX * -fy + relY * fx);
      if (ahead > 6 && ahead < 96 && side < 25) {
        blocked = true;
        const otherSpeed = other.speed ?? 0;
        wanted = Math.min(wanted, ahead < 52 ? 0 : otherSpeed * 0.92);
      }
    }
    if (blocked && car.speed < 6) {
      this.stuckTime += dt;
      if (this.stuckTime > 2.2 && this.honkCooldown <= 0) {
        this.honkCooldown = 4 + this.rng() * 4;
        this.stuckTime = 0;
        return { accelerate: false, brake: true, steer: 0, handbrake: false, honk: true };
      }
    } else {
      this.stuckTime = 0;
    }
    this.honkCooldown -= dt;
    return {
      accelerate: car.speed < wanted,
      brake: car.speed > wanted + 16,
      steer,
      handbrake: false,
      honk: false,
    };
  }
}

function nearestCentre(value) {
  let best = ROAD_CENTRES[0];
  for (const centre of ROAD_CENTRES) {
    if (Math.abs(centre - value) < Math.abs(best - value)) best = centre;
  }
  return best;
}

function nextCentreAlong(current, direction) {
  const idx = ROAD_CENTRES.indexOf(current);
  const next = idx + direction;
  if (next < 0) return ROAD_CENTRES[0];
  if (next >= ROAD_CENTRES.length) return ROAD_CENTRES[ROAD_CENTRES.length - 1];
  return ROAD_CENTRES[next];
}
