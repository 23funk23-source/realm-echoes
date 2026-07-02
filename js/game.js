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

const WORLD = 1800;

// ================= состояние =================
let state = 'menu'; // menu | play | pause | dead | win
let player = null;
let bullets = [], ebullets = [], enemies = [], drops = [], particles = [];
let boss = null;
let cam = { x: 0, y: 0 };
let portal = null, dungeonReturn = null, lavaPools = [];
let stageIdx = 0, nextT = 0, banner = null, shake = 0;
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

// ================= пиксельные спрайты классов =================
// 16x16, '.' — прозрачный пиксель; палитры по референсам:
// Воин — красно-чёрный с золотом, Лучник — сине-серебряный с крылатым шлемом,
// Маг — фиолетово-белый с золотом.
const SPRITES = {
  warrior: {
    pal: { R: '#c03028', r: '#e05848', D: '#701f18', G: '#d8a030', g: '#f4d060', K: '#241a18', O: '#ff9838' },
    grid: [
      '......gGGg.....O',
      '..g..gRRRRg....O',
      '.gRg.GRRRRG.gRgO',
      '.gRggGRRRRGggRgG',
      '..RgGRKKKKRGgR.G',
      '...gGKOOOOKGg..G',
      '....GRKKKKRG...G',
      '..RRGGGGGGGGRR.G',
      '.RRgKKRRRRKKgRRG',
      '.RRgKRGGGGRKgRRG',
      '.RR.KRGDDGRK.RRG',
      '.RR.KRRDDRRK.RRG',
      '..R.KKR..RKK.R.G',
      '...GKK....KKG...',
      '...GGg....gGG...',
      '................',
    ],
  },
  archer: {
    pal: { B: '#4a72c4', b: '#7aa2e8', N: '#2c4a86', S: '#d8dce4', s: '#f6f8fc', G: '#d8a840', g: '#f4d878', K: '#28303c', F: '#e8c498' },
    grid: [
      '......SSSS....g.',
      '..s..SbbbbS..gGg',
      '.ss.SbbbbbbS..G.',
      '.sSSbbSSSSbbSSG.',
      '..SSbFFFFFFbSSG.',
      '...SbFKFFKFbS.G.',
      '....BFFFFFFB..G.',
      '..BBBBBBBBBBB.G.',
      '.BBbBBNBBNBBb.G.',
      '.BBbBNBBBBNBb.G.',
      '.BB.BGGggGGB..G.',
      '..B.BBBNNBBB..G.',
      '....BBB..BBB..G.',
      '...GGB....BGG...',
      '...GGs....sGG...',
      '................',
    ],
  },
  wizard: {
    pal: { P: '#7a4ab0', p: '#a878e0', L: '#d0b8f0', W: '#ece8f4', G: '#d8a840', g: '#f4d878', K: '#241c30', E: '#c060ff' },
    grid: [
      '..g....gg....g..',
      '.gWg..WWWW..gWg.',
      '.gWWWWWWWWWWWg..',
      '..WWWWWWWWWWW.gg',
      '...WPKPPPPKPW.gg',
      '...WPEPPPPEPW.G.',
      '....PKKKKKKP..G.',
      '..WPPPPPPPPPW.G.',
      '.WWpPGPPPPGPpWG.',
      '.WWpPPGGGGPPpWG.',
      '.WW.PGPLLPGP.WG.',
      '..W.PPGLLGPP.WG.',
      '....PPP..PPP..G.',
      '...GPP....PPG...',
      '...GGL....LGG...',
      '................',
    ],
  },
};

function makeSprite(def) {
  const c = document.createElement('canvas');
  c.width = 16; c.height = 16;
  const g = c.getContext('2d');
  def.grid.forEach((row, y) => {
    for (let x = 0; x < Math.min(row.length, 16); x++) {
      const col = def.pal[row[x]];
      if (!col) continue;
      g.fillStyle = col;
      g.fillRect(x, y, 1, 1);
    }
  });
  return c;
}
const sprites = {};
for (const k in SPRITES) sprites[k] = makeSprite(SPRITES[k]);

// превью спрайтов в карточках меню
document.querySelectorAll('.card-sprite').forEach(c => {
  const s = sprites[c.dataset.cls];
  if (!s) return;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(s, 0, 0, c.width, c.height);
});

