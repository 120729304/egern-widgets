/**
 * Egern 小组件：Komari 流量圆环 v1.1
 *
 * 读取每台机器的总流量和已用流量，一台机器一条跑道（赛车跑道式椭圆，
 * 从外到内按 1~N 排列），大尺寸上下布局：上面跑道、下面机器列表。
 *
 * Env：
 *   KOMARI_URL        Komari 面板地址（单面板），如 https://xxxxxx
 *   KOMARI_URLS       多面板地址，用 | 或换行分隔（与 KOMARI_URL 二选一）
 *   REFRESH_MINUTES   刷新间隔（分钟），10 ~ 180，默认 30
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

const RING_COLORS = ['#A855F7', '#0A84FF', '#30D158', '#FF9F0A', '#FF453A', '#64D2FF'];

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

/* 赛车跑道式椭圆：items 按顺序从外到内，{pct: 0~1 或 null(不限量只画轨道), color} */
function stadiumPath(cx, cy, a, r) {
  const f = (x) => x.toFixed(1);
  return (
    `M ${f(cx)} ${f(cy - r)} L ${f(cx + a)} ${f(cy - r)} ` +
    `A ${f(r)} ${f(r)} 0 0 1 ${f(cx + a)} ${f(cy + r)} ` +
    `L ${f(cx - a)} ${f(cy + r)} A ${f(r)} ${f(r)} 0 0 1 ${f(cx - a)} ${f(cy - r)} Z`
  );
}

function trackSvg(items, w, h) {
  const n = Math.max(1, items.length);
  const sw = Math.max(5, Math.min(11, Math.floor(Math.min(w, h) / (n * 2.6))));
  const gap = Math.max(2, Math.floor(sw / 3));
  const step = sw + gap;
  const cx = w / 2;
  const cy = h / 2;
  const r0 = h / 2 - sw / 2 - 1;
  const a0 = Math.max(0, w / 2 - r0 - sw / 2 - 1);
  let paths = '';
  items.forEach((it, i) => {
    const r = r0 - i * step;
    const a = Math.max(0, a0 - i * step * 0.8);
    if (r <= sw / 2) return;
    const d = stadiumPath(cx, cy, a, r);
    // 跑道周长：两条直道 + 一个整圆（不用 pathLength，Egern 渲染不支持）
    const perim = 4 * a + 2 * Math.PI * r;
    paths += `<path d="${d}" fill="none" stroke="${C.barTrack}" stroke-width="${sw}"/>`;
    const p = it.pct == null ? 0 : Math.max(0, Math.min(1, it.pct));
    if (p > 0) {
      paths +=
        `<path d="${d}" fill="none" stroke="${it.color}" stroke-width="${sw}" ` +
        `stroke-linecap="round" stroke-dasharray="${(perim * p).toFixed(1)} ${perim.toFixed(1)}"/>`;
    }
  });
  return svgUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${paths}</svg>`
  );
}

/* 同心圆环（锁屏圆形小组件用）：items 按顺序从外到内 */
function ringsSvg(items, size) {
  const n = Math.max(1, items.length);
  const sw = Math.max(5, Math.min(12, Math.floor(size / (n * 3.4))));
  const gap = Math.max(2, Math.floor(sw / 3));
  const step = sw + gap;
  const c = size / 2;
  const r0 = c - sw / 2 - 1;
  let circles = '';
  items.forEach((it, i) => {
    const r = r0 - i * step;
    if (r <= sw / 2) return;
    const rr = r.toFixed(1);
    const circ = 2 * Math.PI * r;
    circles += `<circle cx="${c}" cy="${c}" r="${rr}" fill="none" stroke="${C.barTrack}" stroke-width="${sw}"/>`;
    const p = it.pct == null ? 0 : Math.max(0, Math.min(1, it.pct));
    if (p > 0) {
      circles +=
        `<circle cx="${c}" cy="${c}" r="${rr}" fill="none" stroke="${it.color}" stroke-width="${sw}" ` +
        `stroke-linecap="round" stroke-dasharray="${(circ * p).toFixed(1)} ${circ.toFixed(1)}" ` +
        `transform="rotate(-90 ${c} ${c})"/>`;
    }
  });
  return svgUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${circles}</svg>`
  );
}

