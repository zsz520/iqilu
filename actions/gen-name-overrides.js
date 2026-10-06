/**
 * 从 data/channel_names.csv（官方权威名表）重新生成 config.json 的 nameOverrides。
 *
 * 为什么需要这个脚本：
 *   nameOverrides 有 140 条，手写必错、且以后权威表更新后无法同步。
 *   这里把「权威表 → 覆盖映射」的推导固化下来，权威表一变重跑即可。
 *
 * 推导规则：
 *   1. 逐行读权威表（orgId,id,地市,规范名）
 *   2. 在 streams_all.json 里找到 (orgId, id) 对应的记录
 *   3. 若该记录当前名字与规范名不同，则写入覆盖映射 "orgId:id" → 规范名
 *   4. 只写「本地确实存在」的条目，避免出现永远命中不了的死键
 *
 * 用法：node actions/gen-name-overrides.js [--dry]
 */
const fs = require('fs');
const path = require('path');

const dry = process.argv.includes('--dry');

const dataDir = path.join(__dirname, '../data');
const csvPath = path.join(dataDir, 'channel_names.csv');
const allPath = path.join(dataDir, 'streams_all.json');
const configPath = path.join(__dirname, '../config.json');

if (!fs.existsSync(csvPath)) {
  console.error(`找不到权威名表：${csvPath}`);
  process.exit(1);
}

// ---- 1. 读权威表 ----
const rows = fs.readFileSync(csvPath, 'utf-8')
  .split(/\r?\n/)
  .map(l => l.trim())
  .filter(l => l && !l.startsWith('#'))
  .map(l => {
    const [orgId, id, city, name] = l.split(',');
    return { orgId: Number(orgId), id: Number(id), city, name };
  });

console.log(`权威表：${rows.length} 条（${new Set(rows.map(r => r.city)).size} 个地市）`);

// ---- 2. 读本地数据，建 (orgId,id) 索引 ----
const all = JSON.parse(fs.readFileSync(allPath, 'utf-8'));
const byKey = new Map();
for (const item of all) {
  if (item.id !== undefined) byKey.set(`${item.orgId}:${item.id}`, item);
}

// ---- 3. 推导覆盖 ----
const overrides = {};
let missing = 0, same = 0;
for (const r of rows) {
  const key = `${r.orgId}:${r.id}`;
  const local = byKey.get(key);
  if (!local) { missing++; continue; }        // 本地没有这个频道，跳过
  if (local.name === r.name) { same++; continue; } // 名字已正确，不必覆盖
  overrides[key] = r.name;
}

// 按 orgId、id 数值排序，便于人工 diff
const sorted = {};
Object.keys(overrides)
  .sort((a, b) => {
    const [ao, ai] = a.split(':').map(Number);
    const [bo, bi] = b.split(':').map(Number);
    return (ao - bo) || (ai - bi);
  })
  .forEach(k => { sorted[k] = overrides[k]; });

console.log(`覆盖映射：${Object.keys(sorted).length} 条  (名字已对：${same}，本地缺失：${missing})`);

if (dry) {
  console.log('\n--dry 模式，未写入。前 10 条预览：');
  Object.entries(sorted).slice(0, 10).forEach(([k, v]) =>
    console.log(`  ${k} → ${v}  (当前「${byKey.get(k).name}」)`));
  process.exit(0);
}

// ---- 4. 写回 config.json ----
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
const before = Object.keys(config.nameOverrides || {}).length;
config.nameOverrides = sorted;
fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

console.log(`config.json 已更新 nameOverrides：${before} → ${Object.keys(sorted).length} 条`);
