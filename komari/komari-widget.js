/**
 * Egern 小组件：Komari 探针监控 v1
 *
 * 从 Komari 面板公开 API 抓取：
 *   探针信息（在线状态 / 地区 / 运行时间）
 *   节点名称
 *   延迟情况（各 ping 任务最新延迟 + 丢包率）
 *   流量总量和使用量（累计上传/下载、套餐限额、使用率）
 *
 * Env：
 *   KOMARI_URL     面板地址，如 https://xxxxxx（必填）
 *   REFRESH_HOURS  刷新间隔（小时），0.5 ~ 24，默认 1
 *   MAX_NODES      中尺寸最多显示节点数，默认 4
 */

const C = {
  text: { light: '#000000', dark: '#FFFFFF' },
  dim: { light: '#3C3C4399', dark: '#EBEBF599' },
  ok: '#30D158',
  warn: '#FF9F0A',
  bad: '#FF453A',
  accent: '#0A84FF',
  barTrack: 'rgba(128,128,128,0.35)', // 进度条底色，深浅模式通用
};

// 进度条/圆环填充用的纯色（SVG 里不能用深浅自适应对象）
function barColor(p) {
  if (p == null) return '#8E8E93';
  if (p >= 90) return C.bad;
  if (p >= 70) return C.warn;
  return C.ok;
}

const ONLINE_THRESHOLD_SEC = 120; // 超过这么久没上报视为离线

/* ---------------- 基础组件 ---------------- */

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

function dot(color) {
  return { type: 'stack', width: 7, height: 7, borderRadius: 3.5, backgroundColor: color, children: [] };
}

function bg() {
  return {
    type: 'linear',
    colors: [
      { light: '#E8F1FF', dark: '#0A1628' },
      { light: '#F3EFFF', dark: '#140F2E' },
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

/* ---------------- 格式化 ---------------- */

function fmtBytes(num) {
  if (num == null) return '-';
  num = Number(num);
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let u = 0;
  while (num >= 1024 && u < units.length - 1) {
    num /= 1024;
    u++;
  }
  return (u === 0 ? String(Math.round(num)) : num.toFixed(1)) + ' ' + units[u];
}

function fmtUptime(sec) {
  sec = Math.floor(Number(sec) || 0);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d) return `${d}天${h}小时`;
  if (h) return `${h}小时${m}分`;
  return `${m}分`;
}

function pctColor(p) {
  if (p == null) return C.dim;
  if (p >= 90) return C.bad;
  if (p >= 70) return C.warn;
  return C.ok;
}

function refreshAt(ctx) {
  const v = Number(ctx.env?.REFRESH_HOURS);
  const h = Number.isFinite(v) ? Math.min(24, Math.max(0.5, v)) : 1;
  return new Date(Date.now() + h * 3600000).toISOString();
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
    throw new Error(`请求 ${url} 失败：${(e && e.message) || e}`);
  }
  const text = await resp.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('面板返回的不是 JSON');
  }
  if (data && data.status === 'error') throw new Error(data.message || 'API 错误');
  return data && typeof data === 'object' && 'data' in data ? data.data : data;
}

/* 面板地址列表：KOMARI_URLS（| 或换行分隔）优先，否则用 KOMARI_URL */
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

/* 用最近 24 小时历史算日均流量（字节/天），拿不到返回 null */
async function getDailyRate(ctx, base, uuid) {
  try {
    const data = (await apiGet(ctx, base, '/api/records/load', {
      uuid,
      load_type: 'network',
      hours: 24,
    })) || {};
    const recs = (data.records || []).filter((r) => r.time);
    if (recs.length < 2) return null;
    recs.sort((a, b) => String(a.time).localeCompare(String(b.time)));
    const total = (r) => (Number(r.net_total_up) || 0) + (Number(r.net_total_down) || 0);
    const first = recs[0];
    const last = recs[recs.length - 1];
    const t0 = total(first);
    const t1 = total(last);
    if (!(t1 > t0)) return null; // 计数器重置或无用量
    const hours = (new Date(last.time) - new Date(first.time)) / 3600000;
    if (!(hours >= 1)) return null;
    return ((t1 - t0) / hours) * 24;
  } catch {
    return null;
  }
}

