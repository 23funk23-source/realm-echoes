'use strict';

// ================= утилиты =================
const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };

// ================= канвас =================
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let W = 0, H = 0;
function resize() {
  W = canvas.width = canvas.clientWidth || innerWidth;
  H = canvas.height = canvas.clientHeight || innerHeight;
}
addEventListener('resize', resize);
if (window.visualViewport) visualViewport.addEventListener('resize', resize);
resize();

// ================= мир: кольца от периферии к центру =================
// масштаб realm'а RotMG: огромная карта, путь от кромки леса до арены — долгий
const WORLD = 12800;
const CX = WORLD / 2, CY = WORLD / 2;
const R_ARENA = 360;    // центральная арена Безумного Бога
const R_LORDS = 2800;   // пояс владык (5 элементальных секторов)
const R_TITANS = 4600;  // земли исполинов; дальше — лес до края карты

// сектор 0 центрирован на «юге» (там, где спавнится игрок)
const SECTORS = [
  { key: 'nature', name: 'Изумрудная роща',     lord: 'natureWarden', minions: ['treant'],                        color: '#6ec84a', floor: '#101c0e' },
  { key: 'fire',   name: 'Пепельные пустоши',   lord: 'flameLord',    minions: ['imp', 'salamander', 'magmaGolem'], color: '#ff6a2a', floor: '#1c0e08' },
  { key: 'storm',  name: 'Грозовые пики',       lord: 'stormLord',    minions: ['sparkling'],                     color: '#7ab8f0', floor: '#0c1220' },
  { key: 'moon',   name: 'Лунные руины',        lord: 'moonArchon',   minions: ['moonshade'],                     color: '#b48ae8', floor: '#150e20' },
  { key: 'ocean',  name: 'Затопленные берега',  lord: 'oceanKing',    minions: ['triton'],                        color: '#4ecdc4', floor: '#0a1a1c' },
];
const sectorIdxAt = (x, y) => {
  const ang = Math.atan2(y - CY, x - CX);
  const rel = (ang - Math.PI / 2 + TAU / 10 + TAU * 2) % TAU;
  return Math.floor(rel / (TAU / 5)) % 5;
};
const sectorCenterAng = i => Math.PI / 2 + i * TAU / 5;

function zoneAt(x, y) {
  const d = Math.hypot(x - CX, y - CY);
  if (d < R_ARENA) return { key: 'arena', name: 'Арена Безумного Бога' };
  if (d < R_LORDS) { const s = SECTORS[sectorIdxAt(x, y)]; return { key: s.key, name: s.name, sector: s }; }
  if (d < R_TITANS) return { key: 'titans', name: 'Земли Исполинов' };
  return { key: 'forest', name: 'Лес Эха' };
}

// ================= состояние =================
let state = 'menu'; // menu | play | pause | dead | win
let player = null;
let bullets = [], ebullets = [], enemies = [], drops = [], particles = [], decor = [];
let bosses = [], engagedBoss = null;
let lordsLeft = 5, finalT = 0, finalActive = false;
let cam = { x: 0, y: 0 };
let banner = null, shake = 0, lastZone = '';
let runTime = 0, killCount = 0, gameTime = 0;

// ================= ввод =================
const keys = {};
const mouse = { x: 0, y: 0, down: false };

addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'Space') { e.preventDefault(); useAbility(); }
  if (e.code === 'KeyM') Music.toggleMute();
  if (e.code === 'KeyP' && (state === 'play' || state === 'pause')) {
    state = state === 'play' ? 'pause' : 'play';
  }
});
addEventListener('keyup', e => keys[e.code] = false);
addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
canvas.addEventListener('mousedown', e => {
  if (e.button === 0) mouse.down = true;
  if (e.button === 2) useAbility();
});
addEventListener('mouseup', e => { if (e.button === 0) mouse.down = false; });
canvas.addEventListener('contextmenu', e => e.preventDefault());
addEventListener('blur', () => {
  mouse.down = false;
  for (const k in keys) keys[k] = false; // иначе клавиши «залипают» при Alt-Tab
});

// пауза при сворачивании вкладки; при возврате — реанимация аудио (iOS 'interrupted')
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (state === 'play') state = 'pause';
  } else if (state !== 'menu') {
    Music.ensure();
  }
});

// ================= сенсорное управление =================
// левая половина — виртуальный джойстик, правый нижний угол — кнопка умения,
// касание в остальной правой части — ручной прицел (как зажатая ЛКМ)
const IS_TOUCH = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const touchCtl = { moveId: null, aimId: null, stick: null };
const abilityBtn = () => ({ x: W - 74, y: H - 84, r: 46 });

canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  Music.ensure();
  if (state === 'pause') { state = 'play'; return; }
  if (state !== 'play') return;
  for (const t of e.changedTouches) {
    const x = t.clientX, y = t.clientY;
    const ab = abilityBtn();
    if (dist2(x, y, ab.x, ab.y) < (ab.r + 12) ** 2) { useAbility(); continue; }
    if (x < W * 0.45 && touchCtl.moveId === null) {
      touchCtl.moveId = t.identifier;
      touchCtl.stick = { x, y, dx: 0, dy: 0 };
    } else if (touchCtl.aimId === null) {
      touchCtl.aimId = t.identifier;
      mouse.x = x; mouse.y = y; mouse.down = true;
    }
  }
}, { passive: false });

canvas.addEventListener('touchmove', e => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier === touchCtl.moveId && touchCtl.stick) {
      const s = touchCtl.stick;
      s.dx = clamp(t.clientX - s.x, -60, 60);
      s.dy = clamp(t.clientY - s.y, -60, 60);
    } else if (t.identifier === touchCtl.aimId) {
      mouse.x = t.clientX; mouse.y = t.clientY;
    }
  }
}, { passive: false });

function touchEnd(e) {
  for (const t of e.changedTouches) {
    if (t.identifier === touchCtl.moveId) { touchCtl.moveId = null; touchCtl.stick = null; }
    if (t.identifier === touchCtl.aimId) { touchCtl.aimId = null; mouse.down = false; }
  }
}
canvas.addEventListener('touchend', touchEnd);
canvas.addEventListener('touchcancel', touchEnd);

// ================= рекорды (localStorage) =================
function loadRecords() {
  // localStorage общий для всего *.github.io-домена — значение может быть чем угодно
  try {
    const v = JSON.parse(localStorage.getItem('re-records') || '[]');
    return Array.isArray(v) ? v.filter(r => r && typeof r === 'object') : [];
  } catch { return []; }
}
function saveRun(win) {
  const all = loadRecords();
  all.push({ cls: player.cls.name, level: player.level, kills: killCount, time: Math.round(runTime), win });
  // победы выше поражений; победы — по времени, поражения — по уровню
  all.sort((a, b) => (b.win - a.win) || (a.win && b.win ? a.time - b.time : b.level - a.level));
  try { localStorage.setItem('re-records', JSON.stringify(all.slice(0, 5))); } catch { /* приватный режим */ }
  renderRecords();
}
function renderRecords() {
  const el = document.getElementById('records');
  const all = loadRecords();
  el.innerHTML = all.length
    ? '<h2>Лучшие забеги</h2>' + all.map(r =>
        `<div class="rec${r.win ? ' win' : ''}">${r.win ? '&#127942;' : '&#128128;'} ${r.cls} · ур. ${r.level} · убийств: ${r.kills} · ${fmtTime(r.time)}</div>`).join('')
    : '';
}
try { renderRecords(); } catch { /* рекорды не должны блокировать запуск игры */ }

// ================= классы =================
const CLASSES = {
  warrior: {
    key: 'warrior', name: 'Воин', color: '#d8503c',
    hp: 160, speed: 265, dmg: 24, fireRate: 2.6, projSpeed: 430, range: 195,
    projR: 7, shots: 1, spread: 0, pierce: 0,
    abilityCd: 5, abilityName: 'Рывок-удар',
  },
  archer: {
    key: 'archer', name: 'Лучник', color: '#6aa8e8',
    hp: 105, speed: 300, dmg: 17, fireRate: 3.4, projSpeed: 580, range: 430,
    projR: 5, shots: 1, spread: 0, pierce: 1,
    abilityCd: 6, abilityName: 'Веер стрел',
  },
  wizard: {
    key: 'wizard', name: 'Маг', color: '#a878e0',
    hp: 90, speed: 285, dmg: 12, fireRate: 5, projSpeed: 520, range: 350,
    projR: 5, shots: 2, spread: 0.14, pierce: 0,
    abilityCd: 7, abilityName: 'Нова',
  },
};

