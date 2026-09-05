# ここは、ワークスペースの `scripts/` へ移す前の置き場所

依頼「[裏実行で承認が下りない件_原因と対応.md](../requests/裏実行で承認が下りない件_原因と対応.md)」で
頼まれた `cowork-commit-state.sh` を作ったが、**裏（無人）実行からは `scripts/` に
ファイルを作れなかった**ので、いったんここに置いてある。

## やってほしいこと（1回だけ、手で）

### 1. スクリプトを `scripts/` へ移す

```
mv "$HOME/Desktop/WEBアプリ用/todoアプリ/docs/cowork/cowork-commit-state.sh" \
   "$HOME/Desktop/WEBアプリ用/scripts/cowork-commit-state.sh"
chmod +x "$HOME/Desktop/WEBアプリ用/scripts/cowork-commit-state.sh"
```

移したあと、この `docs/cowork/` は README ごと消してよい。
（`scripts/__tests__/coworkFixture.ts` の `COMMIT_STATE` が、`scripts/` にあれば
そちらを、無ければここを見る作りにしてあるので、移してもテストは通る。
移し終わったら、そのフォールバックの `?:` も消してよい。）

### 2. 許可リストに3行足す

`todoアプリ/.claude/settings.json` の `permissions.allow` は、**裏実行からは書き換えられなかった**
（`.claude/` も書き込みが許されていない）。最後の `"Bash(bash scripts/lifehub-shots.sh:*)"` の
うしろに、カンマを足してこの3行を貼ってほしい。

```json
      "Bash(bash ../scripts/cowork-commit-state.sh:*)",
      "Bash(bash \"/Users/apple/Desktop/WEBアプリ用/scripts/cowork-commit-state.sh\":*)",
      "Bash(bash scripts/cowork-commit-state.sh:*)"
```

`lifehub-shots.sh` と同じく、呼ばれ方が3通りありうるので3行とも足しておく形にした。

### 3. `.claude/skills/cowork-check/SKILL.md` の「3. 実装する」の下に貼る

これも `.claude/` なので裏実行からは書けなかった。呼び方の決まりを毎回思い出せるように、
手順書の側にも残しておきたい。

````markdown
#### `../scripts/` のスクリプトの呼び方（2026-09-05 追加）

`cd` もパイプも付けず、**単独で**呼ぶこと。`cd X && bash Y | tail -20` の形は、
パス解決を迂回する攻撃よけの安全チェックに当たるので、許可リストをいくら足しても
素通りせず、裏（無人）実行では毎回そこで止まる。

```
bash ../scripts/lifehub-shots.sh                      # ○
cd .. && bash scripts/lifehub-shots.sh | tail -20     # × 承認待ちで止まる
```

同じ理由で、ワークスペース側のリポジトリ（`.cowork/` の状態）を
`git -C "<ワークスペース>" add ...` の形で触るのも通らない。専用のスクリプトを使う。

```
bash ../scripts/cowork-commit-state.sh todoアプリ -m "やりかけを更新"
```

書き込みが許されているのは `todoアプリ` と `../.cowork/apps/todoアプリ` の2か所だけで、
`../scripts/` や `.claude/` にファイルを作ることはできない。そこへ足したいものがある時は、
`docs/cowork/` に置いて README に移し方を書き、保留として報告する。
````

## なぜ裏実行では置けなかったか

常駐は `claude -p "/cowork-check" --add-dir "<状態フォルダ>"` の形で起こしている
（`scripts/cowork-daemon.sh` の 351〜353行目、`scripts/cowork-run-visible.sh` の 109〜111行目）。
書き込みが許されるのは

- 作業場所 … `WEBアプリ用/todoアプリ`
- `--add-dir` で足した1つ … `WEBアプリ用/.cowork/apps/todoアプリ`

の2か所だけで、`WEBアプリ用/scripts` はどちらでもない。Write でも `cp` でも弾かれる
（`cp in '...' was blocked. For security, Claude Code may only copy files to/from the
allowed working directories for this session`）。許可リストでは変えられない。

**次から裏実行に `scripts/` を触らせたいなら**、上の2本の `claude` 起動に
`--add-dir "$ROOT/scripts"` を足す。ただしそれは「連携の仕組みそのものを
裏実行が書き換えられる」ことでもあるので、足すかどうかは人が決めること。

## 使い方（移したあと）

```
bash ../scripts/cowork-commit-state.sh todoアプリ                    # 3つの状態ファイルをコミット＋push
bash ../scripts/cowork-commit-state.sh todoアプリ -m "やりかけを更新"  # メッセージを指定
bash ../scripts/cowork-commit-state.sh todoアプリ --no-push          # コミットだけ
bash ../scripts/cowork-commit-state.sh --all                        # 全アプリぶんまとめて1コミット
```

- 触るのは `.cowork/apps/<アプリ名>/` の `state.tsv` / `waiting.txt` / `pending.md` だけ。
  `git add -A` はしないので、人の作業途中の変更も、無関係な staged も巻き込まない。
- 変更が無ければ空のコミットを作らずに終わる。
- push は追いかけ先（upstream）がある時だけ。失敗しても commit は手元に残り、
  `--force` や履歴の書き換えは一切しない。

動きは `scripts/__tests__/coworkCommitState.test.ts`（8本）で固めてある。

## もう1つの依頼（`lifehub-shots.sh`）について

こちらはコードの変更ではなく**呼び方の決まり**。`cd` もパイプも付けず、

```
bash ../scripts/lifehub-shots.sh
```

と単独で呼ぶ。`cd X && bash Y | tail -20` の形は許可リストを足しても素通りしない。
`.claude/skills/cowork-check/SKILL.md` にも同じことを書いてある。
