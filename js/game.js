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
const R_ARENA = 360;    // запечатанный центр карты (вход в цитадель)
const R_CITADEL = 560;  // отдельная локация финального боя — Цитадель Безумного Бога
const R_ZION = 520;     // мирный город Зион — хаб, откуда все стартуют
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
  if (inZion) return { key: 'zion', name: 'Зион — мирный город' };
  const d = Math.hypot(x - CX, y - CY);
  if (finalActive && d < R_CITADEL + 60) return { key: 'citadel', name: 'Цитадель Безумного Бога' };
  if (d < R_ARENA) return { key: 'arena', name: 'Запечатанный центр' };
  if (d < R_LORDS) { const s = SECTORS[sectorIdxAt(x, y)]; return { key: s.key, name: s.name, sector: s }; }
  if (d < R_TITANS) return { key: 'titans', name: 'Земли Исполинов' };
  return { key: 'forest', name: 'Лес Эха' };
}

// палитры тайлов земли: несколько шейдов на зону + редкая деталь (трава/угли/руны)
const TILES = {
  forest: { shades: ['#0f1a0e', '#12200f', '#0d1710', '#16260f'], detail: '#2a4a24', dchance: 0.14 },
  titans: { shades: ['#201f19', '#26251d', '#1b1a15', '#2b2820'], detail: '#3a3428', dchance: 0.12 },
  nature: { shades: ['#12240e', '#173010', '#0f1e0c', '#1c3a12'], detail: '#3a7024', dchance: 0.16 },
  fire:   { shades: ['#1e0f08', '#28140a', '#170b06', '#301810'], detail: '#c8501c', dchance: 0.15 },
  storm:  { shades: ['#0e1424', '#121a2e', '#0a0f1c', '#161f38'], detail: '#3a6ac0', dchance: 0.12 },
  moon:   { shades: ['#160f22', '#1c1430', '#100a1a', '#241838'], detail: '#7a4ab0', dchance: 0.13 },
  ocean:  { shades: ['#0b1c1e', '#0f262a', '#08161a', '#123236'], detail: '#2e7a7e', dchance: 0.14 },
  arena:  { shades: ['#140c18', '#1a1020', '#100a14', '#1e1428'], detail: '#3a2848', dchance: 0.10 },
};

// ================= состояние =================
let state = 'menu'; // menu | play | pause | dead | win
let player = null;
let bullets = [], ebullets = [], enemies = [], drops = [], particles = [], decor = [];
let bosses = [], engagedBoss = null;
let lordsLeft = 5, finalT = 0, finalActive = false;
let worldNum = 1, nextPortal = null;
let inZion = false, zionPortal = null; // мирный город: старт забега и портал в мир
let playerName = 'Странник';
try { playerName = localStorage.getItem('re-name') || 'Странник'; } catch { /* приватный режим */ }

// онлайн-рейтинг: укажите URL бэкенда (например, bucket kvdb.io) — и таблица станет глобальной
const LB_URL = null; // напр.: 'https://kvdb.io/ВАШ_BUCKET'
async function submitScore() {
  if (!LB_URL || !player || !player.fame) return;
  try {
    await fetch(LB_URL + '/' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), {
      method: 'PUT',
      body: JSON.stringify({ n: playerName, f: player.fame, w: worldNum, c: player.cls.name }),
    });
  } catch { /* рейтинг не должен ломать игру */ }
}

// следующий мир — та же карта, но твари сильнее (компаунд, чтобы поспевать за игроком)
const worldHpMul = () => Math.pow(1.45, worldNum - 1);
const worldDmgMul = () => Math.pow(1.25, worldNum - 1);
const worldXpMul = () => 1 + (worldNum - 1) * 0.35;
let cam = { x: 0, y: 0 };
let banner = null, shake = 0, lastZone = '';
let runTime = 0, killCount = 0, gameTime = 0;

// ================= ввод =================
const keys = {};
const mouse = { x: 0, y: 0, down: false };