// ================= мобы (привязаны к зонам мира) =================
const KINDS = {
  // лес — окраина мира
  wolf:     { r: 13, hp: 34, speed: 165, dmg: 9,  xp: 8,  color: '#9aa2ac', behavior: 'chase', aggro: 480, drop: 0.12 },
  mushroom: { r: 13, hp: 30, speed: 55,  dmg: 8,  xp: 9,  color: '#c84a3c', behavior: 'shoot', shootCd: 2.1, bSpeed: 190, bDmg: 9, aggro: 480, drop: 0.12 },
  wisp:     { r: 11, hp: 22, speed: 190, dmg: 8,  xp: 8,  color: '#8be89c', behavior: 'chase', wobble: true, aggro: 480, drop: 0.12 },
  // земли исполинов — большие существа
  cyclops:  { r: 30, hp: 380, speed: 62,  dmg: 22, xp: 42, color: '#c8a878', behavior: 'ring',  shootCd: 3.2, bSpeed: 165, bDmg: 13, ringN: 10, aggro: 500, drop: 0.55 },
  hydra:    { r: 28, hp: 340, speed: 42,  dmg: 18, xp: 45, color: '#5aa848', behavior: 'shoot3', shootCd: 1.7, bSpeed: 235, bDmg: 13, aggro: 500, drop: 0.55 },
  phoenix:  { r: 16, hp: 240, speed: 205, dmg: 12, xp: 40, color: '#f08030', behavior: 'trail', wobble: true, shootCd: 0.38, bDmg: 10, aggro: 500, drop: 0.55, rebirth: true },
  // элементальные миньоны секторов владык
  sparkling:  { r: 12, hp: 46, speed: 120, dmg: 10, xp: 16, color: '#7ab8f0', behavior: 'shoot',  shootCd: 1.5, bSpeed: 320, bDmg: 12, aggro: 540, drop: 0.25 },
  triton:     { r: 14, hp: 52, speed: 100, dmg: 12, xp: 16, color: '#4ecdc4', behavior: 'shoot3', shootCd: 2.1, bSpeed: 215, bDmg: 12, aggro: 540, drop: 0.25 },
  treant:     { r: 17, hp: 70, speed: 42,  dmg: 15, xp: 18, color: '#5aa848', behavior: 'ring',   shootCd: 3,   bSpeed: 130, bDmg: 11, ringN: 8, aggro: 540, drop: 0.25 },
  moonshade:  { r: 13, hp: 44, speed: 130, dmg: 11, xp: 16, color: '#b48ae8', behavior: 'shoot',  wobble: true, shootCd: 1.7, bSpeed: 260, bDmg: 13, aggro: 540, drop: 0.25 },
  imp:        { r: 11, hp: 40, speed: 175, dmg: 10, xp: 14, color: '#ff8838', behavior: 'chase',  wobble: true, aggro: 540, drop: 0.25 },
  salamander: { r: 14, hp: 48, speed: 105, dmg: 11, xp: 16, color: '#e8543c', behavior: 'shoot',  shootCd: 1.6, bSpeed: 280, bDmg: 12, aggro: 540, drop: 0.25 },
  magmaGolem: { r: 20, hp: 84, speed: 48,  dmg: 16, xp: 20, color: '#c8742c', behavior: 'ring',   shootCd: 2.8, bSpeed: 115, bDmg: 11, ringN: 8, aggro: 540, drop: 0.25 },
};

function spawnEnemy(kindKey, x, y) {
  const k = KINDS[kindKey];
  enemies.push({
    kind: kindKey, k, x, y, r: k.r, hp: k.hp, maxHp: k.hp,
    home: { x, y },
    shootT: rand(0.5, k.shootCd || 1), strafeDir: Math.random() < 0.5 ? 1 : -1,
    seed: rand(0, TAU), touchT: 0, reborn: false,
  });
}

// ================= снаряды боссов =================
function ering(x, y, n, speed, dmg, color, offset = 0, br = 7) {
  for (let i = 0; i < n; i++) {
    const a = offset + (i / n) * TAU;
    ebullets.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, r: br, dmg, color, life: 9 });
  }
}
function efan(x, y, n, spread, speed, dmg, color, br = 7) {
  const base = Math.atan2(player.y - y, player.x - x);
  for (let i = 0; i < n; i++) {
    const a = base + (n === 1 ? 0 : -spread / 2 + (i / (n - 1)) * spread);
    ebullets.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, r: br, dmg, color, life: 9 });
  }
}

// ================= владыки (мини-боссы) и Безумный Бог =================
// точка назначения телепорта владыки не должна выходить за поводок —
// иначе вспышка/кольцо пуль появятся там, куда босс не материализуется
function leashClamp(b) {
  const dx = b.x - b.home.x, dy = b.y - b.home.y;
  const d = Math.hypot(dx, dy);
  if (d > 460) {
    b.x = b.home.x + dx / d * 460;
    b.y = b.home.y + dy / d * 460;
  }
}

