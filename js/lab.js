/* ============================================================
 * lab.js —— 概念实验室（加分项①：交互式概念可视化）
 *
 * 三张联动的图：
 *   1. 双分布图：噪音 N(0,1) 与 信号+噪音 N(d',1) 两条钟形曲线，
 *      判定线 c 把曲线下面积切成 H / M / FA / CR 四块（实时着色）
 *   2. ROC 曲线：d' 决定整条曲线的形状，c 决定点在曲线上的位置
 *   3. z 变换 ROC：坐标轴换成 z 分数后 ROC 变为直线，
 *      截距 = d'/σ(SN)，斜率 = σ(N)/σ(SN)（由 σ(SN) 滑块控制）
 *
 * 所有画布均按 devicePixelRatio 高清渲染，文字不模糊。
 * 另提供 drawMiniROC：结果页用的"理论曲线 + 我的实测点"小图（加分项②）
 * ============================================================ */
const Lab = (function () {
  'use strict';

  let d = 1.5, c = 0.0, sigma = 1.0;   // 当前滑块参数
  let overlay = true;                  // 是否在 ROC 上叠加用户实测点
  let distCv, rocCv, zrocCv;

  const DW = 540, DH = 300;            // 分布图逻辑尺寸
  const RW = 360, RH = 360;            // ROC / zROC 逻辑尺寸
  const ML = 52, MB = 40, MT = 22;     // 图边距

  /* 难度配色（与结果页/排行榜一致；custom = 自定义滑块难度） */
  const WCOLOR = { clear: '#34d399', rain: '#fbbf24', fog: '#f87171', custom: '#a78bfa' };

  /* HiDPI 高清渲染：按设备像素比放大位图，逻辑坐标保持不变 */
  function setupCanvas(canvas, w, h) {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const c2 = canvas.getContext('2d');
    c2.setTransform(dpr, 0, 0, dpr, 0, 0);
    return c2;
  }

  function init() {
    distCv = document.getElementById('distCanvas');
    rocCv = document.getElementById('rocCanvas');
    zrocCv = document.getElementById('zrocCanvas');

    const sd = document.getElementById('sliderD');
    const sc = document.getElementById('sliderC');
    const ss = document.getElementById('sliderS');
    sd.addEventListener('input', function () { d = parseFloat(sd.value); draw(); });
    sc.addEventListener('input', function () { c = parseFloat(sc.value); draw(); });
    ss.addEventListener('input', function () { sigma = parseFloat(ss.value); draw(); });
    document.getElementById('chkOverlay').addEventListener('change', function (e) {
      overlay = e.target.checked; draw();
    });
    draw();
  }

  function draw() {
    document.getElementById('valD').textContent = d.toFixed(1);
    document.getElementById('valC').textContent = (c >= 0 ? '+' : '') + c.toFixed(2);
    document.getElementById('valS').textContent = sigma.toFixed(1);
    drawDist();
    drawROC(rocCv, d, c, true);
    drawZROC();
    /* 读数面板 */
    const pH = 1 - SDT.normCdf(c - d);
    const pF = 1 - SDT.normCdf(c);
    document.getElementById('labPHit').textContent = pH.toFixed(3);
    document.getElementById('labPFA').textContent = pF.toFixed(3);
    document.getElementById('labBeta').textContent = Math.exp(d * c).toFixed(2);
    document.getElementById('labAUC').textContent = SDT.normCdf(d / Math.SQRT2).toFixed(3);
  }

  /* ---------- 双分布图 ---------- */
  function drawDist() {
    const dctx = setupCanvas(distCv, DW, DH);
    const xMin = -4, xMax = Math.max(4.5, 4 + d);
    const base = DH - 34, top = 26;
    const x2px = function (x) { return 12 + (x - xMin) / (xMax - xMin) * (DW - 24); };
    const px2x = function (px) { return xMin + (px - 12) / (DW - 24) * (xMax - xMin); };
    const y2px = function (y) { return base - y / 0.42 * (base - top); };

    dctx.clearRect(0, 0, DW, DH);

    /* 逐列填充四个区域：列色 = 该列在两种实际状态下的归属 */
    for (let px = 12; px < DW - 12; px++) {
      const x = px2x(px);
      const yn = SDT.normPdf(x);
      const ys = SDT.normPdf(x - d);
      const hn = yn / 0.42 * (base - top);
      const hs = ys / 0.42 * (base - top);
      /* 噪音分布：c 左侧=正确拒斥(青)，右侧=误报(琥珀) */
      dctx.fillStyle = x < c ? 'rgba(34,211,238,0.20)' : 'rgba(251,191,36,0.30)';
      dctx.fillRect(px, base - hn, 1, hn);
      /* 信号分布：c 左侧=漏报(红)，右侧=击中(薄荷绿) */
      dctx.fillStyle = x < c ? 'rgba(248,113,113,0.28)' : 'rgba(52,211,153,0.28)';
      dctx.fillRect(px, base - hs, 1, hs);
    }

    /* 曲线轮廓 */
    strokeCurve(dctx, x2px, y2px, xMin, xMax, 0, '#22d3ee');
    strokeCurve(dctx, x2px, y2px, xMin, xMax, d, '#34d399');

    /* 判定线 c */
    dctx.strokeStyle = '#fbbf24';
    dctx.lineWidth = 1.8;
    dctx.setLineDash([6, 5]);
    dctx.beginPath();
    dctx.moveTo(x2px(c), top - 6); dctx.lineTo(x2px(c), base);
    dctx.stroke();
    dctx.setLineDash([]);
    dctx.fillStyle = '#fbbf24';
    dctx.font = '700 13px ui-monospace, Consolas, monospace';
    dctx.textAlign = 'center';
    dctx.fillText('c', x2px(c), top - 10);

    /* 坐标轴与标注 */
    dctx.strokeStyle = '#1a2540';
    dctx.lineWidth = 1;
    dctx.beginPath(); dctx.moveTo(12, base); dctx.lineTo(DW - 12, base); dctx.stroke();
    dctx.fillStyle = '#67748f';
    dctx.font = '12.5px ui-monospace, Consolas, monospace';
    dctx.textAlign = 'right';
    dctx.fillText('证据强度 →', DW - 14, base + 24);
    dctx.textAlign = 'left';
    dctx.fillStyle = '#7c8aa5';
    dctx.fillText('噪音 N(0,1)', 16, top + 12);
    dctx.fillStyle = '#34d399';
    dctx.fillText('信号+噪音 N(d\',1)', 16, top + 30);
  }

  function strokeCurve(c2, x2px, y2px, xMin, xMax, mean, color) {
    c2.strokeStyle = color;
    c2.lineWidth = 2;
    c2.beginPath();
    for (let x = xMin; x <= xMax; x += 0.03) {
      const px = x2px(x), py = y2px(SDT.normPdf(x - mean));
      if (x === xMin) c2.moveTo(px, py); else c2.lineTo(px, py);
    }
    c2.stroke();
  }

  /* ---------- ROC 曲线 ----------
   * 原理：同一条 ROC = 固定 d'、c 从 −∞ 扫到 +∞ 时
   *       (P(FA), P(Hit)) = (1−Φ(c), 1−Φ(c−d')) 的轨迹 */
  function drawROC(canvas, dCur, cCur, withPoint) {
    const c2 = setupCanvas(canvas, RW, RH);
    const plotW = RW - ML - 16, plotH = RH - MT - MB;
    const x2px = function (v) { return ML + v * plotW; };
    const y2px = function (v) { return MT + (1 - v) * plotH; };

    c2.clearRect(0, 0, RW, RH);

    /* 网格与坐标轴 */
    c2.strokeStyle = '#141d33';
    c2.lineWidth = 1;
    c2.fillStyle = '#67748f';
    c2.font = '11.5px ui-monospace, Consolas, monospace';
    c2.textAlign = 'center';
    for (let i = 0; i <= 4; i++) {
      const v = i / 4;
      c2.beginPath(); c2.moveTo(x2px(v), y2px(0)); c2.lineTo(x2px(v), y2px(1)); c2.stroke();
      c2.beginPath(); c2.moveTo(x2px(0), y2px(v)); c2.lineTo(x2px(1), y2px(v)); c2.stroke();
      c2.fillText(v.toFixed(2), x2px(v), y2px(0) + 17);
      c2.textAlign = 'right';
      c2.fillText(v.toFixed(2), x2px(0) - 7, y2px(v) + 4);
      c2.textAlign = 'center';
    }
    c2.font = '12.5px ui-monospace, Consolas, monospace';
    c2.fillText('P(FA) →', x2px(0.5), RH - 8);
    c2.save();
    c2.translate(15, y2px(0.5)); c2.rotate(-Math.PI / 2);
    c2.fillText('P(Hit) →', 0, 0);
    c2.restore();

    /* 对角线（随机水平） */
    c2.strokeStyle = '#2a3852';
    c2.setLineDash([4, 4]);
    c2.beginPath(); c2.moveTo(x2px(0), y2px(0)); c2.lineTo(x2px(1), y2px(1)); c2.stroke();
    c2.setLineDash([]);

    /* 当前 d' 的 ROC 曲线 */
    rocCurve(c2, x2px, y2px, dCur, '#22d3ee', 2.2);

    /* 叠加用户历史实测点（加分项②：多局数据对比） */
    if (overlay) {
      Store.all().forEach(function (g) {
        c2.fillStyle = WCOLOR[g.weather] || '#e7ecf5';
        c2.beginPath();
        c2.arc(x2px(g.pFA), y2px(g.pHit), 4.5, 0, 7);
        c2.fill();
      });
    }

    /* 当前 (c) 对应的操作点 */
    if (withPoint) {
      const pF = 1 - SDT.normCdf(cCur);
      const pH = 1 - SDT.normCdf(cCur - dCur);
      c2.strokeStyle = 'rgba(251,191,36,0.5)';
      c2.setLineDash([3, 3]);
      c2.beginPath(); c2.moveTo(x2px(pF), y2px(0)); c2.lineTo(x2px(pF), y2px(pH)); c2.stroke();
      c2.beginPath(); c2.moveTo(x2px(0), y2px(pH)); c2.lineTo(x2px(pF), y2px(pH)); c2.stroke();
      c2.setLineDash([]);
      c2.fillStyle = '#fbbf24';
      c2.beginPath(); c2.arc(x2px(pF), y2px(pH), 6.5, 0, 7); c2.fill();
      c2.strokeStyle = '#050810';
      c2.lineWidth = 2;
      c2.beginPath(); c2.arc(x2px(pF), y2px(pH), 6.5, 0, 7); c2.stroke();
    }
  }

  function rocCurve(c2, x2px, y2px, dd, color, lw) {
    c2.strokeStyle = color;
    c2.lineWidth = lw;
    c2.beginPath();
    for (let cc = 4; cc >= -4; cc -= 0.04) {
      const px = x2px(1 - SDT.normCdf(cc));
      const py = y2px(1 - SDT.normCdf(cc - dd));
      if (cc === 4) c2.moveTo(px, py); else c2.lineTo(px, py);
    }
    c2.stroke();
  }

  /* ---------- z 变换 ROC ----------
   * 原理：不等方差 SDT 中，噪音 ~ N(0, σN²)，信号+噪音 ~ N(d', σSN²)
   *   z(FA) = c / σN，z(Hit) = (c − d') / σSN
   *   消去 c 得直线：z(Hit) = [σN/σSN] · z(FA) − d'/σSN …（以均值差为 d'+...）
   *   本站约定 σN=1：z(Hit) = (1/σSN)·z(FA) + d'/σSN（截距项符号按图中正方向绘制）
   *   等方差 σSN=1 时斜率 = 1；σSN 越大直线越平缓 */
  function drawZROC() {
    const c2 = setupCanvas(zrocCv, RW, RH);
    const R = 3.5;                                    // 坐标范围 ±3.5
    const plotW = RW - ML - 16, plotH = RH - MT - MB;
    const x2px = function (v) { return ML + (v + R) / (2 * R) * plotW; };
    const y2px = function (v) { return MT + (1 - (v + R) / (2 * R)) * plotH; };

    c2.clearRect(0, 0, RW, RH);

    /* 整数网格与刻度 */
    c2.font = '11.5px ui-monospace, Consolas, monospace';
    for (let v = -3; v <= 3; v++) {
      c2.strokeStyle = v === 0 ? '#3a4a6b' : '#141d33';
      c2.lineWidth = 1;
      c2.beginPath(); c2.moveTo(x2px(v), y2px(-R)); c2.lineTo(x2px(v), y2px(R)); c2.stroke();
      c2.beginPath(); c2.moveTo(x2px(-R), y2px(v)); c2.lineTo(x2px(R), y2px(v)); c2.stroke();
      c2.fillStyle = '#67748f';
      c2.textAlign = 'center';
      c2.fillText(v, x2px(v), y2px(-R) + 17);
      c2.textAlign = 'right';
      c2.fillText(v, x2px(-R) - 7, y2px(v) + 4);
    }

    /* 坐标轴标签 */
    c2.fillStyle = '#67748f';
    c2.font = '12.5px ui-monospace, Consolas, monospace';
    c2.textAlign = 'center';
    c2.fillText('Z(FA) →', x2px(0), RH - 8);
    c2.save();
    c2.translate(15, y2px(0)); c2.rotate(-Math.PI / 2);
    c2.fillText('Z(Hit) →', 0, 0);
    c2.restore();

    /* 对角参考线（过原点斜率1的虚线） */
    c2.strokeStyle = '#2a3852';
    c2.setLineDash([5, 5]);
    c2.beginPath();
    c2.moveTo(x2px(-2.6), y2px(-2.6));
    c2.lineTo(x2px(2.6), y2px(2.6));
    c2.stroke();
    c2.setLineDash([]);

    /* z-ROC 直线：zH = zF/σ + d'/σ，端点裁剪到绘图区内 */
    const slope = 1 / sigma, intercept = d / sigma;
    function clipLine() {
      /* 求直线与绘图区边界的交点 */
      const pts = [];
      const yAt = function (x) { return slope * x + intercept; };
      const xAt = function (y) { return (y - intercept) / slope; };
      [-R, R].forEach(function (x) { const y = yAt(x); if (y >= -R && y <= R) pts.push([x, y]); });
      [-R, R].forEach(function (y) { const x = xAt(y); if (x >= -R && x <= R) pts.push([x, y]); });
      return pts.slice(0, 2);
    }
    const seg = clipLine();
    if (seg.length === 2) {
      c2.strokeStyle = '#e7ecf5';
      c2.lineWidth = 2.2;
      c2.beginPath();
      c2.moveTo(x2px(seg[0][0]), y2px(seg[0][1]));
      c2.lineTo(x2px(seg[1][0]), y2px(seg[1][1]));
      c2.stroke();
    }

    /* 标注斜率与截距 */
    c2.fillStyle = '#8b99b5';
    c2.font = '12px ui-monospace, Consolas, monospace';
    c2.textAlign = 'left';
    c2.fillText('slope = σ(N)/σ(SN) = ' + slope.toFixed(2), x2px(-R) + 8, y2px(R) + 18);
    c2.fillText('截距 = d\'/σ(SN) = ' + intercept.toFixed(2), x2px(-R) + 8, y2px(R) + 36);
  }

  /* ---------- 结果页小 ROC：三条预设天气理论曲线 + 我的全部实测点 ---------- */
  function drawMiniROC(canvas) {
    const W2 = 340, H2 = 340;
    const c2 = setupCanvas(canvas, W2, H2);
    const plotW = W2 - ML - 16, plotH = H2 - MT - MB;
    const x2px = function (v) { return ML + v * plotW; };
    const y2px = function (v) { return MT + (1 - v) * plotH; };

    c2.clearRect(0, 0, W2, H2);
    c2.strokeStyle = '#141d33';
    c2.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const v = i / 4;
      c2.beginPath(); c2.moveTo(x2px(v), y2px(0)); c2.lineTo(x2px(v), y2px(1)); c2.stroke();
      c2.beginPath(); c2.moveTo(x2px(0), y2px(v)); c2.lineTo(x2px(1), y2px(v)); c2.stroke();
    }
    c2.fillStyle = '#67748f';
    c2.font = '12px ui-monospace, Consolas, monospace';
    c2.textAlign = 'center';
    c2.fillText('P(FA) →', x2px(0.5), H2 - 8);
    c2.save(); c2.translate(15, y2px(0.5)); c2.rotate(-Math.PI / 2);
    c2.fillText('P(Hit) →', 0, 0); c2.restore();

    c2.strokeStyle = '#2a3852';
    c2.setLineDash([4, 4]);
    c2.beginPath(); c2.moveTo(x2px(0), y2px(0)); c2.lineTo(x2px(1), y2px(1)); c2.stroke();
    c2.setLineDash([]);

    /* 三条预设天气对应的理论 ROC */
    rocCurve(c2, x2px, y2px, 0.8, 'rgba(248,113,113,0.8)', 1.8);
    rocCurve(c2, x2px, y2px, 1.5, 'rgba(251,191,36,0.8)', 1.8);
    rocCurve(c2, x2px, y2px, 2.5, 'rgba(52,211,153,0.8)', 1.8);

    /* 我的实测点 */
    Store.all().forEach(function (g) {
      c2.fillStyle = WCOLOR[g.weather] || '#e7ecf5';
      c2.beginPath();
      c2.arc(x2px(g.pFA), y2px(g.pHit), 5, 0, 7);
      c2.fill();
      c2.strokeStyle = '#050810';
      c2.lineWidth = 1.5;
      c2.stroke();
    });
  }

  return { init: init, draw: draw, drawMiniROC: drawMiniROC, WCOLOR: WCOLOR };
})();