async function loadData(ctx) {
  const panels = panelList(ctx);
  if (!panels.length) throw new Error('请在 Env 里填写 KOMARI_URL');
  // 校验地址格式，报错更明确
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

      let taskNames = {};
      try {
        const tasks = (await apiGet(ctx, base, '/api/task/ping')) || [];
        tasks.forEach((t) => {
          taskNames[t.id] = t.name || `任务${t.id}`;
        });
      } catch {
        // 面板可能没配置 ping 任务，忽略
      }

      const list = await Promise.all(
        nodes.map(async (n) => {
          let recent = null;
          try {
            const recs = (await apiGet(ctx, base, `/api/recent/${n.uuid}`)) || [];
            if (recs.length) {
              recs.sort((a, b) =>
                String(b.updated_at || '').localeCompare(String(a.updated_at || ''))
              );
              recent = recs[0];
            }
          } catch {
            // 忽略单个节点失败
          }

          let latency = {};
          let loss = null;
          try {
            const p = (await apiGet(ctx, base, '/api/records/ping', { uuid: n.uuid, hours: 1 })) || {};
            const latest = {};
            (p.records || []).forEach((r) => {
              const tid = r.task_id;
              const t = r.time || '';
              if (!(tid in latest) || t > latest[tid].t) latest[tid] = { t, v: r.value };
            });
            Object.entries(latest).forEach(([tid, o]) => {
              if (typeof o.v === 'number') latency[taskNames[tid] || `任务${tid}`] = o.v;
            });
            if (p.basic_info && p.basic_info[0] && typeof p.basic_info[0].loss === 'number') {
              loss = p.basic_info[0].loss;
            }
          } catch {
            // 忽略
          }

          // 只有有限流量的节点才算预测（省一次请求）
          let dailyRate = null;
          const limit = Number(n.traffic_limit) || 0;
          if (limit > 0) {
            dailyRate = await getDailyRate(ctx, base, n.uuid);
          }

          const info = buildInfo(n, recent, latency, loss, dailyRate);
          info.panel = host;
          return info;
        })
      );
      return { base, host, nodes: list };
    })
  );

  // 合并：按面板顺序，每面板内按名称数字前缀排序
  const numPrefix = (n) => {
    const m = String(n || '').match(/^(\d+)/);
    return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
  };
  const list = [];
  sections.forEach((s) => {
    s.nodes.sort(
      (a, b) => numPrefix(a.name) - numPrefix(b.name) || String(a.name).localeCompare(String(b.name))
    );
    list.push(...s.nodes);
  });
  return { list, panels: sections.map((s) => ({ host: s.host, error: s.error || null })) };
}

