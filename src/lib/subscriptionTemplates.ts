import type { BillingCycle } from "../types";

/**
 * 「人気サービスから追加」のお手本(参考: サブスクBOX)。選ぶと名前・料金・カテゴリ・
 * 払い方が入る。料金は変わるので、選んだあとフォームで直せる(目安として扱う)。
 *
 * アイコンは本物のロゴを使わず、ブランドの色の四角に頭文字(mark)を置く。
 * 色は各社の代表色に寄せてある。
 */
export interface SubscriptionTemplate {
  /** 一意の名前。SubscriptionDetail.serviceKey に入る。あとから変えないこと。 */
  key: string;
  service: string;
  plan?: string;
  category: string;
  cycle: BillingCycle;
  /** 税込の円。 */
  price: number;
  color: string;
  /** アイコンの文字。無ければサービス名の1文字目。 */
  mark?: string;
  /** 解約・プランの管理ページ。 */
  manageUrl?: string;
}

/** 料金を確かめた月。画面の注意書きに出す。2026-10-12 に公式ページと記事で調べた
 * (App Store とWebで値段が違うものは、Webの値段。ChatGPT・Claude だけは App Store の円の値段)。 */
export const TEMPLATE_PRICES_CHECKED_AT = "2026年10月";

export const SUBSCRIPTION_TEMPLATES: SubscriptionTemplate[] = [
  // 動画
  { key: "netflix-ads", service: "Netflix", plan: "広告つきスタンダード", category: "動画", cycle: "monthly", price: 890, color: "#e50914", manageUrl: "https://www.netflix.com/account/membership" },
  { key: "netflix-standard", service: "Netflix", plan: "スタンダード", category: "動画", cycle: "monthly", price: 1590, color: "#e50914", manageUrl: "https://www.netflix.com/account/membership" },
  { key: "netflix-premium", service: "Netflix", plan: "プレミアム", category: "動画", cycle: "monthly", price: 2290, color: "#e50914", manageUrl: "https://www.netflix.com/account/membership" },
  { key: "amazon-prime-monthly", service: "Amazonプライム", plan: "月間プラン", category: "買い物", cycle: "monthly", price: 600, color: "#00a8e1", mark: "a", manageUrl: "https://www.amazon.co.jp/gp/primecentral" },
  { key: "amazon-prime-yearly", service: "Amazonプライム", plan: "年間プラン", category: "買い物", cycle: "yearly", price: 5900, color: "#00a8e1", mark: "a", manageUrl: "https://www.amazon.co.jp/gp/primecentral" },
  { key: "unext", service: "U-NEXT", plan: "月額プラン", category: "動画", cycle: "monthly", price: 2189, color: "#111111", mark: "U", manageUrl: "https://video.unext.jp/" },
  { key: "disney-standard", service: "ディズニープラス", plan: "スタンダード", category: "動画", cycle: "monthly", price: 1250, color: "#0063e5", mark: "D+", manageUrl: "https://www.disneyplus.com/ja-jp/explore/how-to-join" },
  { key: "disney-standard-yearly", service: "ディズニープラス", plan: "スタンダード(年額)", category: "動画", cycle: "yearly", price: 12500, color: "#0063e5", mark: "D+", manageUrl: "https://www.disneyplus.com/ja-jp/explore/how-to-join" },
  { key: "disney-premium", service: "ディズニープラス", plan: "プレミアム", category: "動画", cycle: "monthly", price: 1670, color: "#0063e5", mark: "D+", manageUrl: "https://www.disneyplus.com/ja-jp/explore/how-to-join" },
  { key: "disney-premium-yearly", service: "ディズニープラス", plan: "プレミアム(年額)", category: "動画", cycle: "yearly", price: 16700, color: "#0063e5", mark: "D+", manageUrl: "https://www.disneyplus.com/ja-jp/explore/how-to-join" },
  { key: "hulu", service: "Hulu", plan: "月額プラン", category: "動画", cycle: "monthly", price: 1320, color: "#1ce783", mark: "h", manageUrl: "https://www.hulu.jp/account" },
  { key: "dazn-standard", service: "DAZN", plan: "Standard 月額プラン", category: "動画", cycle: "monthly", price: 4200, color: "#f7ff1a", mark: "DZ", manageUrl: "https://www.dazn.com/ja-JP/myaccount" },
  { key: "dazn-annual-monthly", service: "DAZN", plan: "Standard 年間プラン(月々払い)", category: "動画", cycle: "monthly", price: 3200, color: "#f7ff1a", mark: "DZ", manageUrl: "https://www.dazn.com/ja-JP/myaccount" },
  { key: "dazn-annual", service: "DAZN", plan: "Standard 年間プラン(一括)", category: "動画", cycle: "yearly", price: 32000, color: "#f7ff1a", mark: "DZ", manageUrl: "https://www.dazn.com/ja-JP/myaccount" },
  { key: "abema-premium", service: "ABEMAプレミアム", plan: "広告なし", category: "動画", cycle: "monthly", price: 1180, color: "#2db84d", mark: "A", manageUrl: "https://abema.tv/about/premium" },
  { key: "abema-ads", service: "ABEMAプレミアム", plan: "広告つき", category: "動画", cycle: "monthly", price: 680, color: "#2db84d", mark: "A", manageUrl: "https://abema.tv/about/premium" },
  { key: "danime", service: "dアニメストア", category: "動画", cycle: "monthly", price: 660, color: "#e95504", mark: "d", manageUrl: "https://animestore.docomo.ne.jp/animestore/" },
  { key: "lemino", service: "Lemino", plan: "プレミアム", category: "動画", cycle: "monthly", price: 1540, color: "#e6005a", mark: "L", manageUrl: "https://lemino.docomo.ne.jp/" },
  { key: "apple-tv", service: "Apple TV", category: "動画", cycle: "monthly", price: 1200, color: "#111111", mark: "tv", manageUrl: "https://support.apple.com/ja-jp/118428" },
  { key: "youtube-premium", service: "YouTube Premium", plan: "個人", category: "動画", cycle: "monthly", price: 1280, color: "#ff0000", mark: "▶", manageUrl: "https://www.youtube.com/paid_memberships" },
  { key: "youtube-premium-yearly", service: "YouTube Premium", plan: "個人(年間)", category: "動画", cycle: "yearly", price: 12800, color: "#ff0000", mark: "▶", manageUrl: "https://www.youtube.com/paid_memberships" },
  { key: "youtube-premium-family", service: "YouTube Premium", plan: "ファミリー", category: "動画", cycle: "monthly", price: 2280, color: "#ff0000", mark: "▶", manageUrl: "https://www.youtube.com/paid_memberships" },
  { key: "youtube-premium-student", service: "YouTube Premium", plan: "学生", category: "動画", cycle: "monthly", price: 780, color: "#ff0000", mark: "▶", manageUrl: "https://www.youtube.com/paid_memberships" },
  { key: "fod", service: "FODプレミアム", category: "動画", cycle: "monthly", price: 976, color: "#e60033", mark: "F", manageUrl: "https://fod.fujitv.co.jp/" },
  { key: "telasa", service: "TELASA", plan: "見放題プラン", category: "動画", cycle: "monthly", price: 990, color: "#eb5505", mark: "T", manageUrl: "https://www.au.com/entertainment/telasa/" },

  // 音楽
  { key: "spotify-standard", service: "Spotify", plan: "Standard", category: "音楽", cycle: "monthly", price: 1080, color: "#1db954", manageUrl: "https://www.spotify.com/jp/account/subscription/" },
  { key: "spotify-duo", service: "Spotify", plan: "Duo", category: "音楽", cycle: "monthly", price: 1480, color: "#1db954", manageUrl: "https://www.spotify.com/jp/account/subscription/" },
  { key: "spotify-family", service: "Spotify", plan: "Family", category: "音楽", cycle: "monthly", price: 1880, color: "#1db954", manageUrl: "https://www.spotify.com/jp/account/subscription/" },
  { key: "spotify-student", service: "Spotify", plan: "Student", category: "音楽", cycle: "monthly", price: 580, color: "#1db954", manageUrl: "https://www.spotify.com/jp/account/subscription/" },
  { key: "apple-music", service: "Apple Music", plan: "個人", category: "音楽", cycle: "monthly", price: 1180, color: "#fa243c", mark: "♪", manageUrl: "https://support.apple.com/ja-jp/118428" },
  { key: "apple-music-student", service: "Apple Music", plan: "学生", category: "音楽", cycle: "monthly", price: 680, color: "#fa243c", mark: "♪", manageUrl: "https://support.apple.com/ja-jp/118428" },
  { key: "apple-music-family", service: "Apple Music", plan: "ファミリー", category: "音楽", cycle: "monthly", price: 1980, color: "#fa243c", mark: "♪", manageUrl: "https://support.apple.com/ja-jp/118428" },
  { key: "amazon-music-unlimited", service: "Amazon Music Unlimited", plan: "プライム会員", category: "音楽", cycle: "monthly", price: 1080, color: "#25d1da", mark: "♫", manageUrl: "https://www.amazon.co.jp/music/unlimited" },
  { key: "amazon-music-unlimited-yearly", service: "Amazon Music Unlimited", plan: "プライム会員(年額)", category: "音楽", cycle: "yearly", price: 10800, color: "#25d1da", mark: "♫", manageUrl: "https://www.amazon.co.jp/music/unlimited" },
  { key: "amazon-music-unlimited-nonprime", service: "Amazon Music Unlimited", plan: "プライム会員以外", category: "音楽", cycle: "monthly", price: 1180, color: "#25d1da", mark: "♫", manageUrl: "https://www.amazon.co.jp/music/unlimited" },
  { key: "line-music", service: "LINE MUSIC", plan: "一般", category: "音楽", cycle: "monthly", price: 980, color: "#06c755", mark: "L", manageUrl: "https://music.line.me/" },
  { key: "line-music-yearly", service: "LINE MUSIC", plan: "一般(年額)", category: "音楽", cycle: "yearly", price: 9600, color: "#06c755", mark: "L", manageUrl: "https://music.line.me/" },
  { key: "line-music-student", service: "LINE MUSIC", plan: "学生", category: "音楽", cycle: "monthly", price: 480, color: "#06c755", mark: "L", manageUrl: "https://music.line.me/" },
  { key: "youtube-music", service: "YouTube Music Premium", category: "音楽", cycle: "monthly", price: 1080, color: "#ff0000", mark: "♪", manageUrl: "https://www.youtube.com/paid_memberships" },

  // AI・仕事
  { key: "chatgpt-go", service: "ChatGPT", plan: "Go", category: "AI・仕事", cycle: "monthly", price: 1400, color: "#10a37f", mark: "G", manageUrl: "https://chatgpt.com/pricing" },
  { key: "chatgpt-plus", service: "ChatGPT", plan: "Plus", category: "AI・仕事", cycle: "monthly", price: 3000, color: "#10a37f", mark: "G", manageUrl: "https://chatgpt.com/pricing" },
  { key: "chatgpt-pro-5x", service: "ChatGPT", plan: "Pro(5倍)", category: "AI・仕事", cycle: "monthly", price: 16800, color: "#10a37f", mark: "G", manageUrl: "https://chatgpt.com/pricing" },
  { key: "chatgpt-pro", service: "ChatGPT", plan: "Pro(20倍)", category: "AI・仕事", cycle: "monthly", price: 30000, color: "#10a37f", mark: "G", manageUrl: "https://chatgpt.com/pricing" },
  { key: "claude-pro", service: "Claude", plan: "Pro", category: "AI・仕事", cycle: "monthly", price: 3000, color: "#d97757", mark: "C", manageUrl: "https://claude.ai/settings/billing" },
  { key: "claude-pro-yearly", service: "Claude", plan: "Pro(年額)", category: "AI・仕事", cycle: "yearly", price: 35000, color: "#d97757", mark: "C", manageUrl: "https://claude.ai/settings/billing" },
  { key: "claude-max", service: "Claude", plan: "Max 5x", category: "AI・仕事", cycle: "monthly", price: 20000, color: "#d97757", mark: "C", manageUrl: "https://claude.ai/settings/billing" },
  { key: "claude-max-20x", service: "Claude", plan: "Max 20x", category: "AI・仕事", cycle: "monthly", price: 40000, color: "#d97757", mark: "C", manageUrl: "https://claude.ai/settings/billing" },
  { key: "google-ai-pro", service: "Google AI Pro", plan: "月額", category: "AI・仕事", cycle: "monthly", price: 2900, color: "#4285f4", mark: "G", manageUrl: "https://one.google.com/about/plans" },
  { key: "google-ai-pro-yearly", service: "Google AI Pro", plan: "年額", category: "AI・仕事", cycle: "yearly", price: 29000, color: "#4285f4", mark: "G", manageUrl: "https://one.google.com/about/plans" },
  { key: "m365-personal-yearly", service: "Microsoft 365", plan: "Personal(年額)", category: "AI・仕事", cycle: "yearly", price: 21300, color: "#d83b01", mark: "M", manageUrl: "https://account.microsoft.com/services" },
  { key: "m365-personal-monthly", service: "Microsoft 365", plan: "Personal(月額)", category: "AI・仕事", cycle: "monthly", price: 2130, color: "#d83b01", mark: "M", manageUrl: "https://account.microsoft.com/services" },
  { key: "m365-family-yearly", service: "Microsoft 365", plan: "Family(年額)", category: "AI・仕事", cycle: "yearly", price: 27400, color: "#d83b01", mark: "M", manageUrl: "https://account.microsoft.com/services" },
  { key: "m365-family-monthly", service: "Microsoft 365", plan: "Family(月額)", category: "AI・仕事", cycle: "monthly", price: 2740, color: "#d83b01", mark: "M", manageUrl: "https://account.microsoft.com/services" },
  { key: "adobe-cc", service: "Adobe Creative Cloud", plan: "Pro 年間プラン(月々払い)", category: "AI・仕事", cycle: "monthly", price: 9080, color: "#fa0f00", mark: "Cc", manageUrl: "https://account.adobe.com/plans" },
  { key: "adobe-cc-monthly", service: "Adobe Creative Cloud", plan: "Pro 月々プラン", category: "AI・仕事", cycle: "monthly", price: 14480, color: "#fa0f00", mark: "Cc", manageUrl: "https://account.adobe.com/plans" },
  { key: "adobe-photo", service: "Adobe Creative Cloud", plan: "フォトプラン 1TB", category: "AI・仕事", cycle: "monthly", price: 2380, color: "#fa0f00", mark: "Cc", manageUrl: "https://account.adobe.com/plans" },
  { key: "canva-pro", service: "Canva", plan: "プロ", category: "AI・仕事", cycle: "monthly", price: 1180, color: "#00c4cc", mark: "C", manageUrl: "https://www.canva.com/ja_jp/pricing/" },
  { key: "canva-pro-yearly", service: "Canva", plan: "プロ(年額)", category: "AI・仕事", cycle: "yearly", price: 11800, color: "#00c4cc", mark: "C", manageUrl: "https://www.canva.com/ja_jp/pricing/" },
  { key: "notion-plus", service: "Notion", plan: "プラス(月払い)", category: "AI・仕事", cycle: "monthly", price: 2200, color: "#191919", mark: "N", manageUrl: "https://www.notion.com/ja/pricing" },
  { key: "notion-plus-yearly", service: "Notion", plan: "プラス(年払い)", category: "AI・仕事", cycle: "yearly", price: 21780, color: "#191919", mark: "N", manageUrl: "https://www.notion.com/ja/pricing" },

  // クラウド
  { key: "icloud-50", service: "iCloud+", plan: "50GB", category: "クラウド", cycle: "monthly", price: 180, color: "#3693f3", mark: "☁", manageUrl: "https://support.apple.com/ja-jp/118428" },
  { key: "icloud-200", service: "iCloud+", plan: "200GB", category: "クラウド", cycle: "monthly", price: 540, color: "#3693f3", mark: "☁", manageUrl: "https://support.apple.com/ja-jp/118428" },
  { key: "icloud-2t", service: "iCloud+", plan: "2TB", category: "クラウド", cycle: "monthly", price: 1800, color: "#3693f3", mark: "☁", manageUrl: "https://support.apple.com/ja-jp/118428" },
  { key: "google-one-100", service: "Google One", plan: "100GB", category: "クラウド", cycle: "monthly", price: 290, color: "#1a73e8", mark: "1", manageUrl: "https://one.google.com/about/plans" },
  { key: "google-one-100-yearly", service: "Google One", plan: "100GB(年額)", category: "クラウド", cycle: "yearly", price: 2900, color: "#1a73e8", mark: "1", manageUrl: "https://one.google.com/about/plans" },
  { key: "google-one-2t", service: "Google One", plan: "2TB(Google AI Plus)", category: "クラウド", cycle: "monthly", price: 1450, color: "#1a73e8", mark: "1", manageUrl: "https://one.google.com/about/plans" },
  { key: "dropbox-plus-yearly", service: "Dropbox", plan: "Plus(年払い)", category: "クラウド", cycle: "yearly", price: 15840, color: "#0061ff", mark: "◆", manageUrl: "https://www.dropbox.com/account/plan" },
  { key: "dropbox-plus", service: "Dropbox", plan: "Plus(月払い)", category: "クラウド", cycle: "monthly", price: 1650, color: "#0061ff", mark: "◆", manageUrl: "https://www.dropbox.com/account/plan" },
  { key: "apple-one", service: "Apple One", plan: "個人", category: "クラウド", cycle: "monthly", price: 1350, color: "#111111", mark: "A1", manageUrl: "https://support.apple.com/ja-jp/118428" },
  { key: "apple-one-family", service: "Apple One", plan: "ファミリー", category: "クラウド", cycle: "monthly", price: 2500, color: "#111111", mark: "A1", manageUrl: "https://support.apple.com/ja-jp/118428" },

  // ゲーム
  { key: "nso-monthly", service: "Nintendo Switch Online", plan: "個人 1か月", category: "ゲーム", cycle: "monthly", price: 400, color: "#e60012", mark: "N", manageUrl: "https://ec.nintendo.com/my/membership" },
  { key: "nso-yearly", service: "Nintendo Switch Online", plan: "個人 12か月", category: "ゲーム", cycle: "yearly", price: 3000, color: "#e60012", mark: "N", manageUrl: "https://ec.nintendo.com/my/membership" },
  { key: "nso-expansion", service: "Nintendo Switch Online", plan: "＋追加パック 個人 12か月", category: "ゲーム", cycle: "yearly", price: 5900, color: "#e60012", mark: "N", manageUrl: "https://ec.nintendo.com/my/membership" },
  { key: "ps-plus-essential", service: "PlayStation Plus", plan: "エッセンシャル 1か月", category: "ゲーム", cycle: "monthly", price: 850, color: "#003791", mark: "PS", manageUrl: "https://www.playstation.com/ja-jp/ps-plus/" },
  { key: "ps-plus-essential-yearly", service: "PlayStation Plus", plan: "エッセンシャル 12か月", category: "ゲーム", cycle: "yearly", price: 6800, color: "#003791", mark: "PS", manageUrl: "https://www.playstation.com/ja-jp/ps-plus/" },
  { key: "game-pass-ultimate", service: "Xbox Game Pass", plan: "Ultimate", category: "ゲーム", cycle: "monthly", price: 1550, color: "#107c10", mark: "X", manageUrl: "https://account.microsoft.com/services" },
  { key: "game-pass-pc", service: "Xbox Game Pass", plan: "PC Game Pass", category: "ゲーム", cycle: "monthly", price: 1300, color: "#107c10", mark: "X", manageUrl: "https://account.microsoft.com/services" },

  // 本・雑誌
  { key: "kindle-unlimited", service: "Kindle Unlimited", category: "本・雑誌", cycle: "monthly", price: 980, color: "#232f3e", mark: "K", manageUrl: "https://www.amazon.co.jp/kindle-dbs/ku/ku-central" },
  { key: "audible", service: "Audible", plan: "聴き放題", category: "本・雑誌", cycle: "monthly", price: 1500, color: "#f8991d", mark: "A", manageUrl: "https://www.audible.co.jp/account/overview" },
  { key: "rakuten-magazine", service: "楽天マガジン", plan: "月額プラン", category: "本・雑誌", cycle: "monthly", price: 597, color: "#bf0000", mark: "楽", manageUrl: "https://magazine.rakuten.co.jp/" },
  { key: "rakuten-magazine-yearly", service: "楽天マガジン", plan: "年額プラン", category: "本・雑誌", cycle: "yearly", price: 5980, color: "#bf0000", mark: "楽", manageUrl: "https://magazine.rakuten.co.jp/" },
  { key: "d-magazine", service: "dマガジン", category: "本・雑誌", cycle: "monthly", price: 580, color: "#cc0033", mark: "d", manageUrl: "https://magazine.dmkt-sp.jp/" },

  // その他
  { key: "lyp-premium", service: "LYPプレミアム", plan: "スタンダード", category: "買い物", cycle: "monthly", price: 508, color: "#ff0033", mark: "Y", manageUrl: "https://premium.yahoo.co.jp/" },
];

