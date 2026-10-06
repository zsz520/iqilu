const fs = require('fs');
const path = require("path");
const { filterChannels } = require("./lib/filter");

const configPath = path.join(__dirname, '../', `config.json`);
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

const dataPath = path.join(__dirname, '../data', `streams_all.json`);
const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

// 过滤规则统一在 actions/lib/filter.js，三个生成器共用一份，避免规则漂移。
const filtered = filterChannels(data, config);

let m3u = '#EXTM3U\n';

filtered.forEach(item => {
  const logo = item.icon || (item.share && item.share.image) || '';
  const apiUrl = item.stream;
  m3u += `#EXTINF:-1 tvg-logo="${logo}",${item.name}\n`;
  m3u += `${apiUrl}\n`;
});

fs.writeFileSync('iqilu-direct.m3u', m3u, 'utf-8');
console.log('Filtered M3U generated: iqilu-direct.m3u');