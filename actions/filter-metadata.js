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
 *                                    filter-metadata ★ ← 过滤只在这里发生
 *                                            ↓
 *                                      streams_filtered.json （成品，可直接用）
 *                                            ↓
 *                     三个生成器 / CF Worker  都只读这个，不需要知道过滤规则
 *
 * 规则本身仍在 actions/lib/filter.js，可用 config.json 调整。
 */
const fs = require('fs');
const path = require('path');
const { filterChannels } = require('./lib/filter');

const configPath = path.join(__dirname, '../', 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

const inputFile = path.join(__dirname, '../data/streams_all.json');
const outputFile = path.join(__dirname, '../data/streams_filtered.json');

const data = JSON.parse(fs.readFileSync(inputFile, 'utf-8'));
const filtered = filterChannels(data, config);

fs.writeFileSync(outputFile, JSON.stringify(filtered, null, 2), 'utf-8');

const removed = data.length - filtered.length;
console.log(`Filtered ${data.length} → ${filtered.length} items (removed ${removed})`);
console.log(`Written to ${path.relative(process.cwd(), outputFile)}`);