/** 名前だけで登録されたもの(サブスク管理を作る前の固定費など)を、サービスに当てるための別名。 */
const SERVICE_ALIASES: Record<string, string[]> = {
  Netflix: ["ネットフリックス", "ネトフリ"],
  Amazonプライム: ["Amazon Prime", "アマゾンプライム", "Prime"],
  ディズニープラス: ["Disney+", "Disney", "ディズニー+"],
  "U-NEXT": ["UNEXT", "ユーネクスト"],
  Hulu: ["フールー"],
  Spotify: ["スポティファイ"],
  "YouTube Premium": ["YouTube", "ユーチューブ"],
  ChatGPT: ["チャットGPT", "OpenAI"],
  "iCloud+": ["iCloud"],
  "Nintendo Switch Online": ["ニンテンドースイッチオンライン", "Switch Online"],
  "Kindle Unlimited": ["キンドル"],
};

/** サービス名でまとめる(プランが複数あるものは、選んだあとプランを選ばせる)。 */
export function groupTemplatesByService(templates: SubscriptionTemplate[] = SUBSCRIPTION_TEMPLATES) {
  const groups = new Map<string, SubscriptionTemplate[]>();
  for (const template of templates) {
    const list = groups.get(template.service) ?? [];
    list.push(template);
    groups.set(template.service, list);
  }
  return [...groups.entries()].map(([service, plans]) => ({ service, plans }));
}

