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
