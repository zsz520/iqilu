/**
 * 频道数据的「变换」逻辑 —— 改名 + 去重。
 *
 * 为什么不放进 filter.js：
 *   filter.js 负责「筛选」（决定某条留不留），返回布尔值；
 *   这里负责「变换」（决定留下后长什么样 / 要不要合并），返回新数组。
 *   两者职责不同，混在一起会让 filter 的测试和语义都变脏。
 *
 * 挂载点：actions/filter-metadata.js，顺序为
 *   filterChannels（筛选） → applyNameOverrides（改名） → dedupeByStream（去重）
 *
 * 配置全部来自 config.json，代码里不硬编码任何频道信息。
 */

/**
 * 从流地址里抽出「流标识」——归一化后的路径。
 *
 * 为什么要归一化：
 *   1. 上游会给同一路流套不同 CDN 域名。例：
 *        https://alivealone302.litenews.cn/635/1ebcf529.../playlist.m3u8
 *        https://xxx.100ycdn.com/alivealone302.litenews.cn/635/1ebcf529.../playlist.m3u8
 *      两者是同一路流，但字符串前缀完全不同 —— 直接比字符串会漏判。
 *   2. query 里的 k/t 是每次重新签发的时效 token，必须去掉，
 *      否则同一条流永远因 k/t 不同而被判为"不重复"。
 *
 * 归一化规则：去 query → 取 "playlist.m3u8" 之前、最后一个「纯数字 + 32位十六进制」
 * 形态的路径对作为指纹（即 <orgId目录>/<流哈希>）。取不到就退回完整路径。
 */
function streamKey(item) {
  const raw = String((item && item.stream) || '');
  const noQuery = raw.split('?')[0];

  // 匹配 .../<数字>/<32位hex>/playlist.m3u8  或  .../<数字>/<hash>/index.m3u8
  const m = noQuery.match(/\/(\d+)\/([0-9a-zA-Z_]+)\/(?:playlist|index)\.m3u8$/);
  if (m) return `${m[1]}/${m[2]}`;

  // 兜底：live/<名字>/index.m3u8（iqilu 老架构，如 /live/xiajin_tv02/index.m3u8）
  const m2 = noQuery.match(/\/live\/([0-9a-zA-Z_]+)\/index\.m3u8$/);
  if (m2) return `live/${m2[1]}`;

  return noQuery;
}

/**
 * 覆盖表的键 —— 统一用 index。
 *
 * ★ 全项目统一口径：凡是「定位某条频道」的地方，都用 orgId + index。
 *   index = 上游返回数组里的位置，也正是酷9 / Vercel 取址脚本的 num 参数。
 *   这样 config、数据、脚本三处的定位方式完全一致，不再有 id / index 两套编号互相打架。
 */
function overrideKey(item) {
  return `${item.orgId}:${item.index}`;
}

/**
 * 按 config.nameOverrides 改名。
 *
 * 键格式 "orgId:index"，与 dedupe、生成器、取址脚本的 num 参数保持同一套编号。
 *
 * @param {Array}  data
 * @param {object} config
 * @returns {{channels: Array, renamed: Array<{key:string,from:string,to:string}>}}
 */
function applyNameOverrides(data, config) {
  const overrides = config.nameOverrides || {};
  const renamed = [];

  const channels = data.map(item => {
    const key = overrideKey(item);
    const to = overrides[key];
    if (to === undefined || to === item.name) return item;
    // 不改动原对象，保持上游原始数据可追溯
    renamed.push({ key, from: item.name, to });
    return Object.assign({}, item, { name: to, nameSource: 'override' });
  });

  return { channels, renamed };
}

/**
 * 按流地址去重 —— 但**只把「流地址相同 且 上游 id 也相同」的视为真重复**。
 *
 * ★ 为什么加 id 这一重条件：
 *   上游把「同一个台建多个 orgId」的镜像组塞进来时，流地址会完全相同；
 *   但也存在「不同 id 共用一路流」的情况（如 115/635 的潍坊系列、537/657 的东营组）。
 *   后者其实是上游数据不同步 —— id 不同就意味着上游认为它们是两个频道，
 *   **贸然合并会丢台**。所以只合并 id 也一致的（即真正的同一条记录被重复返回）。
 *
 * 保留策略（config.dedupe || {}）：
 *   keepOrgId   —— 这些流目录优先保留。值是「流地址里出现的 orgId 目录段」数组，
 *                  更贴近真实归属（如 305 出现在 423 的流路径里，说明 305 是真身）。
 *   preferLongerName —— 同名流里优先保留名字更长的（通常信息更全）。默认 true。
 *   enabled     —— 总开关，默认 true。
 *
 * @param {Array}  data
 * @param {object} config
 * @returns {{channels: Array, dropped: Array}}
 */