function buildInfo(node, recent, latency, loss, dailyRate) {
  const net = (recent && recent.network) || {};
  const up = Number(net.totalUp) || 0;
  const down = Number(net.totalDown) || 0;
  const used = up + down;
  const limit = Number(node.traffic_limit) || 0;
  const unlimited = limit <= 0;

  let online = false;
  if (recent && recent.updated_at) {
    const age = (Date.now() - new Date(recent.updated_at).getTime()) / 1000;
    online = age <= ONLINE_THRESHOLD_SEC;
  }

  const vals = Object.values(latency).filter((v) => typeof v === 'number' && v >= 0);
  const avgPing = vals.length
    ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
    : null;

  // 到期信息
  let expiry = null;
  if (node.expired_at) {
    const exp = new Date(node.expired_at);
    if (!isNaN(exp)) {
      const days = Math.ceil((exp - Date.now()) / 86400000);
      const bc = Number(node.billing_cycle);
      const cycle = bc === 365 ? '年' : bc === 30 ? '月' : bc === 90 ? '季' : bc ? `${bc}天` : '';
      expiry = {
        days,
        date: `${exp.getFullYear()}-${String(exp.getMonth() + 1).padStart(2, '0')}-${String(exp.getDate()).padStart(2, '0')}`,
        price: node.price ? `${node.currency || ''}${node.price}${cycle ? `/${cycle}` : ''}` : '',
      };
    }
  }

  // 流量用完预测（天）
  let predictDays = null;
  if (!unlimited && limit && dailyRate && dailyRate > 0) {
    const remain = limit - used;
    if (remain > 0) predictDays = remain / dailyRate;
  }

  return {
    name: node.name || node.uuid,
    region: node.region || '',
    online,
    uptime: recent ? recent.uptime : null,
    latency,
    loss,
    avgPing,
    up,
    down,
    used,
    limit,
    unlimited,
    pct: !unlimited && limit ? (used / limit) * 100 : null,
    expiry,
    predictDays,
    panel: '',
  };
}

/* ---------------- 渲染 ---------------- */

function headerRow(title, right) {
  return {
    type: 'stack',
    direction: 'row',
    alignItems: 'center',
    gap: 6,
    children: [
      { type: 'image', src: 'sf-symbol:server.rack', width: 14, height: 14, color: C.accent },
      T(title, 14, C.text, 'semibold'),
      { type: 'spacer' },
      T(right, 12, C.dim, 'regular'),
    ],
  };
}

/* 流量文本：已用/总量 + 预测 */
function trafficText(s) {
  const base = s.unlimited
    ? `已用 ${fmtBytes(s.used)} / 不限量`
    : `已用 ${fmtBytes(s.used)} / ${fmtBytes(s.limit)}${s.pct == null ? '' : ` ${s.pct.toFixed(0)}%`}`;
  if (s.predictDays != null && s.predictDays > 0 && s.predictDays <= 365) {
    const d = Math.round(s.predictDays);
    return `${base} · 预计${d}天后用完`;
  }
  return base;
}

/* 到期文本行元素 */
function expiryKids(s, warnDays) {
  const e = s.expiry;
  if (!e) return [];
  const urgent = e.days <= warnDays;
  const txt =
    e.days < 0 ? `已过期${-e.days}天` : e.days === 0 ? '今天到期' : `到期 ${e.date}（${e.days}天）`;
  return [
    T('·', 13, C.dim, 'regular'),
    T((txt + (e.price ? ` ${e.price}` : '')).trim(), 13, urgent ? C.bad : C.dim, urgent ? 'semibold' : 'regular'),
  ];
}

function nodeRow(s, barW) {
  const children = [
    {
      type: 'stack',
      direction: 'row',
      alignItems: 'end',
      gap: 5,
      children: [
        {
          type: 'stack',
          direction: 'row',
          alignItems: 'center',
          gap: 5,
          children: [
            dot(s.online ? C.ok : C.bad),
            T(s.name, 14, C.text, 'semibold'),
          ],
        },
        { type: 'spacer' },
        T(s.region, 20, C.dim, 'regular'),
      ],
    },
    {
      type: 'stack',
      direction: 'row',
      alignItems: 'center',
      gap: 5,
      children: [
        T(
          (s.avgPing == null ? '延迟 --' : `延迟 ${s.avgPing}ms`) +
            (s.loss ? ` · 丢包${s.loss.toFixed(1)}%` : ''),
          13,
          C.dim,
          'regular'
        ),
        { type: 'spacer' },
        T(
          trafficText(s),
          13,
          s.pct == null ? C.dim : pctColor(s.pct),
          'regular'
        ),
      ],
    },
  ];
  if (!s.unlimited) {
    children.push({
      type: 'image',
      src: barSvg((s.pct || 0) / 100, barColor(s.pct), barW, 4),
      width: barW,
      height: 4,
    });
  }
  return { type: 'stack', direction: 'column', alignItems: 'start', gap: 2, children };
}

