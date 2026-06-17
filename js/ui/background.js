window.CG = window.CG || {};

/* ===========================================================================
 *  动态背景 —— 全屏 canvas 上漂浮的余烬/尘埃，配合 CSS 的缓慢流动星云。
 *  自包含、无图片资源；标签页隐藏时自动暂停。
 * ===========================================================================
 */
(function (CG) {
  let canvas, ctx, particles = [], raf = null, w = 0, h = 0;

  function resize() { w = canvas.width = innerWidth; h = canvas.height = innerHeight; }
  function spawn(atTop) {
    return {
      x: Math.random() * w,
      y: atTop ? Math.random() * h : h + Math.random() * 40,
      r: 0.6 + Math.random() * 2.4,
      spd: 0.15 + Math.random() * 0.6,
      sway: Math.random() * Math.PI * 2,
      a: 0.08 + Math.random() * 0.4,
      hue: 36 + Math.random() * 16,            // 金/琥珀色
    };
  }
  function frame() {
    ctx.clearRect(0, 0, w, h);
    for (const p of particles) {
      p.y -= p.spd;
      p.sway += 0.012;
      p.x += Math.sin(p.sway) * 0.3;
      if (p.y < -12) Object.assign(p, spawn(false));
      ctx.beginPath();
      ctx.fillStyle = `hsla(${p.hue},85%,62%,${p.a})`;
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    raf = requestAnimationFrame(frame);
  }
  function start() { if (!raf) raf = requestAnimationFrame(frame); }
  function stop() { if (raf) { cancelAnimationFrame(raf); raf = null; } }

  function init() {
    canvas = document.getElementById('bg-canvas');
    if (!canvas || typeof canvas.getContext !== 'function') return;   // 非浏览器环境直接跳过
    ctx = canvas.getContext('2d');
    if (!ctx) return;
    resize();
    addEventListener('resize', resize);
    const N = Math.max(28, Math.min(80, Math.floor(w * h / 20000)));
    particles = Array.from({ length: N }, () => spawn(true));
    document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
    start();
  }

  // 场景背景：根据当前界面/层数切换 #scene-bg 的全屏立绘（粒子与星云仍叠在其上）。
  let curScene = null;
  function setScene(key) {
    const el = document.getElementById('scene-bg');
    if (!el || key === curScene) return;
    curScene = key;
    if (!key) { el.classList.remove('show'); el.style.backgroundImage = ''; return; }
    el.style.backgroundImage = `url("assets/bg/${key}.png?v=17")`;
    el.classList.add('show');
  }

  CG.Background = { init, setScene };
})(window.CG);
