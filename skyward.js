/**
 * Skyward / Mihomo 配置覆写脚本
 *
 * 用法：在 Skyward 的「脚本」中导入本文件，然后将其应用到订阅配置。
 * 也可直接用于其他 mihomo 内核客户端（Clash Meta 系列）的覆写脚本，不依赖具体客户端。
 * 入口 main(config) 接收订阅解析后的配置对象，返回覆写后的完整配置对象。
 *
 * 结构参考：https://github.com/AIsouler/MyClash/blob/main/Script/mihomoScript.js
 *
 * 相对上一版（hheshenghuan-cloud/ziji 简化版）的改动：
 *   1. 节点治理：机场信息/广告/倍率节点不再只是被「自动选择」排除，而是直接从配置中剔除；
 *      同时补全地区国旗、剥离零宽字符（防干扰）、按名去重，并修复 dialer-proxy 的改名引用。
 *   2. 地区分组：按节点名自动归类 香港 / 日本 / 美国 / 新加坡 / 台湾，
 *      每个地区可选生成「地区-自动选择」测速组，另生成「其他节点」收纳未归类节点。
 *   3. 分流策略组：补齐 Steam / Twitter / Meta / Line / Spotify / PikPak / Crypto / AdBlock 等，
 *      各分流组默认首选「默认代理」→「自动选择」。
 *   4. 内核参数：补 find-process-mode、ntp；端口与嗅探配置保持原样。
 *   5. DNS：fake-ip + 按规则集分流解析（国内走国内 DNS、私有网络走系统 DNS），
 *      并补充 hosts（去掉 B 站 PCDN、修复 Google Play 下载）。
 *   6. 兜底规则走 proxylite / geolocation-!cn / cn_ip，并可选屏蔽国外 QUIC。
 *   7. 一致性：内核 ipv6 与 dns.ipv6 由「启用IPv6」统一控制，关闭时撤掉失效的 IPv6 直连出口；
 *      DoH 关掉 h3，避免和「屏蔽国外QUIC」自相打架。
 *   8. 语言：options.语言 支持 'zh' / 'en'，组名、直连出口名、规则目标名、DNS 里的 #组名
 *      全部由 t() 统一产出，不会中英混排。
 */

// =====================================================================
// 一、可调开关
// =====================================================================

const options = {
  // ---- 语言 ----
  // 'auto' 跟随客户端界面语言（读宿主注入的 __skywardLocale，没有注入就回落中文）
  // 'zh' 强制中文 / 'en' 强制英文。只影响组名与规则目标，分流逻辑、规则集、图标不变。
  语言: 'auto',

  // ---- 基础策略组 ----
  自动选择: true, // 所有节点自动测速（排除直连类节点）
  故障转移: true, // 按顺序失败切换
  负载均衡: true, // 按 sticky-sessions 分摊

  // ---- 地区分组 ----
  生成地区自动选择组: true, // 台湾-自动选择 等
  隐藏地区手动选择组: false, // true 则隐藏「香港」这类手动组，只留自动组

  // ---- 服务分流（键名 = 策略组名，false 则整组与规则一起移除）----
  GoogleFCM: true,
  YouTube: true,
  Google: true,
  ChatGPT: true,
  GitHub: true,
  OneDrive: true,
  Microsoft: true,
  APPLE: true,
  Telegram: true,
  Steam: true,
  Twitter: true,
  Meta: true,
  Line: true,
  TikTok: true,
  NETFLIX: true,
  Disney: true,
  Spotify: true,
  PikPak: true,
  Crypto: true,
  AdBlock: true,

  // ---- 行为 ----
  过滤非地区节点: true, // 剔除名字像「剩余流量/到期时间/官网」这类非地区节点
  屏蔽国外QUIC: true, // 强制国外流量回落到 TCP，规避 QUIC 走代理的不稳定
  分流组添加所有节点: false, // true 则把全部节点塞进每个分流组（列表会很长）

  // ---- IPv6 ----
  启用IPv6: false, // 同时控制内核 ipv6 与 dns.ipv6，并把 IPv6 直连出口一并撤掉

  // ---- 测速 ----
  测速间隔: 300, // 秒：自动测速的间隔，调小更灵敏但更费流量
  测速超时: 3000, // 毫秒：单次测速超时，弱网可放宽到 5000
  自动选择容差: 50, // 毫秒：url-test 组内节点切换容差，调大更少抖动

  // ---- 分流准确性 ----
  国内应用直连: true, // 微信/支付宝/抖音这类国产 App 按进程名直连，避免被服务规则截走
  国内银行直连: true, // 国内银行与支付域名走直连，DNS 也走国内

  // ---- 广告与追踪 ----
  强化广告拦截: true, // 在 category-ads 之外再叠 category-ads-all 与 DustinWin 的 ads 规则集
  拦截追踪器: false, // 统计/追踪域名一起拒掉，过严时可能有站点功能异常
};

// 宿主（客户端）可以在执行脚本前注入 globalThis.__skywardLocale，例如 'en_US' / 'zh_CN'。
// 没注入时这里拿不到，typeof 也不会抛错，'auto' 就安静地回落中文。
const hostLocale = typeof __skywardLocale === 'string' ? __skywardLocale.toLowerCase() : '';