const BOSSDEFS = {
  stormLord: {
    name: 'Громовой Владыка', sprite: 'lordStorm', hp: 1250, r: 44, color: '#7ab8f0', contact: 15, xp: 240,
    init(b) { b.tBlink = 4; b.tFan = 1.0; b.tRing = 3.5; },
    update(b, dt) {
      const rage = b.hp < b.maxHp * 0.4;
      b.tBlink -= dt;
      if (b.tBlink <= 0) {
        b.tBlink = rage ? 3 : 4.5;
        burst(b.x, b.y, 14, b.color);
        const a = rand(0, TAU), d = rand(140, 240);
        b.x = clamp(b.x + Math.cos(a) * d, 90, WORLD - 90);
        b.y = clamp(b.y + Math.sin(a) * d, 90, WORLD - 90);
        leashClamp(b);
        burst(b.x, b.y, 14, b.color);
        Music.sfx('teleport');
      }
      b.tFan -= dt;
      if (b.tFan <= 0) { b.tFan = rage ? 0.8 : 1.2; efan(b.x, b.y, 3, 0.22, 350, 13, '#a8d8ff', 6); }
      b.tRing -= dt;
      if (b.tRing <= 0) { b.tRing = 3.5; ering(b.x, b.y, rage ? 20 : 16, 175, 13, this.color, rand(0, TAU)); }
    },
  },
  oceanKing: {
    name: 'Морской Царь', sprite: 'lordOcean', hp: 1450, r: 46, color: '#4ecdc4', contact: 15, xp: 250, speed: 34,
    init(b) { b.ang = 0; b.tSpiral = 0; b.tWave = 3; },
    update(b, dt) {
      const a = Math.atan2(player.y - b.y, player.x - b.x);
      b.x += Math.cos(a) * this.speed * dt;
      b.y += Math.sin(a) * this.speed * dt;
      const rage = b.hp < b.maxHp * 0.5;
      b.ang += dt * 2.4;
      b.tSpiral -= dt;
      if (b.tSpiral <= 0) {
        b.tSpiral = 0.13;
        for (let i = 0; i < 2; i++) {
          const aa = b.ang + i * Math.PI;
          ebullets.push({ x: b.x, y: b.y, vx: Math.cos(aa) * 160, vy: Math.sin(aa) * 160, r: 7, dmg: 13, color: '#8ae4de', life: 9 });
        }
      }
      // волна прилива — широкое медленное кольцо
      b.tWave -= dt;
      if (b.tWave <= 0) {
        b.tWave = rage ? 2.6 : 3.5;
        ering(b.x, b.y, rage ? 26 : 22, 128, 13, this.color, rand(0, TAU), 9);
        shake = Math.max(shake, 4);
      }
    },
  },
  natureWarden: {
    name: 'Страж Рощи', sprite: 'lordNature', hp: 1550, r: 47, color: '#6ec84a', contact: 16, xp: 250, speed: 28,
    init(b) { b.ang = 0; b.tSpiral = 0; b.tVolley = 2.5; b.tSum = 7; },
    update(b, dt) {
      const a = Math.atan2(player.y - b.y, player.x - b.x);
      b.x += Math.cos(a) * this.speed * dt;
      b.y += Math.sin(a) * this.speed * dt;
      const rage = b.hp < b.maxHp * 0.5;
      b.ang += dt * 2.6;
      b.tSpiral -= dt;
      if (b.tSpiral <= 0) {
        b.tSpiral = rage ? 0.14 : 0.11;
        const arms = rage ? 3 : 2;
        for (let i = 0; i < arms; i++) {
          const aa = b.ang + (i / arms) * TAU;
          ebullets.push({ x: b.x, y: b.y, vx: Math.cos(aa) * 168, vy: Math.sin(aa) * 168, r: 7, dmg: 13, color: '#a8e070', life: 9 });
        }
      }
      b.tVolley -= dt;
      if (b.tVolley <= 0) { b.tVolley = 3.2; efan(b.x, b.y, 5, 0.5, 245, 13, '#d8f860'); }
      b.tSum -= dt;
      if (b.tSum <= 0) {
        b.tSum = 8;
        const near = enemies.filter(e => dist2(e.x, e.y, b.x, b.y) < 450 * 450).length;
        if (near < 3) spawnEnemy('treant', b.x + rand(-90, 90), b.y + rand(-90, 90));
      }
    },
  },
  moonArchon: {
    name: 'Лунный Архонт', sprite: 'lordMoon', hp: 1350, r: 42, color: '#b48ae8', contact: 15, xp: 250,
    init(b) { b.tTp = 3; b.tFan = 1.5; b.tSum = 6; },
    update(b, dt) {
      const rage = b.hp < b.maxHp * 0.35;
      b.tTp -= dt;
      if (b.tTp <= 0) {
        b.tTp = rage ? 3.2 : 4.5;
        burst(b.x, b.y, 18, b.color);
        const a = rand(0, TAU), d = rand(260, 380);
        b.x = clamp(player.x + Math.cos(a) * d, 90, WORLD - 90);
        b.y = clamp(player.y + Math.sin(a) * d, 90, WORLD - 90);
        leashClamp(b);
        burst(b.x, b.y, 18, b.color);
        Music.sfx('teleport');
        if (rage) ering(b.x, b.y, 14, 190, 14, '#d9a8ff');
      }
      b.tFan -= dt;
      if (b.tFan <= 0) { b.tFan = rage ? 0.95 : 1.5; efan(b.x, b.y, rage ? 7 : 5, 0.5, 265, 15, '#d9a8ff'); }
      b.tSum -= dt;
      if (b.tSum <= 0) {
        b.tSum = 9;
        const near = enemies.filter(e => dist2(e.x, e.y, b.x, b.y) < 450 * 450).length;
        if (near < 3) spawnEnemy('moonshade', b.x + rand(-90, 90), b.y + rand(-90, 90));
      }
    },
  },
  flameLord: {
    name: 'Повелитель Пламени', sprite: 'lordFire', hp: 1450, r: 46, color: '#ff6a2a', contact: 16, xp: 260, speed: 50,
    init(b) { b.ang = 0; b.tSpiral = 0; b.tWave = 3; b.tImp = 6; },
    update(b, dt) {
      const a = Math.atan2(player.y - b.y, player.x - b.x);
      b.x += Math.cos(a) * this.speed * dt;
      b.y += Math.sin(a) * this.speed * dt;
      const rage = b.hp < b.maxHp * 0.4;
      b.ang += dt * 3.4;
      b.tSpiral -= dt;
      if (b.tSpiral <= 0) {
        b.tSpiral = rage ? 0.08 : 0.11;
        const arms = rage ? 3 : 2;
        for (let i = 0; i < arms; i++) {
          const aa = b.ang + (i / arms) * TAU;
          ebullets.push({ x: b.x, y: b.y, vx: Math.cos(aa) * 200, vy: Math.sin(aa) * 200, r: 7, dmg: 13, color: '#ffb066', life: 9 });
        }
      }
      b.tWave -= dt;
      if (b.tWave <= 0) {
        b.tWave = rage ? 2.8 : 4;
        ering(b.x, b.y, rage ? 28 : 24, 125, 14, '#ffd060', rand(0, TAU), 9);
        shake = Math.max(shake, 5);
      }
      b.tImp -= dt;
      if (b.tImp <= 0) {
        b.tImp = 6;
        const near = enemies.filter(e => dist2(e.x, e.y, b.x, b.y) < 450 * 450).length;
        if (near < 4) {
          spawnEnemy('imp', b.x + rand(-80, 80), b.y + rand(-80, 80));
          spawnEnemy('imp', b.x + rand(-80, 80), b.y + rand(-80, 80));
        }
      }
    },
  },
  madGod: {
    name: 'Безумный Бог', sprite: 'madGod', hp: 3400, r: 54, color: '#e8c05a', contact: 22, xp: 500,
    init(b) { b.ang = 0; b.tSpiral = 0; b.tFan = 1.6; b.tRing = 3; b.tSum = 5; b.tTp = 4.5; },
    update(b, dt) {
      const ph = b.hp > b.maxHp * 0.66 ? 1 : b.hp > b.maxHp * 0.33 ? 2 : 3;
      const dC = Math.hypot(b.x - CX, b.y - CY);
      if (dC > R_ARENA * 0.45) {
        const aC = Math.atan2(CY - b.y, CX - b.x);
        b.x += Math.cos(aC) * 70 * dt;
        b.y += Math.sin(aC) * 70 * dt;
      } else {
        const a = Math.atan2(player.y - b.y, player.x - b.x);
        b.x += Math.cos(a) * 38 * dt;
        b.y += Math.sin(a) * 38 * dt;
      }
      b.ang += dt * 3.1;
      b.tSpiral -= dt;
      if (b.tSpiral <= 0) {
        b.tSpiral = 0.12;
        for (let i = 0; i < ph; i++) {
          const aa = b.ang + (i / ph) * TAU;
          ebullets.push({ x: b.x, y: b.y, vx: Math.cos(aa) * 190, vy: Math.sin(aa) * 190, r: 7, dmg: 14, color: '#e8c05a', life: 9 });
        }
      }
      b.tFan -= dt;
      if (b.tFan <= 0) { b.tFan = ph === 3 ? 1.0 : 1.7; efan(b.x, b.y, ph === 3 ? 7 : 5, 0.55, 285, 15, '#ff6858'); }
      if (ph >= 2) {
        b.tRing -= dt;
        if (b.tRing <= 0) {
          b.tRing = 3.2;
          ering(b.x, b.y, 20, 142, 14, '#e8c05a', rand(0, TAU), 8);
          shake = Math.max(shake, 5);
        }
        b.tSum -= dt;
        if (b.tSum <= 0) {
          b.tSum = 7;
          const near = enemies.filter(e => dist2(e.x, e.y, b.x, b.y) < 500 * 500).length;
          if (near < 4) {
            spawnEnemy('moonshade', b.x + rand(-90, 90), b.y + rand(-90, 90));
            spawnEnemy('imp', b.x + rand(-90, 90), b.y + rand(-90, 90));
          }
        }
      }
      if (ph === 3) {
        b.tTp -= dt;
        if (b.tTp <= 0) {
          b.tTp = 4;
          burst(b.x, b.y, 18, b.color);
          const ta = rand(0, TAU), td = rand(120, 200);
          b.x = CX + Math.cos(ta) * td;
          b.y = CY + Math.sin(ta) * td;
          burst(b.x, b.y, 18, b.color);
          Music.sfx('teleport');
          ering(b.x, b.y, 12, 195, 14, '#ff6858');
        }
      }
    },
  },
};

function spawnLord(i) {
  const s = SECTORS[i];
  const def = BOSSDEFS[s.lord];
  const ang = sectorCenterAng(i), rad = (R_ARENA + R_LORDS) / 2;
  const hx = CX + Math.cos(ang) * rad, hy = CY + Math.sin(ang) * rad;
  const b = {
    key: s.lord, def, name: def.name, sector: i,
    hp: def.hp, maxHp: def.hp, r: def.r, color: def.color,
    x: hx, y: hy, home: { x: hx, y: hy },
    touchT: 0,
  };
  def.init(b);
  bosses.push(b);
}

function spawnMadGod() {
  const def = BOSSDEFS.madGod;
  const b = {
    key: 'madGod', def, name: def.name,
    hp: def.hp, maxHp: def.hp, r: def.r, color: def.color,
    x: CX, y: CY - 80, touchT: 0,
  };
  def.init(b);
  bosses.push(b);
}

// ================= генерация мира =================
function posInRing(rMin, rMax) {
  let x, y, d, guard = 0;
  do {
    x = rand(60, WORLD - 60);
    y = rand(60, WORLD - 60);
    d = Math.hypot(x - CX, y - CY);
  } while ((d < rMin || d > rMax) && guard++ < 200);
  return { x, y };
}

