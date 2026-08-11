# Gmail連携 AI返信機能 — 要件定義書

## 本ドキュメントの位置づけ
このセッションでは**要件定義のみ**を成果物とする。コードの実装・ファイル作成・依存パッケージの追加は一切行わない。実装は別途、コンソール(ターミナル版Claude Code)で着手する。

## 背景・目的
LIFE HUB(個人ライフ管理PWA、React+TypeScript+Vite+Tailwind+Dexie/IndexedDB、ローカル完結・バックエンドなし)に、Gmail受信メールに対してAIが返信案を作成し、ユーザーがLIFE HUB内でレビュー・編集・送信まで完結できる機能を追加する。目的は「毎回自分で返信文を考える手間を減らしつつ、誤送信リスクは人の最終確認で防ぐ」こと。

## スコープ
- 対象メール: 受信トレイ全部
- AI: Claude (Anthropic API)
- 認証: Googleに一度ログインすれば、以降ずっとログイン状態を維持(リフレッシュトークン方式)
- 完結性: レビュー・編集・送信まですべてLIFE HUB内で行う(Gmail本体の下書きフォルダは使わない)

## 機能要件

1. **Gmail連携(初回のみ)**
   - Google OAuth2でログイン、スコープは `gmail.readonly`(受信閲覧)+ `gmail.send`(送信)の最小限
   - 一度ログインすればリフレッシュトークンで自動的にログイン状態を維持(毎回の再ログイン不要)
   - Settings画面に「Gmail連携」の接続/解除UIを追加

2. **受信トレイ同期**
   - LIFE HUBのGmail画面を開いたタイミングでオンデマンド取得(リアルタイムPush通知は今回のスコープ外)
   - 取得したメールのメタ情報(差出人/件名/本文抜粋/受信日時)をローカルDB(Dexie)にキャッシュ

3. **AI下書き生成**
   - メール一覧から個別に「AI下書きを作成」、または複数選択して一括生成
   - **自動で全件に無条件生成はしない**(APIコストと的外れな返信の防止のため、明示的なトリガーが必要という設計を推奨。§未決事項1で最終確認)
   - 生成はNetlify Functions経由でAnthropic APIを呼び出す(APIキーをブラウザに露出させないため)

4. **レビュー・編集・送信**
   - 生成された下書きをLIFE HUB内のSheet UIで表示・自由に編集可能
   - 送信は必ず人がボタンを押す操作が必要(v1では完全自動送信は行わない)
   - 送信後は「送信済み」として一覧上でステータス表示

## 非機能要件
- **秘密情報の扱い**: Anthropic APIキー、Google OAuthクライアントシークレットはNetlify Functionsの環境変数に置き、ブラウザ側には一切渡さない(このリポジトリ初のサーバーレス関数導入になる)
- **リフレッシュトークンの保存**: ブラウザのIndexedDBに保存し、既存の「ローカル完結」方針を踏襲する。ただし「この端末・ブラウザにアクセスできる人は誰でもGmailを操作できてしまう」というトレードオフがあることを明記し、ユーザーに承知の上で進めてもらう(GitHubリポジトリ公開時と同様、リスク開示した上での判断とする)
- 既存のDBスキーマ・計算ロジック・他機能には影響を与えない(新規テーブル追加のみ、既存テーブルは変更しない)

## 技術方式(アーキテクチャ)
- **OAuth方式**: Authorization Code flow + `access_type=offline` + `prompt=consent` でリフレッシュトークンを取得。トークン交換はNetlify Functionが担当(クライアントシークレットをサーバー側に隔離)
- **Netlify Functions(新規、`netlify/functions/`配下)**:
  - トークン交換・更新用エンドポイント(Google OAuthトークンエンドポイントのプロキシ)
  - AI下書き生成用エンドポイント(Anthropic APIのプロキシ)
- **Gmail API呼び出し**: ブラウザから直接fetchでアクセストークンを付与して呼ぶ(`users.messages.list`/`get`/`send`)。`googleapis`のような重いSDKは追加せず、既存コードベースの「軽量な依存のみ」という方針(date-fns/dexieのみ)を踏襲し、fetchベースの薄いラッパーを`src/lib/`に書く
- **AI呼び出し**: Netlify Function内で`@anthropic-ai/sdk`または素のfetchでAnthropic APIを呼ぶ

## データ設計(Dexie、追加のみ・既存テーブル非破壊)
- 既存の`src/db/schema.ts`はバージョンごとの追記型マイグレーション(v4でTrips機能一式を追加した例が直近の前例)。今回も同じ形で新バージョンとして追加する
- 新規テーブル案:
  - 受信メールのキャッシュ+下書き状態(Gmail message ID, スレッドID, 差出人, 件名, 抜粋, 受信日時, 下書き本文, ステータス: 未処理/生成中/下書きあり/編集済み/送信済み/スキップ)
  - Gmail連携設定(接続状態、リフレッシュトークン)— 既存の`Settings`テーブル拡張、または新規シングルトンテーブル