// ================= враги =================
const KINDS = {
  slime:    { r: 16, hp: 32, speed: 72,  dmg: 10, xp: 8,  color: '#8bc34a', behavior: 'chase' },
  bat:      { r: 11, hp: 18, speed: 155, dmg: 8,  xp: 6,  color: '#a06adf', behavior: 'chase', wobble: true },
  cultist:  { r: 14, hp: 28, speed: 95,  dmg: 10, xp: 10, color: '#d85c5c', behavior: 'shoot',  shootCd: 1.9, bSpeed: 235, bDmg: 11 },
  skeleton: { r: 15, hp: 38, speed: 80,  dmg: 12, xp: 12, color: '#cfd2d8', behavior: 'shoot3', shootCd: 2.3, bSpeed: 205, bDmg: 9 },
  // обитатели огненного данжа
  imp:        { r: 11, hp: 26, speed: 175, dmg: 9,  xp: 12, color: '#ff8838', behavior: 'chase', wobble: true },
  salamander: { r: 14, hp: 34, speed: 105, dmg: 11, xp: 14, color: '#e8543c', behavior: 'shoot',  shootCd: 1.6, bSpeed: 280, bDmg: 12 },
  magmaGolem: { r: 20, hp: 64, speed: 48,  dmg: 16, xp: 18, color: '#c8742c', behavior: 'ring',   shootCd: 2.8, bSpeed: 115, bDmg: 11 },
};

function spawnEnemy(kindKey, x, y) {
  const k = KINDS[kindKey];
  enemies.push({
    kind: kindKey, k, x, y, r: k.r, hp: k.hp, maxHp: k.hp,
    shootT: rand(0.5, k.shootCd || 1), strafeDir: Math.random() < 0.5 ? 1 : -1,
    seed: rand(0, TAU), touchT: 0,
  });
}

function spawnWaveEnemy(kindKey) {
  let x, y, tries = 0;
  do {
    x = rand(80, WORLD - 80);
    y = rand(80, WORLD - 80);
    tries++;
  } while (dist2(x, y, player.x, player.y) < 450 * 450 && tries < 40);
  spawnEnemy(kindKey, x, y);
}

// ================= боссы =================
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

