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
- `actions/lib/transform.js` —— **变换**（改名、去重），返回新数组而非布尔值

### 处理在什么时候发生

**处理是一个独立流水线步骤**，由 `actions/filter-metadata.js` 执行，产出成品 JSON：

```
fetch-metadata  →  data/streams_1-100.json …
merge-metadata  →  data/streams_all.json        ← 原始，含全部频道，未过滤
filter-metadata →  data/streams_filtered.json   ← 成品，已筛选+改名+去重
                        ↓
        gen-m3u-generic / gen-txt-ku9 / gen-m3u-direct   ← 只读成品，不碰规则
```

**下游（生成器、Cloudflare Worker）都不需要知道规则**，只读 `streams_filtered.json`。
所以改规则只需改一处，不会出现"某个产物忘了同步"的情况。

处理**按顺序**执行三步：

| 步骤 | 做什么 | 配置字段 | 实现 |
|---|---|---|---|
| 1. 筛选 | 决定某条留不留 | `blacklistNames` / `blacklistOrgIds` / `blacklistNameRegex` / `excludeNamePatterns` / `dropInvalidStream` | `filter.js` |
| 2. 改名 | 修正名字 | `nameOverrides` | `transform.js` |
| 3. 去重 | 同流只留一条 | `dedupe` | `transform.js` |

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
> 注：上游记录里还有个 `id` 字段（业务编号），**本项目不使用它做定位**，
> 仅在 `channel_names.csv` 里作为权威表的原始列，由生成脚本换算成 index。

```json
"nameOverrides": {
  "537:0": "东营新闻综合",
  "227:0": "黄岛综合",
  "129:0": "金乡综合"
}
```

名字来源是 **`data/channel_names.csv`**（官方频道清单，223 条，覆盖 16 地市）：

```
# 格式: orgId,id,地市,规范名
223,1,德州,夏津综合
223,2,德州,夏津公共
227,1,青岛,黄岛综合
```

**更新方式**（权威表变了就重跑）：

```bash
node actions/gen-name-overrides.js --dry   # 预览将产生多少条覆盖
node actions/gen-name-overrides.js         # 写回 config.json
```

脚本内部会把权威表的 `id` 列**换算成 index**（在 `streams_all.json` 里按 `orgId+id`
找到对应条目，取其 `index` 作为键）。

当前 223 条权威记录 → 产出 140 条覆盖（41 条名字本就正确，42 条本地缺失未收录）。

---

### 3. 去重规则 `dedupe`

上游存在**「同一个台建了多个 orgId」**的重复建组问题，表现为不同频道名指向完全相同的流地址。
共发现 5 组，例如：

| 重复的流 | 涉及条目 |
|---|---|
| `.../689/bb172d92...` | orgId=39/idx0「新闻综合频道」、orgId=689/idx0「新闻综合频道」、orgId=39/idx3「有节目的测试」 |
| `.../305/c663c037...` | orgId=305/idx1「生活频道」、orgId=423/idx0「综合频道」、orgId=423/idx2「娱乐频道」 |
| `.../537/202304_...` | orgId=537/idx1「公共频道」、orgId=657/idx0「新闻综合频道」（换了个域名） |

```json
"dedupe": {
  "enabled": true,
  "preferLongerName": true,
  "keepOrgId": [305, 635, 689]
}
```

**保留优先级**（打分从高到低）：

1. **在 `nameOverrides` 里有命中的** —— 名字经过权威核对，优先于未核对条目
2. 流地址里含 `keepOrgId` 目录段的 —— 更接近流的所有者
3. 条目 `orgId` 自身在 `keepOrgId` 里
4. 名字更长
5. `index` 更小（同分时取先出现的，保证稳定）

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

## 上游接口的两个坑（改代码前必读）

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
