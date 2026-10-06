/**
 * 改名 + 去重的离线测试（无第三方依赖，直接 node 跑）
 *
 * 覆盖 actions/lib/transform.js：
 *   - streamKey 的归一化（去 query、剥 CDN 域名、老架构 live/ 形式）
 *   - applyNameOverrides 用 id（而非 index）匹配覆盖表
 *   - dedupeByStream 的保留策略（权威优先 > keepOrgId > 名字长度）
 */
const assert = require('assert');
const { streamKey, applyNameOverrides, dedupeByStream } = require('../lib/transform');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log(`  ✅ ${name}`); }
  catch (e) { fail++; console.log(`  ❌ ${name}\n     ${e.message}`); }
}

const item = (o) => ({ orgId: 1, index: 0, id: 1, name: 'X', stream: '', ...o });
const S = (path) => `https://alivealone302.litenews.cn/${path}?k=abc&t=123`;

console.log('\n=== 1. streamKey 归一化 ===');
{
  check('去掉 query（k/t 时效 token）',
    () => assert.strictEqual(
      streamKey(item({ stream: S('635/1ebcf529cada4d448a48f73b216cd1ac/playlist.m3u8') })),
      '635/1ebcf529cada4d448a48f73b216cd1ac'));

  check('★ 剥掉 CDN 中转域名，取尾部真实路径',
    () => assert.strictEqual(
      streamKey(item({ stream: 'https://tftl0gc5nhcjigyzd1c3qgohn4amcpf5gkamcp7zgkc3ogezga4mwcizgk75u.100ycdn.com/alivealone302.litenews.cn/635/1ebcf529cada4d448a48f73b216cd1ac/playlist.m3u8' })),
      '635/1ebcf529cada4d448a48f73b216cd1ac'));

  check('★ 两种域名形态归一化到同一个 key（这正是漏判的根源）',
    () => assert.strictEqual(
      streamKey(item({ stream: 'https://alivealone302.litenews.cn/635/1ebcf529cada4d448a48f73b216cd1ac/playlist.m3u8' })),
      streamKey(item({ stream: 'https://xxx.100ycdn.com/alivealone302.litenews.cn/635/1ebcf529cada4d448a48f73b216cd1ac/playlist.m3u8' }))));

  check('老架构 live/xxx/index.m3u8',
    () => assert.strictEqual(
      streamKey(item({ stream: 'https://jsylivealone302.iqilu.com/live/xiajin_tv02/index.m3u8?t=1' })),
      'live/xiajin_tv02'));

  check('识别不了时退回完整路径（不崩）',
    () => assert.strictEqual(streamKey(item({ stream: 'https://weird.example.com/whatever' })),
      'https://weird.example.com/whatever'));

  check('空 stream 不炸', () => assert.strictEqual(streamKey(item({ stream: '' })), ''));
  check('stream 缺失不炸', () => assert.strictEqual(streamKey({ orgId: 1 }), ''));
}

console.log('\n=== 2. applyNameOverrides（统一用 index 定位）===');
{
  check('★ 用 index 匹配覆盖表',
    () => {
      const cfg = { nameOverrides: { '225:0': '夏津综合' } };
      const src = [item({ orgId: 225, index: 0, id: 1, name: '山东卫视' })];
      const { channels } = applyNameOverrides(src, cfg);
      assert.strictEqual(channels[0].name, '夏津综合');
    });

  check('★ 只认 index，id 再像也不匹配',
    () => {
      const cfg = { nameOverrides: { '225:0': '夏津综合' } };
      // id=0 但 index=5 → 不应命中（键是 index）
      const src = [item({ orgId: 225, index: 5, id: 0, name: '山东卫视' })];
      const { channels } = applyNameOverrides(src, cfg);
      assert.strictEqual(channels[0].name, '山东卫视');
    });

  check('★ 与 Ku9 的 num 参数口径一致（num=index）',
    () => {
      // 537 组：上游 id=1 的那条，其 index=0 → 覆盖键应为 537:0
      const cfg = { nameOverrides: { '537:0': '东营新闻综合' } };
      const src = [item({ orgId: 537, index: 0, id: 1, name: '新闻综合' })];
      const { channels } = applyNameOverrides(src, cfg);
      assert.strictEqual(channels[0].name, '东营新闻综合');
    });

  check('覆盖表键不匹配 → 不改',
    () => {
      const cfg = { nameOverrides: { '1:99': '甲' } };
      const src = [item({ orgId: 1, index: 0, id: 0, name: '乙' })];
      const { channels } = applyNameOverrides(src, cfg);
      assert.strictEqual(channels[0].name, '乙');
    });

  check('无命中 → 原样返回、不改动对象',
    () => {
      const src = [item({ orgId: 5, index: 0, id: 5, name: '不变' })];
      const { channels, renamed } = applyNameOverrides(src, { nameOverrides: {} });
      assert.strictEqual(channels[0], src[0]);
      assert.strictEqual(renamed.length, 0);
    });

  check('★ 不修改原对象（可追溯上游原始数据）',
    () => {
      const src = [item({ orgId: 1, index: 0, id: 1, name: '旧名' })];
      applyNameOverrides(src, { nameOverrides: { '1:0': '新名' } });
      assert.strictEqual(src[0].name, '旧名');
    });

  check('改名日志记录 from/to',
    () => {
      const { renamed } = applyNameOverrides(
        [item({ orgId: 1, index: 3, id: 9, name: '旧' })], { nameOverrides: { '1:3': '新' } });
      assert.deepStrictEqual(renamed, [{ key: '1:3', from: '旧', to: '新' }]);
    });

  check('index 缺失时键为 undefined，不误伤别的条目',
    () => {
      const cfg = { nameOverrides: { '1:0': '甲' } };
      const src = [{ orgId: 1, id: 1, name: '乙', stream: S('1/a/playlist.m3u8') }];
      const { channels } = applyNameOverrides(src, cfg);
      assert.strictEqual(channels[0].name, '乙');
    });

  check('nameOverrides 缺失不炸',
    () => assert.doesNotThrow(() => applyNameOverrides([item({})], {})));
}