const BOSSDEFS = {
  slimeKing: {
    name: 'Король Слизней', hp: 900, r: 52, color: '#7ec850', speed: 46,
    contact: 16, xp: 150, bColor: '#b6e388',
    init(b) { b.tRing = 1.6; b.tSpawn = 4; b.ringOff = 0; },
    update(b, dt) {
      // медленно ползёт к игроку
      const a = Math.atan2(player.y - b.y, player.x - b.x);
      b.x += Math.cos(a) * b.speed * dt;
      b.y += Math.sin(a) * b.speed * dt;
      const enraged = b.hp < b.maxHp * 0.5;
      b.tRing -= dt;
      if (b.tRing <= 0) {
        b.tRing = enraged ? 1.7 : 2.4;
        b.ringOff += 0.35;
        ering(b.x, b.y, enraged ? 22 : 18, 150, 12, this.bColor, b.ringOff);
        shake = Math.max(shake, 4);
      }
      b.tSpawn -= dt;
      if (b.tSpawn <= 0) {
        b.tSpawn = 7;
        if (enemies.length < 5) {
          spawnEnemy('slime', b.x + rand(-70, 70), b.y + rand(-70, 70));
          spawnEnemy('slime', b.x + rand(-70, 70), b.y + rand(-70, 70));
        }
      }
    },
  },
  guardian: {
    name: 'Страж Обелиска', hp: 1300, r: 46, color: '#5a8fd8', speed: 26,
    contact: 14, xp: 220, bColor: '#9cc4f0',
    init(b) { b.ang = 0; b.tSpiral = 0; b.tVolley = 2.5; },
    update(b, dt) {
      const a = Math.atan2(player.y - b.y, player.x - b.x);
      b.x += Math.cos(a) * b.speed * dt;
      b.y += Math.sin(a) * b.speed * dt;
      const enraged = b.hp < b.maxHp * 0.5;
      b.ang += dt * 2.6;
      b.tSpiral -= dt;
      if (b.tSpiral <= 0) {
        b.tSpiral = enraged ? 0.14 : 0.11;
        const arms = enraged ? 3 : 2;
        for (let i = 0; i < arms; i++) {
          const aa = b.ang + (i / arms) * TAU;
          ebullets.push({ x: b.x, y: b.y, vx: Math.cos(aa) * 172, vy: Math.sin(aa) * 172, r: 7, dmg: 13, color: this.bColor, life: 9 });
        }
      }
      b.tVolley -= dt;
      if (b.tVolley <= 0) {
        b.tVolley = 3.2;
        efan(b.x, b.y, 5, 0.5, 245, 13, '#e8e2a0');
      }
    },
  },
  flameLord: {
    name: 'Повелитель Пламени', hp: 1400, r: 46, color: '#ff6a2a', speed: 55,
    contact: 16, xp: 260, bColor: '#ffb066',
    init(b) { b.ang = 0; b.tSpiral = 0; b.tWave = 3; b.tImp = 6; },
    update(b, dt) {
      const a = Math.atan2(player.y - b.y, player.x - b.x);
      b.x += Math.cos(a) * b.speed * dt;
      b.y += Math.sin(a) * b.speed * dt;
      const enraged = b.hp < b.maxHp * 0.4;
      // огненная спираль
      b.ang += dt * 3.4;
      b.tSpiral -= dt;
      if (b.tSpiral <= 0) {
        b.tSpiral = enraged ? 0.08 : 0.11;
        const arms = enraged ? 3 : 2;
        for (let i = 0; i < arms; i++) {
          const aa = b.ang + (i / arms) * TAU;
          ebullets.push({ x: b.x, y: b.y, vx: Math.cos(aa) * 200, vy: Math.sin(aa) * 200, r: 7, dmg: 13, color: this.bColor, life: 9 });
        }
      }
      // волна жара — медленное расширяющееся кольцо
      b.tWave -= dt;
      if (b.tWave <= 0) {
        b.tWave = enraged ? 2.8 : 4;
        ering(b.x, b.y, enraged ? 28 : 24, 125, 14, '#ffd060', rand(0, TAU), 9);
        shake = Math.max(shake, 5);
      }
      b.tImp -= dt;
      if (b.tImp <= 0) {
        b.tImp = 6;
        if (enemies.length < 4) {
          spawnEnemy('imp', b.x + rand(-80, 80), b.y + rand(-80, 80));
          spawnEnemy('imp', b.x + rand(-80, 80), b.y + rand(-80, 80));
        }
      }
    },
  },
  lich: {
    name: 'Лич', hp: 1500, r: 40, color: '#b06ee0', speed: 0,
    contact: 15, xp: 300, bColor: '#d9a8ff',
    init(b) { b.tTp = 3; b.tFan = 1.5; b.tSummon = 5; },
    update(b, dt) {
      const rage = b.hp < b.maxHp * 0.35;
      b.tTp -= dt;
      if (b.tTp <= 0) {
        b.tTp = rage ? 3.2 : 4.5;
        burst(b.x, b.y, 18, b.color);
        const a = rand(0, TAU), d = rand(260, 380);
        b.x = clamp(player.x + Math.cos(a) * d, 90, WORLD - 90);
        b.y = clamp(player.y + Math.sin(a) * d, 90, WORLD - 90);
        burst(b.x, b.y, 18, b.color);
        Music.sfx('teleport');
        if (rage) ering(b.x, b.y, 14, 190, 14, this.bColor);
      }
      b.tFan -= dt;
      if (b.tFan <= 0) {
        b.tFan = rage ? 0.95 : 1.5;
        efan(b.x, b.y, rage ? 7 : 5, 0.5, 265, 15, this.bColor);
      }
      b.tSummon -= dt;
      if (b.tSummon <= 0) {
        b.tSummon = 9;
        if (enemies.length < 4) spawnEnemy('skeleton', b.x + rand(-90, 90), b.y + rand(-90, 90));
      }
    },
  },
};

