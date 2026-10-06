/**
 * 过滤规则离线测试（无第三方依赖，直接 node 跑）
 *
 * 覆盖 actions/lib/filter.js 的四类规则，重点是「先匹配再豁免」那条：
 * 屏蔽广播电台，但保留「XX广播电视台」这类电视频道。
 */
const assert = require('assert');
const { filterChannels, shouldKeep } = require('../lib/filter');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log(`  ✅ ${name}`); }
  catch (e) { fail++; console.log(`  ❌ ${name}\n     ${e.message}`); }
}

// 构造最小样本，不依赖真实 data/
// stream 用真实长度的地址，避免被「有效性」规则（第 0 条）误伤
const item = (o) => ({ orgId: 1, index: 0, name: '', desc: '', stream: 'https://alivealone302.litenews.cn/1/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/playlist.m3u8', ...o });

const baseConfig = {
  blacklistNames: [],
  blacklistOrgIds: [],
  blacklistNameRegex: [],
  excludeNamePatterns: [],
};

console.log('\n=== 0. 流地址有效性（新增）===');
{
  const cfg = { ...baseConfig };
  check('正常地址 → 留',
    () => assert.strictEqual(shouldKeep(item({ name: 'A' }), cfg), true));
  check('★ 空串 → 删', () => assert.strictEqual(shouldKeep(item({ name: 'A', stream: '' }), cfg), false));
  check('★ "https://" 残缺值 → 删（orgId=657 实况）',
    () => assert.strictEqual(shouldKeep(item({ name: 'A', stream: 'https://' }), cfg), false));
  check('★ stream 字段缺失 → 删', () => assert.strictEqual(shouldKeep({ orgId: 1, index: 0, name: 'A' }, cfg), false));
  check('过短地址 → 删', () => assert.strictEqual(shouldKeep(item({ name: 'A', stream: 'https://x/y.m3u8' }), cfg), false));
  check('http（非 https）也保留', () => assert.strictEqual(shouldKeep(item({ name: 'A', stream: 'http://qkqxzb.qingk.cn/live/llsjtv01/index.m3u8' }), cfg), true));
  check('可用 dropInvalidStream:false 关闭该规则',
    () => assert.strictEqual(shouldKeep({ orgId: 1, index: 0, name: 'A', stream: '' }, { ...baseConfig, dropInvalidStream: false }), true));
}

console.log('\n=== 1. blacklistNames（name + desc 都查，保持原行为）===');
{
  const cfg = { ...baseConfig, blacklistNames: ['CCTV', '测试'] };
  check('name 命中 → 删', () => assert.strictEqual(shouldKeep(item({ name: 'CCTV-1' }), cfg), false));
  check('desc 命中 → 删', () => assert.strictEqual(shouldKeep(item({ name: '普通台', desc: '测试频道' }), cfg), false));
  check('都不命中 → 留', () => assert.strictEqual(shouldKeep(item({ name: '山东卫视' }), cfg), true));
}

console.log('\n=== 2. blacklistOrgIds ===');
{
  const cfg = { ...baseConfig, blacklistOrgIds: [21, 29] };
  check('orgId 命中 → 删', () => assert.strictEqual(shouldKeep(item({ orgId: 21 }), cfg), false));
  check('orgId 不命中 → 留', () => assert.strictEqual(shouldKeep(item({ orgId: 22 }), cfg), true));
}

console.log('\n=== 3. blacklistNameRegex（只查 name，不查 desc）===');
{
  const cfg = { ...baseConfig, blacklistNameRegex: ['^测试'] };
  check('name 匹配正则 → 删', () => assert.strictEqual(shouldKeep(item({ name: '测试频道' }), cfg), false));
  check('★ 只出现在 desc 里 → 不删（避免长文本误伤）',
    () => assert.strictEqual(shouldKeep(item({ name: '胶州综合', desc: '测试性描述' }), cfg), true));
  check('非开头匹配 → 不删（锚点生效）',
    () => assert.strictEqual(shouldKeep(item({ name: '我的测试台' }), cfg), true));
}

console.log('\n=== 4. excludeNamePatterns：先匹配再豁免 ★（本次核心需求）===');
{
  const cfg = { ...baseConfig, excludeNamePatterns: [{ match: 'FM|广播', unless: '广播电视台' }] };

  check('「FM100.1」→ 删', () => assert.strictEqual(shouldKeep(item({ name: 'FM100.1' }), cfg), false));
  check('「听广播」→ 删', () => assert.strictEqual(shouldKeep(item({ name: '听广播' }), cfg), false));
  check('「综合广播」→ 删', () => assert.strictEqual(shouldKeep(item({ name: '综合广播' }), cfg), false));
  check('「无棣广播直播回放」→ 删', () => assert.strictEqual(shouldKeep(item({ name: '无棣广播直播回放' }), cfg), false));
  check('「FM97-Live」→ 删', () => assert.strictEqual(shouldKeep(item({ name: 'FM97-Live' }), cfg), false));

  // ★ 这几条是最关键的：电视台不能误删
  check('★「潍城区广播电视台」→ 保留（豁免生效）',
    () => assert.strictEqual(shouldKeep(item({ name: '潍城区广播电视台' }), cfg), true));
  check('「普通电视台」→ 保留', () => assert.strictEqual(shouldKeep(item({ name: '山东卫视' }), cfg), true));

  check('★ 只出现在 desc 里 → 不删',
    () => assert.strictEqual(shouldKeep(item({ name: '乳山综合频道', desc: '乳山广播电视台综合频道' }), cfg), true));
}

console.log('\n=== 5. 规则叠加与边界 ===');
{
  const cfg = {
    blacklistNames: ['测试'],
    blacklistOrgIds: [99],
    blacklistNameRegex: [],
    excludeNamePatterns: [{ match: 'FM|广播', unless: '广播电视台' }],
  };
  check('任一规则命中即删', () => assert.strictEqual(shouldKeep(item({ name: '测试广播' }), cfg), false));
  check('全部规则都不命中 → 留', () => assert.strictEqual(shouldKeep(item({ name: '山东卫视' }), cfg), true));

  check('空 name 不炸', () => assert.doesNotThrow(() => shouldKeep(item({ name: '' }), cfg)));
  check('name 缺失不炸', () => assert.doesNotThrow(() => shouldKeep({ orgId: 1, index: 0 }, cfg)));
  check('desc 缺失不炸', () => assert.doesNotThrow(() => shouldKeep(item({ name: 'x', desc: undefined }), cfg)));

  check('配置缺字段时用空数组兜底',
    () => assert.strictEqual(shouldKeep(item({ name: '任意台' }), {}), true));

  check('★ 非法正则不炸、且跳过该规则',
    () => assert.strictEqual(shouldKeep(item({ name: '任意台' }), { ...baseConfig, blacklistNameRegex: ['[bad'] }), true));
}

console.log('\n=== 6. filterChannels 批量 ===');
{
  const cfg = { ...baseConfig, excludeNamePatterns: [{ match: 'FM|广播', unless: '广播电视台' }] };
  const data = [
    item({ name: '综合频道' }),
    item({ name: 'FM100.1' }),
    item({ name: '潍城区广播电视台' }),
    item({ name: '听广播' }),
  ];
  const kept = filterChannels(data, cfg);
  check('批量过滤后剩 2 条', () => assert.strictEqual(kept.length, 2));
  check('留下的正是电视类', () => assert.deepStrictEqual(kept.map(x => x.name), ['综合频道', '潍城区广播电视台']));
}

console.log('\n' + '='.repeat(46));
console.log(`结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