/* 节点太多时用的单行紧凑模式 */
function nodeRowCompact(s) {
  return {
    type: 'stack',
    direction: 'row',
    alignItems: 'center',
    gap: 5,
    children: [
      dot(s.online ? C.ok : C.bad),
      T(s.name, 12, C.text, 'semibold'),
      { type: 'spacer' },
      T(s.avgPing == null ? '--' : `${s.avgPing}ms`, 11, C.dim, 'regular'),
      T(
        s.unlimited ? fmtBytes(s.used) : s.pct == null ? '-' : `${s.pct.toFixed(0)}%`,
        11,
        s.pct == null ? C.dim : pctColor(s.pct),
        'semibold'
      ),
    ],
  };
}

function nodeRowDetail(s, barW, warnDays) {
  const row = nodeRow(s, barW);
  const tasks = Object.entries(s.latency);
  if (tasks.length) {
    const line = tasks
      .map(([k, v]) => `${k} ${v < 0 ? '超时' : `${v}ms`}`)
      .join(' · ');
    row.children.splice(2, 0, T(line, 13, C.dim, 'regular'));
  }
  if (s.uptime || s.expiry) {
    const kids = [];
    if (s.uptime) kids.push(T(`运行 ${fmtUptime(s.uptime)}`, 13, C.dim, 'regular'));
    kids.push(...expiryKids(s, warnDays));
    row.children.splice(1, 0, {
      type: 'stack',
      direction: 'row',
      alignItems: 'center',
      gap: 4,
      children: kids,
    });
  }
  return row;
}

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
          { type: 'image', src: 'sf-symbol:server.rack', width: 13, height: 13, color: C.accent },
          T('Komari 探针', 13, C.text, 'semibold'),
        ],
      },
      { type: 'spacer' },
      T(message, 14, C.text, 'semibold'),
      T(sub, 11, C.dim, 'regular', { maxLines: 3 }),
      { type: 'spacer' },
    ],
  };
}

function lockWidget(list, family) {
  const online = list.filter((s) => s.online).length;
  if (family === 'accessoryInline') {
    return {
      type: 'widget',
      children: [
        {
          type: 'text',
          text: list.length ? `探针 ${online}/${list.length} 在线` : '探针：待配置',
          maxLines: 1,
          minScale: 0.6,
        },
      ],
    };
  }
  if (family === 'accessoryCircular') {
    const p = list.length ? online / list.length : 0;
    return {
      type: 'widget',
      padding: 8,
      backgroundImage: ringSvg(p, p >= 1 ? C.ok : C.warn, 60, 6),
      children: [
        { type: 'spacer' },
        { type: 'text', text: `${online}/${list.length}`, font: { size: 13, weight: 'bold' }, textAlign: 'center' },
        { type: 'text', text: '在线', font: { size: 9 }, textAlign: 'center', opacity: 0.7 },
        { type: 'spacer' },
      ],
    };
  }
  // accessoryRectangular
  return {
    type: 'widget',
    padding: [2, 4],
    gap: 2,
    children: list.slice(0, 3).map((s) => ({
      type: 'stack',
      direction: 'row',
      alignItems: 'center',
      gap: 4,
      children: [
        dot(s.online ? C.ok : C.bad),
        {
          type: 'text',
          text: `${s.name} ${s.avgPing == null ? '--' : `${s.avgPing}ms`}`,
          font: { size: 'caption1', weight: 'semibold' },
          maxLines: 1,
          minScale: 0.6,
        },
      ],
    })),
  };
}

/* ---------------- 入口 ---------------- */