function dot(color, d = 8) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${d}" height="${d}"><circle cx="${d / 2}" cy="${d / 2}" r="${d / 2}" fill="${color}"/></svg>`;
  return { type: 'image', src: svgUri(svg), width: d, height: d };
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
  return (u === 0 ? String(Math.round(num)) : num.toFixed(num >= 100 ? 0 : 1)) + ' ' + units[u];
}

function fmtTime(ms) {
  const d = new Date(ms);
  const p = (x) => String(x).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function pctColor(p) {
  if (p == null) return C.dim;
  if (p >= 90) return C.bad;
  if (p >= 70) return C.warn;
  return C.ok;
}

function refreshAt(ctx) {
  const v = Number(ctx.env?.REFRESH_MINUTES);
  const min = Number.isFinite(v) ? Math.min(180, Math.max(10, v)) : 30;
  return new Date(Date.now() + min * 60000).toISOString();
}

/* ---------------- 数据抓取 ---------------- */

async function apiGet(ctx, base, path, params) {
  base = String(base || '').replace(/\/+$/, '');
  if (!base) throw new Error('请在 Env 里填写 KOMARI_URL（单面板）或 KOMARI_URLS（多面板）');
  if (!/^https?:\/\//i.test(base)) {
    throw new Error(`面板地址格式不对：${base}，请填写完整地址，如 https://xxxxxx`);
  }
  let url = base + path;
  if (params) {
    const qs = Object.entries(params)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    if (qs) url += '?' + qs;
  }
  let resp;
  try {
    resp = await ctx.http.get(url, {
      timeout: 12000,
      redirect: 'follow',
      headers: { 'User-Agent': 'egern-komari/1.0', Accept: 'application/json' },
    });
  } catch (e) {
    throw new Error(`请求面板失败：${String((e && e.message) || e).slice(0, 60)}`);
  }
  const status = resp.status ?? 200;
  if (status < 200 || status >= 300) throw new Error(`面板返回 HTTP ${status}`);
  const data = await resp.json();
  return data && data.data !== undefined ? data.data : data;
}

function panelList(ctx) {
  const multi = String(ctx.env?.KOMARI_URLS || '');
  const urls = multi
    .split(/[\s|,，\n]+/)
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  if (urls.length) return urls;
  const single = String(ctx.env?.KOMARI_URL || '').trim().replace(/\/+$/, '');
  return single ? [single] : [];
}

function panelHost(base) {
  try {
    return new URL(base).host;
  } catch {
    return base;
  }
}

async function loadData(ctx) {
  const panels = panelList(ctx);
  if (!panels.length) throw new Error('请在 Env 里填写 KOMARI_URL');
  panels.forEach((b) => {
    if (!/^https?:\/\//i.test(b)) throw new Error(`面板地址格式不对：${b}`);
  });

  const sections = await Promise.all(
    panels.map(async (base) => {
      const host = panelHost(base);
      let nodes = [];
      try {
        nodes = (await apiGet(ctx, base, '/api/nodes')) || [];
      } catch (e) {
        return { base, host, error: String((e && e.message) || e), nodes: [] };
      }
      const list = await Promise.all(
        nodes.map(async (n, idx) => {
          let used = 0;
          try {
            const recs = (await apiGet(ctx, base, `/api/recent/${n.uuid}`)) || [];
            if (recs.length) {
              recs.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
              const net = recs[0].network || {};
              used = (Number(net.totalUp) || 0) + (Number(net.totalDown) || 0);
            }
          } catch {
            // 忽略单个节点失败
          }
          const limit = Number(n.traffic_limit) || 0;
          const unlimited = limit <= 0;
          return {
            name: n.name || `节点${idx + 1}`,
            used,
            limit,
            unlimited,
            pct: unlimited ? null : (used / limit) * 100,
            color: RING_COLORS[idx % RING_COLORS.length],
          };
        })
      );
      return { base, host, nodes: list };
    })
  );

  const numPrefix = (n) => {
    const m = String(n || '').match(/^(\d+)/);
    return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
  };
  const list = [];
  sections.forEach((s) => {
    s.nodes.sort(
      (a, b) => numPrefix(a.name) - numPrefix(b.name) || String(a.name).localeCompare(String(b.name))
    );
    s.nodes.forEach((n, i) => {
      n.color = RING_COLORS[list.length % RING_COLORS.length];
      list.push(n);
    });
  });
  const errors = sections.filter((s) => s.error).map((s) => `${s.host}：${s.error}`);
  return { list, errors, at: Date.now() };
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
          { type: 'image', src: 'sf-symbol:gauge.with.dots.needle.67percent', width: 13, height: 13, color: C.accent },
          T('流量圆环', 13, C.text, 'semibold'),
        ],
      },
      { type: 'spacer' },
      T(message, 14, C.text, 'semibold'),
      T(sub, 11, C.dim, 'regular', { maxLines: 4 }),
      { type: 'spacer' },
    ],
  };
}

