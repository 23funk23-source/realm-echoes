'use strict';

// Генеративный музыкальный движок + SFX. Ноль аудиофайлов — весь звук синтезируется.
// API: Music.ensure() (по клику), Music.setBoss(bool), Music.sfx(name), Music.toggleMute(), Music.isMuted()
const Music = (() => {
  let ac = null, master = null, wet = null;
  let started = false, muted = false, boss = false;
  let timer = null, step = 0, stepDur = 0.225;

  const VOLUME = 0.7;
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
  // Am — F — C — G
  const CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
  // Индексы нот аккорда (с октавами), -1 = пауза
  const PATTERN = [0, 2, 1, 3, 2, 4, -1, 3, 0, 2, 1, 4, 3, 5, 2, -1];

  function impulse(dur, decay) {
    const rate = ac.sampleRate, len = Math.floor(rate * dur);
    const buf = ac.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  function init() {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    master = ac.createGain();
    master.gain.value = muted ? 0 : VOLUME;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 4200;
    master.connect(lp);
    lp.connect(ac.destination);
    const conv = ac.createConvolver();
    conv.buffer = impulse(2.2, 2.5);
    wet = ac.createGain();
    wet.gain.value = 0.3;
    wet.connect(conv);
    conv.connect(master);
  }

  function tone({ freq, t, dur, type = 'sine', vol = 0.1, attack = 0.008, reverb = true }) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(master);
    if (reverb) g.connect(wet);
    o.start(t);
    o.stop(t + dur + 0.1);
  }

  function noise(t, dur, vol, freqCut) {
    const src = ac.createBufferSource();
    src.buffer = impulse(dur, 2);
    const g = ac.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const f = ac.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = freqCut;
    src.connect(f); f.connect(g); g.connect(master); g.connect(wet);
    src.start(t);
  }

  function scheduleStep() {
    const t = ac.currentTime + 0.06;
    const chord = CHORDS[Math.floor(step / 16) % CHORDS.length];

    if (step % 16 === 0) {
      // Пад: аккорд с медленной атакой + низкий бурдон
      const padDur = 16 * stepDur + 1.4;
      chord.forEach(m => tone({ freq: mtof(m + 12), t, dur: padDur, type: 'sine', vol: 0.05, attack: 1.4 }));
      tone({ freq: mtof(chord[0] - 12), t, dur: padDur, type: 'triangle', vol: 0.055, attack: 1.2 });
    }

    const pi = PATTERN[step % PATTERN.length];
    if (pi >= 0) {
      const m = chord[pi % chord.length] + 12 * (1 + Math.floor(pi / chord.length));
      tone({ freq: mtof(m + 12), t, dur: 0.5, type: 'triangle', vol: boss ? 0.085 : 0.065, attack: 0.005 });
    }

    if (boss && step % 4 === 0) {
      tone({ freq: mtof(chord[0] - 12), t, dur: 0.26, type: 'sawtooth', vol: 0.045, attack: 0.004, reverb: false });
    }

    step++;
  }

  function startLoop() {
    if (timer) clearInterval(timer);
    stepDur = boss ? 0.165 : 0.225;
    timer = setInterval(scheduleStep, stepDur * 1000);
  }

  function ensure() {
    if (!started) {
      init();
      started = true;
      startLoop();
    }
    if (ac.state === 'suspended') ac.resume();
  }

  function setBoss(b) {
    if (boss === b) return;
    boss = b;
    if (started) {
      step = Math.ceil(step / 16) * 16; // начать с границы такта — без гармонического скачка
      startLoop();
    }
  }

  function toggleMute() {
    muted = !muted;
    if (master) master.gain.value = muted ? 0 : VOLUME;
    return muted;
  }

  function sfx(name) {
    if (!started || muted) return;
    const t = ac.currentTime;
    switch (name) {
      case 'shoot':
        tone({ freq: 480 + Math.random() * 80, t, dur: 0.06, type: 'square', vol: 0.016, reverb: false });
        break;
      case 'hit':
        tone({ freq: 290, t, dur: 0.05, type: 'triangle', vol: 0.02, reverb: false });
        break;
      case 'hurt':
        tone({ freq: 140, t, dur: 0.2, type: 'sawtooth', vol: 0.07, reverb: false });
        tone({ freq: 95, t: t + 0.03, dur: 0.18, type: 'sawtooth', vol: 0.05, reverb: false });
        break;
      case 'pickup':
        tone({ freq: 660, t, dur: 0.1, type: 'sine', vol: 0.06 });
        tone({ freq: 880, t: t + 0.08, dur: 0.12, type: 'sine', vol: 0.06 });
        break;
      case 'levelup':
        [523, 659, 784, 1047].forEach((f, i) =>
          tone({ freq: f, t: t + i * 0.09, dur: 0.22, type: 'triangle', vol: 0.07 }));
        break;
      case 'ability':
        tone({ freq: 220, t, dur: 0.18, type: 'square', vol: 0.045 });
        tone({ freq: 330, t: t + 0.05, dur: 0.16, type: 'square', vol: 0.04 });
        break;
      case 'explode':
        noise(t, 0.5, 0.22, 700);
        tone({ freq: 62, t, dur: 0.5, type: 'sawtooth', vol: 0.1, reverb: false });
        break;
      case 'teleport':
        tone({ freq: 900, t, dur: 0.14, type: 'sine', vol: 0.05 });
        tone({ freq: 450, t: t + 0.06, dur: 0.16, type: 'sine', vol: 0.05 });
        break;
    }
  }

  return { ensure, setBoss, toggleMute, sfx, isMuted: () => muted };
})();
