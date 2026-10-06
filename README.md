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

所有规则集中在 `config.json`，逻辑实现分两个模块：

- `actions/lib/filter.js` —— **筛选**（留不留）
- `actions/lib/transform.js` —— **变换**（改名、去重、按官方表排序），返回新数组而非布尔值

### 处理在什么时候发生

**处理是一个独立流水线步骤**，由 `actions/filter-metadata.js` 执行，产出成品 JSON：

```
fetch-metadata  →  data/streams_1-100.json …
merge-metadata  →  data/streams_all.json        ← 原始，含全部频道，未过滤
filter-metadata →  data/streams_filtered.json   ← 成品，已筛选+改名+去重+排序
                        ↓
        gen-m3u-generic / gen-txt-ku9 / gen-m3u-direct   ← 只读成品，不碰规则
```

**下游（生成器、Cloudflare Worker）都不需要知道规则**，只读 `streams_filtered.json`。
所以改规则只需改一处，不会出现"某个产物忘了同步"的情况。

处理**按顺序**执行四步：

| 步骤 | 做什么 | 配置字段 | 实现 |
|---|---|---|---|
| 1. 筛选 | 决定某条留不留 | `blacklistNames` / `blacklistOrgIds` / `blacklistNameRegex` / `excludeNamePatterns` / `dropInvalidStream` | `filter.js` |
| 2. 改名 | 修正名字 | `nameOverrides` | `transform.js` |
| 3. 去重 | 同流**且同 id** 才合并 | `dedupe` | `transform.js` |
| 4. 排序 | 官方表序在前、未收录沉底 | （读 `data/channel_names.csv`） | `transform.js` |

### 列表顺序 = 官方表的顺序 ★

**排序完全由 `data/channel_names.csv` 的行序决定**，这是给用户的维护入口：

| 情况 | 排在哪 |
|---|---|
| 官方表里有这条 | **按官方表的行序**（表序 = 展示序） |
| 官方表里没有（扫到了但未收录，**无论是否重复**） | **一律沉底**，内部按 `orgId` / `index` |

因此维护方式很简单：**只改官方表**，产物顺序自动跟着变。
**列表末尾那一段就是天然的「新增待确认」清单** —— 上游新上了什么台一眼可见，
确认属实后再把它补进官方表，下次生成它自动归位。

> 当前产物 211 条 = **官方表段 181 条 + 未收录段 30 条**。
> 日志里会打印 `Ordered 官方表 N 条在前 / 未收录 M 条沉底` 便于核对。

> ⚠️ 未收录的**不额外分组** —— 酷9 的 TXT 有「只有一个分组时，分组名须与列表名一致」
> 的契约，多插 `#genre#` 分组有风险。**排在末尾本身就是最好的标识。**

---

### 1. 筛选规则

命中任一即屏蔽：

| 字段 | 说明 | 匹配字段 |
|---|---|---|
| `dropInvalidStream` | 流地址为空/残缺 → 屏蔽（默认 `true`） | `stream` |
| `blacklistNames` | 关键词黑名单，包含任一即屏蔽 | `name` + `desc` |
| `blacklistOrgIds` | 机构 ID 黑名单 | `orgId` |
| `blacklistNameRegex` | 正则黑名单 | **仅 `name`** |
| `excludeNamePatterns` | 先匹配再豁免（见下） | **仅 `name`** |

> ⚠️ **`blacklistOrgIds` 是按「机构」整包屏蔽，一个 orgId 常含多个频道。**
> 当前配置为 `[21, 29, 225]`：
>
> | orgId | 内容 | 为何拉黑 |
> |---|---|---|
> | 21 | 山东卫视系列 9 个频道 | 按需屏蔽 |
> | 29 | 空 | 无内容 |
> | **225** | 2 条，**名字全错** | 废弃错误组：id=1 名为「山东卫视」实为夏津（`xiajin_tv02`）；id=3 名为「少儿频道」实为体育（`typd`）。夏津的正规组是 orgId=223 |
>
> 改这个字段前，先确认该 orgId 下到底有哪些频道：
> ```bash
> node -e "const d=require('./data/streams_all.json'); \
>   [21,29,225].forEach(id=>console.log(id, d.filter(x=>x.orgId===id).map(x=>x.name)))"
> ```
>
> **为何不直接改名而整组拉黑**：225 的两条都是老 iqilu 直连源
> （`jsylivealone302.iqilu.com` / `newlive.iqilu.com:1935`），已与现行 CDN 体系脱节，
> 且改名后仍与 223 组重复，不如整组弃用。

#### `excludeNamePatterns`：先匹配再豁免

每条形如 `{ "match": "正则", "unless": "正则" }`：
命中 `match` 且**不**命中 `unless` → 屏蔽。

当前配置屏蔽广播电台、但保留电视台：

```json
{ "match": "FM|广播", "unless": "广播电视台" }
```