// 组名统一走 t(中文, English)：所有对用户可见的名字（组名、直连出口名、规则目标名）
// 都从这里出，改 options.语言 就整份切换，不会出现中英混排。
const isEn =
  options.语言 === 'en' || (options.语言 === 'auto' && hostLocale !== '' && !hostLocale.startsWith('zh'));
const t = (zh, en) => (isEn ? en : zh);

// =====================================================================
// 二、常量
// =====================================================================

// 图标与规则集统一走 jsDelivr 镜像，比 cdn.jsdelivr.net 在国内稳定，也避开被墙的 raw.githubusercontent.com
const CDN_HOST = 'cdn.jsdmirror.com';
const ICON = `https://${CDN_HOST}/gh/Koolson/Qure@master/IconSet/Color/`;
// 规则集统一取 MetaCubeX/meta-rules-dat（.mrs 体积小、解析快）
const RULESET = `https://${CDN_HOST}/gh/MetaCubeX/meta-rules-dat@meta/`;

const TEST_URL = 'https://www.gstatic.com/generate_204';

const icon = (name) => ICON + name;

// 机场信息/广告节点的名字特征：命中即剔除。
// 注意：exclude-filter 写进配置时必须是「字符串」——放 RegExp 对象会被序列化成 {}，
// 内核会报 `expected type 'string', got 'map[string]interface {}'` 并拒绝整个配置。
const EXCLUDE_FILTER_BODY =
  '群|返利|循环|官网|客服|网站|网址|获取|订阅|流量|到期|机场|下次|版本|官址|备用|过期|已用|联系|邮箱|工单|贩卖|通知|倒卖|防止|国内|地址|频道|电报|无法|说明|提示|访问|支持|教程|关注|更新|作者|加入|超时|收藏|优惠|福利|邀请|好友|失联|选择|剩余|公益|发布|DIZTNA|通路|登录|禁止|定时|渠道|牢记|永久|余额|阁下|本站|刷新|导航|建议|重置|以下|过滤|⚠️|@|t\\.me\\/\\+|\\bexpire\\b|\\bhttps?:\\/\\/|\\.com|\\btraffic\\b';
const EXCLUDE_FILTER = new RegExp(EXCLUDE_FILTER_BODY, 'iu');
const EXCLUDE_FILTER_CONFIG = `(?i)${EXCLUDE_FILTER_BODY}`;

// 零宽/不可见字符：机场常逐字符插入以干扰正则匹配。
// 刻意保留 ZWNJ/ZWJ 与变体选择符（它们参与 emoji 与连字，有语义）。
const INVISIBLE_CHARS = /[\u00AD\u180E\u200B\u200E\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u115F\u1160\u3164\uFFA0]/g;

// 直连出口：提供双栈 / IPv4/IPv6 优先等多种选择。
// 内核 ipv6 关闭时，带 IPv6 的两个出口是不会生效的，留着只会让人误选——一并撤掉。
const directProxies = [
  { name: t('🇨🇳 直连 | 双栈', '🇨🇳 Direct | Dual Stack'), type: 'direct' },
  { name: t('🇨🇳 直连 | IPv4优先', '🇨🇳 Direct | IPv4 Preferred'), type: 'direct', 'ip-version': 'ipv4-prefer' },
  { name: t('🇨🇳 直连 | 仅IPv4', '🇨🇳 Direct | IPv4 Only'), type: 'direct', 'ip-version': 'ipv4' },
  ...(options.启用IPv6
    ? [
        { name: t('🇨🇳 直连 | IPv6优先', '🇨🇳 Direct | IPv6 Preferred'), type: 'direct', 'ip-version': 'ipv6-prefer' },
        { name: t('🇨🇳 直连 | 仅IPv6', '🇨🇳 Direct | IPv6 Only'), type: 'direct', 'ip-version': 'ipv6' },
      ]
    : []),
];
const DIRECT_GROUP = t('直连', 'Direct');
const directProxyNames = directProxies.map((p) => p.name);

const DEFAULT_GROUP = t('默认代理', 'Proxy');
const AUTO_GROUPS = [t('自动选择', 'Auto'), t('故障转移', 'Fallback'), t('负载均衡', 'Load Balance')];
// options 里的键名固定用中文，与 AUTO_GROUPS 按下标对应——语言只影响组名，不影响开关
const AUTO_GROUP_KEYS = ['自动选择', '故障转移', '负载均衡'];
const enabledAutoGroupNames = () => AUTO_GROUPS.filter((_, i) => options[AUTO_GROUP_KEYS[i]]);
const FINAL_GROUP = t('漏网之鱼', 'Final');
const OTHER_GROUP = t('其他节点', 'Others');

