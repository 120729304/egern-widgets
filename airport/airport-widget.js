/**
 * Egern 小组件：机场流量 v1
 *
 * 从机场订阅链接的 subscription-userinfo 响应头读取：
 *   流量（已用 / 总量 / 剩余 / 使用率）
 *   到期时间（日期 + 剩余天数）
 *
 * Env：
 *   SUB_URLS         订阅链接，多个用 | 或换行分隔；可用「名字=链接」命名，如 我的机场=https://sub.xxx/abc
 *   REFRESH_MINUTES  刷新间隔（分钟），10 ~ 720，默认 60
 *   WARN_DAYS        到期提醒阈值（天），默认 7，剩余天数小于等于此值标红
 *   WARN_PCT         流量使用告警百分比，默认 90
 *   USER_AGENT       请求订阅时用的 UA，默认 ClashMeta/1.18.0（有些机场只给 Clash/Stash 类客户端返回流量头）
 *   DEBUG            填 1 开启调试，失败时在小组件里显示状态码和响应头名称
 */

const C = {
  text: { light: '#000000', dark: '#FFFFFF' },
  dim: { light: '#3C3C4399', dark: '#EBEBF599' },
  ok: '#30D158',
  warn: '#FF9F0A',
  bad: '#FF453A',
  accent: '#0A84FF',
  barTrack: 'rgba(128,128,128,0.35)',
};

function T(value, size, color, weight = 'regular', extra = {}) {
  return {
    type: 'text',
    text: String(value),
    font: { size, weight },
    textColor: color || C.text,
    maxLines: 1,
    minScale: 0.6,
    ...extra,
  };
}

function bg() {
  return {
    type: 'linear',
    colors: [
      { light: '#E3F2FF', dark: '#0A1E38' },
      { light: '#F0F7FF', dark: '#0D2444' },
    ],
    stops: [0, 1],
    startPoint: { x: 0, y: 0 },
    endPoint: { x: 1, y: 1 },
  };
}