function genWorld() {
  decor = []; enemies = []; bosses = [];
  // лес: деревья
  for (let i = 0; i < 850; i++) {
    const p = posInRing(R_TITANS + 40, WORLD);
    decor.push({ type: 'tree', x: p.x, y: p.y, s: rand(0.8, 1.6) });
  }
  // земли исполинов: валуны
  for (let i = 0; i < 240; i++) {
    const p = posInRing(R_LORDS + 40, R_TITANS - 40);
    decor.push({ type: 'rock', x: p.x, y: p.y, s: rand(0.7, 1.6) });
  }
  // декор секторов владык
  const secDecor = { nature: 'bush', fire: 'lava', storm: 'spark', moon: 'rune', ocean: 'pool' };
  SECTORS.forEach((s, i) => {
    for (let j = 0; j < 42; j++) {
      const ang = sectorCenterAng(i) + rand(-TAU / 10 * 0.85, TAU / 10 * 0.85);
      const rad = rand(R_ARENA + 70, R_LORDS - 60);
      decor.push({ type: secDecor[s.key], x: CX + Math.cos(ang) * rad, y: CY + Math.sin(ang) * rad, s: rand(0.8, 1.5) });
    }
  });
  // мобы леса (не вплотную к точке спавна игрока)
  const forestKinds = ['wolf', 'mushroom', 'wisp'];
  let placed = 0, guard = 0;
  while (placed < 170 && guard++ < 3000) {
    const p = posInRing(R_TITANS + 60, WORLD);
    if (dist2(p.x, p.y, player.x, player.y) < 520 * 520) continue;
    spawnEnemy(forestKinds[placed % 3], p.x, p.y);
    placed++;
  }
  // исполины (не вплотную к лесу, чтобы не аггрились на свежий спавн)
  const titanKinds = ['cyclops', 'hydra', 'phoenix'];
  for (let i = 0; i < 60; i++) {
    const p = posInRing(R_LORDS + 80, R_TITANS - 170);
    spawnEnemy(titanKinds[i % 3], p.x, p.y);
  }
  // миньоны секторов + владыки
  SECTORS.forEach((s, i) => {
    for (let j = 0; j < 18; j++) {
      const ang = sectorCenterAng(i) + rand(-TAU / 10 * 0.8, TAU / 10 * 0.8);
      const rad = rand(R_ARENA + 100, R_LORDS - 90);
      spawnEnemy(s.minions[j % s.minions.length], CX + Math.cos(ang) * rad, CY + Math.sin(ang) * rad);
    }
    spawnLord(i);
  });
}

// ================= игрок =================
function startRun(clsKey) {
  Music.ensure();
  const cls = CLASSES[clsKey];
  player = {
    cls, x: CX, y: WORLD - 170, r: 14,
    hp: cls.hp, maxHp: cls.hp, dmg: cls.dmg, speed: cls.speed,
    level: 1, xp: 0, xpNeed: 25,
    fireT: 0, abilityT: 0, inv: 0, aimDir: -Math.PI / 2, dexPots: 0,
  };
  bullets = []; ebullets = []; drops = []; particles = [];
  engagedBoss = null; lordsLeft = 5; finalT = 0; finalActive = false;
  runTime = 0; killCount = 0; shake = 0; lastZone = 'forest';
  genWorld();
  banner = { text: 'Лес Эха', sub: 'Пробивайтесь от окраин мира к центру — там ждёт Безумный Бог', t: 4 };
  document.getElementById('menu').classList.add('hidden');
  document.getElementById('gameover').classList.add('hidden');
  document.getElementById('victory').classList.add('hidden');
  state = 'play';
}
window.startRun = startRun;

function toMenu() {
  state = 'menu';
  Music.setBoss(false);
  document.getElementById('gameover').classList.add('hidden');
  document.getElementById('victory').classList.add('hidden');
  document.getElementById('menu').classList.remove('hidden');
}
window.toMenu = toMenu;

function gainXp(n) {
  player.xp += n;
  while (player.xp >= player.xpNeed) {
    player.xp -= player.xpNeed;
    player.level++;
    player.xpNeed = 25 + (player.level - 1) * 18;
    player.maxHp += 14;
    player.dmg *= 1.07;
    player.hp = Math.min(player.maxHp, player.hp + player.maxHp * 0.45);
    Music.sfx('levelup');
    if (!banner || banner.small) banner = { text: 'Уровень ' + player.level + '!', sub: '', t: 1.4, small: true };
    burst(player.x, player.y, 20, '#f4d47c');
  }
}

function hurtPlayer(dmg) {
  if (player.inv > 0 || state !== 'play') return;
  player.hp -= dmg;
  player.inv = 0.6;
  shake = Math.max(shake, 7);
  Music.sfx('hurt');
  burst(player.x, player.y, 8, '#e86a5e');
  if (player.hp <= 0) {
    player.hp = 0;
    state = 'dead';
    Music.setBoss(false);
    const where = engagedBoss
      ? 'в бою с «' + engagedBoss.name + '»'
      : 'в локации «' + zoneAt(player.x, player.y).name + '»';
    document.getElementById('deathStats').textContent =
      `${player.cls.name} пал ${where}\nУровень: ${player.level} · Убийств: ${killCount} · Время: ${fmtTime(runTime)}`;
    document.getElementById('gameover').classList.remove('hidden');
    saveRun(false);
  }
}

function win() {
  if (state !== 'play') return; // размен с боссом: смерть игрока в тот же кадр — победа не засчитывается
  state = 'win';
  Music.setBoss(false);
  document.getElementById('winStats').textContent =
    `${player.cls.name} · Уровень ${player.level} · Убийств: ${killCount} · Время: ${fmtTime(runTime)}`;
  document.getElementById('victory').classList.remove('hidden');
  saveRun(true);
}

function fmtTime(s) {
  const m = Math.floor(s / 60), ss = Math.floor(s % 60);
  return m + ':' + String(ss).padStart(2, '0');
}

// ================= умения =================
function useAbility() {
  if (state !== 'play' || !player || player.abilityT > 0) return;
  const cls = player.cls;
  player.abilityT = cls.abilityCd;
  // при ручном прицеле — по курсору/пальцу, иначе — по направлению автоатаки
  const aim = mouse.down ? aimAngle() : player.aimDir;
  Music.sfx('ability');

  if (cls.key === 'warrior') {
    player.x = clamp(player.x + Math.cos(aim) * 160, player.r, WORLD - player.r);
    player.y = clamp(player.y + Math.sin(aim) * 160, player.r, WORLD - player.r);
    player.inv = Math.max(player.inv, 0.4);
    burst(player.x, player.y, 26, cls.color);
    shake = Math.max(shake, 6);
    const dmg = player.dmg * 2.4, R = 130;
    for (const e of enemies) {
      if (dist2(e.x, e.y, player.x, player.y) < (R + e.r) ** 2) {
        e.hp -= dmg;
        const ka = Math.atan2(e.y - player.y, e.x - player.x);
        e.x = clamp(e.x + Math.cos(ka) * 80, e.r, WORLD - e.r);
        e.y = clamp(e.y + Math.sin(ka) * 80, e.r, WORLD - e.r);
      }
    }
    for (const b of bosses) {
      if (dist2(b.x, b.y, player.x, player.y) < (R + b.r) ** 2) b.hp -= dmg;
    }
  } else if (cls.key === 'archer') {
    for (let i = 0; i < 7; i++) {
      const a = aim - 0.25 + (i / 6) * 0.5;
      spawnBullet(a, cls.projSpeed * 1.1, player.dmg * 1.25, 6, 470, 3);
    }
  } else if (cls.key === 'wizard') {
    for (let i = 0; i < 22; i++) {
      spawnBullet((i / 22) * TAU, 380, player.dmg * 1.15, 6, 300, 0);
    }
  }
}

function aimAngle() {
  return Math.atan2(mouse.y + cam.y - player.y, mouse.x + cam.x - player.x);
}

function spawnBullet(ang, speed, dmg, r, range, pierce) {
  bullets.push({
    x: player.x, y: player.y,
    vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
    r, dmg, pierce, life: range / speed, color: player.cls.color,
    hit: new Set(), // пробивающая пуля не должна бить одну цель дважды
  });
}

// ================= частицы =================
function burst(x, y, n, color) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, TAU), s = rand(40, 220);
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.25, 0.6), maxLife: 0.6, color, r: rand(2, 5) });
  }
}