// 国内常见 App 的包名。按进程直连比按域名判断更准：这些 App 大量走自有协议与直连 IP，
// 域名规则抓不全，反而会被后面的服务规则误截走代理，绕远又慢。
const DOMESTIC_PROCESSES = [
  'com.tencent.mm', // 微信
  'com.tencent.mobileqq', // QQ
  'com.eg.android.AlipayGphone', // 支付宝
  'com.taobao.taobao', // 淘宝
  'com.sankuai.meituan', // 美团
  'com.dianping.v1', // 大众点评
  'com.jingdong.pdj', // 京东
  'com.xunmeng.pinduoduo', // 拼多多
  'com.ss.android.ugc.aweme', // 抖音
  'com.tencent.qqlive', // 腾讯视频
  'com.youku.phone', // 优酷
  'com.qiyi.video', // 爱奇艺
  'com.netease.cloudmusic', // 网易云音乐
  'com.kugou.android', // 酷狗
  'cn.kuwo.player', // 酷我
  'com.baidu.BaiduMap', // 百度地图
  'com.autonavi.minimap', // 高德地图
  'com.UCMobile', // UC 浏览器
];

// =====================================================================
// 三、地区定义
// =====================================================================

// name 是内部键（也用于匹配机场给的中文节点名），en 只作为英文界面下的显示名
const regionDefinitions = [
  {
    name: '香港',
    en: 'Hong Kong, China',
    flag: '🇭🇰',
    regex: /🇭🇰|香港|(?<![A-Za-z])HKG?(?![A-Za-z])|hong\s*kong/i,
    icon: icon('Hong_Kong.png'),
  },
  {
    name: '日本',
    en: 'Japan',
    flag: '🇯🇵',
    regex: /🇯🇵|日本|东京|大阪|京都|(?<![A-Za-z])JPN?(?![A-Za-z])|japan/i,
    icon: icon('Japan.png'),
  },
  {
    name: '美国',
    en: 'United States',
    flag: '🇺🇸',
    regex:
      /🇺🇸|美国|纽约|洛杉矶|旧金山|芝加哥|休斯顿|迈阿密|西雅图|波士顿|华盛顿|拉斯维加斯|圣何塞|圣地亚哥|(?<![A-Za-z])USA?(?![A-Za-z])|america|united\s*states/i,
    icon: icon('America_Map.png'),
  },
  {
    name: '新加坡',
    en: 'Singapore',
    flag: '🇸🇬',
    regex: /🇸🇬|新加坡|狮城|(?<![A-Za-z])SGP?(?![A-Za-z])|singapore/i,
    icon: icon('Singapore.png'),
  },
  {
    name: '台湾',
    en: 'Taiwan, China',
    flag: '🇹🇼',
    regex: /🇹🇼|台湾|台北|高雄|(?<![A-Za-z])TWN?(?![A-Za-z])|taiwan/i,
    icon: icon('Taiwan.png'),
  },
];

// 地区组的显示名，以及「地区-自动选择」测速组的名字
const regionLabel = (region) => t(region.name, region.en);
const regionAutoLabel = (region) => (isEn ? `${region.en} Auto` : `${region.name}-自动选择`);

// =====================================================================
// 四、规则集（rule-providers）
// =====================================================================

// MetaCubeX 的 .mrs 规则集：behavior 决定取 geosite 还是 geoip
const mrs = (behavior) => (file, name) => ({
  type: 'http',
  behavior,
  format: 'mrs',
  interval: 86400,
  url: `${RULESET}geo/${behavior === 'domain' ? 'geosite' : 'geoip'}/${file}.mrs`,
  path: `./ruleset/${name || file.replace(/[^A-Za-z0-9_.-]/g, '_')}.mrs`,
});
const geosite = mrs('domain');
const geoip = mrs('ipcidr');

