/* ============================================================
 * game.js —— 检测游戏核心：试次状态机 + Canvas 驾驶场景渲染
 *
 * 试次流水线（心理学实验标准流程）：
 *   注视点(600ms) → 刺激闪现(700~950ms，限时) → 视觉掩蔽(200ms)
 *   → 等待作答(F/J 或按钮) → 即时反馈（击中/漏报/误报/正确拒斥，约1.1秒）
 *   → 记录 H/M/FA/CR → 下一试次
 *
 * 生成模型（SDT）：
 *   每试次先按先验概率 P(S)=0.3 抽签决定"有没有行人"，
 *   再从 N(0,1) 或 N(d',1) 采样一个"证据值"，
 *   映射为画面中目标物的清晰度——d' 越小，有/无行人的画面越像。
 * ============================================================ */
const Game = (function () {
  'use strict';

  /* 画布逻辑尺寸与地平线位置 */
  const W = 880, H = 430, HOR = 175;

  const TRIALS = 24;    // 每局试次数（≥20，满足作业要求）
  const P_SIGNAL = 0.3; // 先验概率 P(S)：深夜园区行人稀少

  let cv, ctx;          // 画布与绘图上下文
  let st = null;        // 本局状态
  let timers = [];      // 所有延时器（便于中止时清理）
  let stars = null;     // 星星坐标缓存

  /* ---------- 工具 ---------- */
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function later(fn, ms) { timers.push(setTimeout(fn, ms)); }
  function clearTimers() { timers.forEach(clearTimeout); timers = []; }
  function stopRaf() { if (st && st.rafId) cancelAnimationFrame(st.rafId); }

  /* HiDPI 高清渲染：按设备像素比放大画布位图，再用变换矩阵保持逻辑坐标不变
   * 原理：Retina 屏一个 CSS 像素对应 2×2 物理像素，直接按 CSS 尺寸创建位图会模糊；
   *       放大位图后文字与线条才能真正清晰 */
  function setupCanvas(canvas, w, h) {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const c2 = canvas.getContext('2d');
    c2.setTransform(dpr, 0, 0, dpr, 0, 0);
    return c2;
  }

  /* 把"深度(0远~1近)+横向位置(-1~1)"投影到屏幕坐标与缩放 */
  function project(lat, depth) {
    const y = HOR + depth * (H - 26 - HOR);
    const halfW = 22 + depth * 368;             // 路面在该深度处的半宽
    const s = 0.32 + depth * 1.15;              // 透视缩放
    return { x: W / 2 + lat * halfW, y: y, s: s };
  }

  /* ---------- 初始化：绑定按钮与键盘 ---------- */
  function init() {
    cv = document.getElementById('gameCanvas');
    ctx = setupCanvas(cv, W, H);
    document.getElementById('btnYes').addEventListener('click', function () { answer(true); });
    document.getElementById('btnNo').addEventListener('click', function () { answer(false); });
    document.getElementById('btnQuit').addEventListener('click', quit);
    document.addEventListener('keydown', function (e) {
      if (!st || st.phase !== 'response') return;
      if (e.key === 'f' || e.key === 'F') answer(true);   // F = 有行人
      if (e.key === 'j' || e.key === 'J') answer(false);  // J = 无行人
    });
  }

  /* ---------- 开始一局 ----------
   * config 由 main.js 根据预设天气或自定义滑块生成：
   * { key, name, dprime, fog(0~0.5), rain(0~1), stars(bool) } */
  function start(config) {
    clearTimers();
    st = { conf: config, idx: 0, H: 0, M: 0, FA: 0, CR: 0,
           phase: 'idle', rafId: null, trial: null };
    stars = null;
    Main.show('screen-game');
    Sound.hum(true);
    updateHUD();
    nextTrial();
  }

  /* 中止测试（不保存成绩） */
  function quit() {
    clearTimers(); stopRaf();
    st = null;
    Sound.hum(false);
    setButtons(false);
    Main.show('screen-briefing');
  }

  /* ---------- 生成一个试次 ---------- */
  function makeTrial() {
    const hasSignal = Math.random() < P_SIGNAL;               // 先验抽签
    const ev = SDT.randNormal(hasSignal ? st.conf.dprime : 0, 1); // 证据采样
    const alpha = clamp(0.32 + 0.20 * ev, 0.08, 0.95);        // 证据→目标清晰度
    // 每试次只有一个"候选目标"：有信号时是行人剪影，无信号时是形似干扰物
    const candidate = {
      kind: hasSignal ? 'ped' : pick(['bag', 'bin', 'sign']),
      lat: (Math.random() * 2 - 1) * 0.72,
      depth: 0.38 + Math.random() * 0.52,
      alpha: alpha,
      seed: Math.random() * 1000
    };
    // 环境杂物：固定低透明度，营造场景但不携带信号
    const clutter = [];
    const n = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      clutter.push({
        type: pick(['bush', 'bin', 'post']),
        lat: (Math.random() < 0.5 ? -1 : 1) * (0.95 + Math.random() * 0.25),
        depth: 0.12 + Math.random() * 0.8,
        alpha: 0.10 + Math.random() * 0.15,
        seed: Math.random() * 1000
      });
    }
    return { hasSignal: hasSignal, candidate: candidate, clutter: clutter,
             stimDur: 700 + Math.random() * 250 };
  }

  /* ---------- 试次状态机 ---------- */
  function nextTrial() {
    if (st.idx >= TRIALS) { finish(); return; }
    st.trial = makeTrial();
    st.phase = 'fixation';
    updateHUD();
    drawFixation();
    later(function () {
      if (!st || st.phase !== 'fixation') return;
      st.phase = 'stimulus';
      st.animStart = performance.now();
      animate();
    }, 600);
  }

  /* 刺激呈现：逐帧动画，到时后切掩蔽 */
  function animate() {
    if (!st || st.phase !== 'stimulus') return;
    const t = (performance.now() - st.animStart) / 1000;
    drawScene(t);
    if (t * 1000 >= st.trial.stimDur) {
      st.phase = 'mask';
      drawMask();                       // 视觉后掩蔽：消除视觉残留
      later(function () {
        if (!st || st.phase !== 'mask') return;
        st.phase = 'response';
        drawResponse();
        setButtons(true);
      }, 200);
      return;
    }
    st.rafId = requestAnimationFrame(animate);
  }

  /* 作答：判定结果类型并立即给出反馈 */
  function answer(said) {
    if (!st || st.phase !== 'response') return;
    setButtons(false);
    const sig = st.trial.hasSignal;
    let outcome;
    if (sig && said)        { st.H++;  outcome = 'H';  }  // 击中：有行人，报警
    else if (sig && !said)  { st.M++;  outcome = 'M';  }  // 漏报：有行人，没报警
    else if (!sig && said)  { st.FA++; outcome = 'FA'; }  // 误报：没行人，报警（幽灵刹车）
    else                    { st.CR++; outcome = 'CR'; }  // 正确拒斥
    st.idx++;
    Sound.tick();
    updateHUD();
    st.phase = 'gap';
    drawFeedback(outcome);              // 即时反馈：本次判断属于哪一类
    later(nextTrial, 1100);             // 反馈停留约 1.1 秒后进入下一试次
  }

  /* 一局结束：计算指标、存档、出报告 */
  function finish() {
    st.phase = 'done';
    Sound.hum(false);
    const m = SDT.compute(st.H, st.M, st.FA, st.CR);
    const rec = {
      ts: Date.now(),
      weather: st.conf.key, weatherName: st.conf.name, envD: st.conf.dprime,
      trials: TRIALS,
      H: m.H, M: m.M, FA: m.FA, CR: m.CR, N: m.N,
      pHit: m.pHit, pFA: m.pFA, dprime: m.dprime, criterion: m.criterion,
      beta: m.beta, accuracy: m.accuracy
    };
    Store.save(rec);
    Main.showResults(rec);
  }

  /* ---------- HUD ---------- */
  function updateHUD() {
    document.getElementById('hudWeather').textContent =
      st.conf.name + ' · d\' = ' + st.conf.dprime.toFixed(1);
    document.getElementById('hudTrial').textContent =
      'TRIAL ' + String(Math.min(st.idx + 1, TRIALS)).padStart(2, '0') + ' / ' + TRIALS;
    document.getElementById('hudHit').textContent = st.H;
    document.getElementById('hudFA').textContent = st.FA;
  }

  function setButtons(enabled) {
    document.getElementById('btnYes').disabled = !enabled;
    document.getElementById('btnNo').disabled = !enabled;
  }

  /* ============================================================
   * 以下是 Canvas 绘制：夜间驾驶第一人称视角
   * ============================================================ */

  /* 注视点画面 */
  function drawFixation() {
    ctx.fillStyle = '#050810';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(W / 2 - 13, H / 2); ctx.lineTo(W / 2 + 13, H / 2);
    ctx.moveTo(W / 2, H / 2 - 13); ctx.lineTo(W / 2, H / 2 + 13);
    ctx.stroke();
    ctx.fillStyle = '#4a5876';
    ctx.font = '14px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('注视屏幕中央 · 画面即将闪现', W / 2, H / 2 + 48);
  }

  /* 掩蔽噪点 */
  function drawMask() {
    ctx.fillStyle = '#050810';
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 2600; i++) {
      const g = Math.floor(Math.random() * 200);
      ctx.fillStyle = 'rgba(' + g + ',' + (g + 10) + ',' + (g + 25) + ',' + (0.15 + Math.random() * 0.4) + ')';
      ctx.fillRect(Math.random() * W, Math.random() * H, 2, 2);
    }
  }

  /* 作答提示画面 */
  function drawResponse() {
    ctx.fillStyle = '#050810';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#1a2540';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(W / 2 - 290, H / 2 - 80, 580, 160);
    ctx.fillStyle = '#fbbf24';
    ctx.font = '700 25px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('回放结束 —— 刚才画面里有没有行人？', W / 2, H / 2 - 12);
    ctx.fillStyle = '#8b99b5';
    ctx.font = '15.5px ui-monospace, Consolas, monospace';
    ctx.fillText('[ F ] 有行人 · 制动        [ J ] 无行人 · 通过', W / 2, H / 2 + 36);
  }

  /* 作答即时反馈：直接告诉玩家这一判断是 击中/漏报/误报/正确拒斥 */
  function drawFeedback(outcome) {
    ctx.fillStyle = '#050810';
    ctx.fillRect(0, 0, W, H);

    /* 四类结果：标题、副标题（场景化解释）、主题色 */
    const INFO = {
      H:  { tag: '✓ 击中 HIT',          sub: '正确！画面里确实有行人——车辆已制动，避免事故', color: '#34d399' },
      M:  { tag: '✗ 漏报 MISS',         sub: '有行人但你放行了——这是最危险的一类错误！',       color: '#f87171' },
      FA: { tag: '✗ 误报 FA',           sub: '画面里其实没有行人——幽灵刹车，后车追尾风险',     color: '#fbbf24' },
      CR: { tag: '✓ 正确拒斥 CR',       sub: '正确！只是杂物 / 反光 / 阴影——车辆顺利通过',     color: '#22d3ee' }
    };
    const info = INFO[outcome];

    /* 中央面板 */
    ctx.strokeStyle = info.color;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.55;
    ctx.strokeRect(W / 2 - 330, H / 2 - 92, 660, 184);
    ctx.globalAlpha = 1;

    /* 结果标题（大字） */
    ctx.fillStyle = info.color;
    ctx.font = '700 34px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(info.tag, W / 2, H / 2 - 16);

    /* 场景化副标题 */
    ctx.fillStyle = '#c3cede';
    ctx.font = '16.5px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(info.sub, W / 2, H / 2 + 30);

    /* 底部小字：当前累计 */
    ctx.fillStyle = '#67748f';
    ctx.font = '13px ui-monospace, Consolas, monospace';
    ctx.fillText('已作答 ' + st.idx + ' / ' + TRIALS + ' · 击中 ' + st.H + ' · 误报 ' + st.FA,
                 W / 2, H / 2 + 66);
  }

  /* 主场景：t 为刺激已呈现秒数 */
  function drawScene(t) {
    const w = st.conf;
    const tr = st.trial;

    /* 夜空 */
    const sky = ctx.createLinearGradient(0, 0, 0, HOR);
    sky.addColorStop(0, '#030509');
    sky.addColorStop(1, '#0a1120');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, HOR);

    /* 星星（仅晴天） */
    if (w.stars) {
      if (!stars) {
        stars = [];
        for (let i = 0; i < 60; i++)
          stars.push({ x: Math.random() * W, y: Math.random() * HOR * 0.8, r: Math.random() });
      }
      stars.forEach(function (s) {
        ctx.fillStyle = 'rgba(220,230,255,' + (0.25 + 0.35 * Math.abs(Math.sin(t * 2 + s.r * 20))) + ')';
        ctx.fillRect(s.x, s.y, 1.4, 1.4);
      });
    }

    /* 地面 */
    ctx.fillStyle = '#070a10';
    ctx.fillRect(0, HOR, W, H - HOR);

    /* 路面（透视梯形） */
    ctx.beginPath();
    ctx.moveTo(W / 2 - 22, HOR);
    ctx.lineTo(W / 2 + 22, HOR);
    ctx.lineTo(W / 2 + 390, H);
    ctx.lineTo(W / 2 - 390, H);
    ctx.closePath();
    ctx.fillStyle = '#11151d';
    ctx.fill();

    /* 车灯照亮的光锥 */
    const beam = ctx.createRadialGradient(W / 2, H + 80, 60, W / 2, H + 80, 560);
    beam.addColorStop(0, 'rgba(255,214,140,0.16)');
    beam.addColorStop(1, 'rgba(255,214,140,0)');
    ctx.fillStyle = beam;
    ctx.fillRect(0, 0, W, H);

    /* 路缘线 */
    ctx.strokeStyle = 'rgba(251,191,36,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(W / 2 - 22, HOR); ctx.lineTo(W / 2 - 390, H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(W / 2 + 22, HOR); ctx.lineTo(W / 2 + 390, H); ctx.stroke();

    /* 中央虚线：向viewer流动制造速度感 */
    ctx.fillStyle = 'rgba(224,231,245,0.55)';
    for (let i = 0; i < 7; i++) {
      const depth = ((i / 7 + t * 0.55) % 1);
      if (depth < 0.05) continue;
      const p0 = project(0, depth);
      const p1 = project(0, Math.min(1, depth + 0.045));
      ctx.beginPath();
      ctx.moveTo(p0.x - 2.2 * p0.s, p0.y); ctx.lineTo(p0.x + 2.2 * p0.s, p0.y);
      ctx.lineTo(p1.x + 3.2 * p1.s, p1.y); ctx.lineTo(p1.x - 3.2 * p1.s, p1.y);
      ctx.closePath(); ctx.fill();
    }

    /* 路灯：两侧琥珀光晕 */
    [0.22, 0.5, 0.78].forEach(function (dep) {
      [-1, 1].forEach(function (side) {
        const p = project(side * 1.45, dep);
        const glow = ctx.createRadialGradient(p.x, p.y - 95 * p.s, 2, p.x, p.y - 95 * p.s, 46 * p.s);
        glow.addColorStop(0, 'rgba(251,191,36,0.5)');
        glow.addColorStop(1, 'rgba(251,191,36,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(p.x - 50 * p.s, p.y - 145 * p.s, 100 * p.s, 100 * p.s);
        ctx.strokeStyle = 'rgba(60,72,95,0.9)';
        ctx.lineWidth = Math.max(1, 2.5 * p.s);
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, p.y - 95 * p.s); ctx.stroke();
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath(); ctx.arc(p.x, p.y - 95 * p.s, Math.max(1.5, 3.5 * p.s), 0, 7); ctx.fill();
      });
    });

    /* 环境杂物（不携带信号的背景 clutter） */
    tr.clutter.forEach(function (o) { drawObject(o, t); });

    /* 候选目标：行人剪影 或 形似干扰物 */
    drawObject({ type: tr.candidate.kind === 'ped' ? 'ped' : tr.candidate.kind,
                 lat: tr.candidate.lat, depth: tr.candidate.depth,
                 alpha: tr.candidate.alpha, seed: tr.candidate.seed }, t);

    /* 雨层 */
    if (w.rain > 0) {
      ctx.strokeStyle = 'rgba(165,185,215,' + (0.28 * w.rain) + ')';
      ctx.lineWidth = 1;
      ctx.beginPath();
      const nDrops = Math.round(130 * w.rain);
      for (let i = 0; i < nDrops; i++) {
        const x0 = (i * 67.3) % W;
        const y0 = ((i * 91.7) % H + t * 620) % H;
        ctx.moveTo(x0, y0); ctx.lineTo(x0 - 5, y0 + 17);
      }
      ctx.stroke();
      /* 路面湿反光 */
      ctx.fillStyle = 'rgba(190,205,230,' + (0.05 * w.rain) + ')';
      ctx.fillRect(W / 2 - 300, H - 70, 600, 14);
    }

    /* 雾层：整体薄纱 + 漂移雾团（浓度随难度连续变化） */
    if (w.fog > 0) {
      ctx.fillStyle = 'rgba(148,160,182,' + (w.fog * 0.45) + ')';
      ctx.fillRect(0, 0, W, H);
      for (let i = 0; i < 6; i++) {
        const bx = ((i * 173 + t * 24 * (i % 2 ? 1 : -1)) % (W + 300)) - 150;
        const by = 80 + (i * 67) % (H - 120);
        const fg = ctx.createRadialGradient(bx, by, 10, bx, by, 150);
        fg.addColorStop(0, 'rgba(170,182,205,' + (w.fog * 0.35) + ')');
        fg.addColorStop(1, 'rgba(170,182,205,0)');
        ctx.fillStyle = fg;
        ctx.fillRect(bx - 150, by - 150, 300, 300);
      }
    }

    /* 暗角 */
    const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.95);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, W, H);
  }

  /* 通用物体绘制：行人/塑料袋/垃圾桶/反光牌/灌木/标杆 */
  function drawObject(o, t) {
    const p = project(o.lat, o.depth);
    const s = p.s, a = o.alpha;
    const sway = Math.sin(t * 6 + o.seed) * 2 * s;

    if (o.type === 'ped') {
      /* 行人剪影：头+躯干+迈步的腿，行走摆动 */
      ctx.strokeStyle = 'rgba(196,210,228,' + a + ')';
      ctx.fillStyle = 'rgba(196,210,228,' + a + ')';
      ctx.lineWidth = Math.max(1, 3 * s);
      const hy = p.y - 46 * s;                    // 头部中心
      ctx.beginPath(); ctx.arc(p.x + sway * 0.4, hy, 6.5 * s, 0, 7); ctx.fill();
      ctx.beginPath();                            // 躯干
      ctx.moveTo(p.x + sway * 0.4, hy + 7 * s);
      ctx.lineTo(p.x + sway * 0.2, p.y - 18 * s);
      ctx.stroke();
      const leg = Math.sin(t * 9 + o.seed) * 7 * s; // 迈步
      ctx.beginPath();
      ctx.moveTo(p.x + sway * 0.2, p.y - 18 * s); ctx.lineTo(p.x - 5 * s + leg, p.y);
      ctx.moveTo(p.x + sway * 0.2, p.y - 18 * s); ctx.lineTo(p.x + 5 * s - leg, p.y);
      ctx.moveTo(p.x + sway * 0.35, hy + 12 * s); ctx.lineTo(p.x - 6 * s - leg * 0.6, p.y - 14 * s);
      ctx.moveTo(p.x + sway * 0.35, hy + 12 * s); ctx.lineTo(p.x + 6 * s + leg * 0.6, p.y - 13 * s);
      ctx.stroke();
    } else if (o.type === 'bag') {
      /* 飘动的塑料袋：最经典的"像人"误报源 */
      const drift = Math.sin(t * 3 + o.seed) * 6 * s;
      ctx.fillStyle = 'rgba(210,220,235,' + (a * 0.9) + ')';
      ctx.beginPath();
      ctx.moveTo(p.x - 8 * s + drift, p.y - 30 * s);
      ctx.quadraticCurveTo(p.x - 14 * s + drift, p.y - 8 * s, p.x - 6 * s + drift, p.y);
      ctx.quadraticCurveTo(p.x + drift, p.y + 3 * s, p.x + 6 * s + drift, p.y);
      ctx.quadraticCurveTo(p.x + 13 * s + drift, p.y - 10 * s, p.x + 7 * s + drift, p.y - 28 * s);
      ctx.quadraticCurveTo(p.x + drift, p.y - 36 * s, p.x - 8 * s + drift, p.y - 30 * s);
      ctx.fill();
    } else if (o.type === 'bin') {
      /* 垃圾桶：深色圆柱 */
      ctx.fillStyle = 'rgba(120,134,158,' + a + ')';
      ctx.fillRect(p.x - 8 * s, p.y - 30 * s, 16 * s, 30 * s);
      ctx.fillStyle = 'rgba(150,164,188,' + a + ')';
      ctx.fillRect(p.x - 10 * s, p.y - 34 * s, 20 * s, 5 * s);
    } else if (o.type === 'sign') {
      /* 反光路牌：琥珀色眩光 */
      ctx.strokeStyle = 'rgba(150,164,188,' + a + ')';
      ctx.lineWidth = Math.max(1, 2 * s);
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, p.y - 42 * s); ctx.stroke();
      ctx.save();
      ctx.translate(p.x, p.y - 48 * s);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = 'rgba(251,191,36,' + (a * 0.95) + ')';
      ctx.fillRect(-8 * s, -8 * s, 16 * s, 16 * s);
      ctx.restore();
    } else if (o.type === 'bush') {
      /* 路边灌木 */
      ctx.fillStyle = 'rgba(52,72,64,' + a + ')';
      ctx.beginPath();
      ctx.ellipse(p.x, p.y - 8 * s, 16 * s, 10 * s, 0, 0, 7);
      ctx.ellipse(p.x + 10 * s, p.y - 5 * s, 10 * s, 7 * s, 0, 0, 7);
      ctx.fill();
    } else if (o.type === 'post') {
      /* 标杆 */
      ctx.strokeStyle = 'rgba(140,152,176,' + a + ')';
      ctx.lineWidth = Math.max(1, 2.5 * s);
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, p.y - 36 * s); ctx.stroke();
    }
  }

  return { init: init, start: start, TRIALS: TRIALS, P_SIGNAL: P_SIGNAL };
})();