function spawnBoss(key) {
  const def = BOSSDEFS[key];
  const toCenter = Math.atan2(WORLD / 2 - player.y, WORLD / 2 - player.x);
  boss = {
    key, def, name: def.name,
    hp: def.hp, maxHp: def.hp, r: def.r, color: def.color, speed: def.speed,
    x: clamp(player.x + Math.cos(toCenter) * 560, 110, WORLD - 110),
    y: clamp(player.y + Math.sin(toCenter) * 560, 110, WORLD - 110),
    touchT: 0,
  };
  def.init(boss);
}

// ================= этапы =================
const STAGES = [
  { type: 'wave', label: 'Волна 1 — Окраины', spawn: [['slime', 6], ['bat', 4]] },
  { type: 'boss', boss: 'slimeKing' },
  { type: 'wave', label: 'Волна 2 — Руины', spawn: [['bat', 5], ['cultist', 6]] },
  { type: 'boss', boss: 'guardian' },
  { type: 'portal', label: 'Огненный портал' },
  { type: 'wave', label: 'Данж — Пылающие залы', fire: true, spawn: [['imp', 5], ['salamander', 4], ['magmaGolem', 3]] },
  { type: 'boss', boss: 'flameLord', fire: true },
  { type: 'wave', label: 'Волна 3 — Некрополь', spawn: [['cultist', 5], ['skeleton', 6]] },
  { type: 'boss', boss: 'lich' },
];
const DUNGEON_SKIP_TO = 7; // портал закрылся — данж пропускается, сразу к Некрополю
const PORTAL_TIME = 12;

function startStage(i) {
  stageIdx = i;
  const st = STAGES[i];
  // возвращение из данжа на место входа
  if (dungeonReturn && !st.fire) {
    // несобранная добыча данжа переезжает вместе с игроком
    for (const d of drops) {
      d.x = clamp(dungeonReturn.x + rand(-70, 70), 20, WORLD - 20);
      d.y = clamp(dungeonReturn.y + rand(-70, 70), 20, WORLD - 20);
    }
    player.x = dungeonReturn.x;
    player.y = dungeonReturn.y;
    dungeonReturn = null;
    lavaPools = [];
    ebullets = [];
    Music.sfx('teleport');
  }
  if (st.fire && lavaPools.length === 0) {
    for (let j = 0; j < 12; j++) lavaPools.push({ x: rand(120, WORLD - 120), y: rand(120, WORLD - 120), r: rand(40, 90) });
  }
  if (st.type === 'wave') {
    for (const [kind, n] of st.spawn) for (let j = 0; j < n; j++) spawnWaveEnemy(kind);
    banner = { text: st.label, sub: 'Зачистите волну', t: 2.6 };
    Music.setBoss(false);
  } else if (st.type === 'portal') {
    let px = clamp(player.x, 200, WORLD - 200), py = clamp(player.y - 200, 200, WORLD - 200);
    if (dist2(px, py, player.x, player.y) < 150 * 150) {
      // не спавнить портал вплотную к игроку — иначе мгновенный незапрошенный телепорт
      const aC = Math.atan2(WORLD / 2 - player.y, WORLD / 2 - player.x);
      px = clamp(player.x + Math.cos(aC) * 220, 200, WORLD - 200);
      py = clamp(player.y + Math.sin(aC) * 220, 200, WORLD - 200);
    }
    portal = { x: px, y: py, t: PORTAL_TIME };
    banner = { text: 'Огненный портал', sub: 'Шагните внутрь, пока он не закрылся — там ценная добыча', t: 3 };
    Music.setBoss(false);
  } else {
    spawnBoss(st.boss);
    const bn = STAGES.slice(0, i + 1).filter(s => s.type === 'boss').length;
    const btotal = STAGES.filter(s => s.type === 'boss').length;
    banner = { text: boss.name, sub: 'Босс ' + bn + ' из ' + btotal, t: 2.8 };
    Music.setBoss(true);
  }
}