console.log('\n=== 3. dedupeByStream ===');
{
  const mk = (orgId, index, id, name, path) => item({ orgId, index, id, name, stream: S(path) });

  check('同一路流只留一条', () => {
    const data = [
      mk(39, 0, 10, '新闻综合频道', '689/bb17/playlist.m3u8'),
      mk(689, 0, 11, '新闻综合频道', '689/bb17/playlist.m3u8'),
    ];
    const { channels, dropped } = dedupeByStream(data, { dedupe: { keepOrgId: [689] } });
    assert.strictEqual(channels.length, 1);
    assert.strictEqual(channels[0].orgId, 689);
    assert.strictEqual(dropped.length, 1);
  });

  check('★ 有权威命名覆盖的条目优先保留', () => {
    const data = [
      mk(537, 1, 3, '公共频道', '537/hashA/playlist.m3u8'),
      mk(657, 0, 1, '新闻综合频道', '537/hashA/playlist.m3u8'),
    ];
    // 537:1（index=1）在覆盖表里 → 应保留 537
    const { channels } = dedupeByStream(data, { nameOverrides: { '537:1': '东营公共' }, dedupe: {} });
    assert.strictEqual(channels[0].orgId, 537);
    assert.strictEqual(channels[0].name, '公共频道');
  });

  check('★ CDN 中转域名也能识别为重复', () => {
    const data = [
      mk(635, 2, 7, '潍坊影视综艺', '635/1ebc/playlist.m3u8'),
      item({ orgId: 115, index: 5, id: 181, name: '潍坊影视综艺',
        stream: 'https://xxx.100ycdn.com/alivealone302.litenews.cn/635/1ebc/playlist.m3u8' }),
    ];
    const { channels } = dedupeByStream(data, { dedupe: { keepOrgId: [635] } });
    assert.strictEqual(channels.length, 1);
    assert.strictEqual(channels[0].orgId, 635);
  });

  check('enabled:false 时不去重', () => {
    const data = [
      mk(1, 0, 1, 'A', '1/h/playlist.m3u8'),
      mk(2, 0, 1, 'B', '1/h/playlist.m3u8'),
    ];
    const { channels, dropped } = dedupeByStream(data, { dedupe: { enabled: false } });
    assert.strictEqual(channels.length, 2);
    assert.strictEqual(dropped.length, 0);
  });

  check('不重复的流一条不动', () => {
    const data = [
      mk(1, 0, 1, 'A', '1/h1/playlist.m3u8'),
      mk(2, 0, 1, 'B', '2/h2/playlist.m3u8'),
    ];
    const { channels } = dedupeByStream(data, { dedupe: {} });
    assert.strictEqual(channels.length, 2);
  });

  check('★ 去重后恢复原始顺序（按 orgId,index）', () => {
    const data = [
      mk(9, 3, 1, 'C', '9/h3/playlist.m3u8'),
      mk(2, 0, 1, 'A', '2/h1/playlist.m3u8'),
      mk(5, 1, 1, 'B', '5/h2/playlist.m3u8'),
    ];
    const { channels } = dedupeByStream(data, { dedupe: {} });
    assert.deepStrictEqual(channels.map(x => x.orgId), [2, 5, 9]);
  });

  check('dropped 记录保留去向', () => {
    const data = [
      mk(1, 0, 1, '留', '1/h/playlist.m3u8'),
      mk(2, 0, 1, '删', '1/h/playlist.m3u8'),
    ];
    const { dropped } = dedupeByStream(data, { dedupe: {} });
    assert.strictEqual(dropped[0].name, '删');
    assert.strictEqual(dropped[0].keptAs, '留');
  });

  check('空数组不炸', () => assert.deepStrictEqual(dedupeByStream([], { dedupe: {} }).channels, []));
  check('dedupe 配置缺失不炸', () => assert.strictEqual(dedupeByStream([mk(1, 0, 1, 'A', '1/h/playlist.m3u8')], {}).channels.length, 1));
}

console.log('\n=== 4. 端到端：改名 + 去重串联 ===');
{
  // 模拟真实场景：225 组错挂 + 39/689 重复
  const data = [
    item({ orgId: 39, index: 0, id: 10, name: '新闻综合频道', stream: S('689/bb17/playlist.m3u8') }),
    item({ orgId: 225, index: 0, id: 1, name: '山东卫视', stream: 'https://jsylivealone302.iqilu.com/live/xiajin_tv02/index.m3u8?t=1' }),
    item({ orgId: 689, index: 0, id: 11, name: '新闻综合频道', stream: S('689/bb17/playlist.m3u8') }),
  ];
  const cfg = {
    nameOverrides: { '225:0': '夏津综合' },
    dedupe: { keepOrgId: [689] },
  };
  const r1 = applyNameOverrides(data, cfg);
  const r2 = dedupeByStream(r1.channels, cfg);
  check('3 条 → 2 条（去重掉一条）', () => assert.strictEqual(r2.channels.length, 2));
  check('225 的名字被修正', () => assert.strictEqual(
    r2.channels.find(x => x.orgId === 225).name, '夏津综合'));
  check('保留的是 689 那条', () => assert.strictEqual(
    r2.channels.find(x => x.name === '新闻综合频道').orgId, 689));
}

console.log('\n' + '='.repeat(46));
console.log(`结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
