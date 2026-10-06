const fs = require('fs');
const path = require("path");

const configPath = path.join(__dirname, '../', `config.json`);
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

const baseUrl = config.baseUrl_ku9.replace(/\/$/, '');
const blacklistNames = config.blacklistNames || [];
const blacklistOrgIds = config.blacklistOrgIds || [];

// 列表名称：酷9 的「TXT 只有一个分组时，分组名必须和列表名称一致」才认配置。
// 可用环境变量 KU9_LIST_NAME 覆盖，默认沿用原文件名语义。
const listName = process.env.KU9_LIST_NAME || 'iqilu-ku9';

const dataPath = path.join(__dirname, '../data', `streams_all.json`);
const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

const filtered = data.filter(item => {
  const name = item.name || '';
  const desc = item.desc || '';
  const nameOk = !blacklistNames.some(key => name.includes(key) || desc.includes(key));
  const idOk = !blacklistOrgIds.includes(item.orgId);
  return nameOk && idOk;
});

const apiUrlOf = (item) => `${baseUrl}?orgid=${item.orgId}&num=${item.index}`;

// 逗号是 TXT 的字段分隔符，名字里出现逗号会让字段错位（地址被当成第二个名字）。
const sanitize = (s) => String(s).replace(/[,\r\n]/g, ' ');

// —— 产物 1：M3U（保留，兼容原播放器用法）——
// 带 #EXTM3U 头 + #EXTINF 行，能携带 tvg-logo 图标。
let m3u = '#EXTM3U\n';

filtered.forEach(item => {
  const logo = item.icon || (item.share && item.share.image) || '';
  m3u += `#EXTINF:-1 tvg-logo="${logo}",${item.name}\n`;
  m3u += `${apiUrlOf(item)}\n`;
});

fs.writeFileSync('iqilu-ku9.m3u', m3u, 'utf-8');
console.log(`M3U generated: iqilu-ku9.m3u (${filtered.length} channels)`);

// —— 产物 2：TXT（酷9 TXT 格式）——
// 首行：列表名,#genre#,分组名
// 频道行：频道名,地址
// 与 M3U 的区别：没有 #EXTM3U 头、没有 #EXTINF 行，
// 频道名与地址写在同一行用英文逗号分隔。
// 注意：TXT 这两列结构里没有图标位置，所以 tvg-logo 在 TXT 中会丢失。
const txtLines = filtered.map(item => `${item.name},${apiUrlOf(item)}`);
const header = `${sanitize(listName)},#genre#,${sanitize(listName)}`;
const txt = [header, ...txtLines].join('\n') + '\n';

fs.writeFileSync('iqilu-ku9.txt', txt, 'utf-8');
console.log(`TXT generated: iqilu-ku9.txt (${filtered.length} channels)`);