// ================= обновление =================
function update(dt) {
  runTime += dt;
  gameTime += dt;
  const cls = player.cls;

  // движение игрока: клавиатура или виртуальный джойстик
  let mx = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
  let my = (keys.KeyS || keys.ArrowDown ? 1 : 0) - (keys.KeyW || keys.ArrowUp ? 1 : 0);
  let mag = mx || my ? 1 : 0;
  if (touchCtl.stick) {
    const s = touchCtl.stick, l = Math.hypot(s.dx, s.dy);
    if (l > 8) { mx = s.dx / l; my = s.dy / l; mag = Math.min(1, l / 50); }
  }
  if (mag > 0 && (mx || my)) {
    const l = Math.hypot(mx, my);
    player.x = clamp(player.x + (mx / l) * mag * player.speed * dt, player.r, WORLD - player.r);
    player.y = clamp(player.y + (my / l) * mag * player.speed * dt, player.r, WORLD - player.r);
  }
  // барьер арены: снаружи — пока живы владыки, изнутри — во время финала
  {
    let dcx = player.x - CX, dcy = player.y - CY;
    if (dcx === 0 && dcy === 0) dcy = 1; // вырожденный случай точного центра
    const dc = Math.hypot(dcx, dcy);
    if (!finalActive && dc < R_ARENA + player.r) {
      const k = (R_ARENA + player.r) / dc;
      player.x = CX + dcx * k;
      player.y = CY + dcy * k;
    } else if (finalActive && dc > R_ARENA - player.r - 6) {
      const k = (R_ARENA - player.r - 6) / dc;
      player.x = CX + dcx * k;
      player.y = CY + dcy * k;
    }
  }
  player.inv = Math.max(0, player.inv - dt);
  player.abilityT = Math.max(0, player.abilityT - dt);
  player.fireT -= dt;
  player.hp = Math.min(player.maxHp, player.hp + 1.3 * dt);

  // стрельба: автоатака по ближайшей цели, зажатая ЛКМ — ручное прицеливание
  let fireAng = null;
  if (mouse.down) {
    fireAng = aimAngle();
  } else {
    // захват цели не дальше, чем реально долетает пуля (range + радиус пули)
    const R = cls.range + cls.projR;
    let best = Infinity, tx = 0, ty = 0, found = false;
    for (const e of enemies) {
      const d = dist2(e.x, e.y, player.x, player.y);
      if (d < best && d < (R + e.r) ** 2) { best = d; tx = e.x; ty = e.y; found = true; }
    }
    for (const b of bosses) {
      const d = dist2(b.x, b.y, player.x, player.y);
      if (d < best && d < (R + b.r) ** 2) { best = d; tx = b.x; ty = b.y; found = true; }
    }
    if (found) fireAng = Math.atan2(ty - player.y, tx - player.x);
  }
  if (fireAng !== null) {
    player.aimDir = fireAng;
    if (player.fireT <= 0) {
      // зелья ловкости: +15% скорости атаки за каждое
      player.fireT = 1 / (cls.fireRate * (1 + 0.15 * player.dexPots));
      for (let i = 0; i < cls.shots; i++) {
        const off = cls.shots === 1 ? 0 : -cls.spread / 2 + (i / (cls.shots - 1)) * cls.spread;
        spawnBullet(fireAng + off, cls.projSpeed, player.dmg, cls.projR, cls.range, cls.pierce);
      }
      Music.sfx('shoot');
    }
  }

  // камера
  cam.x = WORLD <= W ? (WORLD - W) / 2 : clamp(player.x - W / 2, 0, WORLD - W);
  cam.y = WORLD <= H ? (WORLD - H) / 2 : clamp(player.y - H / 2, 0, WORLD - H);
  shake = Math.max(0, shake - dt * 22);

  // враги: блуждание вне аггро-радиуса, атака внутри
  for (const e of enemies) {
    const k = e.k;
    const a = Math.atan2(player.y - e.y, player.x - e.x);
    const d = Math.sqrt(dist2(e.x, e.y, player.x, player.y));
    let vx = 0, vy = 0;

    if (d > k.aggro) {
      // мирно бродит недалеко от дома
      if (dist2(e.x, e.y, e.home.x, e.home.y) > 220 * 220) {
        const ha = Math.atan2(e.home.y - e.y, e.home.x - e.x);
        vx = Math.cos(ha) * k.speed * 0.3;
        vy = Math.sin(ha) * k.speed * 0.3;
      } else {
        const wa = e.seed + Math.sin(gameTime * 0.22 + e.seed * 3) * 2.2;
        vx = Math.cos(wa) * k.speed * 0.2;
        vy = Math.sin(wa) * k.speed * 0.2;
      }
    } else if (k.behavior === 'chase' || k.behavior === 'ring' || k.behavior === 'trail') {
      vx = Math.cos(a) * k.speed;
      vy = Math.sin(a) * k.speed;
      if (k.wobble) {
        const w = Math.sin(gameTime * 9 + e.seed) * 90;
        vx += Math.cos(a + Math.PI / 2) * w;
        vy += Math.sin(a + Math.PI / 2) * w;
      }
      if (k.behavior === 'ring') {
        e.shootT -= dt;
        if (e.shootT <= 0 && d < 620) {
          e.shootT = k.shootCd;
          ering(e.x, e.y, k.ringN || 8, k.bSpeed, k.bDmg, k.color, rand(0, TAU), 6);
        }
      } else if (k.behavior === 'trail') {
        // феникс оставляет за собой огненный след
        e.shootT -= dt;
        if (e.shootT <= 0) {
          e.shootT = k.shootCd;
          ebullets.push({ x: e.x, y: e.y, vx: rand(-14, 14), vy: rand(-14, 14), r: 6, dmg: k.bDmg, color: '#ffb066', life: 2.2 });
        }
      }
    } else {
      // стрелки держат дистанцию ~270
      if (d > 300) { vx = Math.cos(a) * k.speed; vy = Math.sin(a) * k.speed; }
      else if (d < 230) { vx = -Math.cos(a) * k.speed; vy = -Math.sin(a) * k.speed; }
      else { vx = Math.cos(a + Math.PI / 2) * k.speed * 0.6 * e.strafeDir; vy = Math.sin(a + Math.PI / 2) * k.speed * 0.6 * e.strafeDir; }
      e.shootT -= dt;
      if (e.shootT <= 0 && d < 540) {
        e.shootT = k.shootCd;
        if (k.behavior === 'shoot') {
          ebullets.push({ x: e.x, y: e.y, vx: Math.cos(a) * k.bSpeed, vy: Math.sin(a) * k.bSpeed, r: 6, dmg: k.bDmg, color: k.color, life: 6 });
        } else {
          for (let i = -1; i <= 1; i++) {
            const aa = a + i * 0.22;
            ebullets.push({ x: e.x, y: e.y, vx: Math.cos(aa) * k.bSpeed, vy: Math.sin(aa) * k.bSpeed, r: 6, dmg: k.bDmg, color: k.color, life: 6 });
          }
        }
      }
    }
    e.x = clamp(e.x + vx * dt, e.r, WORLD - e.r);
    e.y = clamp(e.y + vy * dt, e.r, WORLD - e.r);

    // до финала арена запечатана и для мобов
    if (!finalActive) {
      let ecx = e.x - CX, ecy = e.y - CY;
      if (ecx === 0 && ecy === 0) ecy = 1;
      const edc = Math.hypot(ecx, ecy);
      if (edc < R_ARENA + e.r) {
        const k2 = (R_ARENA + e.r) / edc;
        e.x = CX + ecx * k2;
        e.y = CY + ecy * k2;
      }
    }

    // контактный урон
    e.touchT = Math.max(0, e.touchT - dt);
    if (e.touchT <= 0 && dist2(e.x, e.y, player.x, player.y) < (e.r + player.r) ** 2) {
      e.touchT = 0.8;
      hurtPlayer(k.dmg);
    }
  }

  // расталкивание врагов — только рядом с игроком (вдали наложение незаметно,
  // а на большой карте пар слишком много для полного перебора)
  const sep = [];
  for (const e of enemies) {
    if (dist2(e.x, e.y, player.x, player.y) < 1400 * 1400) sep.push(e);
  }
  for (let i = 0; i < sep.length; i++) {
    for (let j = i + 1; j < sep.length; j++) {
      const a = sep[i], b = sep[j];
      const dd = dist2(a.x, a.y, b.x, b.y), min = a.r + b.r;
      if (dd > 0 && dd < min * min) {
        const d = Math.sqrt(dd), push = (min - d) / 2;
        const nx = (b.x - a.x) / d, ny = (b.y - a.y) / d;
        a.x -= nx * push; a.y -= ny * push;
        b.x += nx * push; b.y += ny * push;
      }
    }
  }

  // владыки и Безумный Бог — активны только рядом с игроком
  engagedBoss = null;
  let bestBossD = Infinity;
  for (const b of bosses) {
    const d2b = dist2(b.x, b.y, player.x, player.y);
    if (d2b < 780 * 780) {
      b.def.update(b, dt);
      // владыка привязан к своему сектору: не гонится за игроком дальше поводка
      // и не заходит в запечатанную арену
      if (b.key !== 'madGod') {
        const dhx = b.x - b.home.x, dhy = b.y - b.home.y;
        const dh = Math.hypot(dhx, dhy);
        if (dh > 460) {
          const k2 = 460 / dh;
          b.x = b.home.x + dhx * k2;
          b.y = b.home.y + dhy * k2;
        }
        let bcx = b.x - CX, bcy = b.y - CY;
        if (bcx === 0 && bcy === 0) bcy = 1;
        const bdc = Math.hypot(bcx, bcy);
        if (bdc < R_ARENA + b.r) {
          const k3 = (R_ARENA + b.r) / bdc;
          b.x = CX + bcx * k3;
          b.y = CY + bcy * k3;
        }
      }
      if (d2b < bestBossD) { bestBossD = d2b; engagedBoss = b; }
      b.touchT = Math.max(0, b.touchT - dt);
      if (b.touchT <= 0 && d2b < (b.r + player.r) ** 2) {
        b.touchT = 0.8;
        hurtPlayer(b.def.contact);
      }
    }
  }
  Music.setBoss(!!engagedBoss || finalActive);

  // пули игрока
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    let dead = b.life <= 0 || b.x < 0 || b.x > WORLD || b.y < 0 || b.y > WORLD;

    if (!dead) {
      for (let j = enemies.length - 1; j >= 0; j--) {
        const e = enemies[j];
        if (b.hit.has(e)) continue;
        if (dist2(b.x, b.y, e.x, e.y) < (b.r + e.r) ** 2) {
          b.hit.add(e);
          e.hp -= b.dmg;
          burst(b.x, b.y, 3, e.k.color);
          Music.sfx('hit');
          if (b.pierce > 0) b.pierce--; else { dead = true; }
          if (dead) break;
        }
      }
    }
    if (!dead) {
      for (const bb of bosses) {
        if (b.hit.has(bb)) continue;
        if (dist2(b.x, b.y, bb.x, bb.y) < (b.r + bb.r) ** 2) {
          b.hit.add(bb);
          bb.hp -= b.dmg;
          burst(b.x, b.y, 3, bb.color);
          Music.sfx('hit');
          if (b.pierce > 0) b.pierce--; else { dead = true; }
          if (dead) break;
        }
      }
    }
    if (dead) bullets.splice(i, 1);
  }

  // смерть врагов (феникс возрождается один раз)
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    if (e.hp > 0) continue;
    if (e.k.rebirth && !e.reborn) {
      e.reborn = true;
      e.hp = e.maxHp * 0.4;
      burst(e.x, e.y, 26, '#f8d048');
      Music.sfx('ability');
      continue;
    }
    killCount++;
    gainXp(e.k.xp);
    burst(e.x, e.y, 10, e.k.color);
    if (Math.random() < e.k.drop) drops.push({ x: e.x, y: e.y, type: 'hp' });
    enemies.splice(i, 1);
  }

  // смерть владык и Безумного Бога
  for (let i = bosses.length - 1; i >= 0; i--) {
    const b = bosses[i];
    if (b.hp > 0) continue;
    killCount++;
    gainXp(b.def.xp);
    burst(b.x, b.y, 60, b.color);
    burst(b.x, b.y, 40, '#f4d47c');
    shake = Math.max(shake, 14);
    Music.sfx('explode');
    if (b.key === 'madGod') {
      bosses.splice(i, 1);
      win();
      continue;
    }
    // владыка: зелье ловкости + лечение
    drops.push({ x: b.x, y: b.y, type: 'dex' });
    for (let j = 0; j < 2; j++) drops.push({ x: b.x + rand(-55, 55), y: b.y + rand(-55, 55), type: 'hp' });
    bosses.splice(i, 1);
    lordsLeft--;
    if (lordsLeft > 0) {
      banner = { text: b.name + ' повержен!', sub: 'Осталось владык: ' + lordsLeft + ' из 5', t: 3 };
    } else {
      finalT = 4;
      banner = { text: 'Все владыки пали!', sub: 'Безумный Бог призывает всех в свою цитадель…', t: 4 };
    }
  }

  // финальный призыв: всех переносит в центральную арену
  if (finalT > 0 && state === 'play') {
    finalT -= dt;
    if (finalT <= 0) {
      finalActive = true;
      player.x = CX;
      player.y = CY + R_ARENA - 90;
      bullets = []; ebullets = [];
      spawnMadGod();
      Music.sfx('teleport');
      burst(player.x, player.y, 24, '#f4d47c');
      banner = { text: 'Безумный Бог', sub: 'Финальная битва! Из арены нет выхода', t: 3 };
    }
  }

  // пули врагов
  for (let i = ebullets.length - 1; i >= 0; i--) {
    const b = ebullets[i];
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    let dead = b.life <= 0 || b.x < -40 || b.x > WORLD + 40 || b.y < -40 || b.y > WORLD + 40;
    if (!dead && dist2(b.x, b.y, player.x, player.y) < (b.r + player.r) ** 2) {
      hurtPlayer(b.dmg);
      dead = true;
    }
    if (dead) ebullets.splice(i, 1);
  }

  // зелья
  for (let i = drops.length - 1; i >= 0; i--) {
    const d = drops[i];
    if (dist2(d.x, d.y, player.x, player.y) < 26 * 26) {
      if (d.type === 'dex') {
        player.dexPots++;
        Music.sfx('levelup');
        // не затирать сюжетный баннер («Все владыки пали!» и т.п.)
        if (!banner || banner.small) banner = { text: 'Скорость атаки +15%!', sub: '', t: 1.5, small: true };
        burst(d.x, d.y, 12, '#f4d47c');
      } else {
        player.hp = Math.min(player.maxHp, player.hp + 30);
        Music.sfx('pickup');
        burst(d.x, d.y, 8, '#e86a5e');
      }
      drops.splice(i, 1);
    }
  }

  // частицы
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vx *= 0.92; p.vy *= 0.92;
    p.life -= dt;
    if (p.life <= 0) particles.splice(i, 1);
  }

  if (banner) { banner.t -= dt; if (banner.t <= 0) banner = null; }

  // смена зоны — подпись локации
  const z = zoneAt(player.x, player.y);
  if (z.key !== lastZone) {
    lastZone = z.key;
    if (!banner || banner.small) banner = { text: z.name, sub: '', t: 1.8, small: true };
  }

  // атмосферные частицы зон
  if (z.key === 'fire' && Math.random() < dt * 12) {
    particles.push({
      x: clamp(cam.x + rand(0, W), 0, WORLD), y: clamp(cam.y + rand(0, H), 0, WORLD),
      vx: rand(-12, 12), vy: rand(-65, -30),
      life: rand(0.6, 1.2), maxLife: 1.2,
      color: Math.random() < 0.5 ? '#ff9838' : '#ffc060', r: rand(1.5, 3),
    });
  } else if (z.key === 'storm' && Math.random() < dt * 8) {
    particles.push({
      x: clamp(cam.x + rand(0, W), 0, WORLD), y: clamp(cam.y + rand(0, H), 0, WORLD),
      vx: rand(-30, 30), vy: rand(-40, 40),
      life: rand(0.2, 0.5), maxLife: 0.5,
      color: '#a8d8ff', r: rand(1.5, 2.5),
    });
  }
}

