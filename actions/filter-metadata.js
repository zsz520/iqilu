/**
 * 过滤 streams_all.json，产出 data/streams_filtered.json。
 *
 * 为什么单独一步：
 *   原先「过滤」被抄在每个生成器里（gen-m3u-generic / gen-txt-ku9 / gen-m3u-direct），
 *   连 Cloudflare Worker 里也手抄了一份。规则一改就要同步改四处，必然漂移。
 *   现在把过滤收敛成这一个步骤，产出成品 JSON：
 *
 *     fetch-metadata → merge-metadata → streams_all.json      （原始，未过滤）
 *                                            ↓
 *                                    filter-metadata ★ ← 唯一的加工关卡
 *                                            ↓
 *                                      streams_filtered.json （成品，可直接用）
 *                                            ↓
 *                     三个生成器 / CF Worker  都只读这个，不需要知道规则
 *
 * 三个步骤，按顺序：
 *   1. filterChannels      筛选 —— 黑名单，决定留不留（actions/lib/filter.js）
 *   2. applyNameOverrides  改名 —— 修正上游错挂/不完整名（actions/lib/transform.js）
 *   3. dedupeByStream      去重 —— 同一路流只留一条（actions/lib/transform.js）
 *   4. orderByAuthority    排序 —— 官方表序在前，未收录的沉底（actions/lib/transform.js）
 * 规则全部来自 config.json；官方表来自 data/channel_names.csv。
 */
const fs = require('fs');
const path = require('path');
const { filterChannels } = require('./lib/filter');
const { applyNameOverrides, dedupeByStream, orderByAuthority } = require('./lib/transform');

const configPath = path.join(__dirname, '../', 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

const inputFile = path.join(__dirname, '../data/streams_all.json');
const outputFile = path.join(__dirname, '../data/streams_filtered.json');
const authorityFile = path.join(__dirname, '../data/channel_names.csv');

const data = JSON.parse(fs.readFileSync(inputFile, 'utf-8'));

// 读官方权威表（行序 = 期望的列表顺序）。
// ⚠️ 必须 UTF-8 读；若含 U+FFFD 说明文件被 GBK 写坏，直接中止。
function readAuthorityRows(file) {
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, 'utf-8');
  if (raw.includes('\uFFFD')) {
    console.error(`✗ ${path.basename(file)} 含 U+FFFD，编码已被破坏（多半是 GBK 写坏的）。`);
    console.error('  请先 git checkout -- data/channel_names.csv 恢复后再重跑。');
    process.exit(1);
  }
  return raw.split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#') && !/^,+\s*$/.test(l))
    .map(l => {
      const p = l.split(',');
      return { orgId: Number(p[0]), index: Number(p[1]) };
    })
    .filter(r => Number.isFinite(r.orgId) && Number.isFinite(r.index));
}

const authorityRows = readAuthorityRows(authorityFile);

// 1. 筛选
const filtered = filterChannels(data, config);

// 2. 改名
const { channels: renamed, renamed: renameLog } = applyNameOverrides(filtered, config);

// 3. 去重
const { channels: deduped, dropped } = dedupeByStream(renamed, config);

// 4. 排序：官方表序在前，未收录的沉底
const final = orderByAuthority(deduped, authorityRows);

fs.writeFileSync(outputFile, JSON.stringify(final, null, 2), 'utf-8');

const rankKeys = new Set(authorityRows.map(r => `${r.orgId}:${r.index}`));
const ranked = final.filter(i => rankKeys.has(`${i.orgId}:${i.index}`)).length;

console.log(`Filtered ${data.length} → ${filtered.length} (removed ${data.length - filtered.length})`);
console.log(`Renamed  ${renameLog.length}`);
for (const r of renameLog) console.log(`  ${r.key}: 「${r.from}」→「${r.to}」`);
console.log(`Deduped  ${dropped.length}`);
for (const d of dropped) console.log(`  orgId=${d.orgId}/idx=${d.index}「${d.name}」重复 → 保留「${d.keptAs}」`);
console.log(`Ordered  官方表 ${ranked} 条在前 / 未收录 ${final.length - ranked} 条沉底`);
console.log(`Written to ${path.relative(process.cwd(), outputFile)}`);
