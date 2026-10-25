# skyward-config

给 **Skyward / mihomo** 用的配置覆写脚本。

把机场订阅里那份原始、杂乱的配置，重建成一套干净好用的配置：剔除广告与信息节点、按地区分组、按服务分流、DNS 也按规则集分流。

脚本只依赖 mihomo 内核能力，不绑定具体客户端——Skyward、Clash Meta 系列（mihomo party、Verge Rev 等）都能直接用，接口是通用的 `function main(config)` 覆写脚本。

结构参考 [AIsouler/MyClash](https://github.com/AIsouler/MyClash) 的 `mihomoScript.js`，接口遵循 mihomo 扩展脚本约定（`function main(config)` 接收订阅配置、返回改写后的配置）。

---

## 使用方法

1. 打开 Skyward → **配置**（Profiles）→ 点进你的订阅 → 编辑
2. 找到 **扩展脚本** 区块，点 **前往配置脚本** → **添加**
3. **标签** 随便填（例如 `aqiyoung`），**URL** 填下面的链接，点 **同步** 拉取脚本内容
4. 回到订阅编辑页 → **扩展脚本** → 勾选刚添加的脚本（脚本模式）
5. 保存并更新一次订阅，配置即生效

### 脚本链接

```
https://cdn.jsdelivr.net/gh/aqiyoung/skyward-config@main/skyward.js
```

备选链接：

| 链接 | 说明 |
| --- | --- |
| `https://raw.githubusercontent.com/aqiyoung/skyward-config/main/skyward.js` | 改动即时生效，但国内可能被墙 |
| `https://gh-proxy.com/https://raw.githubusercontent.com/aqiyoung/skyward-config/main/skyward.js` | raw 的国内加速代理，实测即时生效 |
| `https://cdn.jsdelivr.net/gh/aqiyoung/skyward-config@<commit>/skyward.js` | 把 `<commit>` 换成最新 commit 的短哈希（如 `@22fc01e`） |

> **关于更新延迟**
>
> jsDelivr 对分支 `@main` 的缓存是 **12 小时**（响应头 `s-maxage=43200`），所以脚本改动后：
> - 最长可能要等半天才会全量生效；
> - 而且不同网络、不同边缘节点可能拿到**不同版本**，会看到新旧混用的情况。
>
> 另外，在 URL 后面加 `?v=xxx` 之类的参数**没有用**——jsDelivr 的缓存键不包含 query，实测过。
>
> 想立刻拿到最新版，二选一：
> 1. 把 URL 换成上面的 **raw** 或 **gh-proxy** 链接；
> 2. 把 jsDelivr 链接里的 `@main` 换成**最新 commit 的短哈希**（例如 `...@22fc01e/skyward.js`）。
>    哈希一变就是全新的缓存键，立刻生效；同一个哈希的内容永远不会变。

---

## 它做了什么

| 能力 | 说明 |
| --- | --- |
| **节点治理** | 机场把「剩余流量 / 到期时间 / 官网」这类**信息节点当成节点**投放，脚本会直接把它们从配置里剔除；同时剥离零宽字符、补全地区国旗、按名字去重、修复 `dialer-proxy` 的改名引用 |
| **地区分组** | 按节点名自动归类 **香港 / 日本 / 美国 / 新加坡 / 台湾**，每个地区生成一个手动组和一个 `地区-自动选择` 测速组；没归类的节点进「其他节点」 |
| **服务分流** | 20 个常用服务分组：GoogleFCM / YouTube / Google / ChatGPT / GitHub / OneDrive / Microsoft / APPLE / Telegram / Steam / Twitter / Meta / Line / TikTok / NETFLIX / Disney / Spotify / PikPak / Crypto / AdBlock |
| **国内直连** | 国内域名、国内 IP、私有网络、Steam 下载、NVIDIA、国内银行与支付域名优先直连；另可按**进程名**把微信 / 支付宝 / 抖音这类国产 App 钉在直连上，不会被服务规则截走 |
| **DNS 分流** | `fake-ip` 模式；国内域名走国内 DNS、私有网络走系统 DNS、默认走境外 DNS；银行域名走真实解析；`hosts` 修复 Google Play 下载、屏蔽 B 站 PCDN |
| **内核参数** | 补 `find-process-mode`、`ntp`，统一各测速参数（间隔 / 超时 / 容差可配），DoH 关掉 HTTP/3 以免和「屏蔽国外QUIC」打架 |

### 生成的策略组

```
GLOBAL
└── 默认代理                  ← 所有节点的总入口，默认指向「自动选择」
    ├── 自动选择 (url-test)   ← 所有节点自动测速，排除直连类出口
    ├── 故障转移 (fallback)
    ├── 负载均衡 (load-balance, sticky-sessions)
    ├── 各服务分组             ← 默认指向「默认代理」
    ├── 漏网之鱼               ← 兜底
    ├── 直连                   ← 3 个直连出口（双栈 / IPv4优先 / 仅IPv4），开「启用IPv6」再补 2 个
    └── 各地区组 + 其他节点
```

### 规则顺序

```
1. 国产 App 按进程名（微信 / 支付宝 / 抖音 …）      → 直连
2. 图标 CDN / 私有网络 / 国内域名 / 银行 / Steam·NVIDIA  → 直连
3. （可选）屏蔽国外 QUIC：非中国大陆的 UDP/443 → REJECT，逼国外流量回落 TCP
4. 自建域名 / 指定进程（PUBG）                       → 默认代理
5. 各服务规则（AdBlock 置顶：广告域 + 强化广告集）
6. proxylite / geolocation-!cn                      → 默认代理
7. 国内 IP 兜底                                      → 直连
8. MATCH                                            → 漏网之鱼
```

---

## 开关

脚本开头的 `options` 对象集中管理所有开关，改完提交即可。

### 语言

| 开关 | 默认 | 说明 |
| --- | --- | --- |
| `语言` | `'auto'` | `'auto'` 跟随客户端界面语言 / `'zh'` 强制中文 / `'en'` 强制英文。只影响生成的策略组名、直连出口名和规则里的**目标名**；分流逻辑、规则集、图标都不变 |

**`auto` 怎么工作**：脚本读宿主注入的全局变量 `globalThis.__skywardLocale`（形如 `en_US` / `zh_CN`），非 `zh*` 就用英文。宿主没注入时安静回落中文——所以这个默认值对现有用户没有影响。

> 内核的脚本执行环境是个裸 QuickJS，只装了 `console`，本身**拿不到客户端界面语言**（入口签名 `evaluate(script, config)` 只有两个字符串）。所以语言是由客户端在执行前注入的：
>
> ```js
> globalThis.__skywardLocale = "en_US";
> // …你的脚本原文…
> ```
>
> Skyward 从 `1.0.0` 之后的构建开始做这件事（`lib/common/javascript.dart` 的 `withLocale()` / `handleEvaluate(locale:)`），语言取设置里的语言选项，选「跟随系统」时取系统区域。
>
> **别的客户端**（FlClash、Clash Meta 系列）没有这一步，`auto` 会安静回落中文。要强制英文，把 `options.语言` 改成 `'en'` 即可，不依赖宿主。

英文对照：

| 中文 | English |
| --- | --- |
| 默认代理 | Proxy |
| 自动选择 / 故障转移 / 负载均衡 | Auto / Fallback / Load Balance |
| 漏网之鱼 | Final |
| 直连 | Direct |
| 其他节点 | Others |
| 直连出口 | Direct \| Dual Stack · IPv4 Preferred · IPv4 Only |
| 香港（-自动选择） | Hong Kong, China（Hong Kong, China Auto） |
| 日本（-自动选择） | Japan（Japan Auto） |
| 美国（-自动选择） | United States（United States Auto） |
| 新加坡（-自动选择） | Singapore（Singapore Auto） |
| 台湾（-自动选择） | Taiwan, China（Taiwan, China Auto） |

> 规则里的目标名（`RULE-SET,private,直连`、`MATCH,漏网之鱼`、`dns` 里的 `#默认代理`）全部由组名变量派生，切语言会自动跟着改。这是切换语言最容易翻车的地方——写死中文目标名的话，内核会因为「规则指向不存在的策略组」直接拒绝整份配置。已有的冒烟测试专门校验这一点。

### 策略组

| 开关 | 默认 | 说明 |
| --- | --- | --- |
| `自动选择` | `true` | 所有节点自动测速（`url-test`） |
| `故障转移` | `true` | 按顺序失败切换（`fallback`） |
| `负载均衡` | `true` | 按会话分摊（`load-balance`） |

### 地区分组

| 开关 | 默认 | 说明 |
| --- | --- | --- |
| `生成地区自动选择组` | `true` | 生成 `香港-自动选择` 这类测速组 |
| `隐藏地区手动选择组` | `false` | `true` 则隐藏「香港」这类手动组，只留自动组 |

### 服务分流

键名即策略组名，`false` 时该分组与对应规则会一起移除。

`GoogleFCM` `YouTube` `Google` `ChatGPT` `GitHub` `OneDrive` `Microsoft` `APPLE` `Telegram` `Steam` `Twitter` `Meta` `Line` `TikTok` `NETFLIX` `Disney` `Spotify` `PikPak` `Crypto` `AdBlock`

### 行为

| 开关 | 默认 | 说明 |
| --- | --- | --- |
| `过滤非地区节点` | `true` | 剔除名字像「剩余流量 / 到期 / 官网」的非地区节点 |
| `屏蔽国外QUIC` | `true` | 非中国大陆的 UDP/443 一律拒绝，规避 QUIC 走代理的不稳定 |
| `分流组添加所有节点` | `false` | `true` 会把全部节点塞进每个分流组（列表会很长） |

### IPv6

| 开关 | 默认 | 说明 |
| --- | --- | --- |
| `启用IPv6` | `false` | 同时控制内核 `ipv6` 与 `dns.ipv6`。关闭时会一并撤掉「IPv6优先 / 仅IPv6」两个直连出口——内核不开 IPv6，那两个出口选了也不生效，留着只会误导 |

### 测速

| 开关 | 默认 | 说明 |
| --- | --- | --- |
| `测速间隔` | `300` | 秒。自动测速的间隔，调小更灵敏但更费流量 |
| `测速超时` | `3000` | 毫秒。单次测速超时，弱网可放宽到 `5000` |
| `自动选择容差` | `50` | 毫秒。`url-test` 组内切换容差，调大更少抖动 |

### 分流准确性

| 开关 | 默认 | 说明 |
| --- | --- | --- |
| `国内应用直连` | `true` | 按进程名把国产 App（微信 / QQ / 支付宝 / 淘宝 / 美团 / 抖音 / 三大视频 / 音乐 / 地图等 18 个）钉在直连。这些 App 大量走自有协议与直连 IP，域名规则抓不全，容易被服务规则误截走代理 |
| `国内银行直连` | `true` | 国内银行与支付域名走直连，DNS 走国内，且从 `fake-ip` 里排除（部分网银的风控与证书校验见不得 fake-ip） |

> 进程名规则依赖 TUN + `find-process-mode: strict`，脚本里两个都已开启。

### 广告与追踪

| 开关 | 默认 | 说明 |
| --- | --- | --- |
| `强化广告拦截` | `true` | 在 `category-ads` 之外再叠 `category-ads-all` 与 DustinWin 的 `ads` 规则集 |
| `拦截追踪器` | `false` | 统计 / 追踪域名一起拒掉。**默认关**：一拒埋点，部分站点的登录与购买会莫名失败，代价不值 |

---

## 已知限制

- **订阅必须内联 `proxies`**。如果订阅使用 `proxy-providers`，脚本会直接抛错——因为节点过滤和地区分组需要能读到节点列表。绝大多数机场订阅都是内联 `proxies`。
- **IPv6 默认关闭**，由 `启用IPv6` 一个开关统一控制全局 `ipv6`、`dns.ipv6` 和 IPv6 直连出口。有原生 IPv6 且想用的话，把它改成 `true` 即可，不用再手动改两处。
- **英文模式下 Skyward 的内置组图标不会命中**。客户端的内置图标表是按中文组名硬编码的（`默认代理`、`香港` 之类），英文组名匹配不到，会回落到配置里的 `icon`。脚本给每个组都写了图标 URL，所以外观几乎无差别，只是每组图标要多走一次网络下载。
- **Telegram 频道里的 sponsored 广告挡不掉**。广告由 MTProto 下发（`messages.getSponsoredMessages`），和普通消息走同一条 DC 连接、媒体共用同一个 CDN，没有可识别的域名或 IP 特征，域名规则无从下手。能拦的只有内置浏览器 / Instant View 里网页的广告。真要去掉，得靠第三方客户端或 Telegram Premium。
- **`hosts` 会屏蔽 B 站 PCDN**（`+.mcdn.bilivideo.com` 等解析到 `0.0.0.0`）。不需要的话删掉 `buildDnsAndHosts()` 里那四行即可。
- **`external-controller` 的 `secret` 是硬编码的**，且这个仓库是公开的。如果你开了 `allow-lan` 并暴露了 9090 端口，建议换成自己的随机串。
- 图标与规则集统一走 **cdn.jsdmirror.com**（jsDelivr 国内镜像）。要换 CDN 只需改 `CDN_HOST` 一个常量，`ICON`、`RULESET` 和直连规则 `DOMAIN,...` 都从它派生。
- **组图标由客户端自己下载，且每个图标只拉一次**。那一次没成功（超时/被限速）就退化成显示组名首字母（GLOBAL → `G`、Steam → `S`），刷新界面不会重试，只有重启客户端才会重来。图标请求若走代理容易失败，所以上面加了图标域名直连规则；直连反而更差的话，删掉 `buildGroupsAndRules()` 里那一行 `DOMAIN,...` 即可。
- **GLOBAL 的图标不受脚本控制**。客户端对 GLOBAL 组固定渲染自己的默认图标（浅色网格地球），脚本里写的 `icon` 会被忽略，改这里看不到效果。

---

## 致谢

- 原脚本：hheshenghuan-cloud/ziji
- 结构与思路参考：[AIsouler/MyClash](https://github.com/AIsouler/MyClash)
- 规则集：[MetaCubeX/meta-rules-dat](https://github.com/MetaCubeX/meta-rules-dat)、[DustinWin/ruleset_geodata](https://github.com/DustinWin/ruleset_geodata)、[qichiyuhub/rule](https://github.com/qichiyuhub/rule)、[hheshenghuan-cloud/ziji](https://github.com/hheshenghuan-cloud/ziji)
- 图标：[Koolson/Qure](https://github.com/Koolson/Qure)
