/**
 * 共享的频道过滤逻辑 —— 被 gen-m3u-generic.js / gen-m3u-direct.js / gen-txt-ku9.js 复用。
 *
 * 之前这段逻辑在三个生成器里各抄了一份，改规则要改三处、极易漏。
 * 抽成模块后只改这里。
 */

/**
 * 判断一条频道是否应被保留。
 *
 * 依次应用 config.json 里的三类规则：
 *   1. blacklistNames      —— 频道名/描述 包含任一关键词 → 屏蔽
 *   2. blacklistOrgIds     —— orgId 在列表内 → 屏蔽
 *   3. blacklistNameRegex  —— 频道名匹配任一正则 → 屏蔽
 *   4. excludeNamePatterns —— 名称命中「先匹配再豁免」规则 → 屏蔽（用于"广播但排除广播电视台"这类）
 *
 * @param {object} item    data/streams_all.json 里的一条记录
 * @param {object} config  config.json 解析结果
 * @returns {boolean}      true = 保留，false = 屏蔽
 */
function shouldKeep(item, config) {
  const name = item.name || '';
  const desc = item.desc || '';

  const blacklistNames = config.blacklistNames || [];
  const blacklistOrgIds = config.blacklistOrgIds || [];
  const blacklistNameRegex = config.blacklistNameRegex || [];
  const excludeNamePatterns = config.excludeNamePatterns || [];

  // 1. 关键词黑名单：name 和 desc 都查（保持原有行为）
  if (blacklistNames.some(key => name.includes(key) || desc.includes(key))) return false;

  // 2. orgId 黑名单
  if (blacklistOrgIds.includes(item.orgId)) return false;

  // 3. 名称正则黑名单：只查 name，避免 desc 长文本误伤
  for (const pattern of blacklistNameRegex) {
    try {
      if (new RegExp(pattern, 'i').test(name)) return false;
    } catch (err) {
      console.warn(`[filter] 无效正则，已跳过: ${pattern} (${err.message})`);
    }
  }

  // 4. 「先匹配再豁免」规则：每条形如 { match: "FM|广播", unless: "广播电视台" }
  //    命中 match，且【不】命中 unless → 屏蔽。
  //    用于"屏蔽广播电台、但保留『XX广播电视台』这类电视频道"。
  for (const rule of excludeNamePatterns) {
    if (!rule || !rule.match) continue;
    try {
      const hit = new RegExp(rule.match, 'i').test(name);
      if (!hit) continue;
      if (rule.unless && new RegExp(rule.unless, 'i').test(name)) continue; // 豁免
      return false;
    } catch (err) {
      console.warn(`[filter] 无效正则，已跳过: ${rule.match} (${err.message})`);
    }
  }

  return true;
}

/**
 * 过滤整个数据数组。
 * @param {Array} data
 * @param {object} config
 * @returns {Array}
 */
function filterChannels(data, config) {
  return data.filter(item => shouldKeep(item, config));
}

module.exports = { shouldKeep, filterChannels };