addEventListener('keydown', e => {
  // не перехватывать ввод в полях (имя для рейтинга): иначе пробел блокируется, M мьютит
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
  keys[e.code] = true;
  if (e.code === 'Space') { e.preventDefault(); useAbility(); }
  if (e.code === 'KeyM') Music.toggleMute();
  if (e.code === 'KeyP' && (state === 'play' || state === 'pause')) {
    state = state === 'play' ? 'pause' : 'play';
  }
});
addEventListener('keyup', e => keys[e.code] = false);
addEventListener('mousemove', e => {
  mouse.x = e.clientX; mouse.y = e.clientY;
  // не дёргать тач-перетаскивание физической мышью на гибридных устройствах
  if (drag && drag.touchId === undefined) dragMove(e.clientX, e.clientY);
});
canvas.addEventListener('mousedown', e => {
  if (e.button === 0) {
    if (beginSlotDrag(e.clientX, e.clientY)) return; // взяли предмет — не прицеливание
    if (drag && slotRectAt(e.clientX, e.clientY)) return; // панель — активная drop-зона
    mouse.down = true;
  }
  if (e.button === 2) {
    // ПКМ по занятому слоту — быстро выбросить предмет
    const r = state === 'play' && player ? slotRectAt(e.clientX, e.clientY) : null;
    const it = r && slotItemAt(r);
    if (it) {
      setSlot(r, null);
      discardItem(it);
      recalcStats();
      return;
    }
    useAbility();
  }
});
addEventListener('mouseup', e => {
  if (e.button === 0) {
    mouse.down = false;
    if (drag && drag.touchId === undefined) finishDrag(e.clientX, e.clientY);
  }
});
canvas.addEventListener('contextmenu', e => e.preventDefault());
addEventListener('blur', () => {
  mouse.down = false;
  for (const k in keys) keys[k] = false; // иначе клавиши «залипают» при Alt-Tab
  if (drag) {
    // mouseup/touchend может не прийти при потере фокуса — вернуть предмет в слот
    setSlot(drag.from, drag.item);
    recalcStats();
    drag = null;
  }
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
// на узких экранах кнопка поднята, чтобы не перекрывать слоты экипировки
const abilityBtn = () => ({ x: W - 74, y: H - 84 - (W < 440 ? 56 : 0), r: 46 });

canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  Music.ensure();
  if (state === 'pause') { state = 'play'; return; }
  if (state !== 'play') return;
  for (const t of e.changedTouches) {
    const x = t.clientX, y = t.clientY;
    // кнопка умения рисуется поверх слотов — и проверяется первой
    const ab = abilityBtn();
    if (dist2(x, y, ab.x, ab.y) < (ab.r + 12) ** 2) { useAbility(); continue; }
    // занятый слот — берём предмет (тап без сдвига = надеть/снять, сдвиг = перетащить);
    // пустые слоты не поглощают ввод, палец работает как джойстик
    if (beginSlotDrag(x, y, t.identifier)) continue;
    if (drag && slotRectAt(x, y)) continue; // во время перетаскивания панель поглощает касания
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
    if (drag && t.identifier === drag.touchId) {
      dragMove(t.clientX, t.clientY);
      continue;
    }
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
    if (drag && t.identifier === drag.touchId) {
      finishDrag(t.clientX, t.clientY);
    }
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
    if (!Array.isArray(v)) return [];
    return v.filter(r => r && typeof r === 'object')
      // миграция v1.1: победа (убит Бог) эквивалентна «дошёл до мира 2»
      .map(r => (r.win && !r.world ? { ...r, world: 2 } : r));
  } catch { return []; }
}
function saveRun() {
  const all = loadRecords();
  all.push({ name: playerName, fame: player.fame, cls: player.cls.name, world: worldNum, level: player.level, kills: killCount, time: Math.round(runTime) });
  // рейтинг: выше тот, у кого больше славы; при равенстве — мир, затем уровень
  // (Number() — защита от мусорных значений в общем localStorage *.github.io)
  all.sort((a, b) => ((Number(b.fame) || 0) - (Number(a.fame) || 0))
    || ((Number(b.world) || 1) - (Number(a.world) || 1))
    || ((Number(b.level) || 1) - (Number(a.level) || 1)));
  try { localStorage.setItem('re-records', JSON.stringify(all.slice(0, 5))); } catch { /* приватный режим */ }
  renderRecords();
  submitScore(); // в онлайн-рейтинг, если настроен LB_URL
}
const escHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function renderRecords() {
  const el = document.getElementById('records');
  const all = loadRecords();
  el.innerHTML = all.length
    ? '<h2>Рейтинг славы</h2>' + all.map((r, i) => {
        // числовые поля принудительно к числам: localStorage общий для *.github.io
        const w = Number(r.world) || 1;
        return `<div class="rec${w > 1 ? ' win' : ''}">${i + 1}. ${escHtml(r.name || 'Безымянный')} · &#11088;${Number(r.fame) || 0} · ${escHtml(r.cls)} · мир ${w} · ур. ${Number(r.level) || 1}</div>`;
      }).join('')
    : '';
}
try { renderRecords(); } catch { /* рекорды не должны блокировать запуск игры */ }
try {
  const nameInp = document.getElementById('playerName');
  if (nameInp) nameInp.value = playerName === 'Странник' ? '' : playerName;
} catch { /* поле имени опционально */ }

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

// ================= предметы и характеристики =================
// Слоты экипировки: оружие (урон), панцирь (броня), амулет (HP/скорость/скор. атаки).
// Предметы можно надевать и снимать кликом по слотам внизу слева.
const SLOTS = ['weapon', 'armor', 'ring'];
const SLOT_NAMES = { weapon: 'Клинок', armor: 'Панцирь', ring: 'Амулет' };
const SLOT_COLORS = { weapon: '#e86a5e', armor: '#6aa8e8', ring: '#f4d47c' };
const SLOT_GLYPHS = { weapon: 'О', armor: 'П', ring: 'А' };
const LORD_GENITIVE = {
  stormLord: 'Грозы', oceanKing: 'Прилива', natureWarden: 'Рощи',
  moonArchon: 'Луны', flameLord: 'Пламени', madGod: 'Безумного Бога',
};

// редкость в духе цветных сумок RotMG: чем сложнее босс — тем ценнее дроп
const RARITIES = [
  { key: 'common', name: 'обычный', color: '#c8d0dc', bag: '#8a5a2c', mul: 1 },
  { key: 'rare', name: 'редкий', color: '#5a9fe8', bag: '#2e5ab0', mul: 1.4 },
  { key: 'epic', name: 'эпический', color: '#c07af0', bag: '#7a3ac0', mul: 1.8 },
  { key: 'legendary', name: 'легендарный', color: '#ffd257', bag: '#c8912c', mul: 2.3 },
];
// bonus 0..1 сдвигает бросок к ценному
function rollRarity(bonus) {
  const r = Math.random() + bonus;
  if (r > 1.3) return 3;
  if (r > 0.98) return 2;
  if (r > 0.62) return 1;
  return 0;
}

function makeItem(slot, tier, owner, rar = 0) {
  const R = RARITIES[rar];
  const it = { slot, tier, rar, name: SLOT_NAMES[slot] + (owner ? ' ' + owner : '') + ' T' + tier };
  if (slot === 'weapon') it.dmg = (0.08 + 0.06 * tier) * R.mul;
  else if (slot === 'armor') it.armor = Math.round((2 + 2 * tier) * R.mul);
  else {
    const roll = Math.floor(rand(0, 3));
    if (roll === 0) it.hp = Math.round((15 + 15 * tier) * R.mul);
    else if (roll === 1) it.speed = Math.round((8 + 6 * tier) * R.mul);
    else it.atkSpd = (0.05 + 0.05 * tier) * R.mul;
  }
  return it;
}

function fmtItem(it) {
  const b = [];
  if (it.dmg) b.push('+' + Math.round(it.dmg * 100) + '% урона');
  if (it.armor) b.push('+' + it.armor + ' брони');
  if (it.hp) b.push('+' + it.hp + ' HP');
  if (it.speed) b.push('+' + it.speed + ' к скорости');
  if (it.atkSpd) b.push('+' + Math.round(it.atkSpd * 100) + '% скор. атаки');
  return RARITIES[it.rar || 0].name + ' ' + it.name + ' (' + b.join(', ') + ')';
}

// характеристики игрока = база класса + уровни + банки + надетые предметы
function recalcStats() {
  const cls = player.cls;
  let dmgMul = 1, armor = player.defPots * 2, hpB = 0, spd = 0, atk = 1 + 0.15 * player.dexPots;
  for (const s of SLOTS) {
    const it = player.equip[s];
    if (!it) continue;
    dmgMul += it.dmg || 0;
    armor += it.armor || 0;
    hpB += it.hp || 0;
    spd += it.speed || 0;
    atk += it.atkSpd || 0;
  }
  player.dmg = player.baseDmg * dmgMul;
  player.maxHp = Math.round(player.baseHp + hpB);
  player.hp = Math.min(player.hp, player.maxHp);
  player.armor = armor;
  player.speed = cls.speed + spd;
  player.atkRate = cls.fireRate * atk;
}

// подобрать предмет: в пустой слот сразу, иначе в рюкзак; false — некуда.
// Слот-источник активного drag зарезервирован — finishDrag вернёт туда предмет.
function giveItem(it) {
  const resSlot = drag && drag.from.kind === 'equip' ? drag.from.slot : null;
  const resBag = drag && drag.from.kind === 'bag' ? drag.from.idx : -1;
  if (!player.equip[it.slot] && it.slot !== resSlot) {
    player.equip[it.slot] = it;
    recalcStats();
    banner = { text: 'Надето: ' + it.name, sub: fmtItem(it), t: 2.6 };
    return true;
  }
  const free = player.bags.findIndex((b, i) => !b && i !== resBag);
  if (free >= 0) {
    player.bags[free] = it;
    banner = { text: 'В рюкзак: ' + it.name, sub: fmtItem(it), t: 2.4 };
    return true;
  }
  return false;
}

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
  const hp = Math.round(k.hp * worldHpMul());
  enemies.push({
    kind: kindKey, k, x, y, r: k.r, hp, maxHp: hp,
    home: { x, y },
    shootT: rand(0.5, k.shootCd || 1), strafeDir: Math.random() < 0.5 ? 1 : -1,
    seed: rand(0, TAU), touchT: 0, reborn: false,
  });
}

// ================= снаряды боссов =================
function ering(x, y, n, speed, dmg, color, offset = 0, br = 7, flags) {
  for (let i = 0; i < n; i++) {
    const a = offset + (i / n) * TAU;
    ebullets.push(Object.assign(
      { x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, r: br, dmg, color, life: 9 }, flags));
  }
}

// стена пуль с брешью — нужно найти проход и проскочить (кайт в духе RotMG)
function bulletWall(x, y, ang, spread, n, speed, dmg, color, flags) {
  const gap = 2 + Math.floor(rand(0, n - 4));
  for (let i = 0; i < n; i++) {
    if (Math.abs(i - gap) <= 2) continue; // брешь для прохода
    const a = ang - spread / 2 + (i / (n - 1)) * spread;
    ebullets.push(Object.assign(
      { x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, r: 9, dmg, color, life: 8 }, flags));
  }
}