- `FM100.1`、`听广播`、`综合广播` → **屏蔽**（广播电台）
- `潍城区广播电视台` → **保留**（这是电视台官方全称，实际是电视频道）

> 若想连"广播电视台"一起屏蔽，把 `unless` 去掉即可：`{ "match": "FM|广播" }`。

---

### 2. 改名规则 `nameOverrides`

上游返回的频道名有两类缺陷，都靠这张表修正：

| 缺陷 | 实例 |
|---|---|
| **张冠李戴** | `orgId=225 index=0` 名为「山东卫视」，实际流是夏津（`xiajin_tv02`） |
| **缺地域前缀** | 全站 13 个频道都叫「综合频道」，用户分不清是黄岛、金乡还是成武 |

**键格式：`"orgId:index"`**

> ★ **全项目统一用 `index` 定位。**
> `index` 是上游返回数组里的位置，也正是酷9 / Vercel 取址脚本的 `num` 参数。
> 用它当键，`config.json`、`streams_filtered.json`、Ku9 TXT 的 `num` 三处口径完全一致，
> 不会出现两套编号互相打架。
>
> 注：上游记录里还有个 `id` 字段（业务编号），**本项目不使用它做定位**。
> 权威表 `channel_names.csv` 的第 2 列也已统一改为 `index`，全项目只剩一套编号。

```json
"nameOverrides": {
  "537:0": "东营新闻综合",
  "227:0": "黄岛综合",
  "129:0": "金乡综合"
}
```

名字来源是 **`data/channel_names.csv`**（官方频道清单，223 条，覆盖 16 地市）：

```
# 格式: orgId,index,地市,规范名
223,0,德州,夏津综合
223,1,德州,夏津公共
227,0,青岛,黄岛综合
```

**更新方式**（权威表变了就重跑）：

```bash
node actions/gen-name-overrides.js --dry   # 预览将产生多少条覆盖
node actions/gen-name-overrides.js         # 写回 config.json
```

> 权威表第 2 列的口径就是 `index`，生成脚本不做任何换算，直接拿 `orgId:index` 当键。
> 如果你的权威表还是上游 `id` 口径，先跑一次换算：
>
> ```bash
> node actions/csv-id-to-index.js          # 干跑，看能换算多少行
> node actions/csv-id-to-index.js --write  # 落盘
> ```
>
> 换算依赖 `streams_all.json` 里已存在的 `orgId+id`；**本地没有的频道换算不出来**，
> 会保留原值并列出来，需要人工确认。

当前 223 条权威记录 → 产出 140 条覆盖（41 条名字本就正确，42 条本地缺失未收录）。

---

### 3. 去重规则 `dedupe`

**★ 去重键 = 流地址指纹 + 上游 `id`，两个都相同才算重复。**

上游「流地址相同」有两种完全不同的成因，**必须区别对待**：

| 成因 | 例子 | 处理 |
|---|---|---|
| 同一条记录被重复返回（真·重复） | 305/423 的胶州组 | **合并** |
| 上游不同步：**不同 `id` 共用一路流** | 115/635 的潍坊系列、537/657 的东营组 | **不合并** —— 合并会丢台 |

所以只要 `id` 不一样就全部保留。这是**刻意保守**的取舍：
宁可在列表里多留一条让人工判断，也不要静默丢掉一个台。

```json
"dedupe": {
  "enabled": true,
  "preferLongerName": true,
  "keepOrgId": [305, 635, 689]
}
```

> 实测效果：放宽前 8 组被判重、放宽后只剩 **2 组**（`423:0`、`423:1`）。

**保留优先级**（打分从高到低）：

1. **在 `nameOverrides` 里有命中的** —— 名字经过权威核对，优先于未核对条目
2. 流地址里含 `keepOrgId` 目录段的 —— 更接近流的所有者
3. 条目 `orgId` 自身在 `keepOrgId` 里
4. 名字更长
5. `index` 更小（同分时取先出现的，保证稳定）

> 去重函数**不负责排序**（排序是第 4 步 `orderByAuthority` 的事），
> 否则它会覆盖掉官方表的顺序。

**流地址归一化**（`streamKey`）——去重能生效的关键：

```
https://alivealone302.litenews.cn/635/1ebcf529.../playlist.m3u8
https://xxx.100ycdn.com/alivealone302.litenews.cn/635/1ebcf529.../playlist.m3u8
  ↑ 同一路流、不同 CDN 域名 → 都归一化为 "635/1ebcf529..."
```

规则：去 `?k=&t=`（每次重新签发的时效 token，不去掉永远判不出重复）
→ 提取 `<数字目录>/<流哈希>` 作为指纹 → 兜底再试 `/live/<名字>/index.m3u8`。

---

### 数据质量对比