// 所有规则集的定义（按名索引，构建时只挑选需要的）
const providerDefs = {
  // ---- 始终引入：直连类 ----
  private: geosite('private'),
  private_ip: geoip('private', 'private_ip'),
  geolocation_cn: geosite('geolocation-cn', 'geolocation_cn'),
  games_cn: geosite('category-games@cn', 'games_cn'), // 含 Steam 下载域名
  apple_cn: geosite('apple@cn', 'apple_cn'),
  microsoft_cn: geosite('microsoft@cn', 'microsoft_cn'),
  nvidia_cn: geosite('nvidia@cn', 'nvidia_cn'),
  cn_ip: geoip('cn', 'cn_ip'),

  // ---- 始终引入：fake-ip 过滤与自定义 ----
  fakeip_filter: {
    type: 'http',
    behavior: 'domain',
    format: 'mrs',
    interval: 86400,
    url: `https://${CDN_HOST}/gh/DustinWin/ruleset_geodata@mihomo-ruleset/fakeip-filter.mrs`,
    path: './ruleset/fakeip_filter.mrs',
  },
  ziji: {
    // 自建站/需要走代理的自定义域名
    type: 'http',
    behavior: 'domain',
    format: 'yaml',
    interval: 86400,
    url: `https://${CDN_HOST}/gh/hheshenghuan-cloud/ziji@main/ziji.yaml`,
    path: './ruleset/ziji.yaml',
  },
  zijign: {
    // 自建站里需要直连的国内域名
    type: 'http',
    behavior: 'domain',
    format: 'yaml',
    interval: 86400,
    url: `https://${CDN_HOST}/gh/hheshenghuan-cloud/ziji@main/zijign.yaml`,
    path: './ruleset/zijign.yaml',
  },
  proxylite: {
    // 轻量补漏：未被前面规则命中的常见需要代理的域名
    type: 'http',
    behavior: 'classical',
    format: 'text',
    interval: 86400,
    url: `https://${CDN_HOST}/gh/qichiyuhub/rule@main/rules/proxy.list`,
    path: './ruleset/proxylite.list',
  },

  // ---- 始终引入：兜底 ----
  'geolocation-!cn': geosite('geolocation-!cn', 'geolocation_not_cn'),

  // ---- 服务分流 ----
  googlefcm: geosite('googlefcm'),
  youtube: geosite('youtube'),
  google: geosite('google'),
  google_ip: geoip('google', 'google_ip'),
  ai: geosite('category-ai-!cn', 'ai'),
  github: geosite('github'),
  onedrive: geosite('onedrive'),
  microsoft: geosite('microsoft'),
  apple: geosite('apple'),
  apple_ip: {
    type: 'http',
    behavior: 'ipcidr',
    format: 'mrs',
    interval: 86400,
    url: `${RULESET}geo-lite/geoip/apple.mrs`,
    path: './ruleset/apple_ip.mrs',
  },
  telegram: geosite('telegram'),
  telegram_ip: geoip('telegram', 'telegram_ip'),
  steam: geosite('steam'),
  twitter: geosite('twitter'),
  twitter_ip: geoip('twitter', 'twitter_ip'),
  meta: geosite('meta'),
  facebook_ip: geoip('facebook', 'facebook_ip'),
  line: geosite('line'),
  tiktok: geosite('tiktok'),
  netflix: geosite('netflix'),
  netflix_ip: geoip('netflix', 'netflix_ip'),
  disney: geosite('disney'),
  spotify: geosite('spotify'),
  pikpak: geosite('pikpak'),
  cryptocurrency: geosite('category-cryptocurrency', 'cryptocurrency'),

  // ---- 广告与追踪 ----
  category_ads: geosite('category-ads', 'category_ads'),
  category_ads_all: geosite('category-ads-all', 'category_ads_all'), // 比 category-ads 覆盖更广
  tracker: geosite('tracker'), // 统计/追踪类域名，默认只引入不用
  dustin_ads: {
    // DustinWin 的反广告清单，与 MetaCubeX 的 category-ads 互为补充
    type: 'http',
    behavior: 'domain',
    format: 'mrs',
    interval: 86400,
    url: `https://${CDN_HOST}/gh/DustinWin/ruleset_geodata@mihomo-ruleset/ads.mrs`,
    path: './ruleset/dustin_ads.mrs',
  },

  // ---- 国内直连补漏 ----
  bank_cn: geosite('category-bank-cn', 'bank_cn'), // 国内银行与支付
};

// 无条件引入的规则集
const BASE_PROVIDERS = [
  'private',
  'private_ip',
  'geolocation_cn',
  'games_cn',
  'apple_cn',
  'microsoft_cn',
  'nvidia_cn',
  'cn_ip',
  'fakeip_filter',
  'ziji',
  'zijign',
  'proxylite',
  'geolocation-!cn',
  // 国内银行/支付直连，需要时才拉规则集，省一份下载
  ...(options.国内银行直连 ? ['bank_cn'] : []),
];

// =====================================================================
// 五、服务分流定义
// =====================================================================

// 广告拦截：默认只拦广告域；开「强化」再叠上更广的规则集。
// 追踪器默认不拦——统计/埋点一拒，部分站点的登录与购买会莫名失败，代价不值。
const adProviders = [
  'category_ads',
  ...(options.强化广告拦截 ? ['category_ads_all', 'dustin_ads'] : []),
  ...(options.拦截追踪器 ? ['tracker'] : []),
];

