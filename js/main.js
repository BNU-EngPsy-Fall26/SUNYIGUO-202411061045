/* ============================================================
 * main.js —— 主控模块
 * 功能：页面导航（单页应用）、难度选择（预设天气 + 自定义滑块）、
 *       成绩报告渲染、战绩榜/排行榜渲染、开机自检动画、音效
 * ============================================================ */

/* ---------- 简易音效（Web Audio，无任何音频文件） ---------- */
const Sound = (function () {
  'use strict';
  let ac = null, on = true, humNodes = null;

  function ctx() {
    if (!ac) {
      try { ac = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (e) { ac = null; }
    }
    return ac;
  }

  /* 作答反馈：短促"嘀"声 */
  function tick() {
    if (!on || !ctx()) return;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = 'square'; o.frequency.value = 880;
    g.gain.setValueAtTime(0.035, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.12);
    o.connect(g); g.connect(ac.destination);
    o.start(); o.stop(ac.currentTime + 0.13);
  }

  /* 引擎怠速低频轰鸣：测试进行中开启 */
  function hum(startIt) {
    if (!ctx()) return;
    if (startIt && on && !humNodes) {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'sawtooth'; o.frequency.value = 52;
      g.gain.value = 0.018;
      o.connect(g); g.connect(ac.destination);
      o.start();
      humNodes = { o: o, g: g };
    } else if (!startIt && humNodes) {
      try { humNodes.o.stop(); } catch (e) {}
      humNodes = null;
    }
  }

  function toggle() {
    on = !on;
    if (!on) hum(false);
    return on;
  }

  return { tick: tick, hum: hum, toggle: toggle, isOn: function () { return on; } };
})();

/* ---------- 主控 ---------- */
const Main = (function () {
  'use strict';

  /* 三个预设天气（点击卡片 = 把滑块快捷定位到对应 d'） */
  const PRESETS = {
    clear: { key: 'clear', name: '晴朗深夜', d: 2.5 },
    rain:  { key: 'rain',  name: '雨夜',     d: 1.5 },
    fog:   { key: 'fog',   name: '浓雾',     d: 0.8 }
  };

  let curD = 1.5;                    // 当前难度（滑块值是唯一数据源）
  let curKey = 'rain', curName = '雨夜';

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  /* 由 d' 生成画面配置：d' 越低，雾越浓、雨越大——难度连续可调 */
  function configFromD(d, name, key) {
    return {
      key: key || 'custom',
      name: name || ('自定义天气'),
      dprime: d,
      fog: clamp((2.3 - d) / 1.8, 0, 1) * 0.45,
      rain: d < 2.4 ? clamp((2.4 - d) / 1.7, 0, 1) : 0,
      stars: d >= 2.3
    };
  }

  /* 难度解释文案：随滑块实时更新 */
  function explainD(d) {
    if (d >= 2.2) return '当前 <b>d\' = ' + d.toFixed(1) + '</b>：信号与噪音几乎分开——行人轮廓清晰，判断轻松，错误很少。';
    if (d >= 1.2) return '当前 <b>d\' = ' + d.toFixed(1) + '</b>：两个分布明显重叠——需要集中注意力，漏报与误报开始增多。';
    return '当前 <b>d\' = ' + d.toFixed(1) + '</b>：两个分布严重重叠——很多时候接近凭直觉猜，这正是体验 d\' 含义的最佳区间。';
  }

  /* 页面切换（单页应用：所有"页面"是同一 HTML 里的 <section>） */
  function show(id) {
    document.querySelectorAll('.screen').forEach(function (s) {
      s.classList.toggle('active', s.id === id);
    });
    document.querySelectorAll('.nav-link').forEach(function (a) {
      a.classList.toggle('current', a.dataset.target === id);
    });
    if (id === 'screen-lab') Lab.draw();
    if (id === 'screen-history') renderHistory();
    window.scrollTo(0, 0);
  }

  /* ---------- 简报页：难度选择 ---------- */
  function initBriefing() {
    const slider = document.getElementById('sliderDiff');

    /* 预设天气卡：点击 = 快捷设置滑块 */
    document.querySelectorAll('.weather-card').forEach(function (card) {
      card.addEventListener('click', function () {
        slider.value = card.dataset.d;
        syncDifficulty();
      });
    });

    /* 自定义滑块：拖动 = 连续调节 d' */
    slider.addEventListener('input', syncDifficulty);

    function syncDifficulty() {
      curD = parseFloat(slider.value);
      /* 若滑块值恰好等于某预设，则高亮该卡；否则视为自定义 */
      let matched = null;
      Object.keys(PRESETS).forEach(function (k) {
        if (Math.abs(PRESETS[k].d - curD) < 0.01) matched = PRESETS[k];
      });
      document.querySelectorAll('.weather-card').forEach(function (x) {
        x.classList.toggle('selected', matched && x.dataset.weather === matched.key);
      });
      curKey = matched ? matched.key : 'custom';
      curName = matched ? matched.name : '自定义天气';
      document.getElementById('customDVal').textContent = curD.toFixed(1);
      document.getElementById('dExplain').innerHTML = explainD(curD);
    }
    syncDifficulty();

    document.getElementById('btnStart').addEventListener('click', function () {
      Game.start(configFromD(curD, curName, curKey));
    });

    /* 开机自检打字机动画 */
    const lines = [
      '> NIGHT-PILOT 感知标定系统 v2.4 启动 ……',
      '> 摄像头阵列 …………………… 在线',
      '> 毫米波雷达 …………………… 在线',
      '> 夜间测试场模式 ……………… 就绪',
      '> 等待安全员接入 ▊'
    ];
    const el = document.getElementById('bootLog');
    let li = 0, ci = 0;
    (function type() {
      if (li >= lines.length) return;
      el.textContent = lines.slice(0, li).join('\n') + (li > 0 ? '\n' : '') + lines[li].slice(0, ci + 1);
      ci++;
      if (ci >= lines[li].length) { li++; ci = 0; setTimeout(type, 260); }
      else setTimeout(type, 18);
    })();
  }

  /* ---------- 成绩报告页 ---------- */
  function showResults(rec) {
    show('screen-results');

    document.getElementById('resWeather').textContent =
      rec.weatherName + '（难度 d\' = ' + rec.envD.toFixed(1) + '）· ' + rec.trials + ' 次判断';

    /* 混淆矩阵 */
    document.getElementById('cellH').textContent = rec.H;
    document.getElementById('cellM').textContent = rec.M;
    document.getElementById('cellFA').textContent = rec.FA;
    document.getElementById('cellCR').textContent = rec.CR;

    /* 五项指标 */
    document.getElementById('mPHit').textContent = rec.pHit.toFixed(2);
    document.getElementById('mPFA').textContent = rec.pFA.toFixed(2);
    document.getElementById('mD').textContent = rec.dprime.toFixed(2);
    document.getElementById('mC').textContent = (rec.criterion >= 0 ? '+' : '') + rec.criterion.toFixed(2);
    document.getElementById('mAcc').textContent = Math.round(rec.accuracy * 100) + '%';

    /* 「准确率陷阱」讲解卡：本场景 P(S)=0.3，全程说"无"也有 70% 准确率 */
    const lazyAcc = Math.round((1 - Game.P_SIGNAL) * 100);
    document.getElementById('trapText').innerHTML =
      '本场景行人稀少（先验概率 P(S)=0.3）。假如你全程闭眼按「无行人」，' +
      '准确率也能达到 <b>' + lazyAcc + '%</b> —— 但那时 d\' = 0，毫无分辨能力。' +
      '你本局的准确率是 <b>' + Math.round(rec.accuracy * 100) + '%</b>，d\' 是 <b>' +
      rec.dprime.toFixed(2) + '</b>。这就是为什么工程心理学要把' +
      '「能不能分辨」（d\'）和「敢不敢报警」（c）分开衡量。';

    /* c 值的场景化解读 */
    const cEl = document.getElementById('cInterpret');
    if (rec.criterion > 0.25) {
      cEl.innerHTML = '你的标准 c = ' + rec.criterion.toFixed(2) + '，偏<b>保守</b>：' +
        '很确定才报警。避免了幽灵刹车，但浓雾里可能漏掉真行人——像核电站操作员，宁可不反应也不愿误动作。';
    } else if (rec.criterion < -0.25) {
      cEl.innerHTML = '你的标准 c = ' + rec.criterion.toFixed(2) + '，偏<b>宽松</b>：' +
        '稍有可疑就报警。行人几乎不会漏，但幽灵刹车变多——像急救调度员，宁可错报不可漏报。';
    } else {
      cEl.innerHTML = '你的标准 c = ' + rec.criterion.toFixed(2) + '，接近<b>中立</b>：' +
        '在"漏报"与"误报"之间保持均衡。试着想想：如果漏报行人的代价是事故，最优标准其实应该更宽松。';
    }

    /* 小 ROC：三条预设天气理论曲线 + 我的历史实测点 */
    Lab.drawMiniROC(document.getElementById('miniRoc'));

    /* 按钮 */
    document.getElementById('btnAgain').onclick = function () {
      Game.start(configFromD(rec.envD, rec.weatherName, rec.weather));
    };
    document.getElementById('btnChange').onclick = function () { show('screen-briefing'); };
    document.getElementById('btnToLab').onclick = function () { show('screen-lab'); };
  }

  /* ---------- 战绩榜页 ---------- */
  function renderHistory() {
    const games = Store.all().slice().reverse();
    const tbody = document.getElementById('historyBody');
    const empty = document.getElementById('historyEmpty');

    if (games.length === 0) {
      tbody.innerHTML = '';
      empty.style.display = 'block';
    } else {
      empty.style.display = 'none';
      tbody.innerHTML = games.map(function (g) {
        const dt = new Date(g.ts);
        const time = (dt.getMonth() + 1) + '/' + dt.getDate() + ' ' +
          String(dt.getHours()).padStart(2, '0') + ':' + String(dt.getMinutes()).padStart(2, '0');
        return '<tr>' +
          '<td>' + time + '</td>' +
          '<td><span class="wtag" style="color:' + (Lab.WCOLOR[g.weather] || '#e7ecf5') + '">' +
            g.weatherName + ' ' + g.envD.toFixed(1) + '</span></td>' +
          '<td>' + g.H + '/' + g.M + '/' + g.FA + '/' + g.CR + '</td>' +
          '<td>' + g.pHit.toFixed(2) + '</td>' +
          '<td>' + g.pFA.toFixed(2) + '</td>' +
          '<td class="num-strong">' + g.dprime.toFixed(2) + '</td>' +
          '<td>' + (g.criterion >= 0 ? '+' : '') + g.criterion.toFixed(2) + '</td>' +
          '<td>' + Math.round(g.accuracy * 100) + '%</td>' +
          '</tr>';
      }).join('');
    }

    /* 排行榜：预设天气 + 自定义难度的历史最佳 d' */
    const best = Store.bestByWeather();
    const names = { clear: '晴朗深夜 d\'=2.5', rain: '雨夜 d\'=1.5', fog: '浓雾 d\'=0.8', custom: '自定义难度' };
    document.getElementById('leaderboard').innerHTML = Object.keys(names).map(function (k) {
      const g = best[k];
      return '<div class="lb-row">' +
        '<span class="lb-w" style="color:' + Lab.WCOLOR[k] + '">' + names[k] + '</span>' +
        '<span class="lb-v">' + (g ? 'd\' = ' + g.dprime.toFixed(2) + ' · 准确率 ' + Math.round(g.accuracy * 100) + '%' : '—— 暂无记录') + '</span>' +
        '</div>';
    }).join('');
  }

  /* ---------- 启动 ---------- */
  function boot() {
    /* 顶部导航 */
    document.querySelectorAll('.nav-link').forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        show(a.dataset.target);
      });
    });
    /* 战绩榜清空按钮 */
    document.getElementById('btnClear').addEventListener('click', function () {
      if (confirm('确定清空全部历史成绩？此操作不可恢复。')) {
        Store.clear();
        renderHistory();
      }
    });
    /* 音效开关 */
    document.getElementById('btnSound').addEventListener('click', function () {
      const onNow = Sound.toggle();
      document.getElementById('btnSound').textContent = onNow ? '音效 ON' : '音效 OFF';
    });

    Game.init();
    Lab.init();
    initBriefing();
    show('screen-briefing');
  }

  document.addEventListener('DOMContentLoaded', boot);

  return { show: show, showResults: showResults };
})();