// ================= игрок =================
function startRun(clsKey) {
  Music.ensure();
  const cls = CLASSES[clsKey];
  player = {
    cls, x: WORLD / 2, y: WORLD * 0.78, r: 14,
    hp: cls.hp, maxHp: cls.hp, dmg: cls.dmg, speed: cls.speed,
    level: 1, xp: 0, xpNeed: 25,
    fireT: 0, abilityT: 0, inv: 0, aimDir: -Math.PI / 2, dexPots: 0,
  };
  bullets = []; ebullets = []; enemies = []; drops = []; particles = [];
  boss = null; nextT = 0; runTime = 0; killCount = 0; shake = 0;
  portal = null; dungeonReturn = null; lavaPools = [];
  document.getElementById('menu').classList.add('hidden');
  document.getElementById('gameover').classList.add('hidden');
  document.getElementById('victory').classList.add('hidden');
  state = 'play';
  startStage(0);
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
    banner = { text: 'Уровень ' + player.level + '!', sub: '', t: 1.4, small: true };
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
    const st = STAGES[stageIdx];
    const where = st.type === 'boss' ? 'в бою с боссом «' + boss.name + '»' : 'на этапе «' + st.label + '»';
    document.getElementById('deathStats').textContent =
      `${player.cls.name} пал ${where}\nУровень: ${player.level} · Убийств: ${killCount} · Время: ${fmtTime(runTime)}`;
    document.getElementById('gameover').classList.remove('hidden');
    saveRun(false);
  }
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
    if (boss && dist2(boss.x, boss.y, player.x, player.y) < (R + boss.r) ** 2) boss.hp -= dmg;
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
    if (boss) {
      const d = dist2(boss.x, boss.y, player.x, player.y);
      if (d < best && d < (R + boss.r) ** 2) { tx = boss.x; ty = boss.y; found = true; }
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

  // враги
  for (const e of enemies) {
    const k = e.k;
    const a = Math.atan2(player.y - e.y, player.x - e.x);
    const d = Math.sqrt(dist2(e.x, e.y, player.x, player.y));
    let vx = 0, vy = 0;

    if (k.behavior === 'chase' || k.behavior === 'ring') {
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
          ering(e.x, e.y, 8, k.bSpeed, k.bDmg, k.color, rand(0, TAU), 6);
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

    // контактный урон
    e.touchT = Math.max(0, e.touchT - dt);
    if (e.touchT <= 0 && dist2(e.x, e.y, player.x, player.y) < (e.r + player.r) ** 2) {
      e.touchT = 0.8;
      hurtPlayer(k.dmg);
    }
  }

  // расталкивание врагов
  for (let i = 0; i < enemies.length; i++) {
    for (let j = i + 1; j < enemies.length; j++) {
      const a = enemies[i], b = enemies[j];
      const dd = dist2(a.x, a.y, b.x, b.y), min = a.r + b.r;
      if (dd > 0 && dd < min * min) {
        const d = Math.sqrt(dd), push = (min - d) / 2;
        const nx = (b.x - a.x) / d, ny = (b.y - a.y) / d;
        a.x -= nx * push; a.y -= ny * push;
        b.x += nx * push; b.y += ny * push;
      }
    }
  }

  // босс
  if (boss) {
    boss.def.update(boss, dt);
    boss.touchT = Math.max(0, boss.touchT - dt);
    if (boss.touchT <= 0 && dist2(boss.x, boss.y, player.x, player.y) < (boss.r + player.r) ** 2) {
      boss.touchT = 0.8;
      hurtPlayer(boss.def.contact);
    }
  }

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
    if (!dead && boss && dist2(b.x, b.y, boss.x, boss.y) < (b.r + boss.r) ** 2) {
      boss.hp -= b.dmg;
      burst(b.x, b.y, 3, boss.color);
      Music.sfx('hit');
      dead = true;
    }
    if (dead) bullets.splice(i, 1);
  }

  // смерть врагов
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    if (e.hp <= 0) {
      killCount++;
      gainXp(e.k.xp);
      burst(e.x, e.y, 10, e.k.color);
      if (Math.random() < 0.22) drops.push({ x: e.x, y: e.y, type: 'hp' });
      enemies.splice(i, 1);
    }
  }

  // смерть босса
  if (boss && boss.hp <= 0) {
    killCount++;
    gainXp(boss.def.xp);
    burst(boss.x, boss.y, 60, boss.color);
    burst(boss.x, boss.y, 40, '#f4d47c');
    // с каждого босса — зелье ловкости; с Повелителя Пламени — два (награда за данж)
    drops.push({ x: boss.x, y: boss.y, type: 'dex' });
    if (boss.key === 'flameLord') drops.push({ x: boss.x + rand(-45, 45), y: boss.y + rand(-45, 45), type: 'dex' });
    for (let i = 0; i < 2; i++) drops.push({ x: boss.x + rand(-55, 55), y: boss.y + rand(-55, 55), type: 'hp' });
    shake = Math.max(shake, 14);
    Music.sfx('explode');
    Music.setBoss(false);
    // миньоны босса гибнут вместе с ним
    for (const e of enemies) burst(e.x, e.y, 8, e.k.color);
    enemies = [];
    ebullets = [];
    boss = null;
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
        banner = { text: 'Скорость атаки +15%!', sub: '', t: 1.5, small: true };
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

  // портал в огненный данж
  if (portal && state === 'play') {
    portal.t -= dt;
    if (dist2(player.x, player.y, portal.x, portal.y) < 36 * 36) {
      dungeonReturn = { x: player.x, y: player.y };
      portal = null;
      player.x = WORLD / 2;
      player.y = WORLD * 0.8;
      bullets = []; ebullets = [];
      Music.sfx('teleport');
      startStage(stageIdx + 1);
    } else if (portal.t <= 0) {
      portal = null;
      startStage(DUNGEON_SKIP_TO);
      // после startStage, иначе баннер этапа его перезапишет
      banner = { text: 'Портал закрылся…', sub: STAGES[DUNGEON_SKIP_TO].label, t: 2.2 };
    }
  }

  // тлеющие угольки в огненной теме
  if (STAGES[stageIdx].fire && Math.random() < dt * 14) {
    particles.push({
      x: clamp(cam.x + rand(0, W), 0, WORLD), y: clamp(cam.y + rand(0, H), 0, WORLD),
      vx: rand(-12, 12), vy: rand(-65, -30),
      life: rand(0.6, 1.2), maxLife: 1.2,
      color: Math.random() < 0.5 ? '#ff9838' : '#ffc060', r: rand(1.5, 3),
    });
  }

  // менеджер этапов
  if (state === 'play') {
    const st = STAGES[stageIdx];
    const cleared = st.type === 'wave' ? enemies.length === 0
      : st.type === 'boss' ? boss === null
      : false; // портал переключает этапы сам
    if (nextT > 0) {
      nextT -= dt;
      if (nextT <= 0) {
        if (stageIdx + 1 >= STAGES.length) {
          state = 'win';
          document.getElementById('winStats').textContent =
            `${player.cls.name} · Уровень ${player.level} · Убийств: ${killCount} · Время: ${fmtTime(runTime)}`;
          document.getElementById('victory').classList.remove('hidden');
          saveRun(true);
        } else {
          startStage(stageIdx + 1);
        }
      }
    } else if (cleared) {
      nextT = 1.6;
    }
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

  // пол мира (в данже — огненная тема)
  const fireTheme = !!(player && STAGES[stageIdx].fire);
  ctx.fillStyle = fireTheme ? '#1a0d08' : '#12181f';
  ctx.fillRect(0, 0, WORLD, WORLD);
  ctx.strokeStyle = fireTheme ? '#2e1810' : '#1a232d';
  ctx.lineWidth = 1;
  const gs = 100;
  const x0 = Math.max(0, Math.floor(cam.x / gs) * gs), x1 = Math.min(WORLD, cam.x + W);
  const y0 = Math.max(0, Math.floor(cam.y / gs) * gs), y1 = Math.min(WORLD, cam.y + H);
  ctx.beginPath();
  for (let x = x0; x <= x1; x += gs) { ctx.moveTo(x, Math.max(0, cam.y)); ctx.lineTo(x, y1); }
  for (let y = y0; y <= y1; y += gs) { ctx.moveTo(Math.max(0, cam.x), y); ctx.lineTo(x1, y); }
  ctx.stroke();
  // лавовые озёра (декор данжа)
  if (fireTheme) {
    for (const p of lavaPools) {
      const lg = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, p.r);
      lg.addColorStop(0, 'rgba(255,140,50,0.55)');
      lg.addColorStop(0.65, 'rgba(200,60,20,0.3)');
      lg.addColorStop(1, 'rgba(200,60,20,0)');
      ctx.fillStyle = lg;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
    }
  }
  // стены
  ctx.strokeStyle = fireTheme ? '#8a4224' : '#33465c';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, WORLD - 6, WORLD - 6);

  if (player) {
    // портал в данж
    if (portal) {
      const pr = 26 + Math.sin(gameTime * 5) * 3;
      const pg = ctx.createRadialGradient(portal.x, portal.y, 4, portal.x, portal.y, pr + 16);
      pg.addColorStop(0, 'rgba(255,190,90,0.95)');
      pg.addColorStop(0.6, 'rgba(255,106,42,0.55)');
      pg.addColorStop(1, 'rgba(255,106,42,0)');
      ctx.fillStyle = pg;
      ctx.beginPath(); ctx.arc(portal.x, portal.y, pr + 16, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#ffb066';
      ctx.lineWidth = 3;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(portal.x, portal.y, pr - i * 6, gameTime * (2 + i), gameTime * (2 + i) + 4.2);
        ctx.stroke();
      }
      // оставшееся время — дуга
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(portal.x, portal.y, pr + 9, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(portal.t / PORTAL_TIME, 0, 1));
      ctx.stroke();
    }

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

    // враги
    for (const e of enemies) drawCreature(e.x, e.y, e.r, e.k.color, e.hp, e.maxHp);

    // босс
    if (boss) {
      const pulse = 1 + Math.sin(gameTime * 4) * 0.04;
      drawCreature(boss.x, boss.y, boss.r * pulse, boss.color, boss.hp, boss.maxHp, true);
      // декор по типу босса
      ctx.save();
      ctx.translate(boss.x, boss.y);
      if (boss.key === 'slimeKing') {
        ctx.fillStyle = '#f4d47c';
        for (let i = -1; i <= 1; i++) {
          ctx.beginPath();
          ctx.moveTo(i * 18 - 9, -boss.r - 4);
          ctx.lineTo(i * 18, -boss.r - 22);
          ctx.lineTo(i * 18 + 9, -boss.r - 4);
          ctx.fill();
        }
      } else if (boss.key === 'guardian') {
        ctx.strokeStyle = '#9cc4f0';
        ctx.lineWidth = 3;
        for (let i = 0; i < 4; i++) {
          const a = boss.ang + (i / 4) * TAU;
          const ox = Math.cos(a) * (boss.r + 18), oy = Math.sin(a) * (boss.r + 18);
          ctx.save(); ctx.translate(ox, oy); ctx.rotate(a);
          ctx.strokeRect(-6, -6, 12, 12);
          ctx.restore();
        }
      } else if (boss.key === 'flameLord') {
        ctx.fillStyle = 'rgba(255,176,102,0.8)';
        for (let i = 0; i < 6; i++) {
          const a = gameTime * 3 + (i / 6) * TAU;
          const fx = Math.cos(a) * (boss.r + 10), fy = Math.sin(a) * (boss.r + 10);
          const fl = 10 + Math.sin(gameTime * 8 + i) * 4;
          ctx.beginPath();
          ctx.moveTo(fx + Math.cos(a - 0.35) * 6, fy + Math.sin(a - 0.35) * 6);
          ctx.lineTo(fx + Math.cos(a) * fl, fy + Math.sin(a) * fl);
          ctx.lineTo(fx + Math.cos(a + 0.35) * 6, fy + Math.sin(a + 0.35) * 6);
          ctx.fill();
        }
      } else if (boss.key === 'lich') {
        ctx.strokeStyle = 'rgba(217,168,255,0.5)';
        ctx.lineWidth = 2;
        for (let i = 0; i < 3; i++) {
          const a = gameTime * 2 + (i / 3) * TAU;
          ctx.beginPath();
          ctx.arc(Math.cos(a) * (boss.r + 16), Math.sin(a) * (boss.r + 16), 6, 0, TAU);
          ctx.stroke();
        }
      }
      ctx.restore();
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

function drawCreature(x, y, r, color, hp, maxHp, isBoss = false) {
  // тень
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(x, y + r * 0.85, r * 0.9, r * 0.35, 0, 0, TAU); ctx.fill();
  // тело
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = isBoss ? 4 : 2.5;
  ctx.stroke();
  // глаза смотрят на игрока
  if (player) {
    const a = Math.atan2(player.y - y, player.x - x);
    const ex = Math.cos(a) * r * 0.35, ey = Math.sin(a) * r * 0.35;
    const er = Math.max(2.5, r * 0.14);
    ctx.fillStyle = '#fff';
    for (const s of [-1, 1]) {
      const ox = Math.cos(a + Math.PI / 2) * r * 0.32 * s;
      const oy = Math.sin(a + Math.PI / 2) * r * 0.32 * s;
      ctx.beginPath(); ctx.arc(x + ex + ox, y + ey + oy, er, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = '#1a1a24';
    for (const s of [-1, 1]) {
      const ox = Math.cos(a + Math.PI / 2) * r * 0.32 * s;
      const oy = Math.sin(a + Math.PI / 2) * r * 0.32 * s;
      ctx.beginPath(); ctx.arc(x + ex * 1.15 + ox, y + ey * 1.15 + oy, er * 0.55, 0, TAU); ctx.fill();
    }
  }
  // полоска HP (миньонам — только если ранены)
  if (!isBoss && hp < maxHp) {
    const w = r * 2;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x - w / 2, y - r - 12, w, 5);
    ctx.fillStyle = '#e86a5e';
    ctx.fillRect(x - w / 2, y - r - 12, w * clamp(hp / maxHp, 0, 1), 5);
  }
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

function drawUI() {
  ctx.textBaseline = 'middle';

  // HP / XP
  bar(18, 18, 230, 20, player.hp / player.maxHp, '#c94b41', 'rgba(0,0,0,0.55)');
  ctx.fillStyle = '#fff';
  ctx.font = '12px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText(Math.ceil(player.hp) + ' / ' + Math.ceil(player.maxHp), 18 + 115, 28);
  bar(18, 42, 230, 10, player.xp / player.xpNeed, '#f4d47c', 'rgba(0,0,0,0.55)');
  ctx.textAlign = 'left';
  ctx.fillStyle = '#cdd8e4';
  ctx.font = '13px system-ui';
  ctx.fillText(player.cls.name + ' · ур. ' + player.level + (player.dexPots ? ' · скор. атаки +' + player.dexPots * 15 + '%' : ''), 18, 66);

  // умение
  const cd = player.abilityT;
  bar(18, 80, 230, 12, 1 - cd / player.cls.abilityCd, cd > 0 ? '#5a8fd8' : '#7ac74f', 'rgba(0,0,0,0.55)');
  ctx.fillStyle = '#9fb0c3';
  ctx.font = '11px system-ui';
  ctx.fillText(player.cls.abilityName + (cd > 0 ? ' · ' + cd.toFixed(1) + 'с' : ' — готово [Space]'), 18, 102);

  // этап + звук
  ctx.textAlign = 'right';
  ctx.fillStyle = '#9fb0c3';
  ctx.font = '13px system-ui';
  ctx.fillText('Этап ' + (stageIdx + 1) + ' / ' + STAGES.length, W - 18, 26);
  ctx.fillStyle = '#66788e';
  ctx.font = '11px system-ui';
  ctx.fillText('M · звук: ' + (Music.isMuted() ? 'выкл' : 'вкл'), W - 18, 46);
  ctx.fillText(fmtTime(runTime), W - 18, 64);

  // HP босса
  if (boss) {
    const bw = Math.min(430, W * 0.5);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f0d9ff';
    ctx.font = 'bold 15px system-ui';
    ctx.fillText(boss.name, W / 2, 26);
    bar(W / 2 - bw / 2, 38, bw, 14, boss.hp / boss.maxHp, boss.color, 'rgba(0,0,0,0.6)');
  }

  // баннер этапа
  if (banner) {
    const a = clamp(banner.t / 0.5, 0, 1);
    ctx.globalAlpha = a;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f4d47c';
    ctx.font = 'bold ' + (banner.small ? 26 : 40) + 'px system-ui';
    ctx.fillText(banner.text, W / 2, H * 0.32);
    if (banner.sub) {
      ctx.fillStyle = '#9fb0c3';
      ctx.font = '16px system-ui';
      ctx.fillText(banner.sub, W / 2, H * 0.32 + 36);
    }
    ctx.globalAlpha = 1;
  }

  // сенсорный интерфейс
  if (IS_TOUCH && state === 'play') {
    // кнопка умения
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
    // джойстик
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
