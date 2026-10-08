/**
 * Egern 小组件：天气 v1
 *
 * 数据源：Open-Meteo（免费、无需 key）
 * 显示：当前温度 / 天气 / 体感温度 / 湿度 / 风速、未来几小时逐小时、
 *       中尺寸右下角：明后天小预报 + 日出日落，大尺寸：未来 3 天预报
 *
 * Env：
 *   LOCATION         城市名（如 青岛）、"城市,省份"（如 青岛,山东）或 "纬度,经度"（如 36.07,120.38），默认 青岛
 *   REFRESH_MINUTES  刷新间隔（分钟），10 ~ 180，默认 30
 *   TEMP_UNIT        c 摄氏 / f 华氏，默认 c
 */

const C = {
  text: { light: '#000000', dark: '#FFFFFF' },
  dim: { light: '#3C3C4399', dark: '#EBEBF599' },
  accent: '#0A84FF',
  warn: '#FF9F0A',
};

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

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

function bg() {
  return {
    type: 'linear',
    colors: [
      { light: '#D9EBFF', dark: '#0A1A33' },
      { light: '#F2F7FF', dark: '#0E2140' },
    ],
    stops: [0, 1],
    startPoint: { x: 0, y: 0 },
    endPoint: { x: 1, y: 1 },
  };
}

function wIcon(sf, size, color) {
  return { type: 'image', src: 'sf-symbol:' + sf, width: size, height: size, color: color || C.accent };
}

function headerRow(title, right) {
  return {
    type: 'stack',
    direction: 'row',
    alignItems: 'center',
    gap: 6,
    children: [
      wIcon('cloud.sun', 14),
      T(title, 14, C.text, 'semibold'),
      { type: 'spacer' },
      T(right, 12, C.dim, 'regular'),
    ],
  };
}

/* ---------------- 天气码 ---------------- */

function wmo(code) {
  const c = Number(code);
  if (c === 0) return { desc: '晴', sf: 'sun.max' };
  if (c === 1 || c === 2) return { desc: '多云', sf: 'cloud.sun' };
  if (c === 3) return { desc: '阴', sf: 'cloud' };
  if (c === 45 || c === 48) return { desc: '雾', sf: 'cloud.fog' };
  if (c === 51 || c === 53 || c === 55) return { desc: '毛毛雨', sf: 'cloud.drizzle' };
  if (c === 56 || c === 57) return { desc: '冻毛毛雨', sf: 'cloud.sleet' };
  if (c === 61 || c === 63 || c === 65) return { desc: '雨', sf: 'cloud.rain' };
  if (c === 66 || c === 67) return { desc: '冻雨', sf: 'cloud.sleet' };
  if (c === 71 || c === 73 || c === 75 || c === 77) return { desc: '雪', sf: 'cloud.snow' };
  if (c === 80 || c === 81 || c === 82) return { desc: '阵雨', sf: 'cloud.heavyrain' };
  if (c === 85 || c === 86) return { desc: '阵雪', sf: 'cloud.snow' };
  if (c === 95) return { desc: '雷阵雨', sf: 'cloud.bolt.rain' };
  if (c === 96 || c === 99) return { desc: '冰雹', sf: 'cloud.hail' };
  return { desc: '-', sf: 'cloud' };
}

function weekdayOf(ymd) {
  const parts = String(ymd).split('-').map(Number);
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return '';
  return WEEK[new Date(parts[0], parts[1] - 1, parts[2]).getDay()];
}

/* ---------------- 数据抓取 ---------------- */