function listRow(s) {
  const right = s.unlimited
    ? `${fmtBytes(s.used)} / 不限量`
    : `${fmtBytes(s.used)} / ${fmtBytes(s.limit)}`;
  return {
    type: 'stack',
    direction: 'row',
    alignItems: 'center',
    gap: 6,
    children: [
      dot(s.color),
      // 名字超长截断，不缩小，保证每行字号一致
      T(s.name, 13, C.text, 'semibold', { minScale: 1 }),
      { type: 'spacer' },
      T(right, 12, C.dim, 'regular'),
      T(s.pct == null ? '--' : `${s.pct.toFixed(0)}%`, 13, pctColor(s.pct), 'semibold'),
    ],
  };
}

function lockWidget(list) {
  const s = list[0];
  const fam = 'accessoryCircular';
  if (!s) return { type: 'widget', children: [{ type: 'text', text: '待配置' }] };
  return {
    type: 'widget',
    padding: 8,
    backgroundImage: ringsSvg([{ pct: s.pct == null ? 0 : s.pct / 100, color: s.color }], 60),
    children: [
      { type: 'spacer' },
      { type: 'text', text: s.pct == null ? '--' : `${s.pct.toFixed(0)}%`, font: { size: 15, weight: 'bold' }, textAlign: 'center' },
      { type: 'text', text: s.name, font: { size: 8 }, textAlign: 'center', opacity: 0.7, maxLines: 1 },
      { type: 'spacer' },
    ],
  };
}

/* ---------------- 入口 ---------------- */