export default async function (ctx) {
  const family = ctx.widgetFamily || 'systemMedium';

  let list;
  let panels;
  try {
    ({ list, panels } = await loadData(ctx));
  } catch (e) {
    const msg = String((e && e.message) || e);
    if (msg.includes('KOMARI_URL')) {
      return emptyWidget('等待面板地址', '在 Env 里填写 KOMARI_URL，如 https://xxxxxx');
    }
    return emptyWidget('读取失败', msg.slice(0, 120));
  }

  if (family.startsWith('accessory')) return lockWidget(list, family);
  if (!list.length) return emptyWidget('没有节点', '面板上没有可见的探针节点');

  // 排序已在 loadData 内完成（面板顺序 + 名称数字前缀）
  const multi = panels.length > 1;
  const sections = panels.map((p) => ({
    host: p.host,
    error: p.error,
    nodes: list.filter((n) => n.panel === p.host),
  }));

  const online = list.filter((s) => s.online).length;
  const head = `${online}/${list.length} 在线`;

  const wd = parseInt(ctx.env?.EXPIRE_WARN_DAYS, 10);
  const warnDays = Number.isFinite(wd) && wd >= 0 ? wd : 14;

  const divider = (sec) => ({
    type: 'stack',
    direction: 'row',
    alignItems: 'center',
    gap: 6,
    children: [
      T(`▸ ${sec.host}`, 11, C.accent, 'semibold'),
      ...(sec.error ? [T('连接失败', 10, C.bad, 'regular')] : []),
    ],
  });

  if (family === 'systemSmall') {
    const totalUsed = list.reduce((a, s) => a + s.used, 0);
    // 即将到期的节点数
    const urgent = list.filter((s) => s.expiry && s.expiry.days <= warnDays).length;
    return {
      type: 'widget',
      padding: 14,
      gap: 6,
      backgroundGradient: bg(),
      refreshAfter: refreshAt(ctx),
      children: [
        headerRow('Komari 探针', head),
        { type: 'spacer' },
        T(`${online}/${list.length} 在线`, 24, C.text, 'bold'),
        T(`节点总已用 ${fmtBytes(totalUsed)}`, 12, C.dim, 'regular'),
        ...(urgent
          ? [T(`⚠️ ${urgent} 台服务器 ${warnDays} 天内到期`, 12, C.bad, 'semibold')]
          : []),
        { type: 'spacer' },
      ],
    };
  }

  if (family === 'systemLarge' || family === 'systemExtraLarge') {
    // 节点太多放不下时自动切换紧凑模式（一行一个），阈值可用 Env 调整
    const ct = parseInt(ctx.env?.COMPACT_THRESHOLD, 10);
    const threshold = Number.isFinite(ct) && ct > 0 ? ct : 8;
    const compact = list.length > threshold;
    const rows = sections.flatMap((sec) => [
      ...(multi ? [divider(sec)] : []),
      ...(compact ? sec.nodes.map(nodeRowCompact) : sec.nodes.map((s) => nodeRowDetail(s, 300, warnDays))),
    ]);
    return {
      type: 'widget',
      padding: 14,
      gap: 0.5,
      backgroundGradient: bg(),
      refreshAfter: refreshAt(ctx),
      children: [headerRow('Komari 探针', head), ...rows, { type: 'spacer' }],
    };
  }

  // systemMedium（默认）
  const maxNodes = Math.max(1, parseInt(ctx.env?.MAX_NODES, 10) || 4);
  const children = [headerRow('Komari 探针', head)];
  let remaining = maxNodes;
  sections.forEach((sec) => {
    if (remaining <= 0) return;
    if (multi && sec.nodes.length) children.push(divider(sec));
    const take = sec.nodes.slice(0, remaining);
    take.forEach((s) => children.push(nodeRow(s, 280)));
    remaining -= take.length;
  });
  if (list.length > maxNodes) {
    children.push(T(`还有 ${list.length - maxNodes} 个节点，大尺寸查看全部`, 11, C.dim, 'regular'));
  }
  children.push({ type: 'spacer' });
  return {
    type: 'widget',
    padding: 14,
    gap: 7,
    backgroundGradient: bg(),
    refreshAfter: refreshAt(ctx),
    children,
  };
}