function qs(params) {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

async function httpJson(ctx, url, label) {
  let resp;
  try {
    resp = await ctx.http.get(url, {
      timeout: 15000,
      redirect: 'follow',
      headers: { 'User-Agent': 'egern-weather/1.0', Accept: 'application/json' },
    });
  } catch (e) {
    throw new Error(`${label}请求失败：${(e && e.message) || e}`);
  }
  const text = await resp.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label}返回的不是 JSON`);
  }
}

/* 解析 LOCATION：支持 "纬度,经度" / "城市" / "城市,省份" */
async function resolveLocation(ctx, loc) {
  const m = String(loc).match(/^\s*(-?\d+(?:\.\d+)?)\s*[,，]\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (m) {
    const lat = Number(m[1]);
    const lon = Number(m[2]);
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) throw new Error('经纬度超出范围');
    return { lat, lon, name: `${lat},${lon}` };
  }
  const parts = String(loc).split(/[,，]/).map((s) => s.trim()).filter(Boolean);
  const city = parts[0];
  const province = parts[1] || '';
  if (!city) throw new Error('请在 Env 里填写 LOCATION，如 青岛');
  const data = await httpJson(
    ctx,
    'https://geocoding-api.open-meteo.com/v1/search?' +
      qs({ name: city, count: 10, language: 'zh', format: 'json' }),
    '城市搜索'
  );
  const results = (data && data.results) || [];
  if (!results.length) throw new Error(`找不到城市：${city}`);
  let pool = results;
  if (province) {
    const hit = results.filter((r) =>
      [r.admin1, r.admin2, r.name].some((x) => x && String(x).includes(province))
    );
    if (hit.length) pool = hit;
  }
  // 人口多的优先（大城市排前面，避免搜到同名小地方）
  pool = pool.slice().sort((a, b) => (b.population || 0) - (a.population || 0));
  const r = pool[0];
  return { lat: r.latitude, lon: r.longitude, name: r.name || city };
}

async function loadWeather(ctx) {
  const loc = String(ctx.env?.LOCATION || '').trim() || '青岛';
  const place = await resolveLocation(ctx, loc);
  const unit = String(ctx.env?.TEMP_UNIT || 'c').toLowerCase() === 'f' ? 'fahrenheit' : 'celsius';
  const data = await httpJson(
    ctx,
    'https://api.open-meteo.com/v1/forecast?' +
      qs({
        latitude: place.lat,
        longitude: place.lon,
        current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m',
        hourly: 'temperature_2m,weather_code,precipitation_probability',
        daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset',
        timezone: 'auto',
        forecast_days: 3,
        temperature_unit: unit,
        wind_speed_unit: 'ms',
      }),
    '天气'
  );

  const cur = data.current || {};
  const hourly = data.hourly || {};
  const daily = data.daily || {};
  const deg = unit === 'fahrenheit' ? '°F' : '°C';

  // 逐小时：从当前小时开始取
  const times = hourly.time || [];
  let start = times.indexOf(cur.time);
  if (start < 0) {
    start = times.findIndex((t) => t >= cur.time);
    if (start < 0) start = 0;
  }
  const hours = [];
  for (let i = start; i < Math.min(start + 8, times.length); i++) {
    const h = parseInt(String(times[i]).slice(11, 13), 10);
    hours.push({
      label: i === start ? '现在' : `${h}时`,
      temp: hourly.temperature_2m[i],
      wx: wmo(hourly.weather_code[i]),
      pop: hourly.precipitation_probability[i] ?? 0,
    });
  }

  const days = [];
  const dtimes = daily.time || [];
  for (let i = 0; i < dtimes.length; i++) {
    days.push({
      week: i === 0 ? '今天' : weekdayOf(dtimes[i]),
      wx: wmo(daily.weather_code[i]),
      max: daily.temperature_2m_max[i],
      min: daily.temperature_2m_min[i],
      pop: daily.precipitation_probability_max[i] ?? 0,
    });
  }

  return {
    place,
    deg,
    unit,
    current: {
      temp: cur.temperature_2m,
      feels: cur.apparent_temperature,
      humidity: cur.relative_humidity_2m,
      wind: cur.wind_speed_10m,
      wx: wmo(cur.weather_code),
      time: String(cur.time || '').slice(11, 16),
    },
    hours,
    days,
    today: days[0] || {},
    sun: {
      rise: String((daily.sunrise || [])[0] || '').slice(11, 16),
      set: String((daily.sunset || [])[0] || '').slice(11, 16),
    },
  };
}

function refreshAt(ctx) {
  const v = Number(ctx.env?.REFRESH_MINUTES);
  const min = Number.isFinite(v) ? Math.min(180, Math.max(10, v)) : 30;
  return new Date(Date.now() + min * 60000).toISOString();
}

/* ---------------- 渲染 ---------------- */

function emptyWidget(title, message) {
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
        children: [wIcon('cloud.sun', 13), T(title, 13, C.text, 'semibold')],
      },
      { type: 'spacer' },
      T('天气', 14, C.text, 'semibold'),
      T(message, 11, C.dim, 'regular', { maxLines: 3 }),
      { type: 'spacer' },
    ],
  };
}

function lockWidget(w, family) {
  const c = w.current;
  const txt = `${w.place.name} ${Math.round(c.temp)}°${w.unit === 'fahrenheit' ? 'F' : ''} ${c.wx.desc}`;
  if (family === 'accessoryInline') {
    return { type: 'widget', children: [{ type: 'text', text: txt, maxLines: 1, minScale: 0.6 }] };
  }
  if (family === 'accessoryCircular') {
    return {
      type: 'widget',
      padding: 8,
      children: [
        { type: 'spacer' },
        { type: 'text', text: `${Math.round(c.temp)}°`, font: { size: 20, weight: 'bold' }, textAlign: 'center' },
        { type: 'text', text: c.wx.desc, font: { size: 10 }, textAlign: 'center', opacity: 0.7 },
        { type: 'spacer' },
      ],
    };
  }
  // accessoryRectangular
  return {
    type: 'widget',
    padding: [2, 4],
    gap: 2,
    children: [
      { type: 'text', text: `${w.place.name} ${c.wx.desc}`, font: { size: 'caption1', weight: 'semibold' }, maxLines: 1 },
      {
        type: 'text',
        text: `${Math.round(c.temp)}° 最高${Math.round(w.today.max)}° 最低${Math.round(w.today.min)}°`,
        font: { size: 'caption2' },
        maxLines: 1,
        opacity: 0.7,
      },
    ],
  };
}

function currentBlock(w) {
  const c = w.current;
  return {
    type: 'stack',
    direction: 'row',
    alignItems: 'center',
    gap: 10,
    children: [
      wIcon(c.wx.sf, 42),
      {
        type: 'stack',
        direction: 'column',
        gap: 2,
        children: [
          T(`${Math.round(c.temp)}°`, 36, C.text, 'bold'),
          T(`${c.wx.desc} · 体感${Math.round(c.feels)}°`, 12, C.dim, 'regular'),
        ],
      },
      { type: 'spacer' },
      {
        type: 'stack',
        direction: 'column',
        alignItems: 'end',
        gap: 3,
        children: [
          T(`↑${Math.round(w.today.max)}° ↓${Math.round(w.today.min)}°`, 12, C.text, 'semibold'),
          T(`湿度 ${c.humidity}%`, 12, C.dim, 'regular'),
          T(`风速 ${(Number(c.wind) || 0).toFixed(1)}m/s`, 12, C.dim, 'regular'),
        ],
      },
    ],
  };
}

function hourlyStrip(hours) {
  return {
    type: 'stack',
    direction: 'row',
    alignItems: 'center',
    gap: 6,
    children: hours.map((h) => ({
      type: 'stack',
      direction: 'column',
      alignItems: 'center',
      gap: 3,
      children: [
        T(h.label, 10, C.dim, 'regular'),
        wIcon(h.wx.sf, 16),
        T(`${Math.round(h.temp)}°`, 11, C.text, 'semibold'),
        T(h.pop > 0 ? `${h.pop}%` : '', 9, h.pop >= 50 ? C.accent : C.dim, 'regular'),
      ],
    })),
  };
}

function dailyRows(days) {
  return days.map((d) => ({
    type: 'stack',
    direction: 'row',
    alignItems: 'center',
    gap: 6,
    children: [
      T(d.week, 12, C.text, 'semibold'),
      wIcon(d.wx.sf, 16),
      T(d.wx.desc, 12, C.dim, 'regular'),
      { type: 'spacer' },
      T(d.pop > 0 ? `降水${d.pop}%` : '', 11, d.pop >= 50 ? C.accent : C.dim, 'regular'),
      T(`${Math.round(d.min)}°~${Math.round(d.max)}°`, 12, C.text, 'semibold'),
    ],
  }));
}

/* 中尺寸右下角用的迷你预报行：明天/后天 */
function miniDay(d) {
  return {
    type: 'stack',
    direction: 'row',
    alignItems: 'center',
    gap: 5,
    children: [
      T(d.week, 11, C.text, 'semibold'),
      wIcon(d.wx.sf, 14),
      T(`${Math.round(d.min)}°~${Math.round(d.max)}°`, 11, C.text, 'semibold'),
      T(d.pop > 0 ? `${d.pop}%` : '', 10, d.pop >= 50 ? C.accent : C.dim, 'regular'),
    ],
  };
}

/* 日出日落行 */
function sunRow(sun) {
  return {
    type: 'stack',
    direction: 'row',
    alignItems: 'center',
    gap: 4,
    children: [
      wIcon('sunrise', 12),
      T(sun.rise || '--', 10, C.dim, 'regular'),
      wIcon('sunset', 12),
      T(sun.set || '--', 10, C.dim, 'regular'),
    ],
  };
}

/* ---------------- 入口 ---------------- */

export default async function (ctx) {
  const family = ctx.widgetFamily || 'systemMedium';

  let w;
  try {
    w = await loadWeather(ctx);
  } catch (e) {
    return emptyWidget('天气', String((e && e.message) || e).slice(0, 120));
  }

  if (family.startsWith('accessory')) return lockWidget(w, family);

  const head = `${w.place.name} · 更新 ${w.current.time}`;

  if (family === 'systemSmall') {
    return {
      type: 'widget',
      padding: 14,
      gap: 6,
      backgroundGradient: bg(),
      refreshAfter: refreshAt(ctx),
      children: [
        headerRow('天气', w.place.name),
        { type: 'spacer' },
        {
          type: 'stack',
          direction: 'row',
          alignItems: 'center',
          gap: 8,
          children: [
            wIcon(w.current.wx.sf, 34),
            T(`${Math.round(w.current.temp)}°`, 38, C.text, 'bold'),
          ],
        },
        T(`${w.current.wx.desc} · 最高${Math.round(w.today.max)}° 最低${Math.round(w.today.min)}°`, 12, C.dim, 'regular'),
        { type: 'spacer' },
      ],
    };
  }

  if (family === 'systemLarge' || family === 'systemExtraLarge') {
    return {
      type: 'widget',
      padding: 14,
      gap: 8,
      backgroundGradient: bg(),
      refreshAfter: refreshAt(ctx),
      children: [
        headerRow('天气', head),
        currentBlock(w),
        hourlyStrip(w.hours.slice(0, 8)),
        ...dailyRows(w.days),
        { type: 'spacer' },
      ],
    };
  }

  // systemMedium（默认）：逐小时在左，明后天预报 + 日出日落在右
  const nextDays = w.days.slice(1, 3);
  return {
    type: 'widget',
    padding: 14,
    gap: 8,
    backgroundGradient: bg(),
    refreshAfter: refreshAt(ctx),
    children: [
      headerRow('天气', head),
      currentBlock(w),
      {
        type: 'stack',
        direction: 'row',
        alignItems: 'center',
        gap: 8,
        children: [
          hourlyStrip(w.hours.slice(0, 6)),
          { type: 'spacer' },
          {
            type: 'stack',
            direction: 'column',
            gap: 6,
            children: [...nextDays.map(miniDay), sunRow(w.sun)],
          },
        ],
      },
      { type: 'spacer' },
    ],
  };
}