| 指标 | 处理前 | 处理后 |
|---|---|---|
| 频道数 | 216 | **205** |
| 流地址重复组 | 5 组 | **0 组** |
| 重名频道 | 11 个 | **2 个**（残余为真·不同台，见下） |
| 「山东卫视」 | 2 条（1 条错挂） | **1 条（正确）** |
| 无地域前缀通用名 | 13 个「综合频道」等 | **3 个** |
| 坏流地址 | 1 条 | **0 条** |

残留的 2 个重名是**真·不同台**，刻意保留：

- 「经济频道」：orgId=39（临清组，流在 689 目录）vs orgId=683（甘肃组，流在 29 目录）
- 「兰陵综合」：orgId=69（`qingk.cn` 源）vs orgId=113（`litenews` 源）—— **不同源，互为备份**

### 规则测试

```bash
node actions/_test/filter.test.js      # 32 项：五类筛选规则 + 边界
node actions/_test/transform.test.js   # 28 项：流归一化 + 改名 + 去重 + 端到端
```

---

## 上游接口的三个坑（改代码前必读）

### 坑 1：`index` 必须记录上游原始数组下标

`filter-metadata` 产出的 `index` 被酷9 / Vercel 取址脚本当作 `num` 参数，
用来请求 `app.litenews.cn/v1/app/play/tv/live?orgid=X` 并取 `json.data[num]`。

**因此 `index` 必须等于上游原始数组下标**，而不是 filter 之后的下标。

`actions/fetch-metadata.js` 早期版本先 `filter` 再 `map(…, i)`，一旦上游存在
`stream` 为空 / 非 http 的项，`index` 就会整体前移。后果：`num` 取到隔壁频道，
**静默播放错误的台**。现已改为先带原始下标遍历、再过滤。

```js
// ✅ 正确：先记下标，再过滤
const all = json.data.map((item, rawIndex) => ({ ...item, orgId, index: rawIndex, stream }));
const valid = all.filter(item => item.stream.startsWith('http'));
```

> 经核对，当前 121 个 orgId 的 `index` 均为从 0 开始的连续序列，
> 说明现有线上数据未踩到该坑；此修复为**防御性加固**。
>
> ★ **本项目全链路统一以 `index` 作为定位基准**（配置键、去重、生成器的 `num`）。
> 上游记录里的 `id` 字段（业务编号）不作定位使用 —— 两者在 181 条可比对记录中
> 有 33 条指向不同条目，混用必然出错。**只用一套编号，就不会有对齐问题。**

### 坑 2：上游会返回残缺流地址

`orgId=657 idx=1「民生频道」` 的 `stream` 是 `"https://"`（空地址）。
这类条目留在列表里只会让用户点了播不出来，由 `dropInvalidStream` 在筛选阶段丢弃。

### 坑 3：**直播源路径里没有 `id`**，别想着从 URL 反推

核对频道名时最容易走的弯路，就是以为「看一眼流地址就知道上游 `id` 是多少」。
实测 248 条记录，**路径里不携带业务编号 `id`**。路径只有五类形状：

| 形状 | 样例 | 路径里的数字是什么 |
|---|---|---|
| `/orgId/32位hex/playlist.m3u8` | `alivealone302.litenews.cn/1/e6630b8d…885c/playlist.m3u8` | 首段是 **orgId**；第二段是 **16 字节随机流哈希**，与 `id` 无关 |
| `/orgId/日期_ID/playlist.m3u8` | `…/47/202304_1651887490384203776/playlist.m3u8` | 日期 + **雪花 ID**（流的时间戳主键），不是频道 `id` |
| `/b{orgId}/…` | `blivealone302.litenews.cn/b49/4a67ae84…/index.m3u8` | `b` + **orgId** |
| `/live/{拼音}/index.m3u8` | `jsylivealone302.iqilu.com/live/xiajin_tv02/index.m3u8` | **台名拼音**（唯一语义线索，见下） |
| 其他 | 裸 IP、`tv.cctv.com/live/cctv1/` | 无 |

**别把第二段当 base64。** 32 位 hex 段是 MD5 风格的随机哈希，按 base64 解出来是乱码
（`e6630b8d…` → `"{....w...uo.Z.^{..."`）；40 字符段同理。和解密、和 `id` 都没有关系。

> 唯一能当证据用的是什么？**`/live/{拼音}/`**。
> 例如 `orgId=225 idx=0` 挂名「山东卫视」，但流是 `/live/xiajin_tv02/` —— 夏津的拼音，
> 直接坐实了错挂（夏津的正规组是 `orgId=223`）。
> 反例：`/live/llsjtv01/`（兰陵）与 `orgId=113` 的兰陵综合相符，无异常。

**想拿 `id`，只能读接口 JSON 字段**，不能从流地址推。另外注意
`orgId` 路径段与记录自身的 `orgId` 也可能不一致：`orgId=21` 的 9 条里有 7 条流路径是
`/291/…` —— 那是流的归属方编号。**路径段只能当线索，不能当权威。**
