# ChatGPT から LIFE HUB にログインして、旅行・日程を直接作る(tabiori と同じ形)

友人が見た tabiori(ChatGPT のプラグイン一覧にある公開のプラグイン)と同じ体験を、LIFE HUB で作るための仕組みの控え。
個人用の「送信コード版」([chatgpt-plugin.md](chatgpt-plugin.md))とは別のもので、同じ MCP サーバー(`/api/mcp`)に同居している。

## 仕組み

```
ChatGPT ──(1) 接続したい──▶ Supabase の OAuth サーバー ──(2) 同意画面へ──▶ LIFE HUB /oauth/consent
   ▲                                                                              │ 本人が「許可する」
   └────────(4) アクセストークン(JWT)◀──(3) 認可コード◀──────────────────────────┘
ChatGPT ──(5) ツールを呼ぶ + トークン──▶ /api/mcp ──(6) その人の権限で──▶ Supabase(trips・trip_schedule)
                                                                              │ 同期が自動で拾う
                                                                              ▼ アプリの旅行に出る
```

- ログイン・同意の受け渡し・トークンの発行は **Supabase Auth の OAuth 2.1 サーバー**(動的クライアント登録 DCR 対応)。
- `/api/mcp` は、渡されたトークンを **JWKS(ES256)で検証**し(署名・期限・発行元・`client_id` つき=OAuth 由来)、
  **その人のトークンのまま** PostgREST を呼ぶ。強い鍵は持たず、行レベルの制限がそのまま効く。
- ChatGPT がログインの場所を知る道: `/.well-known/oauth-protected-resource`(`api/oauthProtectedResource.ts`)と、
  ツールが未ログインで返す `_meta["mcp/www_authenticate"]`。

## ツール(直接書く系は、足すだけ)

| ツール | できること |
|---|---|
| `list_trips` | 旅行の一覧(50件) |
| `create_trip` | 旅行を作る(同じ名前・期間は二重にならない。消した旅行と同じなら、別の名前を案内) |
| `add_schedule_items` | 日程を**足す**(旅行の期間の外は入れない・1回200件まで・金額は無し) |
| `get_trip_schedule` | 日程を読む(500件まで) |

守り: 削除しない/既存の行を上書きしない(`ON CONFLICT DO NOTHING`)。予定のIDは(旅行・日付・時刻・題名)から決まる値で、
二重送信で増えず、本人が消した予定は戻らない。`send_trip_plan`(送信コード版)は、これまでどおり認証なしで使える。

## 安全の考え方(重要)

Supabase のトークンは、そのままだと**その人の権限をまるごと**持つ。MCP サーバーが旅行のツールしか呼ばなくても、
トークン自体は日記・家計・Gmail の接続情報まで読み書きできてしまう。そこで:

1. **`supabase/sql/028_oauth_client_limits.sql`**(DB の側): OAuth のトークン(`client_id` が付く)は、旅行・日程以外の
   RLS がある全部の表で何もできず、旅行・日程も読む・足すだけ。アプリ自身のログインには `client_id` が無いので影響なし。
   本物の Postgres(PGlite)で `supabase/__tests__/migrations.test.ts` が確かめている。
2. **同意画面**(`/oauth/consent`): 接続するアカウント・戻り先のドメイン・できることを出す。戻り先が chatgpt.com / openai.com
   でなければ警告を出して許可できない(クライアントは名前を自由に付けて登録できるため)。
3. **接続を外す**: アカウント画面の「接続しているアプリ」(`auth.oauth.listGrants / revokeGrant`)。外すとトークンも無効。

## 設定(済み・やり直す時)

Supabase ダッシュボード → Authentication → OAuth Server:
- Enable the Supabase OAuth Server: **オン**
- Authorization Path: `/oauth/consent`(Site URL の末尾の `/` と重なって `//oauth/consent` になるが、Vercel が `/` 1つに転送し、アプリも両方受ける)
- Allow Dynamic OAuth Apps: **オン**(ChatGPT が自分で登録できるように)

**028 の SQL は、自分以外の誰かが接続する前に必ず流す**(流す前は、接続したトークンが旅行以外にも届く)。

## ChatGPT から接続する(自分で試す・友人が使う)

ChatGPT →「プラグイン」→「追加」→「カスタム MCP サーバーを作成」:
- 名前: LIFE HUB 旅行プランナー / URL: `https://life-hub-dashboard.vercel.app/api/mcp`
- 認証: **OAuth**(または、送信コード版も同じ接続で使うなら「OAuth または認証なし」)
- 作成して「接続する」→ LIFE HUB の同意画面が開く → 許可 → ChatGPT に戻る。

個人(Plus)でもこの手順で自分用に使える。**誰でも一覧から入れられる形(tabiori のように)にするには、公開ディレクトリへの提出が要る。**

## 公開ディレクトリへ提出する時に要るもの(未着手)

OpenAI の提出手順(developers.openai.com/plugins/deploy/submission)の要件:
- 組織(または個人)の本人確認。提出できるのは組織のオーナー、または Apps Management Write の権限を持つ人。
- プライバシーポリシー・サポート・利用規約の URL(`public/chatgpt/privacy.html` は**送信コード版の説明**のまま。
  旅行・日程の読み書きとアカウントの接続に合わせて書き直す必要がある)。
- MCP サーバーのドメイン確認(指定の場所にトークンを置く)。
- 正例5件・負例3件のテストケース、動作を見せる動画。
- 審査(自動チェック → MCP 接続の確認 → 人の審査 → 承認後に公開を選ぶ)。
審査にかかる日数は不明。**年末の旅行に間に合う保証は無い**ので、それまでは、友人にカスタム接続で使ってもらう。

## 直す時の注意

- `api/mcp.ts` と `api/oauthProtectedResource.ts` を直したら、`node scripts/gen-netlify-functions.mjs` で Netlify 版を作り直す
  (手で直すと、`netlify/__tests__/mcp.test.ts` が落ちる)。
- 相対 import には `.js` を付ける(拡張子が無いと、Vercel 上で関数ごと落ちる)。
- RLS のある表を足したら、その SQL に `oauth clients blocked` の制限も足す(足し忘れは `migrations.test.ts` が止める)。
- 公開URLは既定で `https://life-hub-dashboard.vercel.app`。独自ドメインにしたら、環境変数 `PUBLIC_BASE_URL` を設定する
  (OAuth の `resource` がずれると、ChatGPT のログインが失敗する)。
