window.CG = window.CG || {};

/* ===========================================================================
 *  战斗音效 —— 用 Web Audio 即时合成，无需音频文件，可在 file:// 直接运行。
 * ===========================================================================
 *  浏览器要求音频在用户手势后才能出声：AudioContext 在首次点击时创建/恢复。
 *  想加新音效：在 SFX 里加一个函数，再在界面相应处 CG.Audio.play('名字')。
 *  全局静音状态存 localStorage。
 * ===========================================================================
 */
(function (CG) {
  let ctx = null, master = null;
  let muted = false;
  try { muted = localStorage.getItem('cg_muted') === '1'; } catch (e) {}

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.32;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // 带衰减包络的振荡器音
  function tone(o) {
    const c = ensure(); if (!c) return;
    const t = c.currentTime + (o.when || 0);
    const osc = c.createOscillator(), g = c.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.freqTo) osc.frequency.exponentialRampToValueAtTime(o.freqTo, t + o.dur);
    const peak = o.gain == null ? 0.25 : o.gain;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + (o.attack || 0.005));
    g.gain.exponentialRampToValueAtTime(0.0006, t + o.dur);
    osc.connect(g); g.connect(master);
    osc.start(t); osc.stop(t + o.dur + 0.03);
  }

  // 经滤波的噪声（打击/挥击/格挡的质感）
  function noise(o) {
    const c = ensure(); if (!c) return;
    const t = c.currentTime + (o.when || 0);
    const len = Math.max(1, Math.floor(c.sampleRate * o.dur));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource(); src.buffer = buf;
    const filt = c.createBiquadFilter();
    filt.type = o.filter || 'lowpass'; filt.frequency.value = o.freq || 1500; filt.Q.value = o.q || 0.7;
    const g = c.createGain();
    g.gain.setValueAtTime(o.gain == null ? 0.2 : o.gain, t);
    g.gain.exponentialRampToValueAtTime(0.0006, t + o.dur);
    src.connect(filt); filt.connect(g); g.connect(master);
    src.start(t); src.stop(t + o.dur + 0.03);
  }

  const SFX = {
    swing()   { noise({ dur: 0.12, gain: 0.15, filter: 'bandpass', freq: 1400, q: 0.9 }); },
    hit(side) {                                            // 玩家受击更低沉，敌人受击更脆
      const base = side === 'player' ? 84 : 120;
      tone({ freq: base, freqTo: base * 0.5, type: 'sine', dur: 0.2, gain: 0.34 });
      noise({ dur: 0.12, gain: 0.22, filter: 'lowpass', freq: 1900 });
    },
    block()   {
      tone({ freq: 520, type: 'triangle', dur: 0.1, gain: 0.2 });
      tone({ freq: 760, type: 'triangle', dur: 0.12, gain: 0.15, when: 0.025 });
      noise({ dur: 0.05, gain: 0.1, filter: 'highpass', freq: 3500 });
    },
    card()    { noise({ dur: 0.16, gain: 0.12, filter: 'bandpass', freq: 2400, q: 0.5 }); },
    select()  { tone({ freq: 440, freqTo: 680, type: 'sine', dur: 0.09, gain: 0.16 }); },
    coin()    {
      tone({ freq: 1318, type: 'square', dur: 0.08, gain: 0.12 });
      tone({ freq: 1760, type: 'square', dur: 0.1, gain: 0.1, when: 0.05 });
    },
    heal()    { [523, 659, 784].forEach((f, i) => tone({ freq: f, type: 'sine', dur: 0.26, gain: 0.16, when: i * 0.07 })); },
    upgrade() {
      tone({ freq: 600, type: 'triangle', dur: 0.12, gain: 0.18 });
      tone({ freq: 940, type: 'triangle', dur: 0.18, gain: 0.16, when: 0.08 });
      noise({ dur: 0.05, gain: 0.08, filter: 'highpass', freq: 4500, when: 0.08 });
    },
    winSting() {                                           // 普通战斗胜利的短提示
      tone({ freq: 660, type: 'triangle', dur: 0.12, gain: 0.2 });
      tone({ freq: 990, type: 'triangle', dur: 0.2, gain: 0.18, when: 0.1 });
    },
    victory() { [523, 659, 784, 1046].forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.32, gain: 0.2, when: i * 0.12 })); },
    defeat()  { [392, 330, 262, 196].forEach((f, i) => tone({ freq: f, type: 'sine', dur: 0.45, gain: 0.2, when: i * 0.14 })); },
  };

  CG.Audio = {
    play(name, arg) { if (muted) return; const fn = SFX[name]; if (fn) { try { fn(arg); } catch (e) {} } },
    isMuted() { return muted; },
    toggle() {
      muted = !muted;
      try { localStorage.setItem('cg_muted', muted ? '1' : '0'); } catch (e) {}
      if (!muted) ensure();
      return muted;
    },
  };
})(window.CG);