export function templateByKey(key: string | null | undefined): SubscriptionTemplate | undefined {
  if (!key) return undefined;
  return SUBSCRIPTION_TEMPLATES.find((template) => template.key === key);
}

/** 名前だけで登録されたもの(サブスク管理を作る前の固定費など)も、サービス名か別名が
 * 合えばその色で出す。長い名前から先に比べる(「Apple Music」を「Apple」で取らない)。 */
function templateByTitle(title: string): SubscriptionTemplate | undefined {
  const normalized = normalizeName(title);
  if (!normalized) return undefined;
  const names: [string, string][] = [];
  for (const service of new Set(SUBSCRIPTION_TEMPLATES.map((t) => t.service))) {
    names.push([normalizeName(service), service]);
    for (const alias of SERVICE_ALIASES[service] ?? []) names.push([normalizeName(alias), service]);
  }
  names.sort((a, b) => b[0].length - a[0].length);
  const match = names.find(([name]) => normalized.startsWith(name));
  return match ? SUBSCRIPTION_TEMPLATES.find((t) => t.service === match[1]) : undefined;
}

function normalizeName(name: string): string {
  return name.replace(/\s+/g, "").toLowerCase();
}

export interface ServiceLook {
  color: string;
  ink: string;
  mark: string;
  /** お手本に当たったか(当たらなければ青緑の薄い面に頭文字)。 */
  branded: boolean;
}

/** 明るい色の上は黒い文字、暗い色の上は白い文字。 */
function inkFor(hex: string): string {
  const value = hex.replace("#", "");
  if (value.length !== 6) return "#ffffff";
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return luminance > 0.45 ? "#121416" : "#ffffff";
}

function firstMark(title: string): string {
  const first = [...title.trim()][0] ?? "?";
  return first.toUpperCase();
}

/** そのサブスクのお手本。選んで登録したものは serviceKey から、名前だけのものは名前から。 */
export function templateFor(title: string, serviceKey?: string | null): SubscriptionTemplate | undefined {
  return templateByKey(serviceKey) ?? templateByTitle(title);
}

export function serviceLook(title: string, serviceKey?: string | null): ServiceLook {
  const template = templateFor(title, serviceKey);
  if (!template) return { color: "", ink: "", mark: firstMark(title), branded: false };
  return {
    color: template.color,
    ink: inkFor(template.color),
    mark: template.mark || firstMark(template.service),
    branded: true,
  };
}
