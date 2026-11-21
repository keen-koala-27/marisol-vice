// people.js — the humans. The Player walks, sprints, aims with the mouse and
// takes damage through armour first. Pedestrians stroll the pavement loop
// around their block, and run from gunfire, reckless cars and shouting — a
// witness who sees a crime is what turns it into wanted heat (the game decides
// that; pedestrians just provide the eyes and the fleeing).

import { PLAYER_RADIUS, PLAYER_WALK_SPEED, PLAYER_SPRINT_SPEED, PALETTE } from './config.js';
import { collideCircleWithSolids, blockBounds } from './city.js';
import { clamp } from './rng.js';

export class Player {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.angle = -Math.PI / 2;
    this.health = 100;
    this.armor = 0;
    this.weapon = 'Pistol';
    this.inCar = null;
    this.moving = false;
    this.sprinting = false;
    this.walkCycle = 0;
    this.hurtFlash = 0;
  }

  get alive() {
    return this.health > 0;
  }

  takeDamage(amount) {
    if (this.armor > 0) {
      const absorbed = Math.min(this.armor, amount * 0.65);
      this.armor -= absorbed;
      amount -= absorbed;
    }
    this.health -= amount;
    this.hurtFlash = 0.35;
    if (this.health < 0) this.health = 0;
  }

  heal(amount) {
    this.health = Math.min(100, this.health + amount);
  }

  // mouseWorld: where the cursor points in world space, so the player faces it.
  updateOnFoot(dt, input, mouseWorld, solids) {
    let mx = 0;
    let my = 0;
    if (input.down('KeyW', 'ArrowUp')) my -= 1;
    if (input.down('KeyS', 'ArrowDown')) my += 1;
    if (input.down('KeyA', 'ArrowLeft')) mx -= 1;
    if (input.down('KeyD', 'ArrowRight')) mx += 1;
    const length = Math.hypot(mx, my);
    this.moving = length > 0;
    this.sprinting = this.moving && input.down('ShiftLeft', 'ShiftRight');
    if (this.moving) {
      const speed = this.sprinting ? PLAYER_SPRINT_SPEED : PLAYER_WALK_SPEED;
      const nx = this.x + (mx / length) * speed * dt;
      const ny = this.y + (my / length) * speed * dt;
      const resolved = collideCircleWithSolids(nx, ny, PLAYER_RADIUS, solids);
      this.x = clamp(resolved.x, 14, 2546);
      this.y = clamp(resolved.y, 14, 2546);
      this.walkCycle += dt * (this.sprinting ? 13 : 9);
    }
    this.angle = Math.atan2(mouseWorld.y - this.y, mouseWorld.x - this.x);
    if (this.hurtFlash > 0) this.hurtFlash -= dt;
  }
}

