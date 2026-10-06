/**
 * iqilu 取址脚本（酷9 远程 JS 版）
 *
 * 入口：function main(item)
 * 取参：官方契约只有 item.url / item.id
 *   - item.url = 列表里写的完整频道地址（带 ?orgid=..&num=..）
 *   - item.id  = 快速取 ?id= 的值（本项目用的是 orgid/num，故从 item.url 解析）
 *   来源：酷9 官方说明书（设备 9978 管理页）§"播放脚本"
 *
 * 返回：成功 { url, headers }；失败 { error }（酷9 会把 error 显示给用户）
 *
 * 注意：本脚本跑在用户设备上取址。出口 IP 是用户自己的，
 *       不经过 Cloudflare 节点 → 绕开上游「按来源 IP 分流」的限制。
 */
function main(item) {
    try {
        return resolve(item);
    } catch (e) {
        // 兜底：任何未预期的异常都转成 {error}，绝不让脚本"静默失败"
        // （酷9 里抛异常往往表现为无反应，用户完全看不出原因）
        var msg = String((e && e.message) || e || "脚本执行失败");
        console.log("[iqilu] FAIL " + msg);
        return { error: "取址失败：" + msg };
    }
}

function resolve(item) {
    // 官方契约是 item.id（取 ?id=）与 item.url（完整地址）。
    // 本项目参数名是 orgid/num，所以从 item.url 解析；
    // 同时兼容有人在列表里写成 ?id=xxx 的变体。
    var orgid = getId(item, "orgid");
    var numStr = getId(item, "num");

    if (!orgid) {
        return fail("缺少 orgid 参数");
    }
    var num = parseInt(numStr, 10);
    if (isNaN(num)) {
        return fail("num 参数无效");
    }

    var api = "https://app.litenews.cn/v1/app/play/tv/live?orgid=" + encodeURIComponent(orgid);

    var headers = {
        "User-Agent": "okhttp/3.12.0",
        "Referer": "https://app.litenews.cn/",
        "Accept": "application/json, text/plain, */*"
    };

    var res = ku9.request(api, "GET", headers, "", false);

    if (!res || res.code !== 200) {
        return fail("请求直播接口失败" + (res ? "（HTTP " + res.code + "）" : ""));
    }

    var data;
    try {
        data = JSON.parse(res.body);
    } catch (e) {
        return fail("返回数据解析失败");
    }

    if (!data.data || !Array.isArray(data.data) || data.data.length === 0) {
        return fail("该 orgid 无可用直播流");
    }

    if (num < 0 || num >= data.data.length) {
        return fail("num 超出范围：0-" + (data.data.length - 1));
    }

    var url = data.data[num].stream;

    if (!url) {
        return fail("未获取到直播流地址");
    }

    return { url: url, headers: { "User-Agent": headers["User-Agent"] } };
}

/** 统一的失败出口：返回 {error} 并打一份日志（设备 9978 调试窗口可见） */
function fail(msg) {
    console.log("[iqilu] " + msg);
    return { error: msg };
}

/**
 * 取查询参数：优先 item[key]（某些实现会把 query 摊平成顶层字段），
 * 否则从 item.url 解析。两种都试，避免契约差异导致整个脚本失效。
 */
function getId(item, key) {
    if (!item) return "";
    var v = item[key];
    if (v !== undefined && v !== null && v !== "") return String(v);

    var s = item.url || item.id || "";
    if (!s) return "";
    // 用官方 API 取；它缺失时返回 ''
    var viaApi = "";
    try {
        viaApi = ku9.getQuery(s, key);
    } catch (e) {
        viaApi = "";
    }
    if (viaApi) return viaApi;

    // 兜底：自己解析（万一 ku9.getQuery 不可用）
    var q = String(s).split("?")[1];
    if (!q) return "";
    var parts = q.split("&");
    for (var i = 0; i < parts.length; i++) {
        var kv = parts[i].split("=");
        if (kv[0] === key) return decodeURIComponent(kv[1] || "");
    }
    return "";
}