function svgUri(svg) {
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

function barSvg(pct, color, w, h) {
  const p = Math.max(0, Math.min(1, pct == null ? 0 : pct));
  const r = h / 2;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
    `<rect width="${w}" height="${h}" rx="${r}" fill="${C.barTrack}"/>` +
    `<rect width="${(w * p).toFixed(1)}" height="${h}" rx="${r}" fill="${color}"/></svg>`;
  return svgUri(svg);
}

function ringSvg(pct, color, size, sw) {
  const r = (size - sw) / 2;
  const c = size / 2;
  const p = Math.max(0, Math.min(1, pct));
  const circ = 2 * Math.PI * r;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${C.barTrack}" stroke-width="${sw}"/>` +
    `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}" ` +
    `stroke-linecap="round" stroke-dasharray="${(circ * p).toFixed(1)} ${circ.toFixed(1)}" ` +
    `transform="rotate(-90 ${c} ${c})"/></svg>`;
  return svgUri(svg);
}

function headerRow(title, right) {
  return {
    type: 'stack',
    direction: 'row',
    alignItems: 'center',
    gap: 6,
    children: [
      { type: 'image', src: 'sf-symbol:airplane', width: 14, height: 14, color: C.accent },
      T(title, 14, C.text, 'semibold'),
      { type: 'spacer' },
      T(right, 12, C.dim, 'regular'),
    ],
  };
}

/* ---------------- 格式化 ---------------- */

function fmtBytes(num) {
  if (num == null || !Number.isFinite(Number(num))) return '-';
  num = Number(num);
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let u = 0;
  while (num >= 1024 && u < units.length - 1) {
    num /= 1024;
    u++;
  }
  return (u === 0 ? String(Math.round(num)) : num.toFixed(1)) + ' ' + units[u];
}

function fmtDate(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function pctColor(p, warnPct) {
  if (p == null) return C.dim;
  if (p >= warnPct) return C.bad;
  if (p >= 70) return C.warn;
  return C.ok;
}

function refreshAt(ctx) {
  const v = Number(ctx.env?.REFRESH_MINUTES);
  const min = Number.isFinite(v) ? Math.min(720, Math.max(10, v)) : 60;
  return new Date(Date.now() + min * 60000).toISOString();
}

/* ---------------- 数据抓取 ---------------- */

/* 兼容多种响应头形状：普通对象（大小写不敏感）、Headers-like（.get）、数组 */
function headerVal(headers, name) {
  if (!headers) return '';
  const target = String(name).toLowerCase();
  try {
    if (typeof headers.get === 'function') {
      const v = headers.get(name);
      if (v != null && v !== '') return String(v);
      const v2 = headers.get(target);
      if (v2 != null && v2 !== '') return String(v2);
    }
    if (Array.isArray(headers)) {
      for (const pair of headers) {
        if (Array.isArray(pair) && String(pair[0]).toLowerCase() === target) return String(pair[1]);
      }
    } else if (typeof headers === 'object') {
      for (const k of Object.keys(headers)) {
        if (k.toLowerCase() === target) {
          const v = headers[k];
          return String(Array.isArray(v) ? v[0] : v);
        }
      }
    }
  } catch {
    // 忽略
  }
  return '';
}

/* 列出响应头名称（调试用） */
function headerNames(headers) {
  const names = [];
  try {
    if (!headers) return names;
    if (typeof headers.keys === 'function') {
      for (const k of headers.keys()) names.push(String(k));
    } else if (Array.isArray(headers)) {
      for (const p of headers) if (Array.isArray(p)) names.push(String(p[0]));
    } else if (typeof headers === 'object') {
      names.push(...Object.keys(headers));
    }
  } catch {
    // 忽略
  }
  return names;
}

/* 解析 subscription-userinfo: upload=..; download=..; total=..; expire=.. */
function parseUserInfo(str) {
  const s = String(str || '');
  const field = (key) => {
    const m = s.match(new RegExp(key + '=([+-]?[0-9]+(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)'));
    return m ? Number(m[1]) : NaN;
  };
  return {
    upload: field('upload'),
    download: field('download'),
    total: field('total'),
    expire: field('expire'),
  };
}

function usable(info) {
  return (
    info &&
    Number.isFinite(info.total) && info.total > 0 &&
    Number.isFinite(info.upload) && Number.isFinite(info.download)
  );
}

async function fetchSub(ctx, url) {
  const ua = String(ctx.env?.USER_AGENT || 'ClashMeta/1.18.0');
  const debug = String(ctx.env?.DEBUG || '').trim() === '1';
  const opt = {
    timeout: 15000,
    redirect: 'follow',
    headers: { 'User-Agent': ua },
  };
  const notes = [];
  const note = (s) => {
    if (debug && notes.length < 8) notes.push(s);
  };
  let lastErr = null;
  // 先 HEAD（不下载正文），拿不到再 GET
  try {
    const resp = await ctx.http.head(url, opt);
    note(`HEAD 状态 ${resp.status ?? '?'}`);
    const info = parseUserInfo(headerVal(resp.headers, 'subscription-userinfo'));
    if (usable(info)) return info;
    note(`HEAD 响应头：${headerNames(resp.headers).join(', ') || '无'}`);
  } catch (e) {
    lastErr = e;
    note(`HEAD 异常：${String((e && e.message) || e).slice(0, 40)}`);
  }
  let resp;
  try {
    resp = await ctx.http.get(url, opt);
    note(`GET 状态 ${resp.status ?? '?'}`);
  } catch (e) {
    const msg = `请求订阅失败：${String((e && e.message) || e).slice(0, 80)}`;
    throw new Error(debug ? `${msg} [${notes.join('；')}]` : msg);
  }
  // 有些面板把流量信息放在正文里，顺带解析一下
  let text = '';
  try {
    text = await resp.text();
  } catch {
    // 忽略
  }
  let info = parseUserInfo(headerVal(resp.headers, 'subscription-userinfo'));
  if (!usable(info)) {
    note(`GET 响应头：${headerNames(resp.headers).join(', ') || '无'}`);
    info = parseUserInfo(text.slice(0, 2000));
  }
  if (!usable(info)) {
    const base = lastErr
      ? `HEAD/GET 均失败：${String(lastErr.message || lastErr).slice(0, 60)}`
      : '订阅未返回流量信息（无 subscription-userinfo 响应头）';
    throw new Error(debug ? `${base} [${notes.join('；')}]` : base);
  }
  return info;
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return '订阅';
  }
}

/* 解析 SUB_URLS：换行或 | 分隔，每项支持「名字=链接」 */
function subList(ctx) {
  const raw = String(ctx.env?.SUB_URLS || '');
  const items = raw
    .split(/\r?\n|\|/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => /^https?:\/\//i.test(s) || (/=/.test(s) && /https?:\/\//i.test(s)));
  return items.map((s) => {
    const m = s.match(/^([^=]+?)=\s*(https?:\/\/.+)$/);
    if (m && !/:\/\//.test(m[1])) return { name: m[1].trim(), url: m[2].trim() };
    return { name: '', url: s };
  });
}

function buildInfo(entry, info) {
  const used = info.upload + info.download;
  const total = info.total;
  const remain = Math.max(0, total - used);
  const pct = (used / total) * 100;
  let expire = null;
  if (Number.isFinite(info.expire) && info.expire > 0) {
    const ms = info.expire * 1000;
    expire = {
      ms,
      date: fmtDate(ms),
      days: Math.ceil((ms - Date.now()) / 86400000),
    };
  }
  return {
    name: entry.name || hostOf(entry.url),
    used,
    total,
    remain,
    pct,
    expire,
  };
}

function expireText(s, warnDays) {
  const e = s.expire;
  if (!e) return { text: '不限时', color: C.dim, urgent: false };
  const urgent = e.days <= warnDays;
  const color = urgent ? C.bad : C.dim;
  if (e.days < 0) return { text: `已过期${-e.days}天`, color: C.bad, urgent: true };
  if (e.days === 0) return { text: '今天到期', color: C.bad, urgent: true };
  return { text: `${e.date}（${e.days}天）`, color, urgent };
}

/* ---------------- 渲染 ---------------- */

function emptyWidget(message, sub) {
  return {
    type: 'widget',
    padding: 16,
    gap: 8,
    backgroundGradient: bg(),
    children: [
      {
        type: 'stack',
        direction: 'row',
        alignItems: 'center',
        gap: 5,
        children: [
          { type: 'image', src: 'sf-symbol:airplane', width: 13, height: 13, color: C.accent },
          T('机场流量', 13, C.text, 'semibold'),
        ],
      },
      { type: 'spacer' },
      T(message, 14, C.text, 'semibold'),
      T(sub, 11, C.dim, 'regular', { maxLines: 4 }),
      { type: 'spacer' },
    ],
  };
}

function subBlock(s, barW, warnDays, warnPct, detail) {
  const exp = expireText(s, warnDays);
  const children = [
    {
      type: 'stack',
      direction: 'row',
      alignItems: 'center',
      gap: 5,
      children: [
        T(s.name, 13, C.text, 'semibold'),
        { type: 'spacer' },
        T(exp.urgent ? `⚠️ ${exp.text}` : exp.text, 12, exp.color, exp.urgent ? 'semibold' : 'regular'),
      ],
    },
    {
      type: 'image',
      src: barSvg(s.pct / 100, pctColor(s.pct, warnPct), barW, 5),
      width: barW,
      height: 5,
    },
    {
      type: 'stack',
      direction: 'row',
      alignItems: 'center',
      gap: 5,
      children: [
        T(`已用 ${fmtBytes(s.used)} / ${fmtBytes(s.total)}`, 12, C.dim, 'regular'),
        { type: 'spacer' },
        T(`${s.pct.toFixed(s.pct < 10 ? 1 : 0)}%`, 12, pctColor(s.pct, warnPct), 'semibold'),
      ],
    },
  ];
  if (detail) {
    children.push(
      T(`剩余 ${fmtBytes(s.remain)}${s.expire ? ` · 到期 ${s.expire.date}` : ' · 不限时'}`, 12, C.dim, 'regular')
    );
  }
  return { type: 'stack', direction: 'column', alignItems: 'start', gap: 3, children };
}

function lockWidget(list, family, warnDays) {
  const s = list[0];
  if (family === 'accessoryInline') {
    return {
      type: 'widget',
      children: [
        {
          type: 'text',
          text: s ? `${s.name} ${s.pct.toFixed(0)}%${s.expire ? ` · ${s.expire.days}天` : ''}` : '机场：待配置',
          maxLines: 1,
          minScale: 0.6,
        },
      ],
    };
  }
  if (family === 'accessoryCircular') {
    const p = s ? s.pct / 100 : 0;
    return {
      type: 'widget',
      padding: 8,
      backgroundImage: ringSvg(p, pctColor(s ? s.pct : null, 90), 60, 6),
      children: [
        { type: 'spacer' },
        { type: 'text', text: s ? `${s.pct.toFixed(0)}%` : '--', font: { size: 15, weight: 'bold' }, textAlign: 'center' },
        { type: 'text', text: '已用', font: { size: 9 }, textAlign: 'center', opacity: 0.7 },
        { type: 'spacer' },
      ],
    };
  }
  // accessoryRectangular
  return {
    type: 'widget',
    padding: [2, 4],
    gap: 2,
    children: (s
      ? [
          `${s.name} ${s.pct.toFixed(0)}%`,
          `剩余 ${fmtBytes(s.remain)}${s.expire ? ` · ${s.expire.days}天到期` : ''}`,
        ]
      : ['机场流量：待配置']
    ).map((t, i) => ({
      type: 'text',
      text: t,
      font: { size: i === 0 ? 'caption1' : 'caption2', weight: i === 0 ? 'semibold' : 'regular' },
      maxLines: 1,
      minScale: 0.6,
      ...(i === 1 ? { opacity: 0.7 } : {}),
    })),
  };
}

/* ---------------- 入口 ---------------- */

export default async function (ctx) {
  const family = ctx.widgetFamily || 'systemMedium';
  const wd = parseInt(ctx.env?.WARN_DAYS, 10);
  const warnDays = Number.isFinite(wd) && wd >= 0 ? wd : 7;
  const wp = parseFloat(ctx.env?.WARN_PCT);
  const warnPct = Number.isFinite(wp) && wp > 0 && wp <= 100 ? wp : 90;
  const debugOn = String(ctx.env?.DEBUG || '').trim() === '1';

  const entries = subList(ctx);
  if (!entries.length) {
    return emptyWidget('等待订阅链接', '在 Env 里填写 SUB_URLS（机场订阅链接），多个用 | 或换行分隔，可用「名字=链接」命名');
  }

  const results = await Promise.all(
    entries.map(async (e) => {
      try {
        const info = await fetchSub(ctx, e.url);
        return { ok: true, sub: buildInfo(e, info) };
      } catch (err) {
        const debug = String(ctx.env?.DEBUG || '').trim() === '1';
        const msg = String((err && err.message) || err);
        return { ok: false, name: e.name || hostOf(e.url), error: msg.slice(0, debug ? 400 : 60) };
      }
    })
  );
  const list = results.filter((r) => r.ok).map((r) => r.sub);
  const failed = results.filter((r) => !r.ok);

  if (family.startsWith('accessory')) return lockWidget(list, family, warnDays);
  if (!list.length) {
    return emptyWidget('读取失败', failed.length ? `${failed[0].name}：${failed[0].error}` : '未知错误');
  }

  const head = list.length > 1 ? `${list.length} 个订阅` : list[0].name;

  if (family === 'systemSmall') {
    const s = list[0];
    const exp = expireText(s, warnDays);
    return {
      type: 'widget',
      padding: 14,
      gap: 6,
      backgroundGradient: bg(),
      refreshAfter: refreshAt(ctx),
      children: [
        headerRow('机场流量', s.name),
        { type: 'spacer' },
        T(`${s.pct.toFixed(0)}%`, 32, C.text, 'bold'),
        T(`已用 ${fmtBytes(s.used)} / ${fmtBytes(s.total)}`, 12, C.dim, 'regular'),
        {
          type: 'image',
          src: barSvg(s.pct / 100, pctColor(s.pct, warnPct), 120, 5),
          width: 120,
          height: 5,
        },
        T(`剩余 ${fmtBytes(s.remain)} · ${exp.text}`, 12, exp.color, exp.urgent ? 'semibold' : 'regular'),
        { type: 'spacer' },
      ],
    };
  }

  if (family === 'systemLarge' || family === 'systemExtraLarge') {
    const shown = list.slice(0, 5);
    const children = [headerRow('机场流量', head)];
    shown.forEach((s) => children.push(subBlock(s, 300, warnDays, warnPct, true)));
    if (list.length > shown.length) {
      children.push(T(`还有 ${list.length - shown.length} 个订阅`, 11, C.dim, 'regular'));
    }
    failed.forEach((f) =>
      children.push(T(`${f.name}：${f.error}`, 11, C.bad, 'regular', { maxLines: debugOn ? 5 : 1 })));

    children.push({ type: 'spacer' });
    return {
      type: 'widget',
      padding: 14,
      gap: 8,
      backgroundGradient: bg(),
      refreshAfter: refreshAt(ctx),
      children,
    };
  }

  // systemMedium（默认）：最多 2 个
  const shown = list.slice(0, 2);
  const children = [headerRow('机场流量', head)];
  shown.forEach((s) => children.push(subBlock(s, 280, warnDays, warnPct, false)));
  if (list.length > shown.length) {
    children.push(T(`还有 ${list.length - shown.length} 个订阅，大尺寸查看`, 11, C.dim, 'regular'));
  }
  failed.forEach((f) =>
      children.push(T(`${f.name}：${f.error}`, 11, C.bad, 'regular', { maxLines: debugOn ? 5 : 1 })));

  children.push({ type: 'spacer' });
  return {
    type: 'widget',
    padding: 14,
    gap: 8,
    backgroundGradient: bg(),
    refreshAfter: refreshAt(ctx),
    children,
  };
}
