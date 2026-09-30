/* ============================================================
 * storage.js —— 本地数据模块
 * 功能：用 localStorage 保存每局成绩，支持多局对比与排行榜
 * 原理：作业要求纯前端、双击即可运行（无服务器），
 *       localStorage 是浏览器内置的键值数据库，刷新后不丢失
 * ============================================================ */
const Store = (function () {
  'use strict';

  const KEY = 'nightpilot.games.v1';

  /* 读取全部历史局（数组，按时间先后排列） */
  function all() {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || [];
    } catch (e) {
      return [];
    }
  }

  /* 保存一局成绩记录 */
  function save(rec) {
    const arr = all();
    arr.push(rec);
    try { localStorage.setItem(KEY, JSON.stringify(arr)); } catch (e) { /* 存储满时静默失败 */ }
  }

  /* 清空全部历史 */
  function clear() {
    localStorage.removeItem(KEY);
  }

  /* 排行榜：每种天气（难度）下的最佳 d' 记录 */
  function bestByWeather() {
    const best = {};
    all().forEach(function (g) {
      if (!best[g.weather] || g.dprime > best[g.weather].dprime) best[g.weather] = g;
    });
    return best;
  }

  return { all: all, save: save, clear: clear, bestByWeather: bestByWeather };
})();