// providers 为依赖的规则集名；direct 表示给该组补一个「直连」选项
const serviceConfigs = [
  { name: 'GoogleFCM', icon: icon('Google.png'), providers: ['googlefcm'], rules: ['RULE-SET,googlefcm,GoogleFCM'] },
  { name: 'YouTube', icon: icon('YouTube.png'), providers: ['youtube'], rules: ['RULE-SET,youtube,YouTube'] },
  {
    name: 'Google',
    icon: icon('Google_Search.png'),
    providers: ['google', 'google_ip'],
    rules: ['RULE-SET,google,Google', 'RULE-SET,google_ip,Google,no-resolve'],
  },
  { name: 'ChatGPT', icon: icon('ChatGPT.png'), providers: ['ai'], rules: ['RULE-SET,ai,ChatGPT'] },
  { name: 'GitHub', icon: icon('GitHub.png'), providers: ['github'], rules: ['RULE-SET,github,GitHub'] },
  { name: 'OneDrive', icon: icon('OneDrive.png'), providers: ['onedrive'], rules: ['RULE-SET,onedrive,OneDrive'] },
  {
    name: 'Microsoft',
    icon: icon('Microsoft.png'),
    direct: true,
    providers: ['microsoft'],
    rules: ['RULE-SET,microsoft,Microsoft'],
  },
  {
    name: 'APPLE',
    icon: icon('Apple.png'),
    direct: true,
    providers: ['apple', 'apple_ip'],
    rules: ['RULE-SET,apple,APPLE', 'RULE-SET,apple_ip,APPLE,no-resolve'],
  },
  {
    name: 'Telegram',
    icon: icon('Telegram.png'),
    providers: ['telegram', 'telegram_ip'],
    rules: ['RULE-SET,telegram,Telegram', 'RULE-SET,telegram_ip,Telegram,no-resolve'],
  },
  { name: 'Steam', icon: icon('Steam.png'), direct: true, providers: ['steam'], rules: ['RULE-SET,steam,Steam'] },
  {
    name: 'Twitter',
    icon: icon('Twitter.png'),
    providers: ['twitter', 'twitter_ip'],
    rules: ['RULE-SET,twitter,Twitter', 'RULE-SET,twitter_ip,Twitter,no-resolve'],
  },
  {
    name: 'Meta',
    icon: icon('Facebook.png'),
    providers: ['meta', 'facebook_ip'],
    rules: ['RULE-SET,meta,Meta', 'RULE-SET,facebook_ip,Meta,no-resolve'],
  },
  { name: 'Line', icon: icon('Line.png'), providers: ['line'], rules: ['RULE-SET,line,Line'] },
  { name: 'TikTok', icon: icon('TikTok.png'), providers: ['tiktok'], rules: ['RULE-SET,tiktok,TikTok'] },
  {
    name: 'NETFLIX',
    icon: icon('Netflix.png'),
    providers: ['netflix', 'netflix_ip'],
    rules: ['RULE-SET,netflix,NETFLIX', 'RULE-SET,netflix_ip,NETFLIX,no-resolve'],
  },
  { name: 'Disney', icon: icon('Disney+.png'), providers: ['disney'], rules: ['RULE-SET,disney,Disney'] },
  { name: 'Spotify', icon: icon('Spotify.png'), direct: true, providers: ['spotify'], rules: ['RULE-SET,spotify,Spotify'] },
  { name: 'PikPak', icon: icon('Nfcloud.png'), direct: true, providers: ['pikpak'], rules: ['RULE-SET,pikpak,PikPak'] },
  {
    name: 'Crypto',
    icon: icon('Cryptocurrency.png'),
    providers: ['cryptocurrency'],
    rules: ['RULE-SET,cryptocurrency,Crypto'],
  },
  {
    name: 'AdBlock',
    icon: icon('AdBlack.png'),
    reject: true,
    providers: adProviders,
    rules: adProviders.map((name) => `RULE-SET,${name},AdBlock`),
  },
];

// =====================================================================
// 六、节点过滤与重命名
// =====================================================================

const regionMatchCache = new Map();

// 取「可用于匹配」的节点名：剥离零宽/不可见字符
function toMatchableName(name) {
  return typeof name === 'string' ? name.replace(INVISIBLE_CHARS, '') : name;
}

// 节点命中的地区集合（带缓存，避免重复跑正则）
function getMatchedRegions(proxyName) {
  if (regionMatchCache.has(proxyName)) return regionMatchCache.get(proxyName);
  const regions = regionDefinitions.filter((region) => region.regex.test(toMatchableName(proxyName)));
  regionMatchCache.set(proxyName, regions);
  return regions;
}

const FLAG_REGEX = /[\u{1F1E6}-\u{1F1FF}]{2}/u;

// 标准化节点名：剥离不可见字符、补地区国旗、折叠多余空格
function normalizeProxyName(proxy) {
  const originalName = proxy.name;
  const matchableName = toMatchableName(originalName);
  const flag = matchableName.match(FLAG_REGEX)?.[0];
  const nameWithoutFlag = (flag ? matchableName.replace(flag, '') : matchableName).replace(/\s+/g, ' ').trim();

  const matchedRegions = getMatchedRegions(originalName);
  const regionFlag = flag || matchedRegions.find((region) => region.flag)?.flag;
  const normalizedName = regionFlag ? `${regionFlag} ${nameWithoutFlag}` : nameWithoutFlag;

  if (normalizedName !== originalName) regionMatchCache.set(normalizedName, matchedRegions);
  return normalizedName === originalName ? proxy : { ...proxy, name: normalizedName };
}

// 节点被重命名时同步更新 dialer-proxy 引用；目标已不存在则删除该字段
function fixDialerProxy(proxy, renameMap, normalizedNames) {
  const target = proxy['dialer-proxy'];
  if (!target) return proxy;
  if (renameMap.has(target)) return { ...proxy, 'dialer-proxy': renameMap.get(target) };
  if (normalizedNames.has(target)) return proxy;
  const copy = { ...proxy };
  delete copy['dialer-proxy'];
  return copy;
}

