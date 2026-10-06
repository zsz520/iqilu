const fs = require('fs');
const path = require("path");

const configPath = path.join(__dirname, '../', `config.json`);
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

const baseUrl = config.baseUrl_generic.replace(/\/$/, '');

// 读过滤后的成品数据。过滤动作已由 filter-metadata.js 统一完成，
// 这里不再需要知道过滤规则。
const dataPath = path.join(__dirname, '../data', `streams_filtered.json`);
const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

let m3u = '#EXTM3U\n';

data.forEach(item => {
  const logo = item.icon || (item.share && item.share.image) || '';
  const apiUrl = `${baseUrl}/api/iqilu?orgid=${item.orgId}&num=${item.index}`;
  m3u += `#EXTINF:-1 tvg-logo="${logo}",${item.name}\n`;
  m3u += `${apiUrl}\n`;
});

fs.writeFileSync('iqilu-generic.m3u', m3u, 'utf-8');
console.log(`M3U generated: iqilu-generic.m3u (${data.length} channels)`);