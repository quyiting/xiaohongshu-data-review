# 小红书数据复盘 · Xiaohongshu Data Review

一个 Codex 技能：连上你已经登录的小红书创作服务平台的 Chrome，把已发布笔记的后台数据读出来，按漏斗找到漏得最厉害的那一环，给出带验证标准的改进动作。

不是爬虫，不登录、不发布、不改动账号任何内容——只读页面。

## 它解决什么

发完笔记看后台，很容易只盯曝光和点赞。真正决定一篇笔记能不能继续被推的，是这条链路：

```
曝光 ──封面点击率──▶ 观看 ──停留──▶ 互动(赞/藏/评/享) ──▶ 涨粉 / 主页访客
```

技能会把这条链路的每一环填上真实数字，指出第一个明显漏掉的环节，并给出下一批内容要动的具体位置和达标线。

## 前置条件

- macOS + Google Chrome 144 或更高版本
- 在 Chrome 里登录 `creator.xiaohongshu.com`
- 打开 `chrome://inspect/#remote-debugging`，开启 **Remote Debugging**

不需要安装任何依赖，脚本只用 Node 内置能力（Node 22+ 自带的 WebSocket）。

## 安装

```bash
git clone https://github.com/quyiting/xiaohongshu-data-review.git \
  ~/.codex/skills/xiaohongshu-data-review
```

装好后在 Codex 里直接说「分析一下我最近的小红书笔记数据」，或者显式调用 `$xiaohongshu-data-review`。

## 用法

在技能目录下运行：

```bash
node scripts/xhs.mjs doctor    # 检查能否连上浏览器、有没有开着小🍠后台
node scripts/xhs.mjs notes     # 每篇笔记的数据，JSON
node scripts/xhs.mjs account   # 账号诊断 + 近 7/30 日总览
node scripts/xhs.mjs fans      # 粉丝总数、净增、性别/年龄/兴趣画像
```

`notes` 的输出示例：

```json
{
  "fetchedAt": "2026-11-04T10:39:36.610Z",
  "noteCount": 5,
  "weightedCoverCtrPercent": 7.66,
  "meanOfPerNoteCtrPercent": 7.3,
  "meanOfPerNoteViewSeconds": 11.5,
  "notes": [
    {
      "title": "调酒｜法式75",
      "publishedAt": "2026-11-01 17:52",
      "exposure": 739,
      "views": 42,
      "coverCtrPercent": 6,
      "likes": 10,
      "comments": 0,
      "saves": 4,
      "follows": 1,
      "shares": 0,
      "avgViewSeconds": 19,
      "rates": { "likePercent": 23.8, "savePercent": 9.5, "engagementPercent": 33.3 }
    }
  ]
}
```

## 三条写进技能里的判断规则

- **曝光不能横向比。** 它是累计值，六天前的笔记和两小时前的笔记没有可比性；能比的只有比率。
- **72 小时内不下结论。** 小红书会持续分配流量，点击率和停留时长在几天内都还在变。
- **先比对草稿标题和实际发布的标题。** 把"法式75｜香槟最后再加"改成"调酒｜法式75"，等于把用户点进来的唯一理由删掉了——这种改动会直接体现在封面点击率上。

详细的指标口径见 [references/metrics.md](references/metrics.md)，连不上时的排查见 [references/troubleshooting.md](references/troubleshooting.md)。

## 安全边界

- 只读：不发布、不编辑、不删除、不回复评论
- 在后台标签页读取，读完即关，不动你正在看的页面
- 不读取、不保存任何 cookie 或登录凭证

## 已知限制

- 依赖 Chrome 的远程调试开关，Chrome 完全退出后可能需要重新打开
- 站内接口有签名，脚本读的是渲染后的 DOM，平台改版可能需要更新选择器
- Chrome 低于 144 没有该开关，需要另起一个独立 profile（见 troubleshooting）
