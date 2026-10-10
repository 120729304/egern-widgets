/*
 * 每日古诗 📜
 *
 * 每次刷新随机一首古诗词名句，显示诗句、作者与出处。
 * 数据源：今日诗词 https://www.jinrishici.com（免费，无需 key）
 *
 * Env:
 *   REFRESH_MINUTES   刷新间隔（分钟），10 ~ 720，默认 120
 */

const API = 'https://v1.jinrishici.com/all.json';
const CACHE_KEY = 'poem_cache';

function refreshAfter(ctx) {
  const v = Number(ctx.env?.REFRESH_MINUTES);
  const min = Number.isFinite(v) ? Math.min(720, Math.max(10, v)) : 120;
  return new Date(Date.now() + min * 60000).toISOString();
}

async function fetchPoem(ctx) {
  const resp = await ctx.http.get(API, {
    timeout: 12000,
    redirect: 'follow',
    headers: { 'User-Agent': 'egern-poem/1.0', Accept: 'application/json' },
  });
  const status = resp.status ?? 200;
  if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`);
  const data = await resp.json();
  if (!data || !data.content) throw new Error('接口无数据');
  return {
    content: String(data.content),
    origin: String(data.origin || ''),
    author: String(data.author || ''),
    at: Date.now(),
  };
}

async function loadPoem(ctx) {
  try {
    const p = await fetchPoem(ctx);
    ctx.storage.setJSON(CACHE_KEY, p);
    return p;
  } catch (_) {
    return ctx.storage.getJSON(CACHE_KEY) || null;
  }
}

function originLine(p) {
  const bits = [];
  if (p.author) bits.push(p.author);
  if (p.origin) bits.push(`《${p.origin}》`);
  return bits.length ? `—— ${bits.join(' ')}` : '';
}

function poemBlock(content, sub, contentSize) {
  return {
    type: 'stack',
    direction: 'column',
    gap: 6,
    children: [
      { type: 'text', text: content, font: { size: contentSize }, maxLines: 4 },
      { type: 'text', text: sub, font: { size: 'caption2' }, opacity: 0.55, maxLines: 1 },
    ],
  };
}

function buildSmall(ctx, p) {
  return {
    type: 'widget',
    padding: 12,
    refreshAfter: refreshAfter(ctx),
    children: [
      { type: 'spacer' },
      {
        type: 'stack',
        direction: 'column',
        alignItems: 'center',
        gap: 8,
        children: [
          { type: 'text', text: '📜 每日一诗', font: { size: 'caption2' }, opacity: 0.55 },
          { type: 'text', text: p.content, font: { size: 'footnote' }, maxLines: 3 },
          { type: 'text', text: originLine(p), font: { size: 'caption2' }, opacity: 0.55, maxLines: 1 },
        ],
      },
      { type: 'spacer' },
    ],
  };
}

function buildMedium(ctx, p) {
  return {
    type: 'widget',
    padding: 14,
    refreshAfter: refreshAfter(ctx),
    children: [
      { type: 'spacer' },
      {
        type: 'stack',
        direction: 'column',
        gap: 8,
        children: [
          { type: 'text', text: '📜 每日一诗', font: { size: 'caption2' }, opacity: 0.55 },
          { type: 'text', text: p.content, font: { size: 'body' }, maxLines: 3 },
          { type: 'text', text: originLine(p), font: { size: 'caption1' }, opacity: 0.55, maxLines: 1 },
        ],
      },
      { type: 'spacer' },
    ],
  };
}

function buildLarge(ctx, poems) {
  const blocks = [];
  poems.forEach((p, i) => {
    if (i > 0) blocks.push({ type: 'spacer' });
    blocks.push(poemBlock(p.content, originLine(p), 'body'));
  });
  return {
    type: 'widget',
    padding: 14,
    refreshAfter: refreshAfter(ctx),
    children: [
      { type: 'text', text: '📜 每日诗词', font: { size: 'footnote', weight: 'semibold' } },
      { type: 'spacer' },
      ...blocks,
      { type: 'spacer' },
    ],
  };
}

export default async function (ctx) {
  const family = ctx.widgetFamily || 'systemSmall';
  const need = family === 'systemLarge' || family === 'systemExtraLarge' ? 2 : 1;
  const poems = [];
  for (let i = 0; i < need; i++) {
    const p = await loadPoem(ctx);
    if (p) poems.push(p);
  }
  if (!poems.length) {
    return {
      type: 'widget',
      padding: 14,
      refreshAfter: refreshAfter(ctx),
      children: [{ type: 'text', text: '📜 诗词加载失败，稍后再试', font: { size: 'footnote' }, opacity: 0.6 }],
    };
  }

  if (family === 'systemLarge' || family === 'systemExtraLarge') return buildLarge(ctx, poems);
  if (family === 'systemMedium') return buildMedium(ctx, poems[0]);
  if (family === 'accessoryCircular') return { type: 'text', text: '诗' };
  if (family === 'accessoryRectangular' || family === 'accessoryInline') {
    return { type: 'text', text: `${poems[0].content} ${originLine(poems[0])}`, maxLines: 1 };
  }
  return buildSmall(ctx, poems[0]);
}
