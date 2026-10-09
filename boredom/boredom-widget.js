/*
 * 无聊按钮 🎲
 *
 * 不知道干啥的时候看一眼，随机给你派个活。
 * 按时段推荐：深夜低耗能、早晨出门走、白天折腾、晚上放松。
 * 每次刷新换一个，连续两次不会重复。
 *
 * Env:
 *   REFRESH_MINUTES   刷新间隔（分钟），10 ~ 180，默认 30
 *   CUSTOM_IDEAS      自定义点子，每行一个，格式 "emoji 文案"，如 "🎮 打一局星露谷"
 */

const PERIODS = [
  {
    id: 'night', label: '深夜', icon: '🌙',
    test: (h) => h >= 23 || h < 6,
    ideas: [
      ['🎧', '找期播客，听到睡着为止'],
      ['📱', '删 20 张废截图和连拍'],
      ['📓', '写三行日记，只许三行'],
      ['🎨', '给小组件换套配色'],
      ['📖', '看 10 页那本一直没看完的书'],
      ['🧘', '跟视频拉伸 5 分钟'],
      ['🎮', '打开吃灰的游戏清个日常'],
      ['☕', '泡杯热的，站窗边发 5 分钟呆'],
      ['🎵', '建个"深夜"歌单，塞 5 首歌'],
      ['💡', '想一个明天要做的小东西，记下来'],
      ['📦', '整理 NAS 里"待看"文件夹'],
      ['🌙', '出门看一眼月亮在不在'],
    ],
  },
  {
    id: 'morning', label: '早晨', icon: '🌅',
    test: (h) => h >= 6 && h < 9,
    ideas: [
      ['🚶', '下楼走 15 分钟，顺便买早餐'],
      ['🍳', '煎个蛋，摆个盘，拍张照'],
      ['📋', '写下今天最重要的 3 件事'],
      ['🧹', '收拾一张桌子，只收一张'],
      ['📻', '听 10 分钟新闻'],
      ['💪', '做 20 个深蹲'],
      ['🌱', '给绿植浇水擦叶子'],
      ['📝', '把拖最久的待办拆成 5 分钟版本'],
    ],
  },
  {
    id: 'day', label: '白天', icon: '☀️',
    test: (h) => h >= 9 && h < 18,
    ideas: [
      ['⌨️', '学 3 个常用软件的新快捷键'],
      ['🖥️', '桌面清到只剩 5 个图标'],
      ['🐙', '逛 10 分钟 GitHub trending'],
      ['🛠️', '给监控脚本加个一直想加的功能'],
      ['📚', '清微信收藏：看或删，二选一'],
      ['📸', '出门拍 5 张"今天"'],
      ['🍜', '试一家没吃过的店'],
      ['🧩', '拼 30 分钟吃灰的拼图/乐高'],
      ['📊', '查查这个月流量用了多少'],
      ['💬', '给很久没联系的朋友发条消息'],
      ['🎯', '把仓库 README 美化一下'],
      ['🗂️', '给 NAS 文件重命名 20 个'],
    ],
  },
  {
    id: 'evening', label: '晚上', icon: '🌆',
    test: (h) => h >= 18 && h < 23,
    ideas: [
      ['🍳', '做一道没做过的菜'],
      ['🎬', '看部电影，不许倍速'],
      ['📓', '写今天的日记，配张图'],
      ['🛋️', '瘫 20 分钟，合法发呆'],
      ['🎨', '画张画，丑也没关系'],
      ['📖', '读 30 分钟书'],
      ['🧹', '整理一个抽屉'],
      ['🎵', '听完一整张专辑'],
      ['💻', '折腾个新小组件'],
      ['🛁', '泡个澡/泡个脚'],
      ['🎲', '玩一局单机，不许刷手机'],
      ['📦', '备份一次手机照片'],
    ],
  },
];

function refreshAfter(ctx) {
  const v = Number(ctx.env?.REFRESH_MINUTES);
  const min = Number.isFinite(v) ? Math.min(180, Math.max(10, v)) : 30;
  return new Date(Date.now() + min * 60000).toISOString();
}

function customIdeas(ctx) {
  const raw = String(ctx.env?.CUSTOM_IDEAS || '');
  return raw
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^(\S+)\s+(.+)$/);
      return m ? [m[1], m[2]] : ['💡', line];
    });
}