// ================= телеграфы спец-атак: успей выбежать =================
let telegraphs = [];
// зона: красный круг, после задержки — взрыв кольцом пуль + урон, если стоишь внутри
function zoneTelegraph(x, y, r, delay, opts) {
  telegraphs.push(Object.assign({ kind: 'zone', x, y, r, t: delay, total: delay }, opts));
}
// луч: полоса от точки по направлению, после задержки — копьё из пуль вдоль линии
function beamTelegraph(x, y, ang, len, delay, opts) {
  telegraphs.push(Object.assign({ kind: 'beam', x, y, ang, len, t: delay, total: delay }, opts));
}
function updateTelegraphs(dt) {
  for (let i = telegraphs.length - 1; i >= 0; i--) {
    const tg = telegraphs[i];
    tg.t -= dt;
    if (tg.t > 0) continue;
    telegraphs.splice(i, 1);
    if (tg.kind === 'zone') {
      burst(tg.x, tg.y, 14, tg.color || '#ff6a50');
      ering(tg.x, tg.y, tg.n || 10, tg.speed || 220, tg.dmg, tg.color || '#ff8a60', rand(0, TAU), 7, tg.flags);
      if (dist2(player.x, player.y, tg.x, tg.y) < (tg.r + player.r) ** 2) hurtPlayer(tg.dmg + 5);
      shake = Math.max(shake, 5);
    } else {
      for (let j = 0; j < 14; j++) {
        const px = tg.x + Math.cos(tg.ang) * (j / 14) * tg.len;
        const py = tg.y + Math.sin(tg.ang) * (j / 14) * tg.len;
        ebullets.push(Object.assign(
          { x: px, y: py, vx: Math.cos(tg.ang) * 430, vy: Math.sin(tg.ang) * 430, r: 7, dmg: tg.dmg, color: tg.color || '#e8e2a0', life: 1.6 }, tg.flags));
      }
      shake = Math.max(shake, 4);
    }
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
    name: 'Громовой Владыка', sprite: 'lordStorm', hp: 1900, r: 44, color: '#7ab8f0', contact: 17, xp: 300,
    init(b) { b.tBlink = 4; b.tFan = 1.0; b.tRing = 3.5; b.tSpec = 3.5; },
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
      // «Небесная кара»: молнии бьют по позиции игрока — стоять на месте нельзя
      b.tSpec -= dt;
      if (b.tSpec <= 0) {
        b.tSpec = rage ? 4 : 5.5;
        for (let i = 0; i < 3; i++) {
          zoneTelegraph(
            clamp(player.x + rand(-90, 90), 60, WORLD - 60),
            clamp(player.y + rand(-90, 90), 60, WORLD - 60),
            95, 0.85 + i * 0.16, { dmg: 15, n: 10, speed: 265, color: '#a8d8ff' });
        }
      }
    },
  },
  oceanKing: {
    name: 'Морской Царь', sprite: 'lordOcean', hp: 2200, r: 46, color: '#4ecdc4', contact: 17, xp: 320, speed: 52,
    init(b) { b.ang = 0; b.tSpiral = 0; b.tWave = 3; b.tWall = 5; },
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
      // «Цунами»: стена пуль с брешью — найди проход; вода замедляет
      b.tWall -= dt;
      if (b.tWall <= 0) {
        b.tWall = rage ? 4.5 : 6.5;
        const aim = Math.atan2(player.y - b.y, player.x - b.x);
        bulletWall(b.x, b.y, aim, 2.4, 22, 185, 14, '#4ecdc4', { slow: true });
        shake = Math.max(shake, 4);
      }
    },
  },
  natureWarden: {
    name: 'Страж Рощи', sprite: 'lordNature', hp: 2300, r: 47, color: '#6ec84a', contact: 18, xp: 320, speed: 44,
    init(b) { b.ang = 0; b.tSpiral = 0; b.tVolley = 2.5; b.tSum = 7; b.tSpec = 4.5; },
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
      // «Корни»: кольцо зон вокруг игрока с одним просветом — выбегай точно
      b.tSpec -= dt;
      if (b.tSpec <= 0) {
        b.tSpec = rage ? 4.5 : 6;
        const gap = Math.floor(rand(0, 5));
        for (let i = 0; i < 5; i++) {
          if (i === gap) continue;
          const za = (i / 5) * TAU + rand(-0.1, 0.1);
          zoneTelegraph(
            clamp(player.x + Math.cos(za) * 130, 60, WORLD - 60),
            clamp(player.y + Math.sin(za) * 130, 60, WORLD - 60),
            90, 1.05, { dmg: 14, n: 8, speed: 205, color: '#a8e070' });
        }
      }
    },
  },
  moonArchon: {
    name: 'Лунный Архонт', sprite: 'lordMoon', hp: 2050, r: 42, color: '#b48ae8', contact: 17, xp: 310,
    init(b) { b.tTp = 3; b.tFan = 1.5; b.tSum = 6; b.tBeam = 4; },
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
      // «Лунный луч»: телеграфированная линия от босса сквозь игрока, затем копьё пуль
      b.tBeam -= dt;
      if (b.tBeam <= 0) {
        b.tBeam = rage ? 3.8 : 5.5;
        const ba = Math.atan2(player.y - b.y, player.x - b.x);
        beamTelegraph(b.x, b.y, ba, 720, 0.8, { dmg: 16, color: '#d9a8ff' });
      }
    },
  },
  flameLord: {
    name: 'Повелитель Пламени', sprite: 'lordFire', hp: 2200, r: 46, color: '#ff6a2a', contact: 18, xp: 330, speed: 62,
    init(b) { b.ang = 0; b.tSpiral = 0; b.tWave = 3; b.tImp = 6; b.tTrack = 4.5; },
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
      // «Извержение»: дорожка взрывов от босса к игроку; огонь поджигает
      b.tTrack -= dt;
      if (b.tTrack <= 0) {
        b.tTrack = rage ? 4.2 : 5.8;
        const ta = Math.atan2(player.y - b.y, player.x - b.x);
        for (let i = 1; i <= 5; i++) {
          zoneTelegraph(
            clamp(b.x + Math.cos(ta) * i * 115, 60, WORLD - 60),
            clamp(b.y + Math.sin(ta) * i * 115, 60, WORLD - 60),
            85, 0.7 + i * 0.13, { dmg: 13, n: 8, speed: 225, color: '#ffb066', flags: { burn: true } });
        }
      }
    },
  },
  madGod: {
    name: 'Безумный Бог', sprite: 'madGod', hp: 5200, r: 54, color: '#e8c05a', contact: 24, xp: 800,
    init(b) { b.ang = 0; b.tSpiral = 0; b.tFan = 1.6; b.tRing = 3; b.tSum = 5; b.tTp = 4.5; b.tBeam = 4; b.tZone = 5; b.tWall = 6; },
    update(b, dt) {
      const ph = b.hp > b.maxHp * 0.66 ? 1 : b.hp > b.maxHp * 0.33 ? 2 : 3;
      const dC = Math.hypot(b.x - CX, b.y - CY);
      if (dC > R_CITADEL * 0.45) {
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
          const ta = rand(0, TAU), td = rand(140, R_CITADEL * 0.55);
          b.x = CX + Math.cos(ta) * td;
          b.y = CY + Math.sin(ta) * td;
          burst(b.x, b.y, 18, b.color);
          Music.sfx('teleport');
          ering(b.x, b.y, 12, 195, 14, '#ff6858');
        }
      }
      // спец-атаки по фазам: луч → зоны → стена с брешью
      b.tBeam -= dt;
      if (b.tBeam <= 0) {
        b.tBeam = ph === 3 ? 3.5 : 5;
        const ba = Math.atan2(player.y - b.y, player.x - b.x);
        beamTelegraph(b.x, b.y, ba, 800, 0.8, { dmg: 17, color: '#ffd257' });
      }
      if (ph >= 2) {
        b.tZone -= dt;
        if (b.tZone <= 0) {
          b.tZone = 4;
          for (let i = 0; i < 3; i++) {
            zoneTelegraph(
              clamp(player.x + rand(-100, 100), CX - R_CITADEL + 60, CX + R_CITADEL - 60),
              clamp(player.y + rand(-100, 100), CY - R_CITADEL + 60, CY + R_CITADEL - 60),
              95, 0.85 + i * 0.15, { dmg: 16, n: 10, speed: 250, color: '#ffd257' });
          }
        }
      }
      if (ph === 3) {
        b.tWall -= dt;
        if (b.tWall <= 0) {
          b.tWall = 5.5;
          const wa = Math.atan2(player.y - b.y, player.x - b.x);
          bulletWall(b.x, b.y, wa, 2.6, 24, 195, 16, '#ff6858', { slow: true });
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
  const hp = Math.round(def.hp * worldHpMul());
  const b = {
    key: s.lord, def, name: def.name, sector: i,
    hp, maxHp: hp, r: def.r, color: def.color,
    x: hx, y: hy, home: { x: hx, y: hy },
    touchT: 0,
  };
  def.init(b);
  bosses.push(b);
}

function spawnMadGod() {
  const def = BOSSDEFS.madGod;
  const hp = Math.round(def.hp * worldHpMul());
  const b = {
    key: 'madGod', def, name: def.name,
    hp, maxHp: hp, r: def.r, color: def.color,
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
    hp: cls.hp, maxHp: cls.hp, baseHp: cls.hp, dmg: cls.dmg, baseDmg: cls.dmg,
    speed: cls.speed, atkRate: cls.fireRate,
    level: 1, xp: 0, xpNeed: 25,
    fireT: 0, abilityT: 0, inv: 0, aimDir: -Math.PI / 2,
    dexPots: 0, defPots: 0, armor: 0, slowT: 0, burnT: 0, fame: 0,
    walk: 0, moving: false, faceX: 0,
    equip: { weapon: null, armor: null, ring: null },
    bags: [null, null, null],
  };
  recalcStats();
  // имя для рейтинга
  try {
    const inp = document.getElementById('playerName');
    if (inp && inp.value.trim()) {
      playerName = inp.value.trim().slice(0, 14);
      localStorage.setItem('re-name', playerName);
    }
  } catch { /* приватный режим */ }
  bullets = []; ebullets = []; drops = []; particles = []; decor = []; enemies = []; bosses = [];
  engagedBoss = null; lordsLeft = 5; finalT = 0; finalActive = false;
  worldNum = 1; nextPortal = null; drag = null; telegraphs = [];
  runTime = 0; killCount = 0; shake = 0;
  // все начинают в мирном Зионе; мир генерируется при входе в портал
  inZion = true;
  lastZone = 'zion';
  player.x = CX;
  player.y = CY + 220;
  zionPortal = { x: CX, y: CY - 300, charge: 0 };
  banner = { text: 'Зион', sub: 'Мирный город. Фонтан лечит; портал на севере ведёт в мир', t: 4 };
  document.getElementById('menu').classList.add('hidden');
  document.getElementById('gameover').classList.add('hidden');
  state = 'play';
}
window.startRun = startRun;

// выход из Зиона в игровой мир
function enterWorld() {
  inZion = false;
  zionPortal = null;
  // позиция ДО генерации: анти-спавн-фильтр в genWorld смотрит на игрока
  player.x = CX;
  player.y = WORLD - 170;
  genWorld();
  lastZone = 'forest';
  Music.sfx('teleport');
  burst(player.x, player.y, 24, '#f4d47c');
  banner = { text: 'Лес Эха', sub: 'Пробивайтесь от окраин мира к центру — там ждёт Безумный Бог', t: 4 };
}

function toMenu() {
  state = 'menu';
  Music.setBoss(false);
  document.getElementById('gameover').classList.add('hidden');
  document.getElementById('menu').classList.remove('hidden');
}
window.toMenu = toMenu;

function gainXp(n) {
  player.xp += n;
  while (player.xp >= player.xpNeed) {
    player.xp -= player.xpNeed;
    player.level++;
    player.xpNeed = 25 + (player.level - 1) * 18;
    player.baseHp += 14;
    player.baseDmg += player.cls.dmg * 0.07; // линейный рост — иначе к мирам 3+ ваншоты всего
    recalcStats();
    player.hp = Math.min(player.maxHp, player.hp + player.maxHp * 0.45);
    Music.sfx('levelup');
    if (!banner || banner.small) banner = { text: 'Уровень ' + player.level + '!', sub: '', t: 1.4, small: true };
    burst(player.x, player.y, 20, '#f4d47c');
  }
}

function hurtPlayer(dmg) {
  if (player.inv > 0 || state !== 'play') return;
  // множитель мира и броня; «пол» урона — процентный (15% масштабированного),
  // чтобы броня не делала игрока бессмертным на дальних мирах
  const scaled = dmg * worldDmgMul();
  const taken = Math.max(1, Math.max(Math.round(scaled * 0.15), Math.round(scaled) - player.armor));
  player.hp -= taken;
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
      `${playerName} (${player.cls.name}) пал ${where}\n⭐ Слава: ${player.fame} · Мир: ${worldNum} · Уровень: ${player.level} · Убийств: ${killCount} · Время: ${fmtTime(runTime)}`;
    document.getElementById('gameover').classList.remove('hidden');
    saveRun();
  }
}

// переход в следующий мир: та же карта, но всё население сильнее
function nextWorld() {
  worldNum++;
  finalActive = false;
  nextPortal = null;
  lordsLeft = 5;
  finalT = 0;
  engagedBoss = null;
  bullets = []; ebullets = []; drops = []; particles = []; telegraphs = [];
  player.slowT = 0; player.burnT = 0;
  player.x = CX;
  player.y = WORLD - 170;
  genWorld();
  lastZone = 'forest';
  Music.setBoss(false);
  Music.sfx('teleport');
  burst(player.x, player.y, 24, '#f4d47c');
  banner = { text: 'Мир ' + worldNum, sub: 'Твари этого эха сильнее прежних (+' + Math.round((worldHpMul() - 1) * 100) + '% HP, +' + Math.round((worldDmgMul() - 1) * 100) + '% урона)', t: 4.5 };
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

// ================= клики по слотам экипировки =================
function slotRects() {
  const size = 42, gap = 6, y = H - size - 12, x0 = 14;
  const rects = [];
  SLOTS.forEach((s, i) => rects.push({ kind: 'equip', slot: s, x: x0 + i * (size + gap), y, size }));
  for (let i = 0; i < 3; i++) {
    rects.push({ kind: 'bag', idx: i, x: x0 + (i + 3) * (size + gap) + 12, y, size });
  }
  return rects;
}

// ---- перетаскивание предметов: клик/тап = быстрое действие (надеть/снять),
// drag = точное перемещение между слотами, отпустить за панелью = выбросить ----
let drag = null; // { item, from, sx, sy, x, y, moved, touchId }

function slotRectAt(x, y) {
  for (const r of slotRects()) {
    if (x >= r.x && x <= r.x + r.size && y >= r.y && y <= r.y + r.size) return r;
  }
  return null;
}
const slotItemAt = r => r.kind === 'equip' ? player.equip[r.slot] : player.bags[r.idx];
function setSlot(r, it) {
  if (r.kind === 'equip') player.equip[r.slot] = it;
  else player.bags[r.idx] = it;
}

// взять предмет из-под курсора/пальца; true — взяли (ввод поглощён панелью)
function beginSlotDrag(x, y, touchId) {
  if (state !== 'play' || !player || drag) return false;
  const r = slotRectAt(x, y);
  if (!r) return false;
  const it = slotItemAt(r);
  if (!it) return false; // пустой слот не поглощает ввод (движение/прицел важнее)
  setSlot(r, null);
  recalcStats();
  drag = { item: it, from: r, sx: x, sy: y, x, y, moved: false, touchId };
  return true;
}

function dragMove(x, y) {
  if (!drag) return;
  drag.x = x; drag.y = y;
  if (dist2(x, y, drag.sx, drag.sy) > 100) drag.moved = true;
}

// выбросить предмет на землю рядом с игроком (его можно поднять снова)
function discardItem(it) {
  let x = clamp(player.x + rand(-14, 14), 20, WORLD - 20);
  let y = clamp(player.y + 36, 20, WORLD - 20);
  // дроп не должен лечь за барьер: внутрь стены цитадели в финале,
  // наружу запечатанного центра до него — иначе он виден, но недостижим
  let dx = x - CX, dy = y - CY;
  if (dx === 0 && dy === 0) dy = 1;
  const dc = Math.hypot(dx, dy);
  if (finalActive && dc > R_CITADEL - 40) {
    const k = (R_CITADEL - 40) / dc;
    x = CX + dx * k; y = CY + dy * k;
  } else if (!finalActive && dc < R_ARENA + 40) {
    const k = (R_ARENA + 40) / dc;
    x = CX + dx * k; y = CY + dy * k;
  }
  drops.push({ x, y, type: 'item', item: it, noPick: 1.4 });
  banner = { text: 'Выброшено: ' + it.name, sub: '', t: 1.4, small: true };
  Music.sfx('hit');
}

function finishDrag(x, y) {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (state !== 'play' || !player) { setSlot(d.from, d.item); recalcStats(); return; }

  if (!d.moved) {
    // обычный клик/тап: снять в рюкзак или надеть из рюкзака
    if (d.from.kind === 'equip') {
      const free = player.bags.indexOf(null);
      if (free >= 0) {
        player.bags[free] = d.item;
        banner = { text: 'Снято: ' + d.item.name, sub: '', t: 1.4, small: true };
      } else {
        setSlot(d.from, d.item);
        banner = { text: 'Рюкзак полон — перетащите за панель, чтобы выбросить', sub: '', t: 1.8, small: true };
      }
    } else {
      const cur = player.equip[d.item.slot];
      player.equip[d.item.slot] = d.item;
      player.bags[d.from.idx] = cur || null;
      banner = { text: 'Надето: ' + d.item.name, sub: fmtItem(d.item), t: 2.2, small: true };
    }
    recalcStats();
    return;
  }

  const t = slotRectAt(x, y);
  if (!t) {
    // отпустили вне панели — выбросить на землю
    discardItem(d.item);
    recalcStats();
    return;
  }
  if (t.kind === 'equip') {
    if (d.item.slot !== t.slot) {
      setSlot(d.from, d.item);
      banner = { text: SLOT_NAMES[d.item.slot] + ' сюда не встаёт', sub: '', t: 1.4, small: true };
    } else {
      const disp = player.equip[t.slot];
      player.equip[t.slot] = d.item;
      if (disp) setSlot(d.from, disp); // источник пуст — обмен всегда корректен
      banner = { text: 'Надето: ' + d.item.name, sub: fmtItem(d.item), t: 2, small: true };
    }
  } else {
    const disp = player.bags[t.idx];
    player.bags[t.idx] = d.item;
    if (disp) {
      if (d.from.kind === 'bag' || disp.slot === d.from.slot) {
        setSlot(d.from, disp);
      } else {
        const free = player.bags.indexOf(null);
        if (free >= 0) player.bags[free] = disp;
        else { // некуда деть вытесненный предмет — откат всей операции
          player.bags[t.idx] = disp;
          setSlot(d.from, d.item);
          banner = { text: 'Нет места для обмена', sub: '', t: 1.4, small: true };
        }
      }
    }
  }
  recalcStats();
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
    const spd = player.speed * (player.slowT > 0 ? 0.55 : 1); // замедление от воды
    player.x = clamp(player.x + (mx / l) * mag * spd * dt, player.r, WORLD - player.r);
    player.y = clamp(player.y + (my / l) * mag * spd * dt, player.r, WORLD - player.r);
    player.moving = true;
    player.faceX = mx;
    player.walk += dt * 12; // фаза шага для анимации
  } else {
    player.moving = false;
    player.walk += dt * 3.5; // покачивание в покое
  }
  // барьер арены: снаружи — пока живы владыки, изнутри — во время финала;
  // в Зионе — стены города
  {
    let dcx = player.x - CX, dcy = player.y - CY;
    if (dcx === 0 && dcy === 0) dcy = 1; // вырожденный случай точного центра
    const dc = Math.hypot(dcx, dcy);
    if (inZion) {
      if (dc > R_ZION - player.r - 6) {
        const k = (R_ZION - player.r - 6) / dc;
        player.x = CX + dcx * k;
        player.y = CY + dcy * k;
      }
      // фонтан в центре лечит
      if (dc < 110) player.hp = Math.min(player.maxHp, player.hp + 14 * dt);
    } else if (!finalActive && dc < R_ARENA + player.r) {
      const k = (R_ARENA + player.r) / dc;
      player.x = CX + dcx * k;
      player.y = CY + dcy * k;
    } else if (finalActive && dc > R_CITADEL - player.r - 6) {
      const k = (R_CITADEL - player.r - 6) / dc;
      player.x = CX + dcx * k;
      player.y = CY + dcy * k;
    }
  }
  player.inv = Math.max(0, player.inv - dt);
  player.abilityT = Math.max(0, player.abilityT - dt);
  player.fireT -= dt;
  player.hp = Math.min(player.maxHp, player.hp + 1.3 * dt);

  // статус-эффекты: замедление и горение (в духе RotMG)
  player.slowT = Math.max(0, player.slowT - dt);
  if (player.burnT > 0) {
    player.burnT -= dt;
    player.hp -= 7 * dt; // огонь жжёт сквозь броню
    if (Math.random() < dt * 10) {
      particles.push({ x: player.x + rand(-10, 10), y: player.y + rand(-14, 4), vx: rand(-10, 10), vy: rand(-50, -25), life: 0.5, maxLife: 0.5, color: '#ff9838', r: rand(1.5, 3) });
    }
    if (player.hp <= 0 && state === 'play') {
      player.hp = 0.1;
      player.inv = 0;
      hurtPlayer(3); // смерть от горения через общий путь
    }
  }

  // спец-атаки боссов: телеграфы взрываются
  updateTelegraphs(dt);

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
      // atkRate уже включает зелья ловкости и предметы (recalcStats)
      player.fireT = 1 / player.atkRate;
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

    // до финала арена запечатана и для мобов; в финале мобы заперты в цитадели
    {
      let ecx = e.x - CX, ecy = e.y - CY;
      if (ecx === 0 && ecy === 0) ecy = 1;
      const edc = Math.hypot(ecx, ecy);
      if (!finalActive && edc < R_ARENA + e.r) {
        const k2 = (R_ARENA + e.r) / edc;
        e.x = CX + ecx * k2;
        e.y = CY + ecy * k2;
      } else if (finalActive && edc > R_CITADEL - e.r) {
        const k2 = (R_CITADEL - e.r) / edc;
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
    // Безумный Бог активен всегда: в цитадели разнос может превышать радиус активации
    if (d2b < 780 * 780 || b.key === 'madGod') {
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
  // после гибели Бога (bosses пуст) боевая музыка выключается, хоть finalActive ещё true
  Music.setBoss(!!engagedBoss || (finalActive && bosses.length > 0));

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
    gainXp(Math.round(e.k.xp * worldXpMul()));
    burst(e.x, e.y, 10, e.k.color);
    if (Math.random() < e.k.drop) drops.push({ x: e.x, y: e.y, type: 'hp' });
    enemies.splice(i, 1);
  }

  // смерть владык и Безумного Бога
  for (let i = bosses.length - 1; i >= 0; i--) {
    const b = bosses[i];
    if (b.hp > 0) continue;
    killCount++;
    gainXp(Math.round(b.def.xp * worldXpMul()));
    burst(b.x, b.y, 60, b.color);
    burst(b.x, b.y, 40, '#f4d47c');
    shake = Math.max(shake, 14);
    Music.sfx('explode');
    if (b.key === 'madGod') {
      bosses.splice(i, 1);
      if (state !== 'play') continue; // размен: смерть игрока в тот же кадр — мир не засчитывается
      // сумка с бронёй Безумного Бога + портал в следующий мир
      ebullets = [];
      telegraphs = []; // висящие зоны/лучи не должны рваться, пока игрок собирает лут
      // самый сложный босс — самый ценный дроп (минимум эпический)
      const godArmor = makeItem('armor', worldNum + 1, LORD_GENITIVE.madGod, Math.max(2, rollRarity(0.6)));
      godArmor.hp = 30 + 10 * worldNum;
      drops.push({ x: CX, y: CY + 80, type: 'item', item: godArmor, godBag: true });
      nextPortal = { x: CX, y: CY, charge: 0 };
      Music.setBoss(false);
      const godFame = 60 * worldNum;
      player.fame += godFame;
      banner = { text: 'Мир ' + worldNum + ' пройден!', sub: '+' + godFame + ' славы · заберите сумку и шагните в портал — дальше сильнее', t: 5 };
      continue;
    }
    // владыка: банка (ловкость или защита) + предмет своей стихии + лечение;
    // чем дальше мир — тем ценнее дроп
    drops.push({ x: b.x, y: b.y, type: Math.random() < 0.5 ? 'dex' : 'def' });
    drops.push({
      x: b.x + rand(-45, 45), y: b.y + rand(-45, 45),
      type: 'item',
      item: makeItem(SLOTS[Math.floor(rand(0, 3))], worldNum, LORD_GENITIVE[b.key], rollRarity(0.12 + 0.1 * (worldNum - 1))),
    });
    for (let j = 0; j < 2; j++) drops.push({ x: b.x + rand(-55, 55), y: b.y + rand(-55, 55), type: 'hp' });
    bosses.splice(i, 1);
    lordsLeft--;
    // очки славы за владыку
    const lordFame = 20 * worldNum;
    player.fame += lordFame;
    if (lordsLeft > 0) {
      banner = { text: b.name + ' повержен!', sub: '+' + lordFame + ' славы · осталось владык: ' + lordsLeft + ' из 5', t: 3 };
    } else {
      finalT = 4;
      banner = { text: 'Все владыки пали!', sub: '+' + lordFame + ' славы · Безумный Бог призывает всех в цитадель…', t: 4 };
    }
  }

  // портал из Зиона в мир (канал 1 с)
  if (inZion && zionPortal && state === 'play') {
    if (dist2(player.x, player.y, zionPortal.x, zionPortal.y) < 48 * 48) {
      zionPortal.charge += dt;
      if (zionPortal.charge >= 1) enterWorld();
    } else {
      zionPortal.charge = 0;
    }
  }

  // портал в следующий мир: «канал» — нужно постоять внутри 1.5 с,
  // чтобы не улететь в новый мир случайно (мимо сумки Безумного Бога)
  if (nextPortal && state === 'play') {
    if (dist2(player.x, player.y, nextPortal.x, nextPortal.y) < 42 * 42) {
      nextPortal.charge += dt;
      if (nextPortal.charge >= 1.5) nextWorld();
    } else {
      nextPortal.charge = 0;
    }
  }

  // финальный призыв: всех переносит в центральную арену
  if (finalT > 0 && state === 'play') {
    finalT -= dt;
    if (finalT <= 0) {
      finalActive = true;
      // отдельная локация: внешний мир остаётся позади
      player.x = CX;
      player.y = CY + R_CITADEL - 110;
      bullets = []; ebullets = []; enemies = []; telegraphs = [];
      player.slowT = 0; player.burnT = 0;
      // ценный несобранный лут (банки/предметы) переносится в цитадель к игроку
      const keep = drops.filter(d => d.type === 'dex' || d.type === 'def' || d.type === 'item');
      keep.forEach((d, ki) => {
        d.x = player.x + (ki - (keep.length - 1) / 2) * 44;
        d.y = player.y - 64;
      });
      drops = keep;
      lastZone = 'citadel';
      spawnMadGod();
      Music.sfx('teleport');
      burst(player.x, player.y, 24, '#f4d47c');
      banner = { text: 'Цитадель Безумного Бога', sub: 'Финальная битва! Из цитадели нет выхода', t: 3.2 };
    }
  }

  // пули врагов
  for (let i = ebullets.length - 1; i >= 0; i--) {
    const b = ebullets[i];
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    let dead = b.life <= 0 || b.x < -40 || b.x > WORLD + 40 || b.y < -40 || b.y > WORLD + 40;
    if (!dead && dist2(b.x, b.y, player.x, player.y) < (b.r + player.r) ** 2) {
      if (player.inv <= 0) { // статусы не вешаются во время неуязвимости
        if (b.slow) player.slowT = 1.4;
        if (b.burn) player.burnT = 2.4;
      }
      hurtPlayer(b.dmg);
      dead = true;
    }
    if (dead) ebullets.splice(i, 1);
  }

  // зелья и предметы на земле
  for (let i = drops.length - 1; i >= 0; i--) {
    const d = drops[i];
    if (d.noPick && d.noPick > 0) { d.noPick -= dt; continue; } // только что выброшен
    if (dist2(d.x, d.y, player.x, player.y) < 26 * 26) {
      if (d.type === 'dex') {
        player.dexPots++;
        recalcStats();
        Music.sfx('levelup');
        // не затирать сюжетный баннер («Все владыки пали!» и т.п.)
        if (!banner || banner.small) banner = { text: 'Ловкость! Скорость атаки +15%', sub: '', t: 1.5, small: true };
        burst(d.x, d.y, 12, '#f4d47c');
      } else if (d.type === 'def') {
        player.defPots++;
        recalcStats();
        Music.sfx('levelup');
        if (!banner || banner.small) banner = { text: 'Защита! Броня +2', sub: '', t: 1.5, small: true };
        burst(d.x, d.y, 12, '#9ab0c8');
      } else if (d.type === 'item') {
        if (drag) continue; // во время перетаскивания слот-источник логически занят — не подбирать
        if (!giveItem(d.item)) {
          // инвентарь полон — предмет остаётся лежать
          if (!banner) banner = { text: 'Инвентарь полон', sub: 'Снимите или замените предмет кликом по слотам внизу', t: 1.6, small: true };
          continue;
        }
        Music.sfx('levelup');
        burst(d.x, d.y, 18, SLOT_COLORS[d.item.slot]);
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
  } else if (z.key === 'zion' && Math.random() < dt * 8) {
    // брызги фонтана
    const fa = rand(0, TAU);
    particles.push({
      x: CX + Math.cos(fa) * rand(0, 40), y: CY + Math.sin(fa) * rand(0, 40) - 10,
      vx: rand(-25, 25), vy: rand(-70, -30),
      life: rand(0.4, 0.8), maxLife: 0.8,
      color: '#8accee', r: rand(1.5, 2.5),
    });
  } else if (z.key === 'citadel' && Math.random() < dt * 10) {
    particles.push({
      x: CX + rand(-R_CITADEL, R_CITADEL) * 0.9, y: CY + rand(-R_CITADEL, R_CITADEL) * 0.9,
      vx: rand(-8, 8), vy: rand(-40, -18),
      life: rand(0.8, 1.6), maxLife: 1.6,
      color: '#e8c05a', r: rand(1.5, 2.5),
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

  // ----- мирный город Зион: старт всех забегов -----
  if (inZion) {
    ctx.fillStyle = '#0a0d12';
    ctx.fillRect(cam.x - 60, cam.y - 60, W + 120, H + 120);
    // мостовая
    ctx.fillStyle = '#2a2620';
    ctx.beginPath(); ctx.arc(CX, CY, R_ZION, 0, TAU); ctx.fill();
    ctx.fillStyle = '#332e26';
    ctx.beginPath(); ctx.arc(CX, CY, R_ZION * 0.72, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(255,230,180,0.12)';
    ctx.lineWidth = 2;
    for (const rr of [0.35, 0.55, 0.72, 0.9]) {
      ctx.beginPath(); ctx.arc(CX, CY, R_ZION * rr, 0, TAU); ctx.stroke();
    }
    // стены города
    ctx.strokeStyle = '#8a7048';
    ctx.lineWidth = 10;
    ctx.beginPath(); ctx.arc(CX, CY, R_ZION, 0, TAU); ctx.stroke();
    // дома по кругу
    for (let i = 0; i < 6; i++) {
      const ha = Math.PI / 2 + 0.5 + (i / 6) * TAU;
      if (Math.abs(((ha - (-Math.PI / 2) + TAU) % TAU) - 0) < 0.6) continue; // не загораживать портал
      const hx = CX + Math.cos(ha) * R_ZION * 0.78, hy = CY + Math.sin(ha) * R_ZION * 0.78;
      ctx.fillStyle = '#4a3c2c';
      ctx.fillRect(hx - 42, hy - 30, 84, 60);
      ctx.fillStyle = '#6a4a30';
      ctx.beginPath();
      ctx.moveTo(hx - 50, hy - 30); ctx.lineTo(hx, hy - 64); ctx.lineTo(hx + 50, hy - 30);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffd88a';
      ctx.fillRect(hx - 10, hy - 8, 20, 24); // тёплое окно-дверь
    }
    // фонари
    for (let i = 0; i < 6; i++) {
      const la = (i / 6) * TAU + Math.PI / 6;
      const lx = CX + Math.cos(la) * R_ZION * 0.5, ly = CY + Math.sin(la) * R_ZION * 0.5;
      ctx.fillStyle = '#3a3228';
      ctx.fillRect(lx - 3, ly - 34, 6, 34);
      const lg = ctx.createRadialGradient(lx, ly - 40, 2, lx, ly - 40, 42);
      lg.addColorStop(0, 'rgba(255,214,120,0.55)');
      lg.addColorStop(1, 'rgba(255,214,120,0)');
      ctx.fillStyle = lg;
      ctx.beginPath(); ctx.arc(lx, ly - 40, 42, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ffd876';
      ctx.beginPath(); ctx.arc(lx, ly - 40, 6, 0, TAU); ctx.fill();
    }
    // фонтан (лечит)
    ctx.fillStyle = '#5a666e';
    ctx.beginPath(); ctx.arc(CX, CY, 84, 0, TAU); ctx.fill();
    ctx.fillStyle = '#3a7a9e';
    ctx.beginPath(); ctx.arc(CX, CY, 68, 0, TAU); ctx.fill();
    ctx.fillStyle = '#5aa8cc';
    ctx.beginPath(); ctx.arc(CX, CY, 68 * (0.8 + Math.sin(gameTime * 2) * 0.06), 0, TAU); ctx.fill();
    ctx.fillStyle = '#8accee';
    ctx.beginPath(); ctx.arc(CX, CY - 6, 16 + Math.sin(gameTime * 5) * 3, 0, TAU); ctx.fill();
    // доска славы (запад)
    const bx = CX - R_ZION * 0.62, by = CY;
    ctx.fillStyle = '#4a3c2c';
    ctx.fillRect(bx - 6, by - 60, 12, 120);
    ctx.fillStyle = '#2e2820';
    ctx.fillRect(bx - 84, by - 96, 168, 74);
    ctx.strokeStyle = '#8a7048';
    ctx.lineWidth = 3;
    ctx.strokeRect(bx - 84, by - 96, 168, 74);
    ctx.fillStyle = '#f4d47c';
    ctx.font = 'bold 15px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('ДОСКА СЛАВЫ', bx, by - 78);
    const top = loadRecords().slice(0, 3);
    ctx.font = '11px system-ui';
    ctx.fillStyle = '#cdd8e4';
    if (top.length) {
      top.forEach((r, i) => ctx.fillText(
        (i + 1) + '. ' + (r.name || 'Безымянный') + ' — ★' + (r.fame || 0) + ' (мир ' + (r.world || 1) + ')',
        bx, by - 56 + i * 16));
    } else {
      ctx.fillText('Пока пусто — впишите себя!', bx, by - 48);
    }
    // портал в мир (север)
    if (zionPortal) {
      const pr = 34 + Math.sin(gameTime * 4) * 4;
      const pg = ctx.createRadialGradient(zionPortal.x, zionPortal.y, 4, zionPortal.x, zionPortal.y, pr + 20);
      pg.addColorStop(0, 'rgba(200,240,255,0.95)');
      pg.addColorStop(0.6, 'rgba(90,168,232,0.55)');
      pg.addColorStop(1, 'rgba(90,168,232,0)');
      ctx.fillStyle = pg;
      ctx.beginPath(); ctx.arc(zionPortal.x, zionPortal.y, pr + 20, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#9fd0f0';
      ctx.lineWidth = 3;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(zionPortal.x, zionPortal.y, pr - i * 8, gameTime * (2 + i), gameTime * (2 + i) + 4.2);
        ctx.stroke();
      }
      if (zionPortal.charge > 0) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(zionPortal.x, zionPortal.y, pr + 28, -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, zionPortal.charge / 1));
        ctx.stroke();
      }
      ctx.fillStyle = '#cde8ff';
      ctx.font = 'bold 14px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('Портал: Мир ' + worldNum, zionPortal.x, zionPortal.y - pr - 30);
    }
    ctx.textAlign = 'left';
  } else
  // ----- отдельная локация финала: Цитадель Безумного Бога -----
  if (finalActive) {
    // пустота вокруг цитадели
    ctx.fillStyle = '#07050c';
    ctx.fillRect(cam.x - 60, cam.y - 60, W + 120, H + 120);
    // обсидиановый зал
    ctx.fillStyle = '#151020';
    ctx.beginPath(); ctx.arc(CX, CY, R_CITADEL, 0, TAU); ctx.fill();
    ctx.fillStyle = '#1c1428';
    ctx.beginPath(); ctx.arc(CX, CY, R_CITADEL * 0.55, 0, TAU); ctx.fill();
    // руны по кругу
    ctx.strokeStyle = 'rgba(232,192,90,0.4)';
    ctx.lineWidth = 2.5;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU + gameTime * 0.15;
      const rx = CX + Math.cos(a) * R_CITADEL * 0.8, ry = CY + Math.sin(a) * R_CITADEL * 0.8;
      ctx.beginPath();
      ctx.moveTo(rx, ry - 10); ctx.lineTo(rx + 7, ry); ctx.lineTo(rx, ry + 10); ctx.lineTo(rx - 7, ry);
      ctx.closePath(); ctx.stroke();
    }
    // стены цитадели
    ctx.strokeStyle = '#e8c05a';
    ctx.lineWidth = 12;
    ctx.beginPath(); ctx.arc(CX, CY, R_CITADEL, 0, TAU); ctx.stroke();
    ctx.strokeStyle = 'rgba(232,192,90,0.25)';
    ctx.lineWidth = 26;
    ctx.beginPath(); ctx.arc(CX, CY, R_CITADEL + 18, 0, TAU); ctx.stroke();
  } else {
  // ----- ландшафт: тайловая земля по зонам -----
  // тёмный фон за краем карты
  ctx.fillStyle = '#0a0d10';
  ctx.fillRect(cam.x - 40, cam.y - 40, W + 80, H + 80);
  // только видимые тайлы; шейд и деталь — от детерминированного хэша тайла
  const TS = 64;
  const tx0 = Math.max(0, Math.floor(cam.x / TS)), tx1 = Math.min(Math.floor((WORLD - 1) / TS), Math.floor((cam.x + W) / TS));
  const ty0 = Math.max(0, Math.floor(cam.y / TS)), ty1 = Math.min(Math.floor((WORLD - 1) / TS), Math.floor((cam.y + H) / TS));
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const wx = tx * TS, wy = ty * TS;
      const t = TILES[zoneAt(wx + TS / 2, wy + TS / 2).key] || TILES.forest;
      // перемешанный хэш (иначе младший бит даёт «шахматку» tx^ty)
      let h = (tx * 374761393 + ty * 668265263) >>> 0;
      h = ((h ^ (h >>> 13)) * 1274126177) >>> 0;
      ctx.fillStyle = t.shades[h % t.shades.length];
      ctx.fillRect(wx, wy, TS + 1, TS + 1); // +1 против швов при дробном сдвиге камеры
      if ((h & 255) / 255 < t.dchance) {
        ctx.fillStyle = t.detail;
        ctx.fillRect(wx + (h >> 8 & 55) + 4, wy + (h >> 14 & 55) + 4, 3, 3);
      }
    }
  }
  // мягкие границы колец
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 3;
  for (const r of [R_TITANS, R_LORDS]) {
    ctx.beginPath(); ctx.arc(CX, CY, r, 0, TAU); ctx.stroke();
  }
  // стена арены
  ctx.strokeStyle = finalActive ? '#e8c05a' : 'rgba(232,192,90,0.45)';
  ctx.lineWidth = 9;
  ctx.beginPath(); ctx.arc(CX, CY, R_ARENA, 0, TAU); ctx.stroke();
  // стены мира
  ctx.strokeStyle = '#33465c';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, WORLD - 6, WORLD - 6);

  // декорации (только видимые)
  for (const d of decor) {
    if (d.x < cam.x - 90 || d.x > cam.x + W + 90 || d.y < cam.y - 90 || d.y > cam.y + H + 90) continue;
    drawDecor(d);
  }
  } // конец обычного мира (else от цитадели)

  if (player) {
    // телеграфы спец-атак: красная зона/луч — успей выйти
    for (const tg of telegraphs) {
      const p = 1 - tg.t / tg.total;
      if (tg.kind === 'zone') {
        ctx.fillStyle = 'rgba(255,60,40,' + (0.08 + 0.2 * p).toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(tg.x, tg.y, tg.r, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(255,90,60,0.9)';
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(tg.x, tg.y, tg.r, 0, TAU); ctx.stroke();
        // сжимающееся кольцо-таймер
        ctx.strokeStyle = 'rgba(255,200,120,0.9)';
        ctx.beginPath(); ctx.arc(tg.x, tg.y, Math.max(2, tg.r * (1 - p)), 0, TAU); ctx.stroke();
      } else {
        ctx.save();
        ctx.translate(tg.x, tg.y);
        ctx.rotate(tg.ang);
        ctx.fillStyle = 'rgba(255,60,40,' + (0.1 + 0.22 * p).toFixed(3) + ')';
        ctx.fillRect(0, -14, tg.len, 28);
        ctx.strokeStyle = 'rgba(255,120,80,0.8)';
        ctx.lineWidth = 2;
        ctx.strokeRect(0, -14, tg.len, 28);
        ctx.restore();
      }
    }

    // портал в следующий мир
    if (nextPortal) {
      const pr = 30 + Math.sin(gameTime * 4) * 4;
      const pg = ctx.createRadialGradient(nextPortal.x, nextPortal.y, 4, nextPortal.x, nextPortal.y, pr + 18);
      pg.addColorStop(0, 'rgba(255,240,200,0.95)');
      pg.addColorStop(0.6, 'rgba(232,192,90,0.55)');
      pg.addColorStop(1, 'rgba(232,192,90,0)');
      ctx.fillStyle = pg;
      ctx.beginPath(); ctx.arc(nextPortal.x, nextPortal.y, pr + 18, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#f4d47c';
      ctx.lineWidth = 3;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(nextPortal.x, nextPortal.y, pr - i * 7, gameTime * (2 + i), gameTime * (2 + i) + 4.2);
        ctx.stroke();
      }
      // прогресс «канала» входа
      if (nextPortal.charge > 0) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(nextPortal.x, nextPortal.y, pr + 26, -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, nextPortal.charge / 1.5));
        ctx.stroke();
      }
    }

    // зелья и сумки с предметами
    for (const d of drops) {
      if (d.type === 'item') {
        // лут-бэг: цвет сумки — редкость (как в RotMG), сверху — иконка предмета
        const rar = RARITIES[d.item.rar || 0];
        const R = d.godBag ? 14 : 11;
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath(); ctx.ellipse(d.x, d.y + R - 2, R, 4, 0, 0, TAU); ctx.fill();
        const bob = Math.sin(gameTime * 4) * 2;
        if (d.item.rar >= 2) { // эпик и выше светятся
          const gl = ctx.createRadialGradient(d.x, d.y + bob, 2, d.x, d.y + bob, R + 12);
          gl.addColorStop(0, rar.color + 'aa');
          gl.addColorStop(1, rar.color + '00');
          ctx.fillStyle = gl;
          ctx.beginPath(); ctx.arc(d.x, d.y + bob, R + 12, 0, TAU); ctx.fill();
        }
        ctx.fillStyle = rar.bag;
        ctx.beginPath(); ctx.arc(d.x, d.y + bob, R, 0, TAU); ctx.fill();
        ctx.strokeStyle = rar.color;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(d.x, d.y + bob, R, 0, TAU); ctx.stroke();
        const iconKey = d.item.slot === 'weapon' ? 'iconWeapon' : d.item.slot === 'armor' ? 'iconArmor' : 'iconRing';
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(sprites[iconKey], Math.round(d.x - 9), Math.round(d.y - 9 + bob), 18, 18);
        ctx.imageSmoothingEnabled = true;
      } else if (d.type === 'def') {
        ctx.fillStyle = '#9ab0c8';
        ctx.beginPath(); ctx.arc(d.x, d.y, 9, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(d.x, d.y - 5); ctx.lineTo(d.x + 4, d.y - 2);
        ctx.lineTo(d.x + 4, d.y + 1); ctx.lineTo(d.x, d.y + 5);
        ctx.lineTo(d.x - 4, d.y + 1); ctx.lineTo(d.x - 4, d.y - 2);
        ctx.closePath(); ctx.stroke();
      } else if (d.type === 'dex') {
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
    // мягкий свет под игроком (цвет класса)
    const plg = ctx.createRadialGradient(player.x, player.y, 4, player.x, player.y, 48);
    plg.addColorStop(0, player.cls.color + '40');
    plg.addColorStop(1, player.cls.color + '00');
    ctx.fillStyle = plg;
    ctx.beginPath(); ctx.arc(player.x, player.y, 48, 0, TAU); ctx.fill();
    // тень
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(player.x, player.y + 16, 15, 6, 0, 0, TAU); ctx.fill();
    // спрайт: покачивание + squash/stretch + наклон в направлении бега
    const bob = Math.sin(player.walk) * (player.moving ? 3 : 1.5);
    const squash = 1 + Math.sin(player.walk * 2) * (player.moving ? 0.07 : 0.025);
    const lean = clamp(player.faceX, -1, 1) * (player.moving ? 0.14 : 0) * (0.6 + 0.4 * Math.sin(player.walk));
    ctx.save();
    ctx.translate(player.x, player.y - 8 + bob);
    ctx.rotate(lean);
    ctx.scale(1 / squash, squash);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sprites[player.cls.key], -22, -22, 44, 44);
    ctx.imageSmoothingEnabled = true;
    ctx.restore();
    // указатель прицела (направление автоатаки или мыши)
    const aim = player.aimDir !== undefined ? player.aimDir : aimAngle();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(player.x + Math.cos(aim) * (player.r + 3), player.y + Math.sin(aim) * (player.r + 3));
    ctx.lineTo(player.x + Math.cos(aim) * (player.r + 12), player.y + Math.sin(aim) * (player.r + 12));
    ctx.stroke();
    ctx.globalAlpha = 1;

    // свечение снарядов (аддитивный проход — эффект «блум»)
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.32;
    for (const b of bullets) {
      ctx.fillStyle = b.color;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 2.2, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 0.28;
    for (const b of ebullets) {
      ctx.fillStyle = b.color;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 1.9, 0, TAU); ctx.fill();
    }
    // частицы тоже светятся
    for (const p of particles) {
      ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1) * 0.7;
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 1.6, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // ядра снарядов
    for (const b of bullets) {
      ctx.fillStyle = b.color;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 0.45, 0, TAU); ctx.fill();
    }
    for (const b of ebullets) {
      ctx.fillStyle = b.color;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    // ядра частиц
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
  // живое покачивание + лёгкий squash
  const ph = gameTime * 5 + e.seed;
  const bob = Math.sin(ph) * 1.6;
  const squash = 1 + Math.sin(ph * 2) * 0.05;
  const flip = SPRITES[e.kind].flip && player.x < e.x ? -1 : 1;
  ctx.save();
  ctx.translate(e.x, e.y - size * 0.12 + bob);
  ctx.scale(flip / squash, squash);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(spr, -size / 2, -size / 2, size, size);
  ctx.imageSmoothingEnabled = true;
  ctx.restore();
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
  // ореол света стихии (аддитивный)
  ctx.globalCompositeOperation = 'lighter';
  const bg = ctx.createRadialGradient(b.x, b.y, 6, b.x, b.y, b.r * 2.4);
  bg.addColorStop(0, b.color + '55');
  bg.addColorStop(1, b.color + '00');
  ctx.fillStyle = bg;
  ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 2.4, 0, TAU); ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
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
  const fw = w * clamp(frac, 0, 1);
  ctx.fillStyle = fg;
  ctx.fillRect(x, y, fw, h);
  // глянец сверху
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(x, y, fw, Math.max(2, h * 0.4));
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
  ctx.fillText(player.cls.name + ' · ур. ' + player.level, 18, 66);

  // умение
  const cd = player.abilityT;
  bar(18, 80, bw, 12, 1 - cd / player.cls.abilityCd, cd > 0 ? '#5a8fd8' : '#7ac74f', 'rgba(0,0,0,0.55)');
  ctx.fillStyle = '#9fb0c3';
  ctx.font = '11px system-ui';
  ctx.fillText(player.cls.abilityName + (cd > 0 ? ' · ' + cd.toFixed(1) + 'с' : ' — готово [Space]'), 18, 102);

  // характеристики: на них влияют уровень, банки и надетые предметы
  ctx.fillStyle = '#8a9cb0';
  ctx.font = '11px system-ui';
  ctx.fillText(
    'Урон ' + Math.round(player.dmg)
    + ' · Броня ' + player.armor
    + ' · Скор. ' + Math.round(player.speed)
    + ' · Атака ' + player.atkRate.toFixed(1) + '/с', 18, 120);

  // статус-эффекты
  if (player.burnT > 0 || player.slowT > 0) {
    ctx.font = 'bold 11px system-ui';
    let chipX = 18;
    if (player.burnT > 0) { ctx.fillStyle = '#ff9838'; ctx.fillText('▲ Горение', chipX, 138); chipX += 78; }
    if (player.slowT > 0) { ctx.fillStyle = '#4ecdc4'; ctx.fillText('❄ Замедление', chipX, 138); }
  }

  // квест-стрелка к ближайшему боссу (как в RotMG)
  if (!finalActive && bosses.length && state === 'play') {
    let target = null, best = Infinity;
    for (const b of bosses) {
      const d2b = dist2(b.x, b.y, player.x, player.y);
      if (d2b < best) { best = d2b; target = b; }
    }
    const dq = Math.sqrt(best);
    if (target && dq > 760) {
      const qa = Math.atan2(target.y - player.y, target.x - player.x);
      const qr = Math.min(W, H) * 0.34;
      const qx = W / 2 + Math.cos(qa) * qr;
      const qy = H / 2 + Math.sin(qa) * qr;
      ctx.save();
      ctx.translate(qx, qy);
      ctx.rotate(qa);
      ctx.globalAlpha = 0.55 + Math.sin(gameTime * 5) * 0.2;
      ctx.fillStyle = target.color;
      ctx.beginPath();
      ctx.moveTo(16, 0); ctx.lineTo(-9, -10); ctx.lineTo(-3, 0); ctx.lineTo(-9, 10);
      ctx.closePath(); ctx.fill();
      ctx.restore();
      ctx.globalAlpha = 1;
      ctx.textAlign = 'center';
      ctx.fillStyle = target.color;
      ctx.font = 'bold 11px system-ui';
      ctx.fillText(target.name, W / 2 + Math.cos(qa) * (qr - 34), H / 2 + Math.sin(qa) * (qr - 34));
    }
  }

  // правый блок: мир, владыки, зона, звук, время + миникарта
  ctx.textAlign = 'right';
  ctx.fillStyle = '#f4d47c';
  ctx.font = 'bold 13px system-ui';
  ctx.fillText('⭐ ' + player.fame + ' · Мир ' + worldNum
    + (inZion ? '' : finalActive ? ' · Финальная битва!' : ' · Владык: ' + lordsLeft + ' / 5'), W - 18, 24);
  ctx.fillStyle = '#9fb0c3';
  ctx.font = '12px system-ui';
  ctx.fillText(zoneAt(player.x, player.y).name, W - 18, 44);
  ctx.fillStyle = '#66788e';
  ctx.font = '11px system-ui';
  ctx.fillText('M · звук: ' + (Music.isMuted() ? 'выкл' : 'вкл') + ' · ' + fmtTime(runTime), W - 18, 64);
  if (!finalActive && !inZion) drawMinimap(); // в Цитадели и Зионе карта мира не нужна

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

  // панель экипировки: 3 слота (оружие/панцирь/амулет) + рюкзак на 3 места
  ctx.textAlign = 'center';
  for (const r of slotRects()) {
    const it = r.kind === 'equip' ? player.equip[r.slot] : player.bags[r.idx];
    ctx.fillStyle = 'rgba(10,14,20,0.78)';
    ctx.fillRect(r.x, r.y, r.size, r.size);
    // рамка: цвет редкости предмета, тип слота — по иконке
    ctx.strokeStyle = it ? RARITIES[it.rar || 0].color
      : r.kind === 'equip' ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.18)';
    ctx.lineWidth = it && (it.rar || 0) >= 2 ? 2.5 : 2;
    ctx.strokeRect(r.x + 1, r.y + 1, r.size - 2, r.size - 2);
    const cx2 = r.x + r.size / 2, cy2 = r.y + r.size / 2;
    if (it) {
      const iconKey = it.slot === 'weapon' ? 'iconWeapon' : it.slot === 'armor' ? 'iconArmor' : 'iconRing';
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(sprites[iconKey], Math.round(cx2 - 15), Math.round(cy2 - 16), 30, 30);
      ctx.imageSmoothingEnabled = true;
      ctx.fillStyle = RARITIES[it.rar || 0].color;
      ctx.font = 'bold 9px system-ui';
      ctx.textAlign = 'right';
      ctx.fillText('T' + it.tier, r.x + r.size - 3, r.y + r.size - 7);
      ctx.textAlign = 'center';
    } else if (r.kind === 'equip') {
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.font = 'bold 15px system-ui';
      ctx.fillText(SLOT_GLYPHS[r.slot], cx2, cy2 + 1);
    }
  }
  ctx.fillStyle = '#66788e';
  ctx.font = '10px system-ui';
  ctx.textAlign = 'left';
  const sr = slotRects();
  ctx.fillText('экипировка', sr[0].x + 2, sr[0].y - 9);
  ctx.fillText('рюкзак · тащи между слотами, за панель — выбросить', sr[3].x + 2, sr[3].y - 9);

  // предмет «в руке» при перетаскивании
  if (drag) {
    if (drag.moved) {
      // подсветка подходящих целей
      ctx.lineWidth = 2.5;
      for (const r of sr) {
        const fits = r.kind === 'bag' || r.slot === drag.item.slot;
        if (!fits) continue;
        ctx.strokeStyle = 'rgba(122,199,79,0.85)';
        ctx.strokeRect(r.x - 2, r.y - 2, r.size + 4, r.size + 4);
      }
      const overPanel = !!slotRectAt(drag.x, drag.y);
      ctx.textAlign = 'center';
      ctx.fillStyle = overPanel ? '#9fb0c3' : '#e86a5e';
      ctx.font = 'bold 12px system-ui';
      ctx.fillText(overPanel ? drag.item.name : 'Отпустите — выбросить: ' + drag.item.name, drag.x, drag.y - 30);
    }
    const dIconKey = drag.item.slot === 'weapon' ? 'iconWeapon' : drag.item.slot === 'armor' ? 'iconArmor' : 'iconRing';
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sprites[dIconKey], Math.round(drag.x - 17), Math.round(drag.y - 17), 34, 34);
    ctx.imageSmoothingEnabled = true;
    ctx.fillStyle = RARITIES[drag.item.rar || 0].color;
    ctx.font = 'bold 10px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('T' + drag.item.tier, drag.x + 14, drag.y + 14);
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