// ================= отрисовка =================
function draw() {
  ctx.fillStyle = '#0c1014';
  ctx.fillRect(0, 0, W, H);

  const sx = shake > 0 ? rand(-shake, shake) : 0;
  const sy = shake > 0 ? rand(-shake, shake) : 0;

  ctx.save();
  ctx.translate(-cam.x + sx, -cam.y + sy);

  // ----- ландшафт: кольца мира -----
  // лес — базовый пол до края карты
  ctx.fillStyle = '#0e1510';
  ctx.fillRect(0, 0, WORLD, WORLD);
  // земли исполинов
  ctx.fillStyle = '#191512';
  ctx.beginPath(); ctx.arc(CX, CY, R_TITANS, 0, TAU); ctx.fill();
  // сектора владык
  SECTORS.forEach((s, i) => {
    const a0 = Math.PI / 2 - TAU / 10 + i * TAU / 5;
    const a1 = a0 + TAU / 5;
    ctx.fillStyle = s.floor;
    ctx.beginPath();
    ctx.arc(CX, CY, R_LORDS, a0, a1);
    ctx.arc(CX, CY, R_ARENA, a1, a0, true);
    ctx.closePath();
    ctx.fill();
  });
  // арена
  ctx.fillStyle = '#120c16';
  ctx.beginPath(); ctx.arc(CX, CY, R_ARENA, 0, TAU); ctx.fill();
  // границы колец
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 3;
  for (const r of [R_TITANS, R_LORDS]) {
    ctx.beginPath(); ctx.arc(CX, CY, r, 0, TAU); ctx.stroke();
  }
  // стена арены
  ctx.strokeStyle = finalActive ? '#e8c05a' : 'rgba(232,192,90,0.45)';
  ctx.lineWidth = 9;
  ctx.beginPath(); ctx.arc(CX, CY, R_ARENA, 0, TAU); ctx.stroke();
  // сетка
  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 1;
  const gs = 100;
  const gx0 = Math.max(0, Math.floor(cam.x / gs) * gs), gx1 = Math.min(WORLD, cam.x + W);
  const gy0 = Math.max(0, Math.floor(cam.y / gs) * gs), gy1 = Math.min(WORLD, cam.y + H);
  ctx.beginPath();
  for (let x = gx0; x <= gx1; x += gs) { ctx.moveTo(x, Math.max(0, cam.y)); ctx.lineTo(x, gy1); }
  for (let y = gy0; y <= gy1; y += gs) { ctx.moveTo(Math.max(0, cam.x), y); ctx.lineTo(gx1, y); }
  ctx.stroke();
  // стены мира
  ctx.strokeStyle = '#33465c';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, WORLD - 6, WORLD - 6);

  // декорации (только видимые)
  for (const d of decor) {
    if (d.x < cam.x - 90 || d.x > cam.x + W + 90 || d.y < cam.y - 90 || d.y > cam.y + H + 90) continue;
    drawDecor(d);
  }

  if (player) {
    // зелья
    for (const d of drops) {
      if (d.type === 'dex') {
        ctx.fillStyle = '#e8b23c';
        ctx.beginPath(); ctx.arc(d.x, d.y, 9, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(d.x + 2, d.y - 5);
        ctx.lineTo(d.x - 2, d.y + 1);
        ctx.lineTo(d.x + 1, d.y + 1);
        ctx.lineTo(d.x - 2, d.y + 5);
        ctx.stroke();
      } else {
        ctx.fillStyle = '#c94b41';
        ctx.beginPath(); ctx.arc(d.x, d.y, 9, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(d.x - 4, d.y); ctx.lineTo(d.x + 4, d.y);
        ctx.moveTo(d.x, d.y - 4); ctx.lineTo(d.x, d.y + 4);
        ctx.stroke();
      }
    }

    // враги (только видимые)
    for (const e of enemies) {
      if (e.x < cam.x - 80 || e.x > cam.x + W + 80 || e.y < cam.y - 80 || e.y > cam.y + H + 80) continue;
      drawMob(e);
    }

    // владыки и Безумный Бог
    for (const b of bosses) {
      if (b.x < cam.x - 160 || b.x > cam.x + W + 160 || b.y < cam.y - 160 || b.y > cam.y + H + 160) continue;
      drawBoss(b);
    }

    // игрок
    const inv = player.inv > 0 && Math.floor(gameTime * 14) % 2 === 0;
    ctx.globalAlpha = inv ? 0.4 : 1;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(player.x, player.y + 16, 15, 6, 0, 0, TAU); ctx.fill();
    const bob = Math.sin(gameTime * 6) * 2;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sprites[player.cls.key], Math.round(player.x - 22), Math.round(player.y - 30 + bob), 44, 44);
    ctx.imageSmoothingEnabled = true;
    // указатель прицела (направление автоатаки или мыши)
    const aim = player.aimDir !== undefined ? player.aimDir : aimAngle();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(player.x + Math.cos(aim) * (player.r + 3), player.y + Math.sin(aim) * (player.r + 3));
    ctx.lineTo(player.x + Math.cos(aim) * (player.r + 12), player.y + Math.sin(aim) * (player.r + 12));
    ctx.stroke();
    ctx.globalAlpha = 1;

    // пули игрока
    for (const b of bullets) {
      ctx.fillStyle = b.color;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 0.45, 0, TAU); ctx.fill();
    }
    // пули врагов
    for (const b of ebullets) {
      ctx.fillStyle = b.color;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // частицы
    for (const p of particles) {
      ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  ctx.restore();

  // виньетка
  const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.42, W / 2, H / 2, Math.max(W, H) * 0.72);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);

  if (player && state !== 'menu') drawUI();
}

