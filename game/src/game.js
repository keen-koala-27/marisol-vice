// game.js — Marisol Vice itself. The Game class owns every system (city,
// player, traffic, police, missions, pickups, particles) and runs the loop:
// title screen, play, pause, busted, wasted and story-complete states. Crimes
// feed the wanted heat when a pedestrian or a patrol car witnesses them; heat
// becomes stars; stars bring PoliceControl down on the player until the heat
// cools or the player is busted, wasted, or home free.

import { WORLD_SIZE, HEAT_MAX, HEAT_DECAY_PER_SEC, BUST_TIME, SAVE_KEY, PALETTE } from './config.js';
import { mulberry32, clamp } from './rng.js';
import { Input } from './input.js';
import { SoundBank } from './sound.js';
import { buildCity, isOnRoad } from './city.js';
import { Car, TrafficDriver } from './vehicles.js';
import { Player, Pedestrian } from './people.js';
import { PoliceControl } from './police.js';
import { MISSIONS, MissionRunner, randomCourierJob } from './missions.js';
import { renderFrame } from './render.js';

const WEAPONS = {
  Pistol: { cooldown: 0.34, damage: 34, carDamage: 9, range: 470 },
  SMG: { cooldown: 0.115, damage: 22, carDamage: 6, range: 430 },
};

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.input = new Input(canvas);
    this.sound = new SoundBank();
    const params = new URLSearchParams(window.location.search);
    const seed = Number(params.get('seed') ?? 20261117);
    this.rng = mulberry32(seed ^ 0x9e3779b9);
    this.city = buildCity(seed);
    this.state = 'title';
    this.time = 0;
    this.money = 120;
    this.heat = 0;
    this.stars = 0;
    this.starFlash = 0;
    this.lastCrimeTime = -99;
    this.bustProgress = 0;
    this.lastFine = 0;
    this.camera = { x: 1280, y: 1280 };
    this.shake = 0;
    this.banner = null;
    this.dialogue = null;
    this.dialogueQueue = [];
    this.dialogueTimer = 0;
    this.promptText = null;
    this.objectiveText = null;
    this.marker = null;
    this.cars = [];
    this.trafficDrivers = new Map();
    this.peds = [];
    this.pickups = [];
    this.particles = [];
    this.tracers = [];
    this.skids = [];
    this.shootCooldown = 0;
    this.threat = null;
    this.threatTimer = 0;
    this.ambientTimer = 8;
    this.runner = new MissionRunner();
    this.missionCar = null;
    this.van = null;
    this.vanDriver = null;
    this.bagsCollected = 0;
    this.job = null;
    this.pendingMissionStart = 0;
    this.saveExists = false;
    this.police = new PoliceControl(this.rng);
    this.player = new Player(this.city.landmarks.cantina.x, this.city.landmarks.cantina.y + 30);
    this.spawnWorld();
    this.loadSaveMetadata();
    this.shotName = params.get('shot');
    if (this.shotName) this.stageShot(this.shotName);
    window.__MARISOL__ = this;
    this.lastTimestamp = performance.now();
    const loop = (now) => {
      const dt = Math.min(0.033, (now - this.lastTimestamp) / 1000);
      this.lastTimestamp = now;
      this.update(dt);
      renderFrame(this.ctx, this, canvas.width, canvas.height);
      this.input.endFrame();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // ------------------------------------------------------------ world setup

  spawnWorld() {
    for (const spawn of this.city.parkedCarSpawns) {
      const car = new Car(spawn.x, spawn.y, spawn.angle, spawn.kind, this.randomPaint(spawn.kind));
      car.parked = true;
      this.cars.push(car);
    }
    for (let i = 0; i < 13; i++) this.spawnTrafficCar(true);
    for (let i = 0; i < 26; i++) this.peds.push(new Pedestrian(this.rng, this.city));
  }

  randomPaint(kind) {
    if (kind === 'taxi') return PALETTE.taxiPaint;
    if (kind === 'sport') return PALETTE.sportPaint;
    return PALETTE.carPaints[Math.floor(this.rng() * PALETTE.carPaints.length)];
  }

  spawnTrafficCar(anywhere = false) {
    const kinds = ['sedan', 'sedan', 'taxi', 'sedan', 'van'];
    const kind = kinds[Math.floor(this.rng() * kinds.length)];
    let x = 0;
    let y = 0;
    for (let tries = 0; tries < 20; tries++) {
      const vertical = this.rng() > 0.5;
      const centres = [256, 768, 1280, 1792, 2304];
      const centre = centres[Math.floor(this.rng() * centres.length)];
      const along = 80 + this.rng() * (WORLD_SIZE - 160);
      x = vertical ? centre + (this.rng() > 0.5 ? 27 : -27) : along;
      y = vertical ? along : centre + (this.rng() > 0.5 ? 27 : -27);
      const dist = Math.hypot(x - this.player.x, y - this.player.y);
      if (anywhere || (dist > 480 && dist < 980)) break;
    }
    const angle = Math.round(this.rng() * 3) * (Math.PI / 2);
    const car = new Car(x, y, angle, kind, this.randomPaint(kind));
    this.cars.push(car);
    this.trafficDrivers.set(car.id, new TrafficDriver(car, this.rng));
    return car;
  }

  // ------------------------------------------------------------ save / load

  loadSaveMetadata() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      this.saveExists = !!raw;
    } catch {
      this.saveExists = false;
    }
  }

  saveGame() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        money: this.money,
        nextMission: this.runner.storyComplete ? MISSIONS.length : this.runner.active ? this.runner.index : this.runner.index + 1,
        storyComplete: this.runner.storyComplete,
        weapon: this.player.weapon,
      }));
      this.saveExists = true;
    } catch {
      // Storage can be unavailable (private mode); the game plays on regardless.
    }
  }

  continueGame() {
    try {
      const data = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (!data) return this.newGame();
      this.money = data.money ?? 120;
      this.player.weapon = data.weapon ?? 'Pistol';
      this.beginPlay();
      if (data.storyComplete) {
        this.runner.storyComplete = true;
        this.showBanner('FREE ROAM', 'Courier jobs pay cash — see Rosa at the cantina');
        this.refreshObjective();
      } else {
        this.startMission(Math.min(data.nextMission ?? 0, MISSIONS.length - 1));
      }
    } catch {
      this.newGame();
    }
  }

  newGame() {
    this.money = 120;
    this.heat = 0;
    this.player = new Player(this.city.landmarks.cantina.x, this.city.landmarks.cantina.y + 30);
    this.beginPlay();
    this.startMission(0);
  }

  beginPlay() {
    this.state = 'play';
    this.police.reset();
    this.camera.x = this.player.x;
    this.camera.y = this.player.y;
  }

  // ------------------------------------------------------------ missions

  startMission(index) {
    const intro = this.runner.startMission(index, this.city.landmarks);
    this.queueDialogue(intro);
    this.showBanner(`MISSION ${index + 1}`, MISSIONS[index].title);
    this.onStepEnter();
    this.refreshObjective();
  }

  onStepEnter() {
    const step = this.runner.currentStep();
    if (!step) return;
    if (step.effect === 'spawnMissionCar') {
      const marina = this.city.landmarks.marina;
      const car = new Car(marina.x - 60, marina.y - 40, Math.PI / 2, 'sport', PALETTE.sportPaint);
      car.parked = true;
      car.missionCar = true;
      this.missionCar = car;
      this.cars.push(car);
    }
    if (step.effect === 'spawnVan') {
      const bank = this.city.landmarks.bank;
      const van = new Car(bank.x + 40, bank.y + 66, 0, 'van', PALETTE.vanPaint);
      van.health = 340;
      van.armored = true;
      this.van = van;
      this.cars.push(van);
      this.vanDriver = new TrafficDriver(van, this.rng);
      this.vanDriver.cruiseSpeed = 118;
    }
  }

  refreshObjective() {
    const step = this.runner.currentStep();
    if (step) {
      this.objectiveText = step.type === 'escape'
        ? `Lose the heat (${this.stars}★) then reach the Harbor Hideout`
        : step.objective;
      this.marker = { x: step.x, y: step.y };
      if (step.type === 'steal' && this.missionCar) this.marker = { x: this.missionCar.x, y: this.missionCar.y };
      if (step.type === 'deliverCar' && this.missionCar) this.marker = { x: step.x, y: step.y };
      if (step.type === 'disableVan' && this.van) this.marker = { x: this.van.x, y: this.van.y };
      if (step.type === 'collect') this.marker = this.nearestBagPosition();
      return;
    }
    if (this.job) {
      const atPickup = this.job.leg === 'pickup';
      this.objectiveText = atPickup ? 'Courier job: pick up the parcel' : `Courier job: deliver it — $${this.job.reward}`;
      this.marker = atPickup ? { x: this.job.fromX, y: this.job.fromY } : { x: this.job.toX, y: this.job.toY };
      return;
    }
    if (this.runner.storyComplete) {
      this.objectiveText = 'Free roam — courier jobs at Cantina Rosa';
      this.marker = { x: this.city.landmarks.cantina.x, y: this.city.landmarks.cantina.y };
      return;
    }
    this.objectiveText = null;
    this.marker = null;
  }

  nearestBagPosition() {
    const bag = this.pickups.find((p) => p.missionBag);
    return bag ? { x: bag.x, y: bag.y } : null;
  }

  completeCurrentStep() {
    const mission = this.runner.mission;
    const result = this.runner.advanceStep();
    if (result === 'step') {
      this.onStepEnter();
    } else {
      this.money += mission.reward;
      this.sound.playMissionComplete();
      this.queueDialogue(mission.outro);
      if (result === 'story') {
        this.showBanner('STORY COMPLETE', `${mission.title} · +$${mission.reward}`);
        this.saveGame();
        this.state = 'complete';
      } else {
        this.showBanner('MISSION COMPLETE', `${mission.title} · +$${mission.reward}`);
        this.saveGame();
        this.pendingMissionStart = 2.5;
      }
    }
    this.refreshObjective();
  }

  failMission(reason) {
    this.showBanner('MISSION FAILED', reason);
    this.sound.playBusted();
    // Clean up mission props and run the same mission again from the top.
    if (this.missionCar) {
      this.cars = this.cars.filter((c) => c !== this.missionCar);
      this.missionCar = null;
    }
    if (this.van) {
      this.cars = this.cars.filter((c) => c !== this.van);
      this.van = null;
      this.vanDriver = null;
    }
    this.pickups = this.pickups.filter((p) => !p.missionBag);
    this.bagsCollected = 0;
    const index = this.runner.index;
    this.runner.startMission(index, this.city.landmarks);
    this.onStepEnter();
    this.refreshObjective();
  }

  updateMissions(dt) {
    if (this.pendingMissionStart > 0) {
      this.pendingMissionStart -= dt;
      if (this.pendingMissionStart <= 0 && !this.runner.active && !this.runner.storyComplete) {
        this.startMission(this.runner.index + 1);
      }
      return;
    }
    const step = this.runner.currentStep();
    if (!step) {
      this.updateCourierJob();
      return;
    }
    const player = this.player;
    const distToStep = Math.hypot(player.x - step.x, player.y - step.y);
    if (step.type === 'goto') {
      if (distToStep < (player.inCar ? 72 : 52)) {
        if (step.effect === 'ambush') {
          this.setHeatAtLeast(300);
          this.showBanner('IT’S A SET-UP!', 'Rosa was sold out — run!');
          this.queueDialogue([{ who: 'Danny', text: 'Blue lights everywhere. Rosa, we are going to talk about this.' }]);
        }
        this.completeCurrentStep();
      }
    } else if (step.type === 'steal') {
      if (this.missionCar && player.inCar === this.missionCar) this.completeCurrentStep();
    } else if (step.type === 'deliverCar') {
      if (this.missionCar && this.missionCar.dead) {
        this.failMission('The sports car is wrecked. Rosa sends another… eventually.');
      } else if (this.missionCar && player.inCar === this.missionCar && distToStep < 78) {
        if (this.missionCar.health >= 30) this.completeCurrentStep();
        else this.failMission('Paco takes one look and shakes his head. Too wrecked.');
      }
    } else if (step.type === 'escape') {
      this.objectiveText = `Lose the heat (${this.stars}★) then reach the Harbor Hideout`;
      if (distToStep < 72 && this.stars === 0) this.completeCurrentStep();
    } else if (step.type === 'disableVan') {
      if (this.van) {
        this.marker = { x: this.van.x, y: this.van.y };
        if (this.van.dead || this.van.health < 110) {
          this.stopVanAndDropBags();
          this.completeCurrentStep();
        }
      }
    } else if (step.type === 'collect') {
      this.marker = this.nearestBagPosition();
      if (this.bagsCollected >= (step.count ?? 3)) this.completeCurrentStep();
    }
  }

  stopVanAndDropBags() {
    const van = this.van;
    if (!van) return;
    van.dead = true;
    van.speed = 0;
    this.vanDriver = null;
    for (let i = 0; i < 3; i++) {
      const angle = (i / 3) * Math.PI * 2 + 0.6;
      this.pickups.push({
        x: van.x + Math.cos(angle) * 52,
        y: van.y + Math.sin(angle) * 52,
        kind: 'cash',
        amount: 0,
        missionBag: true,
        phase: this.rng() * 6,
      });
    }
    this.addHeat(70, van.x, van.y);
    this.showBanner('THE VAN IS DOWN', 'Grab the bags — on foot, quick!');
  }

  updateCourierJob() {
    if (!this.runner.storyComplete) return;
    const cantina = this.city.landmarks.cantina;
    if (!this.job) {
      this.marker = { x: cantina.x, y: cantina.y };
      this.objectiveText = 'Free roam — courier jobs at Cantina Rosa';
      if (Math.hypot(this.player.x - cantina.x, this.player.y - cantina.y) < 56) {
        this.job = randomCourierJob(this.rng, this.city.landmarks);
        this.sound.playPickup();
        this.showBanner('COURIER JOB', `Parcel run — $${this.job.reward}`);
        this.refreshObjective();
      }
      return;
    }
    const job = this.job;
    const target = job.leg === 'pickup' ? { x: job.fromX, y: job.fromY } : { x: job.toX, y: job.toY };
    if (Math.hypot(this.player.x - target.x, this.player.y - target.y) < (this.player.inCar ? 72 : 52)) {
      if (job.leg === 'pickup') {
        job.leg = 'deliver';
        this.sound.playPickup();
      } else {
        this.money += job.reward;
        this.sound.playCash();
        this.showBanner('DELIVERED', `+$${job.reward}`);
        this.job = null;
        this.saveGame();
      }
      this.refreshObjective();
    }
  }

  // ------------------------------------------------------------ crime & heat

  witnessesNear(x, y, radius) {
    for (const ped of this.peds) {
      if (!ped.dead && Math.hypot(ped.x - x, ped.y - y) < radius) return true;
    }
    return this.police.eyesOnPlayer;
  }

  addHeat(amount, x, y) {
    const witnessed = this.witnessesNear(x, y, 340);
    const applied = witnessed ? amount : amount * 0.35;
    const before = this.stars;
    this.heat = clamp(this.heat + applied, 0, HEAT_MAX);
    this.lastCrimeTime = this.time;
    this.threat = { x, y };
    this.threatTimer = 1.4;
    this.stars = this.computeStars();
    if (this.stars > before) this.starFlash = 0.9;
  }

  setHeatAtLeast(value) {
    this.heat = Math.max(this.heat, value);
    this.lastCrimeTime = this.time;
    this.stars = this.computeStars();
    this.starFlash = 0.9;
  }

  computeStars() {
    if (this.heat <= 1) return 0;
    return Math.min(5, Math.ceil(this.heat / 100));
  }

  // ------------------------------------------------------------ combat

  fireBullet() {
    const player = this.player;
    const weapon = WEAPONS[player.weapon];
    if (!weapon || this.shootCooldown > 0) return;
    this.shootCooldown = weapon.cooldown;
    const origin = player.inCar ? player.inCar : player;
    const angle = player.inCar
      ? Math.atan2(this.mouseWorld().y - origin.y, this.mouseWorld().x - origin.x)
      : player.angle;
    const spread = (this.rng() - 0.5) * 0.03;
    const dir = angle + spread;
    let hitX = origin.x + Math.cos(dir) * weapon.range;
    let hitY = origin.y + Math.sin(dir) * weapon.range;
    let hitSomething = null;
    // March the ray; buildings stop it, then the first body or car on the line.
    for (let d = 14; d < weapon.range; d += 7) {
      const px = origin.x + Math.cos(dir) * d;
      const py = origin.y + Math.sin(dir) * d;
      let blocked = false;
      for (const b of this.city.solids) {
        if (px > b.x && px < b.x + b.w && py > b.y && py < b.y + b.h) { blocked = true; break; }
      }
      if (blocked) { hitX = px; hitY = py; hitSomething = 'wall'; break; }
      for (const ped of this.peds) {
        if (!ped.dead && Math.hypot(ped.x - px, ped.y - py) < 11) { hitSomething = ped; hitX = px; hitY = py; break; }
      }
      if (hitSomething) break;
      const allCars = [...this.cars, ...this.police.units];
      for (const car of allCars) {
        if (car === player.inCar) continue;
        if (Math.hypot(car.x - px, car.y - py) < 27) { hitSomething = car; hitX = px; hitY = py; break; }
      }
      if (hitSomething) break;
    }
    this.tracers.push({ x1: origin.x + Math.cos(dir) * 18, y1: origin.y + Math.sin(dir) * 18, x2: hitX, y2: hitY, life: 0.09 });
    this.burst(hitX, hitY, 2, '#ffd76a', 60, 0.18, 2);
    this.sound.playGunshot();
    this.threat = { x: origin.x, y: origin.y };
    this.threatTimer = 1.2;
    if (hitSomething instanceof Pedestrian) {
      const died = hitSomething.hurt(weapon.damage);
      this.burst(hitX, hitY, 5, '#a03028', 70, 0.3, 2.4);
      if (died) {
        this.addHeat(95, hitSomething.x, hitSomething.y);
        if (this.rng() > 0.45) this.dropPickup(hitSomething.x, hitSomething.y, 'cash', 10 + Math.floor(this.rng() * 30));
      } else {
        this.addHeat(45, origin.x, origin.y);
      }
    } else if (hitSomething instanceof Car) {
      hitSomething.damage(hitSomething.armored ? weapon.carDamage * 0.55 : weapon.carDamage);
      this.burst(hitX, hitY, 4, '#ffb84d', 90, 0.25, 2);
      if (hitSomething.kind === 'cop') this.addHeat(55, origin.x, origin.y);
      else this.addHeat(22, origin.x, origin.y);
      if (hitSomething === this.van && this.van.dead) this.stopVanCheck();
    } else {
      this.addHeat(30, origin.x, origin.y);
    }
  }

  stopVanCheck() {
    // The missions update notices the van's health and drops the bags.
  }

  dropPickup(x, y, kind, amount = 0) {
    this.pickups.push({ x, y, kind, amount, phase: this.rng() * 6 });
  }

  burst(x, y, count, color, speed, life, size, grows = false) {
    for (let i = 0; i < count; i++) {
      const a = this.rng() * Math.PI * 2;
      const v = speed * (0.3 + this.rng() * 0.7);
      this.particles.push({
        x, y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life: life * (0.6 + this.rng() * 0.7),
        maxLife: life,
        color, size: size * (0.7 + this.rng() * 0.6),
        grows,
      });
    }
    if (this.particles.length > 520) this.particles.splice(0, this.particles.length - 520);
  }

  smokeAt(x, y) {
    this.particles.push({
      x: x + (this.rng() - 0.5) * 10,
      y: y + (this.rng() - 0.5) * 10,
      vx: (this.rng() - 0.5) * 14,
      vy: -26 - this.rng() * 18,
      life: 1.15,
      maxLife: 1.15,
      color: 'rgba(70,70,74,0.55)',
      size: 6,
      grows: true,
    });
  }

  // ------------------------------------------------------------ outcomes

  busted() {
    this.lastFine = Math.min(this.money, 60 + this.stars * 40);
    this.money -= this.lastFine;
    this.state = 'busted';
    this.sound.playBusted();
    this.sound.updateEngine(null);
    this.heat = 0;
    this.stars = 0;
    this.bustProgress = 0;
    this.police.reset();
    if (this.player.inCar) this.exitCar(true);
  }

  wasted() {
    this.lastFine = Math.min(this.money, 120);
    this.money -= this.lastFine;
    this.state = 'wasted';
    this.sound.updateEngine(null);
    this.heat = 0;
    this.stars = 0;
    this.bustProgress = 0;
    this.police.reset();
    if (this.player.inCar) this.exitCar(true);
  }

  respawnAt(landmarkKey) {
    const spot = this.city.landmarks[landmarkKey];
    this.player.x = spot.x;
    this.player.y = spot.y + 16;
    this.player.health = 100;
    this.camera.x = this.player.x;
    this.camera.y = this.player.y;
    this.state = 'play';
  }

  exitCar(silent = false) {
    const car = this.player.inCar;
    if (!car) return;
    const side = car.angle + Math.PI / 2;
    this.player.x = clamp(car.x + Math.cos(side) * 30, 14, WORLD_SIZE - 14);
    this.player.y = clamp(car.y + Math.sin(side) * 30, 14, WORLD_SIZE - 14);
    this.player.inCar = null;
    if (!silent) this.sound.playDoor();
    this.sound.updateEngine(null);
  }

  enterCar(car) {
    const player = this.player;
    if (car.parked) {
      // Hot-wiring a parked car in view of the street is a crime.
      this.addHeat(52, car.x, car.y);
    }
    const driver = this.trafficDrivers.get(car.id);
    if (driver) {
      this.trafficDrivers.delete(car.id);
      // The owner bails out and runs for it.
      const ped = new Pedestrian(this.rng, this.city);
      ped.x = car.x + 26;
      ped.y = car.y;
      ped.fleeTime = 3;
      ped.fleeAngle = Math.atan2(ped.y - player.y, ped.x - player.x);
      this.peds.push(ped);
      this.addHeat(60, car.x, car.y);
    }
    car.parked = false;
    player.inCar = car;
    player.x = car.x;
    player.y = car.y;
    this.sound.playDoor();
  }

  // ------------------------------------------------------------ staging

  stageShot(name) {
    this.newGameSilent();
    const L = this.city.landmarks;
    if (name === 'cover') {
      const car = new Car(1150, 795, 0, 'sport', PALETTE.sportPaint);
      car.speed = 250;
      this.cars.push(car);
      this.player.inCar = car;
      this.player.x = car.x;
      this.player.y = car.y;
      this.setHeatAtLeast(265);
      for (let i = 0; i < 3; i++) {
        const cop = new Car(880 - i * 130, 795 + (i % 2 ? 24 : -24), 0, 'cop', PALETTE.copPaint);
        cop.speed = 240;
        cop.driverAge = 0;
        cop.stuckTime = 0;
        this.police.units.push(cop);
      }
      this.objectiveText = 'Deliver the package to Cantina Rosa';
      this.marker = { x: L.cantina.x, y: L.cantina.y };
      this.camera.x = car.x;
      this.camera.y = car.y;
    } else if (name === 'downtown') {
      this.player.x = 1062;
      this.player.y = 1158;
      this.camera.x = this.player.x;
      this.camera.y = this.player.y;
      this.dialogue = { who: 'Rosa', text: 'A package waits at the Pier 9 warehouse. Bring it to my cantina. Do not open it.' };
      this.dialogueTimer = 999;
      this.objectiveText = 'Pick up Rosa’s package at Pier 9 Warehouse';
      this.marker = { x: L.docks.x, y: L.docks.y };
    } else if (name === 'mission') {
      const car = new Car(1010, 2280, 0.5, 'sedan', '#c94f42');
      car.speed = 120;
      this.cars.push(car);
      this.player.inCar = car;
      this.player.x = car.x;
      this.player.y = car.y;
      this.setHeatAtLeast(105);
      const cop = new Car(700, 2330, 0.2, 'cop', PALETTE.copPaint);
      cop.driverAge = 0;
      cop.stuckTime = 0;
      this.police.units.push(cop);
      this.objectiveText = 'Pick up Rosa’s package at Pier 9 Warehouse';
      this.marker = { x: L.docks.x, y: L.docks.y };
      this.camera.x = car.x;
      this.camera.y = car.y;
    } else if (name === 'getaway') {
      const car = new Car(1830, 1307, 0, 'sedan', '#3f6fb5');
      car.speed = 285;
      car.health = 34;
      this.cars.push(car);
      this.player.inCar = car;
      this.player.x = car.x;
      this.player.y = car.y;
      for (let i = 0; i < 12; i++) {
        this.skids.push({ x1: 1830 - i * 26 - 20, y1: 1307 - 9, x2: 1830 - i * 26, y2: 1307 - 9, alpha: 0.5, life: 16 });
        this.skids.push({ x1: 1830 - i * 26 - 20, y1: 1307 + 9, x2: 1830 - i * 26, y2: 1307 + 9, alpha: 0.5, life: 16 });
      }
      this.setHeatAtLeast(320);
      for (let i = 0; i < 3; i++) {
        const cop = new Car(1560 - i * 120, 1307 + (i % 2 ? 26 : -26), 0, 'cop', PALETTE.copPaint);
        cop.speed = 270;
        cop.driverAge = 0;
        cop.stuckTime = 0;
        this.police.units.push(cop);
      }
      this.objectiveText = 'Lose the heat, then reach the Harbor Hideout';
      this.marker = { x: L.hideout.x, y: L.hideout.y };
      this.camera.x = car.x;
      this.camera.y = car.y;
    }
    this.state = 'play';
  }

  newGameSilent() {
    this.money = 340;
    this.runner.startMission(0, this.city.landmarks);
    this.state = 'play';
  }

  // ------------------------------------------------------------ dialogue

  queueDialogue(lines) {
    for (const line of lines) this.dialogueQueue.push(line);
    if (!this.dialogue) this.nextDialogue();
  }

  nextDialogue() {
    this.dialogue = this.dialogueQueue.shift() ?? null;
    this.dialogueTimer = 4.2;
  }

  showBanner(title, sub) {
    this.banner = { title, sub, t: 0, duration: 2.8 };
  }

  // ------------------------------------------------------------ update

  mouseWorld() {
    return {
      x: this.camera.x + (this.input.mouseX - this.canvas.width / 2),
      y: this.camera.y + (this.input.mouseY - this.canvas.height / 2),
    };
  }

  update(dt) {
    this.time += dt;
    if (this.banner) {
      this.banner.t += dt;
      if (this.banner.t > this.banner.duration) this.banner = null;
    }
    if (this.starFlash > 0) this.starFlash -= dt;
    this.updateParticles(dt);
    // The title screen keeps the city alive behind the logo.
    if (this.state === 'title') {
      this.camera.x = 1280 + Math.cos(this.time * 0.05) * 420;
      this.camera.y = 1280 + Math.sin(this.time * 0.037) * 420;
      this.updateTraffic(dt);
      this.updatePeds(dt);
      if (this.input.pressed('Enter')) {
        this.sound.unlock();
        this.newGame();
      } else if (this.input.pressed('KeyC') && this.saveExists) {
        this.sound.unlock();
        this.continueGame();
      }
      return;
    }
    if (this.state === 'busted' || this.state === 'wasted') {
      if (this.input.pressed('Enter')) {
        this.respawnAt(this.state === 'busted' ? 'police' : 'hospital');
      }
      return;
    }
    if (this.state === 'complete') {
      if (this.input.pressed('Enter')) {
        this.state = 'play';
        this.refreshObjective();
      }
      return;
    }
    if (this.state === 'pause') {
      if (this.input.pressed('Escape', 'KeyP')) this.state = 'play';
      else if (this.input.pressed('KeyR')) {
        this.state = 'play';
        this.failMission('Rosa calls it back in. Run it again, cleaner.');
      } else if (this.input.pressed('KeyQ')) {
        this.saveGame();
        this.state = 'title';
      }
      return;
    }
    if (this.input.pressed('Escape', 'KeyP')) {
      this.state = 'pause';
      return;
    }
    if (this.input.pressed('KeyM')) {
      this.sound.setMuted(!this.sound.muted);
    }
    if (this.input.mouseClicked || this.input.keysPressed.size > 0) this.sound.unlock();
    if (this.dialogue) {
      this.dialogueTimer -= dt;
      if (this.dialogueTimer <= 0 || this.input.mouseClicked) this.nextDialogue();
    }
    this.updatePlay(dt);
  }

  updatePlay(dt) {
    const player = this.player;
    this.shootCooldown -= dt;
    if (this.threatTimer > 0) this.threatTimer -= dt;
    else this.threat = null;

    if (player.inCar) this.updateDriving(dt);
    else this.updateOnFoot(dt);

    this.updateTraffic(dt);
    this.updateVan(dt);
    const focus = player.inCar ?? player;
    this.police.update(dt, focus, this.stars, this.city.solids);
    this.updateCarCollisions(dt);
    this.updatePeds(dt);
    this.updatePickups(dt);
    this.updateHeat(dt);
    this.updateBust(dt);
    this.updateMissions(dt);
    this.updateAmbient(dt);
    this.updateCamera(dt);
    this.updateAudio();

    if (player.health <= 0) this.wasted();
  }

  updateDriving(dt) {
    const player = this.player;
    const car = player.inCar;
    const ctl = {
      accelerate: this.input.down('KeyW', 'ArrowUp'),
      brake: this.input.down('KeyS', 'ArrowDown'),
      steer: (this.input.down('KeyA', 'ArrowLeft') ? -1 : 0) + (this.input.down('KeyD', 'ArrowRight') ? 1 : 0),
      handbrake: this.input.down('Space'),
    };
    const prevRear = this.rearWheelPositions(car);
    car.update(dt, ctl, this.city.solids);
    player.x = car.x;
    player.y = car.y;
    player.angle = car.angle;
    if (car.lastImpact > 150) {
      this.sound.playCrash((car.lastImpact - 150) / 200);
      this.shake = Math.min(14, (car.lastImpact - 130) / 16);
      this.burst(car.x + Math.cos(car.angle) * 22, car.y + Math.sin(car.angle) * 22, 7, '#ffb84d', 130, 0.35, 2.4);
      if (car.lastImpact > 245) player.takeDamage((car.lastImpact - 245) / 22);
    }
    if ((ctl.handbrake && Math.abs(car.speed) > 110) || (Math.abs(ctl.steer) > 0 && Math.abs(car.speed) > 265)) {
      const rear = this.rearWheelPositions(car);
      this.skids.push({ x1: prevRear.lx, y1: prevRear.ly, x2: rear.lx, y2: rear.ly, alpha: 0.5, life: 16 });
      this.skids.push({ x1: prevRear.rx, y1: prevRear.ry, x2: rear.rx, y2: rear.ry, alpha: 0.5, life: 16 });
      if (this.skids.length > 480) this.skids.splice(0, this.skids.length - 480);
    }
    if (car.dead) {
      player.takeDamage(18);
      this.showBanner('TOTALLED', 'Out — on foot, now!');
      this.exitCar();
      return;
    }
    // Running people down is the loudest crime in Marisol.
    for (const ped of this.peds) {
      if (ped.dead) continue;
      const dist = Math.hypot(ped.x - car.x, ped.y - car.y);
      if (dist < 26) {
        if (Math.abs(car.speed) > 55) {
          ped.hurt(100);
          this.burst(ped.x, ped.y, 6, '#a03028', 80, 0.35, 2.4);
          this.addHeat(120, ped.x, ped.y);
          this.sound.playCrash(0.4);
          car.speed *= 0.82;
        } else {
          ped.fleeTime = 1.6;
          ped.fleeAngle = Math.atan2(ped.y - car.y, ped.x - car.x);
        }
      }
    }
    if (this.input.mouseDown) this.fireBullet();
    if (this.input.pressed('KeyF', 'Enter')) this.exitCar();
    this.promptText = null;
  }

  rearWheelPositions(car) {
    const back = -car.length / 2 + 9;
    const side = car.width / 2 - 2;
    const cos = Math.cos(car.angle);
    const sin = Math.sin(car.angle);
    return {
      lx: car.x + cos * back - sin * side,
      ly: car.y + sin * back + cos * side,
      rx: car.x + cos * back + sin * side,
      ry: car.y + sin * back - cos * side,
    };
  }

  updateOnFoot(dt) {
    const player = this.player;
    player.updateOnFoot(dt, this.input, this.mouseWorld(), this.city.solids);
    // The nearest usable car offers itself.
    let nearest = null;
    let nearestDist = 56;
    for (const car of this.cars) {
      if (car.dead) continue;
      const dist = Math.hypot(car.x - player.x, car.y - player.y);
      if (dist < nearestDist) {
        nearest = car;
        nearestDist = dist;
      }
    }
    this.promptText = nearest ? `F — ${nearest.parked ? 'Steal' : 'Drive'} the ${nearest.kind}` : null;
    if (nearest && this.input.pressed('KeyF', 'Enter')) {
      this.enterCar(nearest);
      return;
    }
    if (this.input.mouseDown) this.fireBullet();
  }

  updateTraffic(dt) {
    const obstacles = [...this.cars, ...this.police.units];
    for (const [id, driver] of this.trafficDrivers) {
      const car = driver.car;
      if (car.dead || car === this.player.inCar) continue;
      const ctl = driver.update(dt, { obstacles });
      if (ctl.honk && Math.hypot(car.x - this.player.x, car.y - this.player.y) < 460) this.sound.playHorn();
      car.update(dt, ctl, this.city.solids);
      void id;
    }
    // Recycle traffic that has wandered too far from the action.
    for (const [id, driver] of [...this.trafficDrivers]) {
      const car = driver.car;
      if (Math.hypot(car.x - this.player.x, car.y - this.player.y) > 1250 && car !== this.van) {
        this.cars = this.cars.filter((c) => c !== car);
        this.trafficDrivers.delete(id);
        this.spawnTrafficCar();
      }
      void id;
    }
  }

  updateVan(dt) {
    if (!this.van || !this.vanDriver || this.van.dead) return;
    const ctl = this.vanDriver.update(dt, { obstacles: [...this.cars, ...this.police.units] });
    this.van.update(dt, ctl, this.city.solids);
  }

  updateCarCollisions(dt) {
    const all = [...this.cars, ...this.police.units];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i];
        const b = all[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy);
        const minDist = 40;
        if (dist === 0 || dist >= minDist) continue;
        const nx = dx / dist;
        const ny = dy / dist;
        const overlap = (minDist - dist) / 2;
        if (!a.parked) { a.x -= nx * overlap; a.y -= ny * overlap; }
        if (!b.parked) { b.x += nx * overlap; b.y += ny * overlap; }
        const avx = Math.cos(a.angle) * a.speed;
        const avy = Math.sin(a.angle) * a.speed;
        const bvx = Math.cos(b.angle) * b.speed;
        const bvy = Math.sin(b.angle) * b.speed;
        const relNormal = (bvx - avx) * nx + (bvy - avy) * ny;
        if (relNormal < 0) {
          const impulse = -relNormal * 0.72;
          const aNewVx = avx - nx * impulse;
          const aNewVy = avy - ny * impulse;
          const bNewVx = bvx + nx * impulse;
          const bNewVy = bvy + ny * impulse;
          if (!a.parked) a.speed = aNewVx * Math.cos(a.angle) + aNewVy * Math.sin(a.angle);
          if (!b.parked) b.speed = bNewVx * Math.cos(b.angle) + bNewVy * Math.sin(b.angle);
          const impact = -relNormal;
          if (impact > 85) {
            const dmg = (impact - 85) / 13;
            a.damage(dmg);
            b.damage(dmg);
            this.burst((a.x + b.x) / 2, (a.y + b.y) / 2, 6, '#ffb84d', 120, 0.3, 2.2);
            const playerInvolved = a === this.player.inCar || b === this.player.inCar;
            if (playerInvolved) {
              this.sound.playCrash(impact / 260);
              this.shake = Math.min(12, impact / 22);
              if (impact > 150) this.addHeat(48, this.player.x, this.player.y);
            }
          }
        }
      }
    }
    void dt;
  }

  updatePeds(dt) {
    let threat = this.threat;
    if (!threat && this.player.inCar && Math.abs(this.player.inCar.speed) > 190) {
      threat = { x: this.player.inCar.x, y: this.player.inCar.y };
    }
    for (const ped of this.peds) ped.update(dt, threat);
    // The city stays populated: the dead are quietly replaced across town.
    if (this.peds.length < 26 && this.rng() > 0.6) {
      const ped = new Pedestrian(this.rng, this.city);
      if (Math.hypot(ped.x - this.player.x, ped.y - this.player.y) > 500) this.peds.push(ped);
    }
    if (this.peds.length > 34) this.peds = this.peds.filter((p) => !p.dead).slice(0, 30);
  }

  updatePickups(dt) {
    const player = this.player;
    const survivors = [];
    for (const pickup of this.pickups) {
      const dist = Math.hypot(pickup.x - player.x, pickup.y - player.y);
      let taken = false;
      if (dist < 30) {
        if (pickup.missionBag) {
          if (!player.inCar) {
            this.bagsCollected++;
            this.sound.playCash();
            this.showBanner('BAG GRABBED', `${this.bagsCollected} of 3`);
            taken = true;
          } else {
            this.promptText = 'Get out and grab the cash bag';
          }
        } else if (pickup.kind === 'cash') {
          this.money += pickup.amount;
          this.sound.playCash();
          taken = true;
        } else if (pickup.kind === 'health' && player.health < 100) {
          player.heal(45);
          this.sound.playPickup();
          taken = true;
        } else if (pickup.kind === 'armor' && player.armor < 100) {
          player.armor = 100;
          this.sound.playPickup();
          taken = true;
        } else if (pickup.kind === 'smg' && player.weapon !== 'SMG') {
          player.weapon = 'SMG';
          this.sound.playPickup();
          this.showBanner('SMG ACQUIRED', 'Hold LMB to hose the street down');
          taken = true;
        }
      }
      if (!taken) survivors.push(pickup);
    }
    this.pickups = survivors;
    void dt;
  }

  updateHeat(dt) {
    const before = this.stars;
    if (!this.police.eyesOnPlayer && this.time - this.lastCrimeTime > 3.5 && this.heat > 0) {
      // Cooling off is slower at high heat: three stars take real hiding.
      const rate = this.stars >= 3 ? HEAT_DECAY_PER_SEC * 1.1 : HEAT_DECAY_PER_SEC * 2.2;
      this.heat = Math.max(0, this.heat - rate * dt);
    }
    this.stars = this.computeStars();
    if (this.stars > before) this.starFlash = 0.9;
    if (this.runner.currentStep()?.type === 'escape') this.refreshObjectiveTextOnly();
  }

  refreshObjectiveTextOnly() {
    this.objectiveText = `Lose the heat (${this.stars}★) then reach the Harbor Hideout`;
  }

  updateBust(dt) {
    const player = this.player;
    if (this.stars <= 0) {
      this.bustProgress = Math.max(0, this.bustProgress - dt * 1.6);
      return;
    }
    const focusSpeed = player.inCar ? Math.abs(player.inCar.speed) : 0;
    if (this.police.nearestDistance < 105 && focusSpeed < 38) {
      this.bustProgress += dt / BUST_TIME;
      if (this.bustProgress >= 1) this.busted();
    } else {
      this.bustProgress = Math.max(0, this.bustProgress - dt * 1.1);
    }
  }

  updateAmbient(dt) {
    this.ambientTimer -= dt;
    if (this.ambientTimer <= 0) {
      this.ambientTimer = 22 + this.rng() * 18;
      // A dropped wallet, a first-aid kit from a beach lifeguard stand, and —
      // rarely — something better, left near the player's orbit.
      const roll = this.rng();
      const angle = this.rng() * Math.PI * 2;
      const dist = 260 + this.rng() * 320;
      const x = clamp(this.player.x + Math.cos(angle) * dist, 60, WORLD_SIZE - 60);
      const y = clamp(this.player.y + Math.sin(angle) * dist, 60, WORLD_SIZE - 60);
      if (!isOnRoad(x, y) && this.rng() > 0.4) return;
      if (roll < 0.5) this.dropPickup(x, y, 'cash', 12 + Math.floor(this.rng() * 34));
      else if (roll < 0.78) this.dropPickup(x, y, 'health');
      else if (roll < 0.92) this.dropPickup(x, y, 'armor');
      else this.dropPickup(x, y, 'smg');
    }
    // Damage smoke for every hurting car, wrecks included.
    for (const car of [...this.cars, ...this.police.units]) {
      if (car.health < 55) {
        car.smokeAccumulator += dt;
        const rate = car.dead ? 0.06 : 0.16;
        if (car.smokeAccumulator > rate) {
          car.smokeAccumulator = 0;
          this.smokeAt(car.x, car.y);
          if (car.dead && this.rng() > 0.6) {
            this.particles.push({ x: car.x, y: car.y, vx: 0, vy: -18, life: 0.4, maxLife: 0.4, color: 'rgba(255,120,40,0.8)', size: 5, grows: true });
          }
        }
      }
    }
  }

  updateParticles(dt) {
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.96;
      p.vy *= 0.96;
      p.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const t of this.tracers) t.life -= dt;
    this.tracers = this.tracers.filter((t) => t.life > 0);
    for (const s of this.skids) {
      s.life -= dt;
      s.alpha = Math.max(0, (s.life / 16)) * 0.5;
    }
    this.skids = this.skids.filter((s) => s.life > 0);
  }

  updateCamera(dt) {
    const focus = this.player.inCar ?? this.player;
    const lead = focus.speed ? 0.38 : 0;
    const targetX = focus.x + Math.cos(focus.angle) * (focus.speed ?? 0) * lead;
    const targetY = focus.y + Math.sin(focus.angle) * (focus.speed ?? 0) * lead;
    const ease = 1 - Math.pow(0.0015, dt);
    this.camera.x += (targetX - this.camera.x) * ease;
    this.camera.y += (targetY - this.camera.y) * ease;
    if (this.shake > 0.2) {
      this.camera.x += (this.rng() - 0.5) * this.shake;
      this.camera.y += (this.rng() - 0.5) * this.shake;
      this.shake *= Math.pow(0.001, dt);
    } else {
      this.shake = 0;
    }
  }

  updateAudio() {
    if (this.player.inCar) {
      const car = this.player.inCar;
      this.sound.updateEngine(car.speed / car.spec.topSpeed);
    } else {
      this.sound.updateEngine(null);
    }
    const nearest = this.police.nearestDistance;
    this.sound.updateSiren(nearest === Infinity ? null : nearest, 0.016);
  }
}