// 过滤 → 重命名 → 去重 → 修复引用
function filterAndNormalizeProxies(config) {
  regionMatchCache.clear();

  const originalProxies = config.proxies || [];

  const filteredRawProxies = originalProxies.filter((proxy) => {
    const type = String(proxy.type ?? '').toLowerCase();
    if (type === 'direct' || type === 'reject' || type === 'rematch') return false;
    if (!options.过滤非地区节点) return true;

    const matchableName = toMatchableName(proxy.name);
    const isRegionProxy = getMatchedRegions(proxy.name).length > 0;
    // 地区节点一律保留；非地区节点仅在不像信息节点时保留
    return isRegionProxy || !EXCLUDE_FILTER.test(matchableName);
  });

  const renameMap = new Map();
  const uniqueNames = new Set();
  const normalizedProxies = [];

  for (const rawProxy of filteredRawProxies) {
    const normalized = normalizeProxyName(rawProxy);
    if (normalized.name !== rawProxy.name) {
      // 原名与「剥离不可见字符后的名字」都登记，兼容 dialer-proxy 两种写法
      renameMap.set(rawProxy.name, normalized.name);
      renameMap.set(toMatchableName(rawProxy.name), normalized.name);
    }
    if (!uniqueNames.has(normalized.name)) {
      uniqueNames.add(normalized.name);
      normalizedProxies.push(normalized);
    }
  }

  if (!normalizedProxies.length) {
    throw new Error('配置文件中未找到任何可用代理节点，请使用机场提供的、包含内联 proxies 的配置文件进行覆写');
  }

  const normalizedNames = new Set(normalizedProxies.map((p) => p.name));
  return normalizedProxies.map((proxy) => fixDialerProxy(proxy, renameMap, normalizedNames));
}

// =====================================================================
// 七、策略组
// =====================================================================

const commonGroupOption = {
  interval: options.测速间隔,
  timeout: options.测速超时,
  'max-failed-times': 3,
  lazy: true,
};

const baseSelect = { ...commonGroupOption, type: 'select' };

// 引用全部节点的组：排除直连类出口与残余信息节点
const includeAllOption = {
  'include-all': true,
  'exclude-type': 'DIRECT',
  'exclude-filter': EXCLUDE_FILTER_CONFIG,
};

// 按地区把节点归类，生成「地区」手动组与「地区-自动选择」测速组
function buildRegionGroups(filteredProxies) {
  const buckets = Object.fromEntries(regionDefinitions.map(({ name }) => [name, []]));
  const otherProxies = [];

  for (const proxy of filteredProxies) {
    const matched = getMatchedRegions(proxy.name);
    for (const region of matched) buckets[region.name].push(proxy.name);
    if (!matched.length) otherProxies.push(proxy.name);
  }

  const groups = [];
  const selectNames = [];
  const hiddenManual = options.隐藏地区手动选择组;

  for (const region of regionDefinitions) {
    const proxies = buckets[region.name];
    if (!proxies.length) continue;

    const label = regionLabel(region);
    if (options.生成地区自动选择组) {
      const autoName = regionAutoLabel(region);
      groups.push({
        ...commonGroupOption,
        type: 'url-test',
        name: autoName,
        proxies,
        url: TEST_URL,
        tolerance: options.自动选择容差,
        hidden: true,
        icon: icon('Auto.png'),
      });
      groups.push({ ...baseSelect, name: label, proxies: [...proxies, autoName], icon: region.icon, hidden: hiddenManual });
    } else {
      groups.push({ ...baseSelect, name: label, proxies, icon: region.icon, hidden: hiddenManual });
    }
    selectNames.push(label);
  }

  if (otherProxies.length) {
    groups.push({ ...baseSelect, name: OTHER_GROUP, proxies: otherProxies, icon: icon('World_Map.png') });
    selectNames.push(OTHER_GROUP);
  }

  return { groups, selectNames };
}

