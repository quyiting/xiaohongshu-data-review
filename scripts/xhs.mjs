#!/usr/bin/env node
/**
 * Read-only access to Xiaohongshu (小红书) creator analytics through a Chrome
 * session the user is already logged into.
 *
 * Usage:
 *   node xhs.mjs doctor            # is there a debuggable Chrome, and does it have an XHS tab?
 *   node xhs.mjs notes             # published-note table -> JSON
 *   node xhs.mjs account           # account diagnosis + 7/30-day overview -> text
 *   node xhs.mjs fans              # follower totals and audience profile -> text
 *   node xhs.mjs eval "<expr>"     # ad-hoc read-only JS on the XHS tab
 *
 * Never writes anything to the account. Do not use eval to click publish,
 * delete, or edit notes.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HOME = os.homedir();
const CREATOR_ORIGIN = "https://creator.xiaohongshu.com";
const DATA_PAGE = `${CREATOR_ORIGIN}/statistics/data-analysis`;
const FANS_PAGE = `${CREATOR_ORIGIN}/statistics/fans-data`;
const ACCOUNT_PAGE = `${CREATOR_ORIGIN}/statistics/account/v2`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------------------------------------- discovery */

function profileRoots() {
  const home = HOME;
  return [
    path.join(home, "Library/Application Support/Google/Chrome"),
    path.join(home, "Library/Application Support/Chromium"),
    path.join(home, "Library/Application Support/BraveSoftware/Brave-Browser"),
    path.join(home, "Library/Application Support/Microsoft Edge"),
    path.join(home, ".config/google-chrome"),
    path.join(home, ".config/chromium"),
  ];
}

function findDevToolsFile() {
  const hits = [];
  for (const root of profileRoots()) {
    const direct = path.join(root, "DevToolsActivePort");
    const candidates = [direct];
    try {
      for (const e of fs.readdirSync(root, { withFileTypes: true })) {
        if (e.isDirectory()) candidates.push(path.join(root, e.name, "DevToolsActivePort"));
      }
    } catch {}
    for (const c of candidates) {
      try {
        const st = fs.statSync(c);
        const lines = fs.readFileSync(c, "utf8").trim().split("\n");
        if (lines.length >= 2) hits.push({ file: c, mtime: st.mtimeMs, port: Number(lines[0]), wsPath: lines[1].trim() });
      } catch {}
    }
  }
  hits.sort((a, b) => b.mtime - a.mtime);
  return hits[0] ?? null;
}

/* --------------------------------------------------------------------- CDP */

class Cdp {
  constructor(ws) { this.ws = ws; this.seq = 0; this.pending = new Map(); }

  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("websocket open timeout")), 8000);
      ws.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("websocket refused")); }, { once: true });
    });
    const cdp = new Cdp(ws);
    ws.addEventListener("message", (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      const waiter = msg.id && cdp.pending.get(msg.id);
      if (!waiter) return;
      cdp.pending.delete(msg.id);
      msg.error ? waiter.reject(new Error(msg.error.message || JSON.stringify(msg.error))) : waiter.resolve(msg.result);
    });
    return cdp;
  }

  send(method, params = {}, sessionId) {
    const id = ++this.seq;
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    // A session that died (for example after an in-app route change) never answers,
    // so every request must be able to time out instead of hanging the run.
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method}: no response within 15s`));
      }, 15000);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
    });
  }

  async close() {
    try {
      if (this.ws.readyState === WebSocket.OPEN) {
        await Promise.race([
          new Promise((r) => { this.ws.addEventListener("close", r, { once: true }); this.ws.close(); }),
          sleep(1500),
        ]);
      }
    } catch {}
  }
}

function fail(message, hint) {
  console.error(`ERROR: ${message}`);
  if (hint) console.error(hint);
  process.exit(1);
}

async function openBrowser() {
  const dev = findDevToolsFile();
  if (!dev) {
    fail(
      "no Chrome remote-debugging endpoint found",
      [
        "Ask the user to, in the Chrome window where they are logged into Xiaohongshu:",
        "  1. open chrome://inspect/#remote-debugging",
        "  2. switch on Remote Debugging",
        "  3. keep the Xiaohongshu creator tab open",
        "Then run again. Chrome may also require clicking an allow prompt on connect.",
      ].join("\n"),
    );
  }
  // Chrome accepts a single debugger client per browser and releases the previous
  // session a moment after the socket closes, so a fresh run can be refused briefly.
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return { browser: await Cdp.connect(`ws://127.0.0.1:${dev.port}${dev.wsPath}`), dev };
    } catch (e) {
      lastError = e;
      await sleep(1200 * attempt);
    }
  }
  fail(
    `cannot connect to ws://127.0.0.1:${dev.port} (${lastError.message})`,
    [
      "Two common causes:",
      "  - the sandbox blocks loopback networking: request the network permission, then retry",
      "  - Remote Debugging was toggled off or Chrome restarted: ask the user to re-enable it",
    ].join("\n"),
  );
}