export default async function (ctx) {
  const family = ctx.widgetFamily || 'systemMedium';

  let data;
  try {
    data = await loadData(ctx);
  } catch (e) {
    return emptyWidget('读取失败', String((e && e.message) || e).slice(0, 120));
  }
  const { list, errors, at } = data;
  if (!list.length) {
    return emptyWidget('没有节点', errors.length ? errors[0].slice(0, 120) : '面板上没有找到节点');
  }

  if (family === 'accessoryCircular') return lockWidget(list);
  if (family === 'accessoryInline') {
    const s = list[0];
    return {
      type: 'widget',
      children: [
        {
          type: 'text',
          text: `${s.name} ${s.pct == null ? fmtBytes(s.used) : s.pct.toFixed(0) + '%'}·${list.length}台`,
          maxLines: 1,
          minScale: 0.6,
        },
      ],
    };
  }
  if (family === 'accessoryRectangular') {
    return {
      type: 'widget',
      padding: [2, 4],
      gap: 2,
      children: list.slice(0, 2).map((s, i) => ({
        type: 'text',
        text: `${s.name} ${s.pct == null ? fmtBytes(s.used) : s.pct.toFixed(0) + '%'}`,
        font: { size: i === 0 ? 'caption1' : 'caption2', weight: i === 0 ? 'semibold' : 'regular' },
        maxLines: 1,
        minScale: 0.6,
        ...(i === 1 ? { opacity: 0.7 } : {}),
      })),
    };
  }

  const totalUsed = list.reduce((a, s) => a + s.used, 0);
  const head = (title) => ({
    type: 'stack',
    direction: 'row',
    alignItems: 'center',
    gap: 6,
    children: [
      { type: 'image', src: 'sf-symbol:gauge.with.dots.needle.67percent', width: 14, height: 14, color: C.accent },
      T(title, 14, C.text, 'semibold'),
      { type: 'spacer' },
      T(`更新 ${fmtTime(at)}`, 12, C.dim, 'regular'),
    ],
  });

  if (family === 'systemSmall') {
    const s = list[0];
    return {
      type: 'widget',
      padding: 14,
      gap: 6,
      backgroundGradient: bg(),
      refreshAfter: refreshAt(ctx),
      children: [
        head('流量圆环'),
        { type: 'spacer' },
        {
          type: 'image',
          src: trackSvg([{ pct: s.pct == null ? 0 : s.pct / 100, color: s.color }], 150, 62),
          width: 150,
          height: 62,
        },
        T(s.name, 14, C.text, 'semibold', { textAlign: 'center' }),
        T(s.pct == null ? '不限量' : `${s.pct.toFixed(1)}%`, 24, pctColor(s.pct), 'bold', { textAlign: 'center' }),
        T(`已用 ${fmtBytes(s.used)}${s.unlimited ? '' : ` / ${fmtBytes(s.limit)}`}`, 12, C.dim, 'regular', { textAlign: 'center' }),
        { type: 'spacer' },
      ],
    };
  }

  const trackItems = (arr) => arr.map((s) => ({ pct: s.pct == null ? 0 : s.pct / 100, color: s.color }));

  // systemMedium：左跑道 + 右列表，最多 4 台
  const mkSideBody = (maxNodes) => {
    const shown = list.slice(0, maxNodes);
    const rows = shown.map(listRow);
    if (list.length > shown.length) {
      rows.push(T(`还有 ${list.length - shown.length} 台，大尺寸查看`, 11, C.dim, 'regular'));
    }
    errors.forEach((e) => rows.push(T(e, 11, C.bad, 'regular')));
    return {
      type: 'stack',
      direction: 'row',
      alignItems: 'center',
      gap: 12,
      children: [
        {
          type: 'stack',
          direction: 'column',
          alignItems: 'center',
          gap: 6,
          children: [
            {
              type: 'image',
              src: trackSvg(trackItems(shown), 140, 92),
              width: 140,
              height: 92,
            },
            T(`总已用 ${fmtBytes(totalUsed)}`, 11, C.dim, 'regular'),
          ],
        },
        {
          type: 'stack',
          direction: 'column',
          alignItems: 'start',
          gap: 7,
          children: rows,
        },
      ],
    };
  };

  // systemLarge：上下布局，上面跑道、下面机器列表
  const mkTopBody = (maxNodes) => {
    const shown = list.slice(0, maxNodes);
    const rows = shown.map(listRow);
    if (list.length > shown.length) {
      rows.push(T(`还有 ${list.length - shown.length} 台`, 11, C.dim, 'regular'));
    }
    errors.forEach((e) => rows.push(T(e, 11, C.bad, 'regular')));
    return {
      type: 'stack',
      direction: 'column',
      alignItems: 'center',
      gap: 8,
      children: [
        {
          type: 'image',
          src: trackSvg(trackItems(shown), 310, 112),
          width: 310,
          height: 112,
        },
        T(`总已用 ${fmtBytes(totalUsed)}`, 11, C.dim, 'regular'),
        {
          type: 'stack',
          direction: 'column',
          alignItems: 'start',
          gap: 6,
          children: rows,
        },
      ],
    };
  };

  if (family === 'systemLarge' || family === 'systemExtraLarge') {
    return {
      type: 'widget',
      padding: 14,
      gap: 10,
      backgroundGradient: bg(),
      refreshAfter: refreshAt(ctx),
      children: [head('流量圆环'), mkTopBody(8), { type: 'spacer' }],
    };
  }

  // systemMedium（默认）
  return {
    type: 'widget',
    padding: 14,
    gap: 10,
    backgroundGradient: bg(),
    refreshAfter: refreshAt(ctx),
    children: [head('流量圆环'), mkSideBody(4), { type: 'spacer' }],
  };
}