// 构建全部策略组与规则
function buildGroupsAndRules(filteredProxies, regionGroups) {
  const allNodeNames = filteredProxies.map((p) => p.name);
  const enabledServices = serviceConfigs.filter((svc) => options[svc.name]);
  const regionSelectNames = regionGroups.selectNames;

  // 收集需要的规则集
  const providerNames = new Set(BASE_PROVIDERS);
  for (const svc of enabledServices) {
    for (const name of svc.providers || []) providerNames.add(name);
  }
  const ruleProviders = Object.fromEntries([...providerNames].map((name) => [name, providerDefs[name]]));

  // 分流组的公共选项：默认代理 → 自动组 → 地区组 →（可选）直连
  const serviceProxies = (svc) => {
    if (svc.reject) return ['REJECT', 'REJECT-DROP', 'PASS'];
    const list = [DEFAULT_GROUP, ...enabledAutoGroupNames(), ...regionSelectNames];
    if (svc.direct) list.push(DIRECT_GROUP);
    if (options.分流组添加所有节点) list.push(...allNodeNames);
    return list;
  };

  // 每个自动组的额外参数，与 AUTO_GROUPS / AUTO_GROUP_KEYS 同序
  const autoGroupSpecs = [
    { type: 'url-test', url: TEST_URL, tolerance: options.自动选择容差, icon: icon('Auto.png') },
    { type: 'fallback', url: TEST_URL, icon: icon('Round_Robin.png') },
    { type: 'load-balance', strategy: 'sticky-sessions', url: TEST_URL, icon: icon('Stack.png') },
  ];
  const autoGroups = autoGroupSpecs
    .map((spec, i) => ({ ...commonGroupOption, ...includeAllOption, ...spec, name: AUTO_GROUPS[i], proxies: [], hidden: true }))
    .filter((_, i) => options[AUTO_GROUP_KEYS[i]]);

  const masterGroup = {
    ...baseSelect,
    ...includeAllOption,
    name: DEFAULT_GROUP,
    proxies: [...enabledAutoGroupNames(), ...regionSelectNames, DIRECT_GROUP],
    icon: icon('Rocket.png'),
  };

  const serviceGroups = enabledServices.map((svc) => ({
    ...baseSelect,
    name: svc.name,
    proxies: serviceProxies(svc),
    icon: svc.icon,
  }));

  const finalGroup = {
    ...baseSelect,
    name: FINAL_GROUP,
    proxies: [DEFAULT_GROUP, DIRECT_GROUP, ...regionSelectNames],
    icon: icon('Final.png'),
  };

  const directGroup = {
    ...baseSelect,
    name: DIRECT_GROUP,
    proxies: directProxyNames,
    icon: icon('Direct.png'),
  };

  const globalGroup = {
    ...baseSelect,
    name: 'GLOBAL',
    proxies: [
      DEFAULT_GROUP,
      ...autoGroups.map((g) => g.name),
      ...serviceGroups.map((g) => g.name),
      FINAL_GROUP,
      DIRECT_GROUP,
      ...regionGroups.groups.map((g) => g.name),
    ],
    // 注意：GLOBAL 的图标由客户端自己固定渲染，这里的 icon 不生效，仅作兜底
    icon: icon('Global.png'),
  };

  // ---- 规则 ----
  // 前置：国内/私有网络优先直连，避免被后面的服务规则截走
  // 进程匹配最准，放最前面：命中就不再往下看域名规则
  // 规则里的目标名一律拼变量，不写死中文——否则切英文后规则会指向不存在的组，整个配置直接失效
  const domesticProcessRules = options.国内应用直连
    ? DOMESTIC_PROCESSES.map((pkg) => `PROCESS-NAME,${pkg},${DIRECT_GROUP}`)
    : [];

  const prefixRules = [
    ...domesticProcessRules,
    // 组图标由客户端自己下载，走代理容易超时（每个图标只拉一次，失败就退化成显示组名首字母），固定直连
    `DOMAIN,${CDN_HOST},${DIRECT_GROUP}`,
    `RULE-SET,private,${DIRECT_GROUP}`,
    `RULE-SET,private_ip,${DIRECT_GROUP},no-resolve`,
    `RULE-SET,geolocation_cn,${DIRECT_GROUP}`,
    `RULE-SET,zijign,${DIRECT_GROUP}`,
    `RULE-SET,games_cn,${DIRECT_GROUP}`,
    `RULE-SET,apple_cn,${DIRECT_GROUP}`,
    `RULE-SET,microsoft_cn,${DIRECT_GROUP}`,
    `RULE-SET,nvidia_cn,${DIRECT_GROUP}`,
    ...(options.国内银行直连 ? [`RULE-SET,bank_cn,${DIRECT_GROUP}`] : []),
  ];

  // 屏蔽国外 QUIC：非中国大陆的 UDP/443 一律拒绝，逼迫回落 TCP
  const quicRule = options.屏蔽国外QUIC
    ? ['AND,((NETWORK,UDP),(DST-PORT,443),(NOT,((OR,((RULE-SET,geolocation_cn),(RULE-SET,cn_ip,no-resolve)))))),REJECT']
    : [];

  // 自建/默认走代理的域名 + 特定进程
  const ownRules = [`RULE-SET,ziji,${DEFAULT_GROUP}`, `PROCESS-NAME,com.tencent.ig,${DEFAULT_GROUP}`];

  // 服务规则：AdBlock 放最前，其余按声明顺序
  const serviceRules = [
    ...enabledServices.filter((svc) => svc.name === 'AdBlock').flatMap((svc) => svc.rules || []),
    ...enabledServices.filter((svc) => svc.name !== 'AdBlock').flatMap((svc) => svc.rules || []),
  ];

  const tailRules = [
    `RULE-SET,proxylite,${DEFAULT_GROUP}`,
    `RULE-SET,geolocation-!cn,${DEFAULT_GROUP}`,
    `RULE-SET,cn_ip,${DIRECT_GROUP},no-resolve`,
    `MATCH,${FINAL_GROUP}`,
  ];

  const rules = [...prefixRules, ...quicRule, ...ownRules, ...serviceRules, ...tailRules];

  const proxyGroups = [globalGroup, masterGroup, ...autoGroups, ...serviceGroups, finalGroup, directGroup, ...regionGroups.groups];

  return { proxyGroups, rules, ruleProviders };
}

// =====================================================================
// 八、DNS 与 hosts
// =====================================================================

