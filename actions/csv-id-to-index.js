// 把 data/channel_names.csv 的第 2 列从「上游 id」换算为「数组下标 index」
// 口径统一后，全项目（CSV / config / 产物 num）都只认 index。
//
// ⚠️ 编码警告：本文件必须用 UTF-8 读写。
//   在 Git Bash 里用 heredoc / echo 直接拼中文会按 GBK 落盘，把文件写坏
//   （产生 U+FFFD 替换字符）。**所有中文写入一律走 Node 的 fs，不经 shell。**
//
// 干跑：node actions/csv-id-to-index.js
// 落盘：node actions/csv-id-to-index.js --write
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const csvPath = path.join(root, 'data/channel_names.csv');
const all = JSON.parse(fs.readFileSync(path.join(root, 'data/streams_all.json'), 'utf-8'));
const write = process.argv.includes('--write');

// ---- 编码自检：读进来若含 U+FFFD，说明文件已被写坏，直接中止 ----
const src = fs.readFileSync(csvPath, 'utf-8');
if (src.includes('\uFFFD')) {
  console.error('✗ 文件含 U+FFFD 替换字符，说明编码已被破坏（很可能是被 GBK 写坏了）。');
  console.error('  请先 git checkout -- data/channel_names.csv 恢复，再重跑本脚本。');
  process.exit(1);
}

// orgId:id -> index
const idToIndex = new Map();
for (const it of all) {
  if (it.id !== undefined) idToIndex.set(`${it.orgId}:${it.id}`, it.index);
}

const srcLines = src.split(/\r?\n/);
const out = [];
let converted = 0, unresolved = 0;
const unresolvedRows = [];

for (const line of srcLines) {
  const t = line.trim();
  // 丢掉末尾空行 / 误产生的 ",,," 行
  if (/^,+\s*$/.test(t)) continue;
  if (!t) { continue; }
  if (t.startsWith('#')) {
    // 表头注释同步改写口径说明（用 replace 保证不碰中文之外的字符）
    if (t.includes('格式:')) out.push('# 格式: orgId,index,地市,规范名');
    else if (t.startsWith('# 说明:')) out.push('# 说明: index 为上游接口返回数组的下标（全项目统一口径，同酷9/Vercel 取址脚本的 num 参数）');
    else if (t.startsWith('# 用途:')) out.push('# 用途: 直接生成 config.json 的 nameOverrides（键即 orgId:index）；也可用于核对上游命名是否错挂');
    else out.push(line);
    continue;
  }
  const p = t.split(',');
  if (p.length < 4) { out.push(line); continue; }
  const orgId = Number(p[0]);
  const col2 = Number(p[1]);
  const rest = p.slice(2).join(',');
  const key = `${orgId}:${col2}`;

  // 源文件第 2 列一律是「上游 id」，统一按 id->index 换算。
  // ★ 不要用「本地是否已存在该 index」来判断是否已换算 —— id 的值常落在
  //   本地 index 值域内造成误判（如某 orgId 只有 index 0/1，而 id 写作 1/3）。
  if (idToIndex.has(key)) {
    out.push(`${orgId},${idToIndex.get(key)},${rest}`);
    converted++;
  } else {
    unresolved++;
    unresolvedRows.push(`${orgId},${col2}  ${p[3] || ''}`);
    out.push(`${orgId},${col2},${rest}`);  // 本地无此频道，保留原值待人工确认
  }
}

const dst = out.join('\r\n') + '\r\n';

// 落盘前再自检一次
if (dst.includes('\uFFFD')) {
  console.error('✗ 写出内容含 U+FFFD，中止。');
  process.exit(1);
}

console.log(`已换算: ${converted} 行   换算不出（本地无此频道）: ${unresolved} 行`);
if (unresolvedRows.length) {
  console.log('--- 换算不出的行（保留原值，待人工确认）---');
  unresolvedRows.forEach(r => console.log('  ' + r));
}
if (write) {
  fs.writeFileSync(csvPath, dst, 'utf-8');
  const check = fs.readFileSync(csvPath, 'utf-8');
  console.log(`\n已写入 ${csvPath}`);
  console.log(`回读自检：含U+FFFD=${check.includes('\uFFFD')}  数据行=${check.split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith('#')).length}`);
} else {
  console.log('\n(干跑模式，未写入。加 --write 落盘)');
  console.log('--- 预览前 12 行 ---');
  out.slice(0, 12).forEach(l => console.log(l));
}