function drawDecor(d) {
  const s = d.s;
  switch (d.type) {
    case 'tree': {
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath(); ctx.ellipse(d.x, d.y + 14 * s, 16 * s, 5 * s, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#3a2c1c';
      ctx.fillRect(d.x - 3 * s, d.y + 2 * s, 6 * s, 12 * s);
      ctx.fillStyle = '#1c3a20';
      ctx.beginPath();
      ctx.moveTo(d.x - 16 * s, d.y + 6 * s); ctx.lineTo(d.x, d.y - 30 * s); ctx.lineTo(d.x + 16 * s, d.y + 6 * s);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#2a5230';
      ctx.beginPath();
      ctx.moveTo(d.x - 11 * s, d.y - 6 * s); ctx.lineTo(d.x, d.y - 34 * s); ctx.lineTo(d.x + 11 * s, d.y - 6 * s);
      ctx.closePath(); ctx.fill();
      break;
    }
    case 'rock': {
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath(); ctx.ellipse(d.x, d.y + 8 * s, 15 * s, 5 * s, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#4a463e';
      ctx.beginPath(); ctx.arc(d.x, d.y, 13 * s, 0, TAU); ctx.fill();
      ctx.fillStyle = '#5c584e';
      ctx.beginPath(); ctx.arc(d.x - 3 * s, d.y - 4 * s, 7 * s, 0, TAU); ctx.fill();
      break;
    }
    case 'bush': {
      ctx.fillStyle = '#2a5230';
      ctx.beginPath(); ctx.arc(d.x - 6 * s, d.y, 9 * s, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(d.x + 5 * s, d.y - 2 * s, 8 * s, 0, TAU); ctx.fill();
      ctx.fillStyle = '#3a7040';
      ctx.beginPath(); ctx.arc(d.x, d.y - 4 * s, 7 * s, 0, TAU); ctx.fill();
      break;
    }
    case 'lava': {
      const lg = ctx.createRadialGradient(d.x, d.y, 2, d.x, d.y, 34 * s);
      lg.addColorStop(0, 'rgba(255,140,50,0.55)');
      lg.addColorStop(0.65, 'rgba(200,60,20,0.3)');
      lg.addColorStop(1, 'rgba(200,60,20,0)');
      ctx.fillStyle = lg;
      ctx.beginPath(); ctx.arc(d.x, d.y, 34 * s, 0, TAU); ctx.fill();
      break;
    }
    case 'pool': {
      ctx.fillStyle = 'rgba(78,205,196,0.18)';
      ctx.beginPath(); ctx.ellipse(d.x, d.y, 26 * s, 15 * s, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(78,205,196,0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(d.x, d.y, 18 * s, 9 * s, 0, 0, TAU); ctx.stroke();
      break;
    }
    case 'rune': {
      ctx.strokeStyle = 'rgba(180,138,232,0.55)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(d.x, d.y - 12 * s); ctx.lineTo(d.x + 9 * s, d.y);
      ctx.lineTo(d.x, d.y + 12 * s); ctx.lineTo(d.x - 9 * s, d.y);
      ctx.closePath(); ctx.stroke();
      break;
    }
    case 'spark': {
      ctx.strokeStyle = 'rgba(122,184,240,0.5)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(d.x - 5 * s, d.y - 12 * s);
      ctx.lineTo(d.x + 3 * s, d.y - 2 * s);
      ctx.lineTo(d.x - 3 * s, d.y + 2 * s);
      ctx.lineTo(d.x + 5 * s, d.y + 12 * s);
      ctx.stroke();
      break;
    }
  }
}

function drawMob(e) {
  const spr = sprites[e.kind];
  const size = Math.max(30, e.r * 2.9);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(e.x, e.y + e.r * 0.85, e.r * 0.95, e.r * 0.35, 0, 0, TAU); ctx.fill();
  const bob = Math.sin(gameTime * 5 + e.seed) * 1.5;
  ctx.imageSmoothingEnabled = false;
  if (SPRITES[e.kind].flip && player.x < e.x) {
    ctx.save();
    ctx.translate(e.x, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(spr, Math.round(-size / 2), Math.round(e.y - size * 0.62 + bob), size, size);
    ctx.restore();
  } else {
    ctx.drawImage(spr, Math.round(e.x - size / 2), Math.round(e.y - size * 0.62 + bob), size, size);
  }
  ctx.imageSmoothingEnabled = true;
  if (e.hp < e.maxHp) {
    const w = e.r * 2;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(e.x - w / 2, e.y - e.r - 14, w, 5);
    ctx.fillStyle = '#e86a5e';
    ctx.fillRect(e.x - w / 2, e.y - e.r - 14, w * clamp(e.hp / e.maxHp, 0, 1), 5);
  }
}

function drawBoss(b) {
  const pulse = 1 + Math.sin(gameTime * 4) * 0.03;
  const size = b.r * 2.6 * pulse;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.ellipse(b.x, b.y + b.r * 0.8, b.r, b.r * 0.35, 0, 0, TAU); ctx.fill();
  // аура из вращающихся огней цвета стихии
  ctx.fillStyle = b.color;
  ctx.globalAlpha = 0.55;
  for (let i = 0; i < 5; i++) {
    const a = gameTime * 2.2 + (i / 5) * TAU;
    ctx.beginPath();
    ctx.arc(b.x + Math.cos(a) * (b.r + 16), b.y + Math.sin(a) * (b.r + 16), 5, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sprites[b.def.sprite], Math.round(b.x - size / 2), Math.round(b.y - size * 0.6), Math.round(size), Math.round(size));
  ctx.imageSmoothingEnabled = true;
}

function bar(x, y, w, h, frac, fg, bg) {
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = fg;
  ctx.fillRect(x, y, w * clamp(frac, 0, 1), h);
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

function drawMinimap() {
  const S = Math.min(128, Math.round(W * 0.3)), mx = W - 18 - S, my = 92;
  const sc = S / WORLD;
  ctx.globalAlpha = 0.88;
  ctx.fillStyle = '#0a0f0a';
  ctx.fillRect(mx, my, S, S);
  const ccx = mx + CX * sc, ccy = my + CY * sc;
  // земли исполинов
  ctx.fillStyle = '#2a231d';
  ctx.beginPath(); ctx.arc(ccx, ccy, R_TITANS * sc, 0, TAU); ctx.fill();
  // сектора владык
  SECTORS.forEach((s, i) => {
    const a0 = Math.PI / 2 - TAU / 10 + i * TAU / 5;
    const a1 = a0 + TAU / 5;
    ctx.fillStyle = s.color;
    ctx.globalAlpha = 0.3;
    ctx.beginPath();
    ctx.moveTo(ccx, ccy);
    ctx.arc(ccx, ccy, R_LORDS * sc, a0, a1);
    ctx.closePath();
    ctx.fill();
  });
  ctx.globalAlpha = 0.88;
  // арена
  ctx.fillStyle = finalActive ? '#e8c05a' : '#1a1220';
  ctx.beginPath(); ctx.arc(ccx, ccy, Math.max(4, R_ARENA * sc), 0, TAU); ctx.fill();
  // живые владыки
  for (const b of bosses) {
    if (b.key === 'madGod') continue;
    ctx.fillStyle = b.color;
    ctx.fillRect(mx + b.x * sc - 2.5, my + b.y * sc - 2.5, 5, 5);
  }
  // игрок
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(mx + player.x * sc, my + player.y * sc, 3, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 1;
  ctx.strokeRect(mx + 0.5, my + 0.5, S - 1, S - 1);
  ctx.globalAlpha = 1;
}

function drawUI() {
  ctx.textBaseline = 'middle';
  const bw = Math.min(230, W * 0.42); // на узких экранах бары короче, чтобы не наезжать на правый блок

  // HP / XP
  bar(18, 18, bw, 20, player.hp / player.maxHp, '#c94b41', 'rgba(0,0,0,0.55)');
  ctx.fillStyle = '#fff';
  ctx.font = '12px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText(Math.ceil(player.hp) + ' / ' + Math.ceil(player.maxHp), 18 + bw / 2, 28);
  bar(18, 42, bw, 10, player.xp / player.xpNeed, '#f4d47c', 'rgba(0,0,0,0.55)');
  ctx.textAlign = 'left';
  ctx.fillStyle = '#cdd8e4';
  ctx.font = '13px system-ui';
  ctx.fillText(player.cls.name + ' · ур. ' + player.level + (player.dexPots ? ' · скор. атаки +' + player.dexPots * 15 + '%' : ''), 18, 66);

  // умение
  const cd = player.abilityT;
  bar(18, 80, bw, 12, 1 - cd / player.cls.abilityCd, cd > 0 ? '#5a8fd8' : '#7ac74f', 'rgba(0,0,0,0.55)');
  ctx.fillStyle = '#9fb0c3';
  ctx.font = '11px system-ui';
  ctx.fillText(player.cls.abilityName + (cd > 0 ? ' · ' + cd.toFixed(1) + 'с' : ' — готово [Space]'), 18, 102);

  // правый блок: владыки, зона, звук, время + миникарта
  ctx.textAlign = 'right';
  ctx.fillStyle = '#f4d47c';
  ctx.font = 'bold 13px system-ui';
  ctx.fillText(finalActive ? 'Финальная битва!' : 'Владык осталось: ' + lordsLeft + ' / 5', W - 18, 24);
  ctx.fillStyle = '#9fb0c3';
  ctx.font = '12px system-ui';
  ctx.fillText(zoneAt(player.x, player.y).name, W - 18, 44);
  ctx.fillStyle = '#66788e';
  ctx.font = '11px system-ui';
  ctx.fillText('M · звук: ' + (Music.isMuted() ? 'выкл' : 'вкл') + ' · ' + fmtTime(runTime), W - 18, 64);
  drawMinimap();

  // HP ближайшего босса (на узких экранах — ниже минимапы, чтобы не наезжать на бары)
  if (engagedBoss) {
    const bw2 = Math.min(430, W * 0.5);
    const narrow = W < 560;
    const mmS = Math.min(128, Math.round(W * 0.3));
    const nameY = narrow ? 92 + mmS + 26 : 26;
    const barY = narrow ? nameY + 14 : 38;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f0d9ff';
    ctx.font = (narrow ? 'bold 13px' : 'bold 15px') + ' system-ui';
    ctx.fillText(engagedBoss.name, W / 2, nameY);
    bar(W / 2 - bw2 / 2, barY, bw2, 14, engagedBoss.hp / engagedBoss.maxHp, engagedBoss.color, 'rgba(0,0,0,0.6)');
  }

  // баннер (размер шрифта подстраивается под узкие экраны)
  if (banner) {
    const a = clamp(banner.t / 0.5, 0, 1);
    ctx.globalAlpha = a;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f4d47c';
    const bigFs = Math.min(banner.small ? 26 : 40, W / 11);
    ctx.font = 'bold ' + bigFs + 'px system-ui';
    ctx.fillText(banner.text, W / 2, H * 0.32);
    if (banner.sub) {
      ctx.fillStyle = '#9fb0c3';
      ctx.font = Math.min(16, W / 26) + 'px system-ui';
      ctx.fillText(banner.sub, W / 2, H * 0.32 + bigFs * 0.9);
    }
    ctx.globalAlpha = 1;
  }

  // сенсорный интерфейс
  if (IS_TOUCH && state === 'play') {
    const ab = abilityBtn();
    const ready = player.abilityT <= 0;
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = ready ? 'rgba(122,199,79,0.35)' : 'rgba(30,40,52,0.6)';
    ctx.beginPath(); ctx.arc(ab.x, ab.y, ab.r, 0, TAU); ctx.fill();
    ctx.strokeStyle = ready ? '#7ac74f' : '#5a6a7e';
    ctx.lineWidth = 3;
    if (!ready) {
      ctx.beginPath();
      ctx.arc(ab.x, ab.y, ab.r, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - player.abilityT / player.cls.abilityCd));
      ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(ab.x, ab.y, ab.r, 0, TAU); ctx.stroke();
    }
    ctx.fillStyle = '#dfe6ee';
    ctx.font = 'bold 13px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(ready ? 'УМЕНИЕ' : player.abilityT.toFixed(1), ab.x, ab.y);
    if (touchCtl.stick) {
      const s = touchCtl.stick;
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(s.x, s.y, 52, 0, TAU); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.beginPath(); ctx.arc(s.x + s.dx, s.y + s.dy, 22, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  if (state === 'pause') {
    ctx.fillStyle = 'rgba(8,11,15,0.6)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#dfe6ee';
    ctx.font = 'bold 34px system-ui';
    ctx.fillText('Пауза', W / 2, H / 2 - 10);
    ctx.font = '15px system-ui';
    ctx.fillStyle = '#9fb0c3';
    ctx.fillText(IS_TOUCH ? 'Коснитесь экрана, чтобы продолжить' : 'P — продолжить', W / 2, H / 2 + 26);
  }

  ctx.textAlign = 'left';
}

// ================= цикл =================
let last = performance.now();
function frame(t) {
  if (W === 0 || H === 0) resize(); // если первый layout пришёл позже загрузки скрипта
  const dt = Math.min(0.033, (t - last) / 1000);
  last = t;
  if (state === 'play') update(dt);
  draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