- 型定義は`src/types/index.ts`の既存の書き方(フラットなinterface、必要な箇所のみJSDoc)に合わせる

## 機能と担当の定義
LIFE HUB内のすべての機能に「担当」というメタデータを付与し、各機能がどの部門に属するかを明確にする。以下の5つの担当を定義(固定):

| 担当名 | 対応機能 | 説明 |
|--------|--------|------|
| **お金管理担当** | Money(家計・給与・固定費・PayPay取込) | 収支・予算・支払い管理 |
| **予定・タスク管理担当** | Schedule(カレンダー・イベント・タスク) | 予定・タスク・スケジュール管理 |
| **メモ・リスト担当** | Notes(メモ・チェックリスト・買い物リスト) | メモ・リスト・買い物管理 |
| **旅行計画担当** | Trips(旅行・日程・経費・パッキング) | 旅行・出張・日程・経費管理 |
| **Gmail AI自動返信担当** | Gmail連携(新規) | メール受信・AI返信案作成・返信管理 |

実装方針:
- `src/lib/`に`departments.ts`(または`features.ts`的な名称)を作成し、定義をConstants化(`type Department`, `DEPARTMENT_CONFIG`など)
- 各ページ/コンポーネント内で参照可能にする
- 今回の要件定義書作成時点では「定義を明確にする」ことが目的で、UIでの表示方法(トップカードのどこに表示するか、Settings内でどう表示するか、など)は次セッション(実装時)の判断に任せる

## UI設計方針
- 参考にする既存実装: `src/components/expense/GenericCsvImport.tsx`の3ステップSheetフロー(アップロード→プレビュー→結果)が、「外部データ→一覧プレビュー→確定」という構造の最も近いテンプレート
- 再利用する既存コンポーネント: `Sheet`(フォーカストラップ付きボトムシート)、`ListRow`、`Tabs`、`EmptyState`、`ListSkeleton`+`useDelayedFlag`、`useToast()`
- 画面配置: TOPの4カードグリッドは4枚固定でレイアウト設計されているため今回は追加しない。まずはSettings経由のサブ画面として実装し、使ってみてから独立カード昇格を検討する
- Settings内の「Gmail連携」行は、既存の「以前のデータ」への`Card interactive`リンクと同じ導線パターンを踏襲

## 制約・前提(ユーザー側で必要な準備)
- Google Cloud Consoleでのプロジェクト作成・Gmail API有効化・OAuth同意画面設定・クライアントID/シークレット発行(実装フェーズの最初のステップ)
- Anthropic Consoleでのプロジェクト作成・APIキー発行、Netlify環境変数への設定

## 未決事項(実装着手前に確認推奨)
1. AI下書き生成のトリガー方式: 個別手動 / 複数選択一括 / 条件付き自動、のどれを採用するか(上記は「個別・一括手動」を推奨案として記載)
2. 「受信トレイ全部」の同期範囲: 全期間を遡るか、直近N件/N日分に絞るか(初回同期のAPI呼び出し量・表示パフォーマンスに影響)
3. 返信送信後、元メールの既読化やアーカイブなど後処理を行うか
4. 複数Gmailアカウントへの対応が必要か、単一アカウント前提でよいか

## 実装タスク(Gmail AI自動返信担当)
新規機能実装(本要件定義書の主体):
- [ ] `src/db/schema.ts` — 新バージョン(v5など)追加、受信メール+下書き用テーブル定義
- [ ] `src/types/index.ts` — `SyncedEmail`, `DraftReply`, `GmailAccount` 型追加
- [ ] `src/lib/departments.ts` — 「Gmail AI自動返信担当」定義を追加
- [ ] `src/lib/gmail.ts` (新規) — Gmail API fetch ラッパー(`users.messages.list`/`get`/`send`)
- [ ] `netlify/functions/tokenExchange.ts` (新規) — Google OAuth トークン交換エンドポイント
- [ ] `netlify/functions/generateDraft.ts` (新規) — AI下書き生成エンドポイント(Anthropic API呼び出し)
- [ ] `src/components/gmail/GmailInbox.tsx` (新規) — メール一覧 UI
- [ ] `src/components/gmail/DraftReview.tsx` (新規) — 下書きレビュー・編集 Sheet UI
- [ ] `src/pages/GmailPage.tsx` (新規) — Gmail機能トップ画面
- [ ] `src/pages/SettingsPage.tsx` — 「Gmail連携」セクション追加(接続/解除UI)
- [ ] `.env.example` (新規) — Netlify 環境変数テンプレート(例: GOOGLE_CLIENT_ID, ANTHROPIC_API_KEY など)
- [ ] 型チェック・テスト・Playwright 検証

## 次のステップ
このドキュメントの内容で合意が取れたら、実装はコンソール(ターミナル版Claude Code)側で着手する。このセッションではファイル作成・コード実装は行わない。