// 随机取 n 个不重复的；单取时避开上次的结果
function pick(pool, n, lastIdx) {
  const L = pool.length;
  if (!L) return [['🎲', '先去喝口水吧']];
  const idxs = [];
  let guard = 0;
  while (idxs.length < Math.min(n, L) && guard++ < 200) {
    const i = Math.floor(Math.random() * L);
    if (n === 1 && idxs.length === 0 && L > 1 && i === lastIdx) continue;
    if (!idxs.includes(i)) idxs.push(i);
  }
  return idxs.map((i) => pool[i]);
}

function ideaRow(emoji, text, big) {
  return {
    type: 'stack',
    direction: 'row',
    alignItems: 'center',
    gap: 10,
    children: [
      { type: 'text', text: emoji, font: { size: big ? 'body' : 'footnote' } },
      { type: 'text', text, font: { size: big ? 'body' : 'footnote' }, maxLines: 2 },
    ],
  };
}

function buildSmall(ctx, period, ideas) {
  const [emoji, text] = ideas[0];
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
        gap: 6,
        children: [
          { type: 'text', text: `🎲 ${period.label}`, font: { size: 'caption2' }, opacity: 0.6 },
          { type: 'text', text: emoji, font: { size: 'body' } },
          { type: 'text', text, font: { size: 'footnote' }, maxLines: 2 },
        ],
      },
      { type: 'spacer' },
    ],
  };
}

function buildMedium(ctx, period, ideas) {
  const [emoji, text] = ideas[0];
  return {
    type: 'widget',
    padding: 14,
    refreshAfter: refreshAfter(ctx),
    children: [
      { type: 'spacer' },
      {
        type: 'stack',
        direction: 'row',
        alignItems: 'center',
        gap: 12,
        children: [
          { type: 'text', text: emoji, font: { size: 'body' } },
          {
            type: 'stack',
            direction: 'column',
            gap: 4,
            children: [
              {
                type: 'text',
                text: `🎲 无聊按钮 · ${period.icon}${period.label}`,
                font: { size: 'caption2' },
                opacity: 0.6,
              },
              { type: 'text', text, font: { size: 'body' }, maxLines: 3 },
            ],
          },
        ],
      },
      { type: 'spacer' },
      {
        type: 'text',
        text: '下次刷新换一个',
        font: { size: 'caption2' },
        opacity: 0.4,
      },
    ],
  };
}

function buildLarge(ctx, period, ideas) {
  const rows = [];
  ideas.forEach(([emoji, text], i) => {
    if (i > 0) rows.push({ type: 'spacer' });
    rows.push(ideaRow(emoji, text, true));
  });
  return {
    type: 'widget',
    padding: 14,
    refreshAfter: refreshAfter(ctx),
    children: [
      {
        type: 'text',
        text: `🎲 无聊按钮 · ${period.icon}${period.label}`,
        font: { size: 'footnote', weight: 'semibold' },
      },
      { type: 'spacer' },
      ...rows,
      { type: 'spacer' },
      { type: 'text', text: '下次刷新换三个', font: { size: 'caption2' }, opacity: 0.4 },
    ],
  };
}

export default async function (ctx) {
  const now = new Date();
  const period = PERIODS.find((p) => p.test(now.getHours())) || PERIODS[0];
  const pool = period.ideas.concat(customIdeas(ctx));

  const family = ctx.widgetFamily || 'systemSmall';
  const count = family === 'systemLarge' ? 3 : 1;

  const last = ctx.storage.getJSON('boredom_last') || {};
  const lastIdx = last.period === period.id ? last.idx : -1;
  const ideas = pick(pool, count, lastIdx);
  if (ideas.length === 1) {
    ctx.storage.setJSON('boredom_last', { period: period.id, idx: pool.indexOf(ideas[0]) });
  }

  if (family === 'systemLarge' || family === 'systemExtraLarge') {
    return buildLarge(ctx, period, ideas);
  }
  if (family === 'systemMedium') {
    return buildMedium(ctx, period, ideas);
  }
  if (family === 'accessoryCircular') {
    return { type: 'text', text: ideas[0][0] };
  }
  if (family === 'accessoryRectangular' || family === 'accessoryInline') {
    return { type: 'text', text: `🎲 ${ideas[0][1]}`, maxLines: 1 };
  }
  return buildSmall(ctx, period, ideas);
}