export function drawPlayer(ctx, player, time) {
  if (player.inCar) return;
  ctx.save();
  ctx.translate(player.x, player.y);
  ctx.fillStyle = 'rgba(20,16,10,0.3)';
  ctx.beginPath();
  ctx.ellipse(1.5, 3, 10, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  // Legs swing with the walk cycle while moving.
  const swing = player.moving ? Math.sin(player.walkCycle) * 5 : 0;
  ctx.fillStyle = '#2e3a46';
  ctx.fillRect(-6 + swing * 0.4, 2, 5, 8);
  ctx.fillRect(1 - swing * 0.4, 2, 5, 8);
  ctx.rotate(player.angle + Math.PI / 2);
  // Body and head
  ctx.fillStyle = PALETTE.playerShirt;
  ctx.beginPath();
  ctx.arc(0, 0, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.stroke();
  ctx.fillStyle = PALETTE.playerSkin;
  ctx.beginPath();
  ctx.arc(0, -1, 5.2, 0, Math.PI * 2);
  ctx.fill();
  // Sunglasses stripe — Danny never squints.
  ctx.fillStyle = '#14181d';
  ctx.fillRect(-4.5, -3.4, 9, 2.4);
  // Gun arm, when armed
  if (player.weapon !== 'Fists') {
    ctx.fillStyle = PALETTE.playerSkin;
    ctx.fillRect(6, -8, 5, 3.4);
    ctx.fillStyle = '#191c20';
    ctx.fillRect(9, -8.6, player.weapon === 'SMG' ? 10 : 7, 2.6);
  }
  ctx.restore();
  if (player.hurtFlash > 0) {
    ctx.save();
    ctx.strokeStyle = `rgba(255,60,40,${player.hurtFlash})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(player.x, player.y, 15, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

// A pedestrian walks the pavement loop around one block. `perimeterPos` is a
// distance along that loop; fleeing switches to free running for a few seconds.
export class Pedestrian {
  constructor(rng, city) {
    const bx = Math.floor(rng() * 4);
    const by = Math.floor(rng() * 4);
    const xb = blockBounds(bx);
    const yb = blockBounds(by);
    this.loop = { x: xb.start + 9, y: yb.start + 9, w: xb.size - 18, h: yb.size - 18 };
    this.perimeter = 2 * (this.loop.w + this.loop.h);
    this.perimeterPos = rng() * this.perimeter;
    this.direction = rng() > 0.5 ? 1 : -1;
    this.speed = 34 + rng() * 22;
    this.shirt = PALETTE.pedShirts[Math.floor(rng() * PALETTE.pedShirts.length)];
    this.skin = ['#c98a5e', '#8a5a3b', '#e8b48c', '#6e4526'][Math.floor(rng() * 4)];
    this.health = 30;
    this.dead = false;
    this.fleeTime = 0;
    this.fleeAngle = 0;
    this.walkCycle = rng() * 6;
    this.updatePosition(0);
  }

  updatePosition(dt) {
    if (this.fleeTime > 0) {
      this.fleeTime -= dt;
      this.x += Math.cos(this.fleeAngle) * 138 * dt;
      this.y += Math.sin(this.fleeAngle) * 138 * dt;
      this.x = clamp(this.x, 12, 2548);
      this.y = clamp(this.y, 12, 2548);
      this.walkCycle += dt * 14;
      return;
    }
    this.perimeterPos = (this.perimeterPos + this.direction * this.speed * dt + this.perimeter) % this.perimeter;
    const { w, h } = this.loop;
    let s = this.perimeterPos;
    if (s < w) {
      this.x = this.loop.x + s;
      this.y = this.loop.y;
      this.facing = this.direction > 0 ? 0 : Math.PI;
    } else if (s < w + h) {
      this.x = this.loop.x + w;
      this.y = this.loop.y + (s - w);
      this.facing = this.direction > 0 ? Math.PI / 2 : -Math.PI / 2;
    } else if (s < 2 * w + h) {
      this.x = this.loop.x + w - (s - w - h);
      this.y = this.loop.y + h;
      this.facing = this.direction > 0 ? Math.PI : 0;
    } else {
      this.x = this.loop.x;
      this.y = this.loop.y + h - (s - 2 * w - h);
      this.facing = this.direction > 0 ? -Math.PI / 2 : Math.PI / 2;
    }
    if (this.direction < 0) this.facing += Math.PI;
    this.walkCycle += dt * 8;
  }

  // threat: {x, y} of the scary thing, or null.
  update(dt, threat) {
    if (this.dead) return;
    if (threat) {
      const dist = Math.hypot(threat.x - this.x, threat.y - this.y);
      if (dist < 150) {
        this.fleeTime = Math.max(this.fleeTime, 1.6);
        this.fleeAngle = Math.atan2(this.y - threat.y, this.x - threat.x);
      }
    }
    this.updatePosition(dt);
  }

  hurt(amount) {
    if (this.dead) return true;
    this.health -= amount;
    if (this.health <= 0) {
      this.dead = true;
      return true;
    }
    this.fleeTime = 2.2;
    return false;
  }
}

export function drawPedestrian(ctx, ped) {
  ctx.save();
  ctx.translate(ped.x, ped.y);
  if (ped.dead) {
    ctx.rotate(ped.facing ?? 0);
    ctx.fillStyle = 'rgba(120,30,25,0.5)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 13, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = ped.shirt;
    ctx.beginPath();
    ctx.ellipse(0, 0, 10, 5.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = ped.skin;
    ctx.beginPath();
    ctx.arc(11, 0, 4.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  ctx.fillStyle = 'rgba(20,16,10,0.25)';
  ctx.beginPath();
  ctx.ellipse(1, 2.5, 8, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  const swing = Math.sin(ped.walkCycle) * 3.4;
  ctx.fillStyle = '#3a4149';
  ctx.fillRect(-5 + swing * 0.35, 1, 4, 7);
  ctx.fillRect(1 - swing * 0.35, 1, 4, 7);
  ctx.rotate((ped.fleeTime > 0 ? ped.fleeAngle : ped.facing ?? 0) + Math.PI / 2);
  ctx.fillStyle = ped.shirt;
  ctx.beginPath();
  ctx.arc(0, 0, 7.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = ped.skin;
  ctx.beginPath();
  ctx.arc(0, -0.8, 4.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
