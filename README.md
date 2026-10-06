## iqilu 静态源

## Vercel部署方式（任意播放器）

通过 GitHub Actions 自动抓取最新直播源，生成 M3U 文件。

通过 Vercel Serverless Function 提供 302 跳转。

直接导入播放器使用，无需额外配置。

### 部署方法

1. 克隆本仓库
2. 点击下面按钮，创建 Project，选择刚刚克隆的仓库进行部署
3. 在克隆的仓库里开启 Actions
4. 修改 config.json 文件中 baseUrl-generic 的值，Actions 会自动运行，生成新的 m3u
5. 复制 m3u 文件，导入播放器播放

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com)

## 酷9播放器JS脚本方式

两种格式任选：

- M3U（带频道图标）：[iqilu-ku9.m3u](https://fastly.jsdelivr.net/gh/zsz520/iqilu@master/iqilu-ku9.m3u)
- TXT（酷9 原生格式）：[iqilu-ku9.txt](https://fastly.jsdelivr.net/gh/zsz520/iqilu@master/iqilu-ku9.txt)

生成脚本：`actions/gen-txt-ku9.js`（**一次同时输出上面两个文件**）。

两种格式的差别：

| | M3U | TXT |
|---|---|---|
| 头部 | `#EXTM3U` + 每频道一行 `#EXTINF` | 首行 `列表名,#genre#,分组名` |
| 频道行 | `#EXTINF:-1 tvg-logo="…",频道名` 换行接地址 | `频道名,地址`（同一行，逗号分隔） |
| 频道图标 | ✅ 带 `tvg-logo` | ❌ 两列结构里没有图标位置，会丢失 |
| 适用 | 通用播放器 | 酷9 原生格式，更好手改 |

> TXT 首行的分组名需与列表名一致，酷9 才会读取分组配置。
> 列表名可用环境变量 `KU9_LIST_NAME` 覆盖，默认 `iqilu-ku9`。

## 频道过滤规则

所有过滤规则集中在 `config.json`，逻辑实现在 `actions/lib/filter.js`。

### 过滤在什么时候发生

**过滤是一个独立的流水线步骤**，由 `actions/filter-metadata.js` 执行，产出成品 JSON：

```
fetch-metadata  →  data/streams_1-100.json …
merge-metadata  →  data/streams_all.json        ← 原始，含全部频道，未过滤
filter-metadata →  data/streams_filtered.json   ← 成品，已过滤
                        ↓
        gen-m3u-generic / gen-txt-ku9 / gen-m3u-direct   ← 只读成品，不碰规则
```

**下游（生成器、Cloudflare Worker）都不需要知道过滤规则**，只读 `streams_filtered.json`。
所以改规则只需改一处，不会出现"某个产物忘了同步"的情况。

规则**按顺序**生效，命中任一即屏蔽：

| 字段 | 说明 | 匹配字段 |
|---|---|---|
| `blacklistNames` | 关键词黑名单，包含任一即屏蔽 | `name` + `desc` |
| `blacklistOrgIds` | 机构 ID 黑名单 | `orgId` |
| `blacklistNameRegex` | 正则黑名单 | **仅 `name`** |
| `excludeNamePatterns` | 先匹配再豁免（见下） | **仅 `name`** |

> ⚠️ **`blacklistOrgIds` 是按「机构」整包屏蔽，一个 orgId 常含多个频道。**
> 当前配置为 `[21, 29]`，其中 **orgId 21 包含 9 个频道**
> （山东卫视 / 新闻频道 / 齐鲁频道 / 体育休闲频道 / 生活频道 / 综艺频道 / 文旅频道 / 农科频道 / 少儿频道），
> orgId 29 为空。
>
> 改这个字段前，先确认该 orgId 下到底有哪些频道：
> ```bash
> node -e "const d=require('./data/streams_all.json'); \
>   [21,29].forEach(id=>console.log(id, d.filter(x=>x.orgId===id).map(x=>x.name)))"
> ```

### `excludeNamePatterns`：先匹配再豁免

每条形如 `{ "match": "正则", "unless": "正则" }`：
命中 `match` 且**不**命中 `unless` → 屏蔽。

当前配置屏蔽广播电台、但保留电视台：

```json
{ "match": "FM|广播", "unless": "广播电视台" }
```

- `FM100.1`、`听广播`、`综合广播` → **屏蔽**（广播电台）
- `潍城区广播电视台` → **保留**（这是电视台官方全称，实际是电视频道）

> 若想连"广播电视台"一起屏蔽，把 `unless` 去掉即可：`{ "match": "FM|广播" }`。

### 规则测试

```bash
node actions/_test/filter.test.js
```

覆盖四类规则、规则叠加、以及 25 项边界用例（空字段、非法正则、误伤防护等）。
