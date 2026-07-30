# バックアップと監視

本番DBとプロファイル設定を暗号化して保存し、crawlerの失敗や停止を検知する。バックアップの暗号鍵、Webhook URL、DB、プロファイル設定、生成物はGitへ追加しない。

## 1. 暗号鍵をLinux以外で作成する

復号用秘密鍵はLinuxサーバーへ置かず、復元を行う別端末で保護する。次の例は、個人情報を含まない専用GnuPG鍵を対話形式で作成する。

```sh
gpg --quick-generate-key "mf-dashboard backup <backup@example.com>" rsa3072 encr 2y
gpg --armor --output backup-public-key.asc --export "mf-dashboard backup <backup@example.com>"
gpg --armor --output backup-private-key.asc --export-secret-keys "mf-dashboard backup <backup@example.com>"
```

秘密鍵には強いパスフレーズを設定する。`backup-private-key.asc`はリポジトリ外の暗号化ディスクなどで保管し、Linuxへ転送しない。公開鍵だけをLinuxの次の場所へ配置する。

```sh
install -d -m 700 "$HOME/GitHub_Projects/mf-dashboard/secrets"
install -m 600 backup-public-key.asc \
  "$HOME/GitHub_Projects/mf-dashboard/secrets/backup-public-key.asc"
```

## 2. バックアップを実行する

`backup.py`は最新crawler runが`success`であることを前後に確認し、実行中・失敗状態ではバックアップしない。PythonのSQLite backup APIを使うため、稼働中DBの単純コピーも行わない。バックアップDBへ`PRAGMA integrity_check`を実行し、DB、プロファイル設定、Compose設定、匿名メタデータを1つのtarへまとめてからGnuPG公開鍵で暗号化する。暗号化が成功するまで最終ファイルへ切り替えず、平文の一時ファイルは終了時に削除する。

```sh
cd "$HOME/GitHub_Projects/mf-dashboard"
python3 scripts/ops/backup.py
```

出力先はGit管理対象外の`backups/`で、modeは`700`、暗号化ファイルは`600`となる。既定では14日を超えた日次バックアップを、暗号化成功後に削除する。

systemd user serviceでは平文workspaceを`XDG_RUNTIME_DIR`配下のmode `700`一時ディレクトリへ置く。通常終了と例外では自動削除するが、`SIGKILL`や電源断ではプロセスによる削除を保証できない。Linux起動後に`mf-dashboard-backup-*`がruntime directoryへ残っていないことを確認し、復元端末側もディスク暗号化を有効にする。

## 3. 復元を別端末で検証する

暗号化バックアップを復元端末へコピーし、リポジトリ外に保管した秘密鍵で検証する。

```sh
python3 scripts/ops/restore_check.py \
  /path/to/mf-dashboard-YYYYMMDD-HHMMSS.tar.gpg \
  --identity /protected/path/backup-private-key.asc
```

この処理は専用一時ディレクトリだけへ展開する。4ファイルのallowlist、重複、パストラバーサル、個別・合計サイズを検証し、`PRAGMA integrity_check`と`transactions`、`daily_snapshots`の読み取りに成功した場合だけ合格する。一時復元物は終了時に削除する。

最低1つの暗号化バックアップと復号用秘密鍵をLinux以外に保管する。ローカルバックアップだけでは、Linux本体の故障・盗難・暗号化被害に対応できない。

## 4. crawlerとサービスを監視する

`healthcheck.py`は次を検証し、1つでも不合格なら非ゼロで終了する。

- `web`と`crawler`がDocker Compose上で`running`
- 本番SQLite DBの`PRAGMA quick_check`
- crawlerの最新結果が成功し、30時間以内
- 実行中状態が3時間を超えていない

```sh
python3 scripts/ops/healthcheck.py
```

エラー文には口座名、金額、Secret ID、URLなどを含めない。

## 5. systemd user timerを有効化する

リポジトリを`$HOME/GitHub_Projects/mf-dashboard`へcloneしたLinuxで実行する。

```sh
systemctl --user link "$HOME/GitHub_Projects/mf-dashboard/ops/systemd/"*.service
systemctl --user link "$HOME/GitHub_Projects/mf-dashboard/ops/systemd/"*.timer
systemctl --user daemon-reload
systemctl --user enable --now mf-dashboard-healthcheck.timer mf-dashboard-backup.timer
systemctl --user list-timers 'mf-dashboard-*'
```

healthcheckは毎時実行し、06:30のcrawlerが3時間を超えて停止した場合は10時台までに検出する。バックアップはcrawler完了後の10:30（JST）に実行する。timerは`Persistent=true`のため、停止中に過ぎた実行を次の起動後に補う。user managerはログアウト後も動作するよう、Linux側でlingerが有効であることを確認する。

```sh
loginctl show-user "$USER" -p Linger
```

## 6. 失敗通知を任意で有効化する

Discord WebhookまたはSlack Incoming WebhookのURLを、リポジトリ外のowner-read-onlyファイルへ1行で保存する。値は表示・ログ出力しない。

```sh
install -d -m 700 "$HOME/.config/mf-dashboard"
umask 077
# URLを画面へ表示しない方法で次のファイルへ書き込む
chmod 600 "$HOME/.config/mf-dashboard/alert-webhook"
```

ファイルが存在する場合、backupまたはhealthcheck unitの失敗時に、失敗したunit名だけを通知する。通知処理はowner-only権限を強制し、HTTPSのDiscord/Slack公式Webhook hostだけを許可してredirectを拒否する。ファイルがなければ外部通知unitは安全にスキップされ、失敗自体はsystemd journalに残る。

```sh
systemctl --user status mf-dashboard-healthcheck.service
journalctl --user -u 'mf-dashboard-*' --since today
```

## 7. 運用確認

- 毎日: crawler結果、healthcheck、暗号化バックアップの新規作成を確認
- 毎週: バックアップ件数、ディスク容量、認証失敗、Tailscale端末を確認
- 毎月: 別端末で最新バックアップを復元し、forkとupstreamの差分を確認
- 鍵期限前: 新しい専用鍵を発行し、公開鍵を入れ替えた後にバックアップと復元を再検証
