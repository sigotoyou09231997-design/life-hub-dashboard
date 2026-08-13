# マルチアカウント データ分離 — 設計メモ

## 経緯

LIFE HUBデザイン改修（2026-08-13）で新設した`/account`画面は「アカウント＝Supabaseセッション」という将来のデータ分離の基準点になる。ユーザーからは「アカウントごとに見れるアプリの中身を変えたい」という要望があり、「できる範囲で今回始めたい」との回答を得た。ただし影響範囲が全ページ・同期エンジンに及ぶ大改修になるため、**このパスでは基盤（Account画面の実装）のみ行い、実際のクエリ絞り込み（表示データの出し分け）は次フェーズに切り出した**。このメモはその次フェーズのための設計方針を記録する。

## 現状（2026-08-13時点）

- Dexie（端末内DB）は端末ごとに単一のデータセット。Supabaseログインは「クロスデバイス同期のON/OFF」としてのみ機能しており、ユーザーごとにローカルの表示データを分離する仕組みは無い。
- 同期対象14テーブル（`transactions`/`fixedCosts`/`calendarEvents`/`tasks`/`notes`/`goals`/`habits`/`habitLogs`/`salaries`/`trips`/`tripSchedule`/`tripExpenses`/`tripPackingItems`/`paypayTransactions`）は既に`userId`フィールドを持ち、Supabase側の行は`user_id`で分離されている（`src/lib/sync.ts`）。
- 一方、次のテーブルは`userId`を持たず、ローカル限定：`settings`（端末ごとに1行、singleton）、`diaryEntries`（`photos`がBlob[]でJSON化できない）、`gmailAccounts`/`syncedEmails`/`draftReplies`/`blockedSenders`（Gmail連携情報）。

## 次フェーズでやること（未着手）

1. **分離キーの確定**：既存の`userId`（＝Supabaseの`session.user.id`）をそのままアカウント分離キーとして使う。未ログイン時は`null`（「この端末のローカルデータ」バケット）として扱う。
2. **ローカル限定テーブルへの`userId`追加**：`settings`/`diaryEntries`/`gmailAccounts`/`syncedEmails`/`draftReplies`/`blockedSenders`にスキーマバージョンを上げて`userId`を追加する。`settings`は特に「端末ごとに1行」から「(端末, アカウント)ごとに1行」への設計変更が必要になる。
3. **既存データの帰属**：スキーマ移行時点で既に存在するローカルデータ（`userId`が未設定）をどう扱うかを決める。有力案は「初回ログイン時、その端末の未帰属データをそのアカウントの所有物とみなす」（一人1台で使ってきたこれまでの使い方を壊さない）。データを複数アカウントで共有してきたケースがあると齟齬が出るため、実施前にユーザーへ確認する。
4. **クエリ層の変更**：`useLiveQuery`で全件取得している約40箇所（TopPage/SchedulePage/ExpensePage/NotePage/TripsPage/GmailPage等）に、現在のアカウントID（`null`可）でのフィルタを追加する。ここが最も手数の多い作業になる。
5. **アカウント切り替えUXの決定**：同一端末で複数Googleアカウントを行き来する場合の挙動（ログアウト→別アカウントでログイン、で表示が切り替わるだけで良いか、端末内に複数アカウント分のデータを同時に保持するか）を先に決める。

## このパスで実装したこと（済み）

- `/account`画面（`src/pages/AccountPage.tsx`）：Supabaseセッションの実データ（プロフィール画像・表示名・メール）を表示し、ログイン/ログアウト・同期ボタンをここに集約。**表示するデータそのものはアカウントに関わらず全端末データのまま**（分離は未実装）。
