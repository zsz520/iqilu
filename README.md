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

## 频道数据处理

所有规则集中在 `config.json`，逻辑分两个模块：

- `actions/lib/filter.js` —— **筛选**（留不留）
- `actions/lib/transform.js` —— **变换**（改名、去重、按官方表排序）

### 处理在什么时候发生

处理是独立步骤，由 `actions/filter-metadata.js` 执行，产出成品 JSON：

```
fetch-metadata  →  data/streams_1-100.json …
merge-metadata  →  data/streams_all.json        ← 原始，未过滤
filter-metadata →  data/streams_filtered.json   ← 成品，已筛选+改名+去重+排序
                        ↓
        gen-m3u-generic / gen-txt-ku9 / gen-m3u-direct   ← 只读成品
```

下游（生成器、Cloudflare Worker）只读 `streams_filtered.json`，不需要知道规则。

处理**按顺序**执行四步：

| 步骤 | 做什么 | 配置字段 | 实现 |
|---|---|---|---|
| 1. 筛选 | 决定某条留不留 | `blacklistNames` / `blacklistOrgIds` / `blacklistNameRegex` / `excludeNamePatterns` / `dropInvalidStream` | `filter.js` |
| 2. 改名 | 修正名字 | `nameOverrides` | `transform.js` |
| 3. 去重 | 同流**且同 id** 才合并 | `dedupe` | `transform.js` |
| 4. 排序 | 官方表序在前、未收录沉底 | （读 `data/channel_names.csv`） | `transform.js` |

> ⚠️ 改规则后**必须重跑 `gen-name-overrides.js`**（README 见「改名规则」），
> `filter-metadata` 只读它生成的 `nameOverrides`，不读 CSV。CI 已内置该步骤。

### 列表顺序 = 官方表的顺序 ★

**排序完全由 `data/channel_names.csv` 的行序决定**，这是维护入口：

| 情况 | 排在哪 |
|---|---|
| 官方表里有这条 | **按官方表的行序** |
| 官方表里没有（扫到了但未收录） | **一律沉底**，内部按 `orgId` / `index` |

维护方式：**只改官方表**，顺序自动跟着变。列表末尾就是天然的「新增待确认」清单。

> 当前产物 198 条 = **官方表段 181 条 + 未收录段 17 条**，日志会打印便于核对。
>
> ⚠️ 未收录的**不额外分组** —— 酷9 TXT 要求「只有一个分组时，分组名须与列表名一致」，
> 多插 `#genre#` 有风险。**排在末尾本身就是最好的标识。**

---

### 1. 筛选规则

命中任一即屏蔽：

| 字段 | 说明 | 匹配字段 |
|---|---|---|
| `dropInvalidStream` | 流地址为空/残缺 → 屏蔽（默认 `true`） | `stream` |
| `blacklistNames` | 关键词黑名单 | `name` + `desc` |
| `blacklistOrgIds` | 机构 ID 黑名单 | `orgId` |
| `blacklistNameRegex` | 正则黑名单 | **仅 `name`** |
| `excludeNamePatterns` | 先匹配再豁免（见下） | **仅 `name`** |

> ⚠️ **`blacklistOrgIds` 按「机构」整包屏蔽，一个 orgId 常含多个频道。**
> 当前为 `[21, 29, 225, 683]`：
>
> | orgId | 内容 | 为何拉黑 |
> |---|---|---|
> | 21 | 山东卫视系列 9 个频道 | 按需屏蔽 |
> | 29 | 空（本地扫不到记录） | 占位；**真正带数据的是它的马甲 683** |
> | **225** | 2 条，**名字全错** | id=1 名为「山东卫视」实为夏津；id=3 名为「少儿频道」实为体育。夏津正规组是 223 |
> | **683** | 7 条外省/省台频道 | **29 的马甲组**，流路径全部指向 `/29/…` |
>
> ★ **判断该不该拉黑时，除了看 `orgId`，还要看流路径目录段** —— 上游常给同一批流挂多个 orgId。
> 改前先确认：
> ```bash
> node -e "const d=require('./data/streams_all.json'); \
>   [21,29,225,683].forEach(id=>console.log(id, d.filter(x=>x.orgId===id).map(x=>x.name)))"
> ```

#### `excludeNamePatterns`：先匹配再豁免

每条形如 `{ "match": "正则", "unless": "正则" }`：命中 `match` 且**不**命中 `unless` → 屏蔽。

```json
[
  { "match": "FM|广播",   "unless": "广播电视台" },
  { "match": "直播|发布会|热线", "unless": "" }
]
```

- **规则 1**：屏蔽广播电台，保留电视台。
  `FM100.1`、`听广播` → 屏蔽；`潍城区广播电视台` → 保留。
- **规则 2**：屏蔽「非电视台」的临时流 —— 发布会转播、各路慢直播、监督热线等，
  点开多半是单场景机位或播不出。实测命中 10 条（`新闻发布会`、`慢直播`、`会场直播`、`党风政风监督热线` 等）。

> 该规则只查 `name` 且是**子串匹配**。山东本地台标准命名是「XX综合 / XX新闻综合 / XX影视」，
> 不含这三个词，实测 198 条零误伤。若将来有台名带"直播"字样，给该条补 `unless` 即可。

---

### 2. 改名规则 `nameOverrides`

上游返回的频道名有两类缺陷：**张冠李戴**（orgId=225 index=0 名为「山东卫视」实为夏津）、
**缺地域前缀**（13 个频道都叫「综合频道」）。

**键格式：`"orgId:index"`**