async function listPages(browser) {
  const { targetInfos } = await browser.send("Target.getTargets");
  return targetInfos.filter((t) => t.type === "page" && /^https?:/.test(t.url));
}

// Always read in a throwaway background tab: the user's own tabs stay where they left them.
async function xhsSession(browser) {
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank", background: true });
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
  const send = (method, params) => browser.send(method, params, sessionId);
  await send("Page.enable");
  return { targetId, sessionId, send };
}

async function evaluate(session, expression) {
  const res = await session.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || "evaluation failed");
  return res.result?.value;
}

async function goto(session, url) {
  await session.send("Page.navigate", { url });
  await sleep(1200);
}

async function waitFor(session, expression, { timeout = 25000, interval = 700 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { if (await evaluate(session, expression)) return true; } catch {}
    await sleep(interval);
  }
  return false;
}

/* ------------------------------------------------------------------ parsing */

const num = (raw) => {
  const s = String(raw ?? "").replace(/[, ]/g, "").trim();
  if (!s || s === "-" || s === "—") return null;
  const m = s.match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
};

// Column order on creator.xiaohongshu.com/statistics/data-analysis, verified 2026-11:
// 0 title+date, 1 曝光, 2 观看, 3 封面点击率, 4 点赞, 5 评论, 6 收藏, 7 涨粉, 8 分享, 9 人均观看时长, 10 弹幕, 11 操作
function parseNotes(rows) {
  return rows.map((cells) => {
    const head = cells[0].split("\n").map((s) => s.trim()).filter(Boolean);
    const title = head[0] ?? "";
    const dateMatch = cells[0].match(/(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2})/);
    const note = {
      title,
      publishedAt: dateMatch ? dateMatch[1] : null,
      exposure: num(cells[1]),
      views: num(cells[2]),
      coverCtrPercent: num(cells[3]),
      likes: num(cells[4]),
      comments: num(cells[5]),
      saves: num(cells[6]),
      follows: num(cells[7]),
      shares: num(cells[8]),
      avgViewSeconds: num(cells[9]),
      danmaku: num(cells[10]),
    };
    const v = note.views;
    if (v) {
      const pct = (x) => (x == null ? null : Math.round((x / v) * 1000) / 10);
      note.rates = {
        likePercent: pct(note.likes),
        savePercent: pct(note.saves),
        commentPercent: pct(note.comments),
        followPercent: pct(note.follows),
        sharePercent: pct(note.shares),
        engagementPercent: pct((note.likes ?? 0) + (note.comments ?? 0) + (note.saves ?? 0) + (note.shares ?? 0)),
      };
    }
    return note;
  });
}

/* ---------------------------------------------------------------- commands */

async function cmdDoctor(browser, dev) {
  const pages = await listPages(browser);
  const xhs = pages.filter((p) => p.url.includes("xiaohongshu.com"));
  console.log(JSON.stringify({
    debugEndpoint: `ws://127.0.0.1:${dev.port}`,
    portFile: dev.file,
    xiaohongshuTabs: xhs.map((p) => ({ title: p.title, url: p.url })),
  }, null, 2));
  if (!xhs.length) console.error("WARN: no Xiaohongshu tab is open; `notes` will open a background tab (login cookie must still be valid).");
}

