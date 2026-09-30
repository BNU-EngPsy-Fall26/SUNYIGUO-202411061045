/* ============================================================
 * math.js —— 信号检测论（SDT）数学模块
 * 功能：正态分布函数、随机采样、SDT 指标计算（d' / c / β / 准确率）
 * 说明：纯函数模块，不依赖 DOM，可在控制台单独测试
 * ============================================================ */
const SDT = (function () {
  'use strict';

  /* 标准正态概率密度 φ(x)：画两条分布曲线时用 */
  function normPdf(x) {
    return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
  }

  /* 误差函数 erf(x)：Abramowitz & Stegun 7.1.26 近似，误差 < 1.5e-7 */
  function erf(x) {
    const sign = x < 0 ? -1 : 1;
    const ax = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * ax);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t
      - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
    return sign * y;
  }

  /* 标准正态累积分布 Φ(x)：计算 P(Hit)、P(FA)、AUC 时用 */
  function normCdf(x) {
    return 0.5 * (1 + erf(x / Math.SQRT2));
  }

  /* 标准正态分位数函数 Φ⁻¹(p)（z 分数）：Acklam 有理逼近，误差约 3e-9
   * 原理：SDT 假设噪音 ~ N(0,1)、信号+噪音 ~ N(d',1)，
   *       必须把"概率"换算回"z 分数"才能计算 d' 和 c */
  function normInv(p) {
    if (p <= 0) return -Infinity;
    if (p >= 1) return Infinity;
    const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
      1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
      6.680131188771972e+01, -1.328068155288572e+01];
    const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
      -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
      3.754408661907416e+00];
    const plow = 0.02425, phigh = 1 - plow;
    let q, r;
    if (p < plow) {                    // 左尾
      q = Math.sqrt(-2 * Math.log(p));
      return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
        ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    if (p > phigh) {                   // 右尾
      q = Math.sqrt(-2 * Math.log(1 - p));
      return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
        ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    q = p - 0.5;                       // 中央区
    r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }

  /* Box-Muller 变换：把均匀随机数变成 N(mean, std²) 正态随机数
   * 原理（生成模型）：每个试次，"感官证据"是一次采样——
   *   无行人：x ~ N(0, 1)；有行人：x ~ N(d', 1)
   *   x 映射为画面中目标物的清晰度，这就是信号与噪音重叠的来源 */
  function randNormal(mean, std) {
    let u = 0;
    while (u === 0) u = Math.random();   // 防止 log(0)
    const v = Math.random();
    return mean + std * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /* 由混淆矩阵计数计算全部 SDT 指标
   * d' = z(P(H)) − z(P(FA))   —— 敏感性（分辨能力）
   * c  = −[z(P(H)) + z(P(FA))] / 2  —— 判断标准（c>0 保守，c<0 宽松）
   * β  = exp(d' · c)          —— 似然比标准（β>1 严格，β<1 宽松）
   *
   * 边界校正：Hautus (1995) log-linear 校正——
   * 若某率为 0 或 1，z 分数会趋于无穷导致 d' 无法计算，
   * 因此对所有计数 +0.5、总数 +1 后再求 z 分数。 */
  function compute(H, M, FA, CR) {
    const N = H + M + FA + CR;
    const hitC = (H + 0.5) / (H + M + 1);    // 校正后的击中率
    const faC = (FA + 0.5) / (FA + CR + 1);  // 校正后的误报率
    const zH = normInv(hitC);
    const zF = normInv(faC);
    const d = zH - zF;
    const c = -(zH + zF) / 2;
    return {
      H: H, M: M, FA: FA, CR: CR, N: N,
      pHit: (H + M) > 0 ? H / (H + M) : 0,   // 真实击中率（展示用）
      pFA: (FA + CR) > 0 ? FA / (FA + CR) : 0,
      dprime: d,
      criterion: c,
      beta: Math.exp(d * c),
      accuracy: N > 0 ? (H + CR) / N : 0
    };
  }

  return { normPdf, normCdf, normInv, erf, randNormal, compute };
})();
