# 采集失败排查

先跑 `node scripts/xhs.mjs doctor`：能返回端口和标签页列表，说明连接正常，问题在页面；返回 ERROR，说明连接没建立。

| 现象 | 原因 | 处理 |
|---|---|---|
| `no Chrome remote-debugging endpoint found` | 开关没开，或浏览器不是 Chrome 系 | 让用户在登录小红书的窗口打开 `chrome://inspect/#remote-debugging` 并打开 Remote Debugging |
| 连接报 `Operation not permitted` | 沙箱禁止回环网络 | 申请网络权限后重跑，不要改代码绕过 |
| `websocket open timeout` / `websocket refused` | Chrome 一次只接受一个调试客户端，上一个进程的会话还没释放；或调试开关被关、Chrome 重启过 | 脚本已内置三次重试；连续失败就让用户确认开关仍是打开状态 |
| `note table did not load` | 登录态过期，页面跳到登录；或版式变了 | 让用户在自己浏览器里打开创作服务平台确认能进后台；版式变了就重新确认表头列顺序 |
| `account overview did not render` | 同上，或路由改版 | 账号概览页固定为 `/statistics/account/v2`，若跳转异常改回从数据页点击左侧「账号概览」 |
| 粉丝数显示 0 或「数据加载中」 | 骨架先渲染、数字后到 | 脚本已等待并额外停留 1.5s；仍为 0 时重跑一次 |
| 某篇的曝光/CTR 是 `null` | 平台显示 `-`：审核中或还没起量 | 不要填 0，报告里说明"待统计" |
| 连到了别的浏览器/profile | 多份 `DevToolsActivePort` | 脚本按文件修改时间取最新的那份；不对就关掉其它开了调试的 Chrome 系浏览器 |

## Chrome 低于 144

没有 `chrome://inspect` 的远程调试开关。退路是让用户用一个**独立的 user-data-dir** 启动 Chrome，再在里面手动登录一次小红书：

```bash
open -na "Google Chrome" --args --remote-debugging-port=9222 --user-data-dir="$HOME/.xhs-debug-profile"
```

这条路会要求重新登录，只在旧版本上使用；能在默认 profile 上开开关时不要选它。