async function cmdNotes(browser, keep) {
  const s = await xhsSession(browser);
  await goto(s, DATA_PAGE);
  const ready = await waitFor(s, `document.querySelectorAll("table tr").length > 1`);
  if (!ready) fail("note table did not load (login expired, or the page layout changed)");
  const rows = await evaluate(
    s,
    `(() => {
       const table = document.querySelector("table");
       return [...table.querySelectorAll("tr")].slice(1).map(tr =>
         [...tr.querySelectorAll("td")].map(td => td.innerText.trim()));
     })()`,
  );
  const notes = parseNotes(rows);
  const withViews = notes.filter((n) => n.views);
  const mean = (values) => {
    const nums = values.filter((v) => v != null);
    return nums.length ? +(nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(2) : null;
  };
  const totalExposure = withViews.reduce((a, n) => a + (n.exposure ?? 0), 0);
  const totalViews = withViews.reduce((a, n) => a + (n.views ?? 0), 0);
  console.log(JSON.stringify({
    fetchedAt: new Date().toISOString(),
    noteCount: notes.length,
    // Weighted CTR (views / exposure) is the number comparable with the account dashboard.
    weightedCoverCtrPercent: totalExposure ? +((totalViews / totalExposure) * 100).toFixed(2) : null,
    meanOfPerNoteCtrPercent: mean(notes.map((n) => n.coverCtrPercent)),
    meanOfPerNoteViewSeconds: mean(notes.map((n) => n.avgViewSeconds)),
    notes,
  }, null, 2));
  if (!keep) await browser.send("Target.closeTarget", { targetId: s.targetId });
}

function sliceText(text, startMark, endMark) {
  const start = startMark ? text.indexOf(startMark) : 0;
  const from = start >= 0 ? start : 0;
  const end = endMark ? text.indexOf(endMark, from) : -1;
  return text.slice(from, end > from ? end : undefined).trim();
}

async function cmdAccount(browser, keep) {
  const s = await xhsSession(browser);
  await goto(s, ACCOUNT_PAGE);
  const ok = await waitFor(s, `document.body.innerText.includes("账号诊断") && document.body.innerText.includes("封面点击率")`);
  if (!ok) fail("account overview did not render");
  await sleep(1500); // KPI numbers arrive after the skeleton renders
  const text = await evaluate(s, "document.body.innerText");
  console.log(sliceText(text, "账号诊断", "观看来源").slice(0, 4000));
  if (!keep) await browser.send("Target.closeTarget", { targetId: s.targetId });
}

async function cmdFans(browser, keep) {
  const s = await xhsSession(browser);
  await goto(s, FANS_PAGE);
  const ok = await waitFor(s, `document.body.innerText.includes("粉丝数据趋势") && !document.body.innerText.includes("数据加载中")`);
  if (!ok) fail("fans page did not render (login expired?)");
  await sleep(1500);
  const text = await evaluate(s, "document.body.innerText");
  console.log(sliceText(text, "粉丝数据概览", "完整地域数据").slice(0, 4000));
  if (!keep) await browser.send("Target.closeTarget", { targetId: s.targetId });
}

async function cmdEval(browser, expression) {
  const s = await xhsSession(browser);
  await goto(s, DATA_PAGE); // evaluate in the creator origin, not on a blank tab
  console.log(JSON.stringify(await evaluate(s, expression), null, 2));
  await browser.send("Target.closeTarget", { targetId: s.targetId });
}

/* -------------------------------------------------------------------- main */

const [command, ...rest] = process.argv.slice(2);
if (!command || command === "--help" || command === "-h") {
  console.log("usage: xhs.mjs <doctor|notes|account|fans|eval> [--keep] [expr]");
  process.exit(0);
}
const keep = rest.includes("--keep");
const { browser, dev } = await openBrowser();
try {
  if (command === "doctor") await cmdDoctor(browser, dev);
  else if (command === "notes") await cmdNotes(browser, keep);
  else if (command === "account") await cmdAccount(browser, keep);
  else if (command === "fans") await cmdFans(browser, keep);
  else if (command === "eval") await cmdEval(browser, rest.find((a) => a !== "--keep") ?? "1");
  else fail(`unknown command: ${command}`);
} finally {
  await browser.close();
}
