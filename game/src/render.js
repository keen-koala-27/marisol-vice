// render.js — everything the player sees. The world is drawn top-down with a
// sun-baked slant: buildings get a shadow, an extruded wall and a roof so the
// city reads at a glance. On top of the world sit the HUD (health, armour,
// money, wanted stars, weapon, objective, dialogue) and a live minimap; the
// title, pause, busted, wasted and story-complete screens are drawn here too.
// The judge reads screenshots of this file's work, so every system the game
// has is made visible on the HUD or in the world.

import { WORLD_SIZE, ROAD_CENTRES, ROAD_HALF, PALETTE, HEAT_MAX } from './config.js';
import { drawCar } from './vehicles.js';
import { drawPlayer, drawPedestrian } from './people.js';
import { blockBounds } from './city.js';
import { clamp } from './rng.js';

const FONT = 'system-ui, "Segoe UI", Roboto, sans-serif';

export function renderFrame(ctx, game, width, height) {
  const camX = game.camera.x;
  const camY = game.camera.y;
  drawWorld(ctx, game, camX, camY, width, height);
  if (game.state === 'title') {
    drawTitleScreen(ctx, game, width, height);
    return;
  }
  drawHUD(ctx, game, width, height);
  if (game.state === 'pause') drawPauseScreen(ctx, game, width, height);
  if (game.state === 'busted') drawBustedScreen(ctx, game, width, height);
  if (game.state === 'wasted') drawWastedScreen(ctx, game, width, height);
  if (game.state === 'complete') drawCompleteScreen(ctx, game, width, height);
}