> ★ **全项目统一用 `index` 定位。**
> `index` 是上游返回数组里的位置，也正是酷9 / Vercel 取址脚本的 `num` 参数。
> 用它当键，`config.json`、`streams_filtered.json`、Ku9 TXT 的 `num` 三处口径一致。
> 上游记录里的 `id` 字段**本项目不做定位使用**。

```json
"nameOverrides": {
  "537:0": "东营新闻综合",
  "227:0": "黄岛综合",
  "129:0": "金乡综合"
}
```

名字来源是 **`data/channel_names.csv`**（官方频道清单，225 条，16 地市）：

```
# 格式: orgId,index,地市,规范名
223,0,德州,夏津综合
227,0,青岛,黄岛综合
```

**更新方式**（权威表变了就重跑）：

```bash
node actions/gen-name-overrides.js --dry   # 预览
node actions/gen-name-overrides.js         # 写回 config.json
```

> 权威表第 2 列口径即为 `index`，生成脚本不做换算。
> 若你的表还是上游 `id` 口径，先跑 `node actions/csv-id-to-index.js --write` 换算；
> 本地没有的频道换算不出来，会保留原值待人工确认。

当前 225 条权威记录 → 产出 149 条覆盖（名字已对 34 条，本地缺失 42 条）。

---

### 3. 去重规则 `dedupe`

**★ 去重键 = 流地址指纹 + 上游 `id`，两个都相同才算重复。**

上游「流地址相同」有两种成因，**必须区别对待**：

| 成因 | 例子 | 处理 |
|---|---|---|
| 同一条记录被重复返回 | 305/423 的胶州组 | **合并** |
| 上游不同步：**不同 `id` 共用一路流** | 115/635 潍坊系列 | **不合并**（合并会丢台） |

只要 `id` 不一样就全部保留 —— **刻意保守**：宁可在列表里多留一条让人工判断，
也不要静默丢掉一个台。

```json
"dedupe": {
  "enabled": true,
  "preferLongerName": true,
  "keepOrgId": [305, 635, 689]
}
```

**保留优先级**（打分从高到低）：

1. 在 `nameOverrides` 里有命中的（名字经过权威核对）
2. 流地址里含 `keepOrgId` 目录段的
3. 条目 `orgId` 自身在 `keepOrgId` 里
4. 名字更长
5. `index` 更小（保证稳定）

> 去重函数**不负责排序**（排序是第 4 步的事），否则会覆盖官方表顺序。

**流地址归一化**（`streamKey`）——去重能生效的关键：

```
https://alivealone302.litenews.cn/635/1ebcf529.../playlist.m3u8
https://xxx.100ycdn.com/alivealone302.litenews.cn/635/1ebcf529.../playlist.m3u8
  ↑ 同一路流、不同 CDN 域名 → 都归一化为 "635/1ebcf529..."
```

规则：去 `?k=&t=`（时效 token，不去掉永远判不出重复）→ 提取 `<数字目录>/<流哈希>`
作指纹 → 兜底再试 `/live/<名字>/index.m3u8`。

---

### 4. 命名规范

- **地级市台**：去掉「频道」二字（`东营新闻综合`、`潍坊影视综艺`）。
- **县级台**：统一「XX综合」；同县有多个频道的加序号（`莱西综合` / `莱西综合2`）。
- 依据广电总局《县级广播电视播出机构名录》校准台名。

### 规则测试

```bash
node actions/_test/filter.test.js      # 42 项：五类筛选规则 + 边界
node actions/_test/transform.test.js   # 35 项：流归一化 + 改名 + 去重 + 端到端
```

---

## 上游接口的三个坑（改代码前必读）

### 坑 1：`index` 必须记录上游原始数组下标

产出的 `index` 被酷9 / Vercel 取址脚本当作 `num`，用来请求
`app.litenews.cn/v1/app/play/tv/live?orgid=X` 并取 `json.data[num]`。

**因此 `index` 必须等于上游原始数组下标，而不是 filter 之后的下标。**
早期版本先 `filter` 再 `map(…, i)`，一旦上游有 `stream` 为空的项，`index` 会整体前移，
`num` 取到隔壁频道，**静默播放错误的台**。现已是先记下标再过滤。

```js
// ✅ 正确：先记下标，再过滤
const all = json.data.map((item, rawIndex) => ({ ...item, orgId, index: rawIndex, stream }));
const valid = all.filter(item => item.stream.startsWith('http'));
```

### 坑 2：上游会返回残缺流地址

`orgId=657 idx=1「民生频道」` 的 `stream` 是 `"https://"`（空地址），
由 `dropInvalidStream` 在筛选阶段丢弃。

### 坑 3：**直播源路径里没有 `id`**，别想从 URL 反推

实测 248 条记录，**路径里不携带业务编号 `id`**。路径只有五类形状：

| 形状 | 路径里的数字是什么 |
|---|---|
| `/orgId/32位hex/playlist.m3u8` | 首段 **orgId**；二段是**随机流哈希**，与 `id` 无关 |
| `/orgId/日期_ID/playlist.m3u8` | 日期 + **雪花 ID**（流的主键），不是频道 `id` |
| `/b{orgId}/…` | `b` + **orgId** |
| `/live/{拼音}/index.m3u8` | **台名拼音**（唯一语义线索） |
| 其他（裸 IP、`tv.cctv.com/…`） | 无 |

**别把第二段当 base64** —— 32 位 hex 是随机哈希，解出来是乱码。

> 唯一能当证据的是 **`/live/{拼音}/`**。例如 `orgId=225 idx=0` 挂名「山东卫视」，
> 但流是 `/live/xiajin_tv02/` —— 坐实错挂。
>
> 另注意 `orgId` 路径段与记录自身也可能不一致：`orgId=21` 的 9 条里 7 条流路径是 `/291/…`。
> **路径段只能当线索，不能当权威。**
