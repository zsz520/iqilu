const https = require("https");
const fs = require("fs");
const path = require("path");

const BATCH_SIZE = 100;
const MAX_ORGID = 700;

async function fetchOrgId(orgId) {
  return new Promise((resolve) => {
    const url = `https://app.litenews.cn/v1/app/play/tv/live?orgid=${orgId}`;
    https
      .get(url, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const json = JSON.parse(data);
            if (json.data && Array.isArray(json.data)) {
              // ★ 关键：index 必须记录「上游原始数组下标」，不能用 filter 之后的下标。
              //
              // 为什么：酷9 / Vercel 的取址脚本会拿 num 去请求同一个上游接口，
              // 取的正是 json.data[num] —— 也就是未过滤数组里的位置。
              // 之前这里先 filter 再 map 取 i，一旦上游存在 stream 为空/非 http 的项，
              // index 就会整体前移、与上游真实下标错位，导致 num 取到隔壁频道。
              //
              // 所以：先带原始下标遍历，再过滤。下标用 rawIndex 保留。
              const all = json.data.map((item, rawIndex) => {
                const stream = String(item.stream || '').replace(/\s/g, '');
                // ...item 先展开，再用 stream 覆盖干净后的值
                return { ...item, orgId, index: rawIndex, stream };
              });
              const validStreams = all.filter(
                (item) => item.stream && item.stream.startsWith('http')
              );
              resolve(validStreams);
            } else {
              resolve([]);
            }
          } catch (err) {
            console.log(`orgId ${orgId} JSON parse error`);
            resolve([]);
          }
        });
      })
      .on("error", (err) => {
        console.log(`orgId ${orgId} request error: ${err.message}`);
        resolve([]);
      });
  });
}

async function fetchBatch(start, end) {
  console.log(`\n=== Starting batch ${start}-${end} ===`);
  const results = [];
  for (let orgId = start; orgId <= end; orgId++) {
    const streams = await fetchOrgId(orgId);
    if (streams.length > 0) {
      results.push(...streams);
      console.log(`Fetched orgId ${orgId}, got ${streams.length} valid streams`);
    } else {
      console.log(`Fetched orgId ${orgId}, no valid streams`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  const outputFile = path.join(__dirname, '../data', `streams_${start}-${end}.json`);
  fs.writeFileSync(outputFile, JSON.stringify(results, null, 2), "utf-8");
  console.log(`Batch ${start}-${end} done! ${results.length} total streams saved to ${outputFile}`);
}

async function fetchAllBatches() {
  for (let start = 1; start <= MAX_ORGID; start += BATCH_SIZE) {
    const end = Math.min(start + BATCH_SIZE - 1, MAX_ORGID);
    await fetchBatch(start, end);
  }
  console.log("\n=== All batches completed ===");
}

const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}


fetchAllBatches();
