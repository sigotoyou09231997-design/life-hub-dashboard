-- LIFE HUB: アプリの新バージョン公開をロック画面通知(Web Push)するための状態テーブル。
-- 003_gmail_push_notifications.sqlと同じ方針(汎用同期エンジンsrc/lib/sync.tsの対象外、
-- server_updated_atトリガー/Realtime publicationなし、クライアントからは一切触らずservice_role
-- キーでのみ読み書きする専用テーブル) — netlify/functions/checkAppUpdate.tsが2分おきに
-- 本番サイト自身の /version.json(vite.config.tsのwriteVersionFileプラグインがデプロイごとに
-- 生成)と最後に見た値を突き合わせ、変わっていれば push_subscriptions の全端末へ通知する。
--
-- 1行だけのシングルトンテーブル(id は常に 'singleton' 固定)。

create table public.app_version_state (
  id text primary key,
  version text not null,
  updated_at timestamptz not null default now()
);
alter table public.app_version_state enable row level security;
-- クライアントは一切アクセスしないため、許可ポリシーを追加しない(RLS有効かつポリシーなし
-- = service_roleキー以外からのアクセスはデフォルトで拒否される)。
