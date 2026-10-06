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
 * 按 config.nameOverrides 改名。
 *
 * 键格式 "orgId:id"（注意是上游真实字段 id，不是数组下标 index！）
 *   - 上游接口每条记录都带 id，它才是与后台频道号一致的稳定编号；
 *     index 只是本次返回数组里的位置，会随上下架漂移。
 *   - 若记录没有 id 字段，则回退用 index，兼容旧数据。
 *
 * @param {Array}  data
 * @param {object} config
 * @returns {{channels: Array, renamed: Array<{key:string,from:string,to:string}>}}
 */
function applyNameOverrides(data, config) {
  const overrides = config.nameOverrides || {};
  const renamed = [];

  const channels = data.map(item => {
    const key = `${item.orgId}:${item.id !== undefined ? item.id : item.index}`;
    const to = overrides[key];
    if (to === undefined || to === item.name) return item;
    // 不改动原对象，保持上游原始数据可追溯
    renamed.push({ key, from: item.name, to });
    return Object.assign({}, item, { name: to, nameSource: 'override' });
  });

  return { channels, renamed };
}

/**
 * 按流地址去重：同一路流只保留一条。
 *
 * 上游存在「同一个台建了多个 orgId」的问题（例：39/689、115/635、305/423），
 * 表现为不同频道名指向完全相同的流地址，播放器里就是重复项。
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

  // 先记录每组的大小，只有 >1 的才需要挑
  const groups = new Map();
  data.forEach(item => {
    const k = streamKey(item);
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
    const key = `${item.orgId}:${item.id !== undefined ? item.id : item.index}`;
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
      dropped.push({ orgId: m.orgId, index: m.index, name: m.name, key: streamKey(m), keptAs: sorted[0].name });
    }
  }

  // 恢复原始相对顺序（按 orgId、index），避免去重打乱列表
  kept.sort((a, b) => (a.orgId - b.orgId) || (a.index - b.index));
  return { channels: kept, dropped };
}

module.exports = { streamKey, applyNameOverrides, dedupeByStream };