function dedupeByStream(data, config) {
  const cfg = config.dedupe || {};
  if (cfg.enabled === false) return { channels: data, dropped: [] };

  const keepOrgIds = cfg.keepOrgId || [];
  const preferLongerName = cfg.preferLongerName !== false;
  const overrides = config.nameOverrides || {};

  // ★ 去重键 = 流地址指纹 + 上游 id。
  //   两个都相同才算同一条；id 不同一律保留。
  const dedupeKey = (item) => `${streamKey(item)}#${item.id}`;

  // 先记录每组的大小，只有 >1 的才需要挑
  const groups = new Map();
  data.forEach(item => {
    const k = dedupeKey(item);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(item);
  });

  /**
   * 组内排序，越靠前越该保留。
   * 打分（分高者留）：
   *   +10000 该条在 nameOverrides 里有命中（名字经过权威核对，优先于未核对条目）
   *   +1000  该条的流地址里含 keepOrgId 中的目录段（说明它是流的所有者）
   *   +100   条目的 orgId 自己就在 keepOrgId 里
   *   +name.length  名字更长（信息更全）
   *   -index        同分时取先出现的，保持稳定
   */
  function score(item) {
    let s = 0;
    const key = overrideKey(item);
    if (overrides[key] !== undefined) s += 10000;
    const path = String(item.stream || '');
    for (const oid of keepOrgIds) {
      if (path.indexOf(`/${oid}/`) >= 0) { s += 1000; break; }
    }
    if (keepOrgIds.indexOf(item.orgId) >= 0) s += 100;
    if (preferLongerName) s += String(item.name || '').length;
    s -= Number(item.index || 0) * 0.001;
    return s;
  }

  const dropped = [];
  const kept = [];

  for (const [, members] of groups) {
    if (members.length === 1) { kept.push(members[0]); continue; }
    const sorted = members.slice().sort((a, b) => score(b) - score(a));
    kept.push(sorted[0]);
    for (const m of sorted.slice(1)) {
      dropped.push({ orgId: m.orgId, index: m.index, id: m.id, name: m.name, key: streamKey(m), keptAs: sorted[0].name });
    }
  }

  // 排序交给 orderByAuthority（官方表序 + 未收录沉底），这里不再自定义排序
  return { channels: kept, dropped };
}

/**
 * 按「官方权威表」的顺序重排列表。
 *
 * 用户维护方式是「直接改官方表」——官方表里自上而下的行序就是期望的列表顺序。
 * 因此排序规则：
 *   1. 官方表里有的频道 → 严格按官方表的行号排（表序 = 展示序）
 *   2. 官方表里没有的频道（不管是否重复、是否新扫到）→ 一律排到最后，
 *      内部保持稳定的 <orgId, index> 序，便于一眼看出「新增了哪些台」
 *
 * 这样列表顺序完全由官方表控制，新增台会自动沉到末尾等人确认。
 *
 * @param {Array}  data        频道数组
 * @param {Array}  authorityRows  官方表行数组，顺序即权威顺序（元素含 orgId / index）
 * @returns {Array} 新数组（不修改入参）
 */
function orderByAuthority(data, authorityRows) {
  // "orgId:index" → 官方表行号（越小越靠前）
  const rank = new Map();
  (authorityRows || []).forEach((r, i) => {
    const key = `${r.orgId}:${r.index}`;
    if (!rank.has(key)) rank.set(key, i);   // 同一键重复出现时取首次
  });

  const UNRANKED = Number.MAX_SAFE_INTEGER;  // 官方表没有 → 沉底

  return data.slice().sort((a, b) => {
    const ra = rank.has(overrideKey(a)) ? rank.get(overrideKey(a)) : UNRANKED;
    const rb = rank.has(overrideKey(b)) ? rank.get(overrideKey(b)) : UNRANKED;
    // 第一优先：官方表有 → 无
    if (ra !== rb) {
      if (ra === UNRANKED) return 1;   // a 无官方 → 排后
      if (rb === UNRANKED) return -1;  // b 无官方 → 排后
      return ra - rb;                  // 两者都有 → 按官方行序
    }
    // 第二优先（都无官方）：稳定按 orgId、index
    return (a.orgId - b.orgId) || (a.index - b.index);
  });
}

module.exports = { streamKey, applyNameOverrides, dedupeByStream, orderByAuthority };