function buildDnsAndHosts() {
  const cnDns = ['223.5.5.5', '119.29.29.29'];
  const cnDoh = ['https://dns.alidns.com/dns-query', 'https://doh.pub/dns-query'];

  const fakeIpFilter = ['rule-set:private', 'rule-set:fakeip_filter', 'rule-set:geolocation_cn', '+.push.apple.com', 'mtalk.google.com'];
  if (options.GoogleFCM) fakeIpFilter.push('rule-set:googlefcm');
  // 银行类域名要走真实解析，fake-ip 会让部分网银的风控与证书校验出问题
  if (options.国内银行直连) fakeIpFilter.push('rule-set:bank_cn');

  const nameserverPolicy = {
    'rule-set:private': 'system',
    'rule-set:geolocation_cn': cnDoh,
  };
  if (options.GoogleFCM) nameserverPolicy['rule-set:googlefcm'] = [`https://8.8.8.8/dns-query#${DEFAULT_GROUP}`];
  // 直连的域名就该交给国内 DNS 解析，别拿境外 DNS 的结果去直连
  if (options.国内银行直连) nameserverPolicy['rule-set:bank_cn'] = cnDoh;

  const dns = {
    enable: true,
    ipv6: options.启用IPv6,
    // 国外 QUIC 被拒（见 屏蔽国外QUIC），DoH 若跑在 HTTP/3 上会一起被拒掉，干脆禁用 h3
    'prefer-h3': false,
    listen: '0.0.0.0:1053',
    'cache-algorithm': 'arc',
    'use-hosts': true,
    'use-system-hosts': true,
    'respect-rules': true,
    'enhanced-mode': 'fake-ip',
    'fake-ip-range': '198.18.0.1/16',
    'fake-ip-filter-mode': 'blacklist',
    'fake-ip-filter': fakeIpFilter,
    // default-nameserver 负责解析下面这些 DNS 服务器自身的域名，必须是 IP
    'default-nameserver': cnDns,
    'proxy-server-nameserver': cnDns,
    'direct-nameserver': cnDns,
    'direct-nameserver-follow-policy': true,
    // 默认解析走境外 DNS（经代理），国内域名由 nameserver-policy 分流
    nameserver: [`https://8.8.8.8/dns-query#${DEFAULT_GROUP}`, `https://1.1.1.1/dns-query#${DEFAULT_GROUP}`],
    'nameserver-policy': nameserverPolicy,
  };

  const hosts = {
    // 避免解析 DoH 服务器自身域名时出现循环依赖
    'cloudflare-dns.com': ['1.1.1.1', '1.0.0.1'],
    'dns.google': ['8.8.8.8', '8.8.4.4'],
    'doh.pub': ['1.12.12.12', '120.53.53.53'],
    'dns.alidns.com': ['223.5.5.5', '223.6.6.6'],

    // 解决 Google Play 无法下载的问题
    'services.googleapis.cn': 'services.googleapis.com',

    // 屏蔽 B 站 PCDN，缓解视频/直播卡顿
    '+.mcdn.bilivideo.com': ['0.0.0.0'],
    '+.mcdn.bilivideo.cn': ['0.0.0.0'],
    '+.edge.mountaintoys.cn': ['0.0.0.0'],
    '+.h2.smtcdns.net': ['0.0.0.0'],
  };

  return { dns, hosts };
}

// =====================================================================
// 九、主入口
// =====================================================================

function main(config) {
  config = config || {};

  if (config['proxy-providers'] && Object.keys(config['proxy-providers']).length > 0) {
    throw new Error('订阅使用了 proxy-providers，节点过滤与地区分组无法生效，请改用包含内联 proxies 的配置文件');
  }

  const filteredProxies = filterAndNormalizeProxies(config);
  const regionGroups = buildRegionGroups(filteredProxies);
  const { proxyGroups, rules, ruleProviders } = buildGroupsAndRules(filteredProxies, regionGroups);
  const { dns, hosts } = buildDnsAndHosts();

  return {
    ...config,

    mode: 'rule',
    ipv6: options.启用IPv6,

    'mixed-port': 7890,
    'socks-port': 7891,
    'redir-port': 7892,
    port: 7893,
    'tproxy-port': 7894,
    'allow-lan': true,
    'bind-address': '*',
    'unified-delay': true,
    'tcp-concurrent': true,
    'log-level': 'warning',
    'keep-alive-idle': 600,
    'keep-alive-interval': 15,
    'find-process-mode': 'strict',

    'external-controller': '127.0.0.1:9090',
    secret: 'f4ae40b9db9b68d2f8bbea24434f97ef',

    profile: {
      'store-selected': true,
      'store-fake-ip': true,
    },

    ntp: {
      enable: true,
      'write-to-system': false,
      server: 'ntp.aliyun.com',
      port: 123,
      interval: 60,
    },

    sniffer: {
      enable: true,
      'force-dns-mapping': false,
      'parse-pure-ip': true,
      sniff: {
        HTTP: { ports: [80, '8080-8880'], 'override-destination': false },
        TLS: { ports: [443, 8443], 'override-destination': false },
        QUIC: { ports: [443, 8443], 'override-destination': false },
      },
      'skip-domain': ['Mijia Cloud', '+.push.apple.com', 'mtalk.google.com'],
    },

    tun: {
      enable: true,
      stack: 'mixed',
      'dns-hijack': ['any:53', 'tcp://any:53'],
    },

    dns,
    hosts,

    proxies: [...filteredProxies, ...directProxies],
    'proxy-groups': proxyGroups,
    'rule-providers': ruleProviders,
    rules,
  };
}