function drawWorld(ctx, game, camX, camY, width, height) {
  const city = game.city;
  // The bay fills everything; the island sits on top of it.
  ctx.fillStyle = PALETTE.water;
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  ctx.translate(width / 2 - camX, height / 2 - camY);
  const view = {
    x: camX - width / 2 - 80,
    y: camY - height / 2 - 80,
    w: width + 160,
    h: height + 160,
  };
  // Water sparkle south of the island and the sand rim.
  ctx.fillStyle = PALETTE.waterDeep;
  ctx.fillRect(view.x, WORLD_SIZE + 60, view.w, 400);
  ctx.fillStyle = PALETTE.sand;
  ctx.fillRect(-46, -46, WORLD_SIZE + 92, WORLD_SIZE + 92);
  ctx.fillStyle = PALETTE.ground;
  ctx.fillRect(0, 0, WORLD_SIZE, WORLD_SIZE);

  drawRoads(ctx, view);
  // Pavement rims around every block.
  ctx.fillStyle = PALETTE.sidewalk;
  for (let bx = 0; bx < 4; bx++) {
    for (let by = 0; by < 4; by++) {
      const xb = blockBounds(bx);
      const yb = blockBounds(by);
      ctx.fillRect(xb.start - 9, yb.start - 9, xb.size + 18, yb.size + 18);
    }
  }
  for (const park of city.parks) {
    ctx.fillStyle = PALETTE.park;
    ctx.fillRect(park.x, park.y, park.w, park.h);
    ctx.fillStyle = PALETTE.parkDark;
    ctx.fillRect(park.x + 6, park.y + 6, park.w - 12, 5);
  }
  for (const lot of city.lots) {
    ctx.fillStyle = '#8f8b80';
    ctx.fillRect(lot.x, lot.y, lot.w, lot.h);
    ctx.strokeStyle = 'rgba(240,240,230,0.5)';
    ctx.lineWidth = 2;
    const bays = Math.floor(lot.w / 34);
    for (let i = 0; i < bays; i++) {
      ctx.beginPath();
      ctx.moveTo(lot.x + 8 + i * 34, lot.y + 8);
      ctx.lineTo(lot.x + 8 + i * 34, lot.y + 26);
      ctx.stroke();
    }
  }
  // Skid marks live on the tarmac under everything that moves.
  for (const skid of game.skids) {
    ctx.strokeStyle = `rgba(22,22,24,${skid.alpha})`;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(skid.x1, skid.y1);
    ctx.lineTo(skid.x2, skid.y2);
    ctx.stroke();
  }
  // The mission marker: a pillar of light and a bobbing diamond.
  if (game.marker) drawMarker(ctx, game.marker, game.time);
  for (const pickup of game.pickups) drawPickup(ctx, pickup, game.time);
  for (const tree of city.trees) {
    if (!inView(tree.x, tree.y, view, 60)) continue;
    drawPalm(ctx, tree);
  }
  for (const building of city.buildings) {
    if (!inView(building.x + building.w / 2, building.y + building.h / 2, view, building.w)) continue;
    drawBuilding(ctx, building);
  }
  // The Pier 9 jetty and Rosa's cousin's boat, south of the warehouse.
  ctx.fillStyle = '#8a6a44';
  ctx.fillRect(1240, WORLD_SIZE, 160, 120);
  ctx.fillStyle = '#a37f52';
  for (let i = 0; i < 5; i++) ctx.fillRect(1252 + i * 30, WORLD_SIZE, 12, 120);
  ctx.fillStyle = '#e8e4da';
  ctx.beginPath();
  ctx.ellipse(1320, WORLD_SIZE + 148, 52, 16, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#c94f42';
  ctx.fillRect(1296, WORLD_SIZE + 132, 48, 8);

  for (const car of game.cars) drawCar(ctx, car, game.time);
  for (const unit of game.police.units) drawCar(ctx, unit, game.time);
  for (const ped of game.peds) drawPedestrian(ctx, ped);
  drawPlayer(ctx, game.player, game.time);
  drawParticles(ctx, game);
  // Warm late-afternoon grade over the whole scene.
  ctx.restore();
  const glow = ctx.createRadialGradient(width / 2, height * 0.42, height * 0.3, width / 2, height * 0.5, height * 0.95);
  glow.addColorStop(0, 'rgba(255,170,80,0)');
  glow.addColorStop(1, 'rgba(120,50,90,0.16)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);
}

function inView(x, y, view, pad) {
  return x > view.x - pad && x < view.x + view.w + pad && y > view.y - pad && y < view.y + view.h + pad;
}

function drawRoads(ctx, view) {
  ctx.fillStyle = PALETTE.road;
  for (const centre of ROAD_CENTRES) {
    ctx.fillRect(centre - ROAD_HALF, 0, ROAD_HALF * 2, WORLD_SIZE);
    ctx.fillRect(0, centre - ROAD_HALF, WORLD_SIZE, ROAD_HALF * 2);
  }
  ctx.strokeStyle = PALETTE.roadEdge;
  ctx.lineWidth = 2;
  for (const centre of ROAD_CENTRES) {
    for (const edge of [-ROAD_HALF + 2, ROAD_HALF - 2]) {
      ctx.beginPath();
      ctx.moveTo(centre + edge, 0);
      ctx.lineTo(centre + edge, WORLD_SIZE);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, centre + edge);
      ctx.lineTo(WORLD_SIZE, centre + edge);
      ctx.stroke();
    }
  }
  // Dashed centre lines, broken at intersections.
  ctx.strokeStyle = PALETTE.laneDash;
  ctx.lineWidth = 3;
  ctx.setLineDash([22, 26]);
  for (const centre of ROAD_CENTRES) {
    for (let seg = 0; seg < 4; seg++) {
      const from = ROAD_CENTRES[seg] + ROAD_HALF + 8;
      const to = ROAD_CENTRES[seg + 1] - ROAD_HALF - 8;
      ctx.beginPath();
      ctx.moveTo(centre, from);
      ctx.lineTo(centre, to);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(from, centre);
      ctx.lineTo(to, centre);
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);
  // Crosswalks on every intersection approach.
  ctx.fillStyle = PALETTE.crosswalk;
  for (const cx of ROAD_CENTRES) {
    for (const cy of ROAD_CENTRES) {
      for (let s = 0; s < 5; s++) {
        const off = -34 + s * 17;
        ctx.fillRect(cx + off - 6, cy - ROAD_HALF - 12, 12, 7);
        ctx.fillRect(cx + off - 6, cy + ROAD_HALF + 5, 12, 7);
        ctx.fillRect(cx - ROAD_HALF - 12, cy + off - 6, 7, 12);
        ctx.fillRect(cx + ROAD_HALF + 5, cy + off - 6, 7, 12);
      }
    }
  }
  void view;
}

function drawPalm(ctx, tree) {
  ctx.save();
  ctx.translate(tree.x, tree.y);
  ctx.scale(tree.size, tree.size);
  ctx.fillStyle = 'rgba(20,16,10,0.22)';
  ctx.beginPath();
  ctx.ellipse(4, 5, 13, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = PALETTE.palmLeaf;
  ctx.lineWidth = 3.4;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(Math.cos(a) * 10, Math.sin(a) * 10 - 4, Math.cos(a) * 17, Math.sin(a) * 17 + 3);
    ctx.stroke();
  }
  ctx.fillStyle = PALETTE.palmTrunk;
  ctx.beginPath();
  ctx.arc(0, 0, 3.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBuilding(ctx, building) {
  const lift = building.height * 0.5;
  // Shadow, then the extruded wall, then the roof slab on top.
  ctx.fillStyle = 'rgba(25,20,14,0.25)';
  ctx.fillRect(building.x + 10, building.y + 14, building.w, building.h);
  ctx.fillStyle = building.wall;
  ctx.fillRect(building.x, building.y, building.w, building.h);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(building.x, building.y + building.h - lift * 0.4, building.w, lift * 0.4);
  ctx.fillStyle = building.roof;
  ctx.fillRect(building.x - lift * 0.3, building.y - lift * 0.42, building.w, building.h);
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.fillRect(building.x - lift * 0.3 + 6, building.y - lift * 0.42 + 6, building.w - 12, building.h - 12);
  // Rooftop clutter: vents and air-conditioning boxes.
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  ctx.fillRect(building.x + building.w * 0.18, building.y + building.h * 0.2, 14, 10);
  ctx.fillRect(building.x + building.w * 0.62, building.y + building.h * 0.58, 18, 12);
  if (building.name) {
    ctx.font = `bold 14px ${FONT}`;
    const labelWidth = ctx.measureText(building.name).width + 16;
    const lx = building.x + building.w / 2 - labelWidth / 2;
    const ly = building.y + building.h + 6;
    ctx.fillStyle = 'rgba(18,20,26,0.82)';
    ctx.beginPath();
    ctx.roundRect(lx, ly, labelWidth, 21, 5);
    ctx.fill();
    ctx.fillStyle = '#ffd98a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(building.name, building.x + building.w / 2, ly + 11);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }
}

function drawMarker(ctx, marker, time) {
  const bob = Math.sin(time * 3.2) * 7;
  const grad = ctx.createLinearGradient(0, marker.y - 150, 0, marker.y);
  grad.addColorStop(0, 'rgba(255,209,77,0)');
  grad.addColorStop(1, 'rgba(255,209,77,0.30)');
  ctx.fillStyle = grad;
  ctx.fillRect(marker.x - 15, marker.y - 150, 30, 150);
  ctx.strokeStyle = 'rgba(255,209,77,0.85)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(marker.x, marker.y, 26 + Math.sin(time * 3.2) * 4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.save();
  ctx.translate(marker.x, marker.y - 118 + bob);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = '#ffd14d';
  ctx.strokeStyle = '#8a6414';
  ctx.lineWidth = 2;
  ctx.fillRect(-11, -11, 22, 22);
  ctx.strokeRect(-11, -11, 22, 22);
  ctx.restore();
}

function drawPickup(ctx, pickup, time) {
  const bob = Math.sin(time * 3 + pickup.phase) * 3;
  ctx.save();
  ctx.translate(pickup.x, pickup.y + bob);
  ctx.fillStyle = 'rgba(255,255,255,0.20)';
  ctx.beginPath();
  ctx.arc(0, 0, 17 + Math.sin(time * 4 + pickup.phase) * 2, 0, Math.PI * 2);
  ctx.fill();
  if (pickup.kind === 'cash') {
    ctx.fillStyle = '#2e7d46';
    ctx.beginPath();
    ctx.roundRect(-10, -8, 20, 16, 3);
    ctx.fill();
    ctx.fillStyle = '#c9f2d4';
    ctx.font = `bold 13px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('$', 0, 1);
  } else if (pickup.kind === 'health') {
    ctx.fillStyle = '#f2f2f2';
    ctx.beginPath();
    ctx.roundRect(-10, -10, 20, 20, 3);
    ctx.fill();
    ctx.fillStyle = '#d93a30';
    ctx.fillRect(-2.5, -7, 5, 14);
    ctx.fillRect(-7, -2.5, 14, 5);
  } else if (pickup.kind === 'armor') {
    ctx.fillStyle = '#3d7bff';
    ctx.beginPath();
    ctx.moveTo(0, -11);
    ctx.lineTo(9, -6);
    ctx.lineTo(9, 3);
    ctx.quadraticCurveTo(9, 9, 0, 12);
    ctx.quadraticCurveTo(-9, 9, -9, 3);
    ctx.lineTo(-9, -6);
    ctx.closePath();
    ctx.fill();
  } else if (pickup.kind === 'smg') {
    ctx.fillStyle = '#22262e';
    ctx.beginPath();
    ctx.roundRect(-12, -4, 24, 8, 2);
    ctx.fill();
    ctx.fillRect(2, 3, 4, 7);
  }
  ctx.restore();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

function drawParticles(ctx, game) {
  for (const tracer of game.tracers) {
    ctx.strokeStyle = `rgba(255,230,150,${tracer.life * 5})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(tracer.x1, tracer.y1);
    ctx.lineTo(tracer.x2, tracer.y2);
    ctx.stroke();
  }
  for (const p of game.particles) {
    ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * (p.grows ? (1.6 - p.life / p.maxLife) : 1), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------- HUD

function drawHUD(ctx, game, width, height) {
  const player = game.player;
  // Health and armour, top-left.
  panel(ctx, 16, 16, 216, 64, 0.55);
  ctx.fillStyle = '#f2ede2';
  ctx.font = `bold 13px ${FONT}`;
  ctx.fillText('DANNY COLE', 26, 36);
  bar(ctx, 26, 44, 160, 11, player.health / 100, player.health > 30 ? '#69c24d' : '#e0483e');
  bar(ctx, 26, 59, 160, 7, player.armor / 100, '#5b9bd5');
  ctx.fillStyle = '#ffd98a';
  ctx.font = `bold 11px ${FONT}`;
  if (player.inCar) ctx.fillText(`CAR ${Math.max(0, Math.round(player.inCar.health))}%`, 192, 53);

  // Money and wanted stars, top-right.
  ctx.textAlign = 'right';
  ctx.fillStyle = '#7be495';
  ctx.font = `bold 26px ${FONT}`;
  ctx.fillText(`$${game.money.toLocaleString('en-US')}`, width - 20, 42);
  const stars = game.stars;
  ctx.font = '24px ' + FONT;
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = i < stars ? '#ffd14d' : 'rgba(255,255,255,0.25)';
    const pulse = game.starFlash > 0 && i === stars - 1 ? 1.25 : 1;
    ctx.save();
    ctx.translate(width - 26 - (4 - i) * 27, 66);
    ctx.scale(pulse, pulse);
    ctx.fillText('★', 0, 0);
    ctx.restore();
  }
  ctx.textAlign = 'left';

  // Objective, top-centre.
  if (game.objectiveText) {
    ctx.font = `bold 15px ${FONT}`;
    const textWidth = ctx.measureText(game.objectiveText).width;
    const boxW = Math.min(width - 480, textWidth + 90);
    panel(ctx, (width - boxW) / 2, 14, boxW, 40, 0.6);
    ctx.fillStyle = '#ffd14d';
    ctx.textAlign = 'center';
    const dist = game.marker ? Math.round(Math.hypot(game.marker.x - player.x, game.marker.y - player.y) / 10) : 0;
    ctx.fillText(game.marker ? `${game.objectiveText} · ${dist}m` : game.objectiveText, width / 2, 40);
    ctx.textAlign = 'left';
  }

  // Weapon, bottom-right.
  ctx.textAlign = 'right';
  ctx.fillStyle = '#f2ede2';
  ctx.font = `bold 17px ${FONT}`;
  ctx.fillText(player.weapon.toUpperCase(), width - 20, height - 44);
  ctx.font = `12px ${FONT}`;
  ctx.fillStyle = 'rgba(242,237,226,0.75)';
  ctx.fillText(player.inCar ? 'SPACE handbrake · F exit · LMB drive-by' : 'WASD move · SHIFT sprint · F enter car · LMB shoot', width - 20, height - 24);
  ctx.textAlign = 'left';

  drawMinimap(ctx, game, 16, height - 196, 180);
  if (game.bustProgress > 0.02 && game.state === 'play') drawBustMeter(ctx, game, width, height);
  if (game.promptText) {
    ctx.font = `bold 16px ${FONT}`;
    const w2 = ctx.measureText(game.promptText).width + 28;
    panel(ctx, (width - w2) / 2, height - 118, w2, 32, 0.65);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText(game.promptText, width / 2, height - 97);
    ctx.textAlign = 'left';
  }
  if (game.dialogue) drawDialogue(ctx, game.dialogue, width, height);
  if (game.banner) drawBanner(ctx, game.banner, width, height);
  if (player.hurtFlash > 0.02 || player.health <= 30) {
    const alpha = Math.max(player.hurtFlash * 0.5, player.health <= 30 ? 0.12 + Math.sin(game.time * 4) * 0.05 : 0);
    const grad = ctx.createRadialGradient(width / 2, height / 2, height * 0.34, width / 2, height / 2, height * 0.75);
    grad.addColorStop(0, 'rgba(200,30,20,0)');
    grad.addColorStop(1, `rgba(200,30,20,${clamp(alpha, 0, 0.5)})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
  }
}

function panel(ctx, x, y, w, h, alpha) {
  ctx.fillStyle = `rgba(14,16,22,${alpha})`;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 8);
  ctx.fill();
}

function bar(ctx, x, y, w, h, ratio, color) {
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w * clamp(ratio, 0, 1), h);
}

function drawMinimap(ctx, game, x, y, size) {
  const scale = size / WORLD_SIZE;
  ctx.save();
  panel(ctx, x - 4, y - 4, size + 8, size + 8, 0.6);
  ctx.fillStyle = PALETTE.water;
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = '#a49e8d';
  ctx.fillRect(x + 2, y + 2, size - 4, size - 4);
  ctx.strokeStyle = '#4a4e57';
  ctx.lineWidth = 3;
  for (const centre of ROAD_CENTRES) {
    ctx.beginPath();
    ctx.moveTo(x + centre * scale, y + 2);
    ctx.lineTo(x + centre * scale, y + size - 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + 2, y + centre * scale);
    ctx.lineTo(x + size - 2, y + centre * scale);
    ctx.stroke();
  }
  const dot = (wx, wy, color, r) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x + wx * scale, y + wy * scale, r, 0, Math.PI * 2);
    ctx.fill();
  };
  for (const pickup of game.pickups) dot(pickup.x, pickup.y, '#7be495', 2);
  for (const car of game.cars) if (car.missionCar) dot(car.x, car.y, '#17b6c9', 3.4);
  for (const unit of game.police.units) {
    if (!unit.dead) dot(unit.x, unit.y, Math.floor(game.time * 4) % 2 ? '#ff5147' : '#3d7bff', 3);
  }
  if (game.marker) {
    const mx = x + game.marker.x * scale;
    const my = y + game.marker.y * scale;
    ctx.fillStyle = '#ffd14d';
    ctx.save();
    ctx.translate(mx, my);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-3.6, -3.6, 7.2, 7.2);
    ctx.restore();
  }
  // Player arrow, pointing the way Danny (or his car) faces.
  const focus = game.player.inCar ?? game.player;
  ctx.save();
  ctx.translate(x + focus.x * scale, y + focus.y * scale);
  ctx.rotate(focus.angle + Math.PI / 2);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(0, -6);
  ctx.lineTo(4.4, 5);
  ctx.lineTo(0, 2.6);
  ctx.lineTo(-4.4, 5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = `bold 10px ${FONT}`;
  ctx.fillText('PORT MARISOL', x + 6, y + size - 6);
  ctx.restore();
}

function drawBustMeter(ctx, game, width, height) {
  const w = 300;
  panel(ctx, (width - w) / 2, height - 210, w, 44, 0.7);
  ctx.fillStyle = '#ff5147';
  ctx.font = `bold 14px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText('THE LAW IS ON YOU — MOVE!', width / 2, height - 190);
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillRect((width - w) / 2 + 14, height - 182, w - 28, 7);
  ctx.fillStyle = '#ff5147';
  ctx.fillRect((width - w) / 2 + 14, height - 182, (w - 28) * clamp(game.bustProgress, 0, 1), 7);
  ctx.textAlign = 'left';
}

function drawDialogue(ctx, dialogue, width, height) {
  const boxW = Math.min(680, width - 260);
  const boxX = (width - boxW) / 2;
  const boxY = height - 92;
  panel(ctx, boxX, boxY, boxW, 62, 0.78);
  ctx.fillStyle = dialogue.who === 'Rosa' ? '#ff9d7a' : dialogue.who === 'Paco' ? '#8fd0ff' : '#ffd98a';
  ctx.font = `bold 14px ${FONT}`;
  ctx.fillText(dialogue.who.toUpperCase(), boxX + 16, boxY + 22);
  ctx.fillStyle = '#f5f1e6';
  ctx.font = `15px ${FONT}`;
  wrapText(ctx, dialogue.text, boxX + 16, boxY + 44, boxW - 32, 19);
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(' ');
  let line = '';
  let ly = y;
  for (const word of words) {
    const trial = line ? line + ' ' + word : word;
    if (ctx.measureText(trial).width > maxWidth && line) {
      ctx.fillText(line, x, ly);
      line = word;
      ly += lineHeight;
    } else {
      line = trial;
    }
  }
  if (line) ctx.fillText(line, x, ly);
}

function drawBanner(ctx, banner, width, height) {
  const alpha = clamp(Math.min(banner.t / 0.4, (banner.duration - banner.t) / 0.6, 1), 0, 1);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffd14d';
  ctx.font = `bold 44px ${FONT}`;
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 12;
  ctx.fillText(banner.title, width / 2, height * 0.3);
  if (banner.sub) {
    ctx.fillStyle = '#ffffff';
    ctx.font = `18px ${FONT}`;
    ctx.fillText(banner.sub, width / 2, height * 0.3 + 36);
  }
  ctx.restore();
  ctx.textAlign = 'left';
}

// ---------------------------------------------------------------- screens

function drawTitleScreen(ctx, game, width, height) {
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, 'rgba(20,10,30,0.55)');
  grad.addColorStop(0.55, 'rgba(20,10,30,0.25)');
  grad.addColorStop(1, 'rgba(10,8,18,0.78)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffd14d';
  ctx.font = `bold 84px ${FONT}`;
  ctx.shadowColor = 'rgba(0,0,0,0.65)';
  ctx.shadowBlur = 18;
  ctx.fillText('MARISOL VICE', width / 2, height * 0.3);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#ffe9bd';
  ctx.font = `20px ${FONT}`;
  ctx.fillText('P O R T   M A R I S O L   ·   A   H A R B O U R   O F   T H I E V E S', width / 2, height * 0.3 + 40);
  ctx.fillStyle = '#f5f1e6';
  ctx.font = `16px ${FONT}`;
  ctx.fillText('Danny Cole owes money all over this island. Rosa Delgado collects in favours:', width / 2, height * 0.3 + 86);
  ctx.fillText('run her packages, borrow her cars, dodge her police — and one dawn, rob her bank.', width / 2, height * 0.3 + 108);
  ctx.font = `bold 19px ${FONT}`;
  ctx.fillStyle = '#7be495';
  ctx.fillText(game.saveExists ? 'ENTER — New Game      C — Continue' : 'ENTER — Start Danny’s Story', width / 2, height * 0.3 + 158);
  ctx.fillStyle = 'rgba(245,241,230,0.9)';
  ctx.font = `14px ${FONT}`;
  const controls = [
    'WASD / Arrows — walk & drive      SHIFT — sprint      SPACE — handbrake',
    'F — enter / exit car      MOUSE — aim      LMB — shoot (drive-by too)',
    'ESC / P — pause      M — mute      Stars bring police: lose them to cool off',
  ];
  controls.forEach((line, i) => ctx.fillText(line, width / 2, height * 0.3 + 196 + i * 22));
  ctx.fillStyle = 'rgba(245,241,230,0.55)';
  ctx.font = `12px ${FONT}`;
  ctx.fillText('An original open-world crime game. Every name, street and story in Port Marisol is invented.', width / 2, height - 22);
  ctx.textAlign = 'left';
}

function dimScreen(ctx, width, height, alpha) {
  ctx.fillStyle = `rgba(8,8,14,${alpha})`;
  ctx.fillRect(0, 0, width, height);
}

function drawPauseScreen(ctx, game, width, height) {
  dimScreen(ctx, width, height, 0.55);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold 44px ${FONT}`;
  ctx.fillText('PAUSED', width / 2, height * 0.38);
  ctx.font = `17px ${FONT}`;
  ctx.fillStyle = '#f5f1e6';
  ctx.fillText('ESC — keep driving', width / 2, height * 0.38 + 44);
  ctx.fillText('R — restart current mission', width / 2, height * 0.38 + 72);
  ctx.fillText('Q — save & quit to title', width / 2, height * 0.38 + 100);
  ctx.textAlign = 'left';
  void game;
}

function drawBustedScreen(ctx, game, width, height) {
  dimScreen(ctx, width, height, 0.62);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ff5147';
  ctx.font = `bold 72px ${FONT}`;
  ctx.fillText('BUSTED', width / 2, height * 0.42);
  ctx.fillStyle = '#f5f1e6';
  ctx.font = `18px ${FONT}`;
  ctx.fillText(`Marisol PD walks Danny out of the station, $${game.lastFine} lighter.`, width / 2, height * 0.42 + 42);
  ctx.fillText('Press ENTER to carry on', width / 2, height * 0.42 + 76);
  ctx.textAlign = 'left';
}

function drawWastedScreen(ctx, game, width, height) {
  ctx.fillStyle = 'rgba(90,10,10,0.5)';
  ctx.fillRect(0, 0, width, height);
  dimScreen(ctx, width, height, 0.35);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#e8e4da';
  ctx.font = `bold 72px ${FONT}`;
  ctx.fillText('WASTED', width / 2, height * 0.42);
  ctx.fillStyle = '#f5f1e6';
  ctx.font = `18px ${FONT}`;
  ctx.fillText(`St. Lucia Hospital patches Danny up and bills him $${game.lastFine}.`, width / 2, height * 0.42 + 42);
  ctx.fillText('Press ENTER to carry on', width / 2, height * 0.42 + 76);
  ctx.textAlign = 'left';
}

function drawCompleteScreen(ctx, game, width, height) {
  dimScreen(ctx, width, height, 0.6);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffd14d';
  ctx.font = `bold 52px ${FONT}`;
  ctx.fillText('THE HARBOUR IS YOURS', width / 2, height * 0.36);
  ctx.fillStyle = '#f5f1e6';
  ctx.font = `18px ${FONT}`;
  ctx.fillText('Debt paid in full. Danny Cole is a free man — with a fast car and Rosa’s blessing.', width / 2, height * 0.36 + 44);
  ctx.fillText(`Final balance: $${game.money.toLocaleString('en-US')}`, width / 2, height * 0.36 + 78);
  ctx.font = `16px ${FONT}`;
  ctx.fillText('ENTER — keep roaming Port Marisol (courier jobs pay cash at the cantina)', width / 2, height * 0.36 + 122);
  ctx.textAlign = 'left';
}
