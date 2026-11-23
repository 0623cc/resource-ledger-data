// 抓取资源分享站全量数据，输出 data.json（供公开台账页跨域读取）
// 原理：站点按 UA 判定，浏览器 UA 会被反爬页拦截，Googlebot UA 直接放行
import { readFileSync, writeFileSync } from "node:fs";

const SITE = "https://yaoyao520.byethost7.com/";
const UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const OUT = "data.json";
const INTRO_CAP = 100;
const INTRO_DAYS = 14;

function tz8Date(offsetDays = 0) {
  const t = new Date(Date.now() + 8 * 3600 * 1000 + offsetDays * 86400000);
  return t.toISOString().slice(0, 10);
}

function parseLinks(row) {
  const out = [];
  const raw = String(row.links || "").trim();
  if (raw) {
    const parts = raw.split("|").map((s) => s.trim());
    let i = 0;
    while (i + 1 < parts.length) {
      const pan = parts[i], url = parts[i + 1];
      if (/^https?:\/\//.test(url)) {
        out.push({ p: pan || "网盘", u: url });
        i += 2;
      } else i += 1;
    }
  }
  if (!out.length && /^https?:\/\//.test(String(row.link || "").trim())) {
    out.push({ p: String(row.pan || "网盘").trim(), u: String(row.link).trim() });
  }
  return out;
}

function buildItems(rows) {
  const introFrom = tz8Date(-INTRO_DAYS);
  const items = [];
  for (const r of rows) {
    const t = String(r.title || "").trim();
    const d = String(r.date || "").trim().slice(0, 10);
    if (!t || !/^\d{4}-\d{2}-\d{2}/.test(d)) continue;
    const links = parseLinks(r);
    const it = { t, c: String(r.forum || "其他").trim(), d };
    if (links.length) {
      it.u = links[0].u;
      if (links.length > 1) it.m = links.slice(1).map((x) => ({ p: x.p, u: x.u }));
    }
    if (d >= introFrom) {
      const intro = String(r.intro || "")
        .replace(/\[img\][\s\S]*?\[\/img\]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, INTRO_CAP);
      if (intro) it.i = intro;
    }
    items.push(it);
  }
  items.sort((a, b) => (a.d === b.d ? (a.t < b.t ? 1 : -1) : a.d < b.d ? 1 : -1));
  return items;
}

async function apiGet(page) {
  const url = `${SITE}api.php?action=list&page=${page}&per=200&q=&pan=`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        redirect: "follow",
      });
      const text = await r.text();
      if (!text.trim().startsWith("{")) throw new Error("非 JSON 响应（可能被反爬拦截）");
      return JSON.parse(text);
    } catch (e) {
      if (attempt === 3) throw e;
      await new Promise((res) => setTimeout(res, 1500 * attempt));
    }
  }
}

async function fetchAll() {
  const rows = [];
  let total = null;
  for (let page = 1; page <= 200; page++) {
    const j = await apiGet(page);
    if (!j.ok) throw new Error("接口返回失败: " + JSON.stringify(j).slice(0, 200));
    total = j.total;
    rows.push(...(j.rows || []));
    if (!j.has_more) break;
  }
  return { rows, total };
}

async function main() {
  const { rows, total } = await fetchAll();
  const items = buildItems(rows);

  let prev = null;
  try {
    prev = JSON.parse(readFileSync(OUT, "utf8"));
  } catch {}

  const same = prev && JSON.stringify(prev.items || []) === JSON.stringify(items) && prev.items?.length;
  if (same) {
    console.log(`无变化，保留原文件（${items.length} 条）`);
    return;
  }
  const payload = { ok: true, total: total ?? items.length, fetchedAt: Date.now(), items };
  writeFileSync(OUT, JSON.stringify(payload), "utf8");
  console.log(`写入 data.json：${items.length} 条 / total=${payload.total}`);
}

main().catch((e) => {
  console.error("抓取失败:", e.message);
  process.exit(1);
});
