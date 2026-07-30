# SSHの公開鍵認証限定

Linuxへの公開鍵ログインを別terminalで確認してから、パスワード認証を無効化する。公開鍵ログインを実測する前に適用するとlockoutするため、順序を変えない。

## 1. 現在の接続を保持する

設定の検証が完了するまで、現在のSSH sessionを閉じない。別terminalを開き、公開鍵だけで接続できることを確認する。

```sh
ssh -o BatchMode=yes -o PreferredAuthentications=publickey <linux-host> true
```

exit code `0`の場合だけ次へ進む。

## 2. 設定をinstallする

Linux上のcloneで実行する。

```sh
cd "$HOME/GitHub_Projects/mf-dashboard"
TARGET=/etc/ssh/sshd_config.d/00-mf-dashboard-hardening.conf
PREVIOUS=/etc/ssh/sshd_config.d/00-mf-dashboard-hardening.conf.previous

if sudo test -e "$PREVIOUS"; then
  echo "Previous settings already exist; stop and inspect them." >&2
  exit 1
fi
if sudo test -e "$TARGET"; then
  sudo cp --preserve=mode,ownership,timestamps -- "$TARGET" "$PREVIOUS"
fi
sudo install -o root -g root -m 0644 \
  ops/ssh/00-mf-dashboard-hardening.conf \
  "$TARGET"
sudo sshd -t

CLIENT_ADDR="$(printf '%s\n' "$SSH_CONNECTION" | awk '{print $1}')"
SERVER_ADDR="$(printf '%s\n' "$SSH_CONNECTION" | awk '{print $3}')"
SERVER_PORT="$(printf '%s\n' "$SSH_CONNECTION" | awk '{print $4}')"
EFFECTIVE="$(sudo sshd -T -C \
  "user=$USER,host=$(hostname),addr=$CLIENT_ADDR,laddr=$SERVER_ADDR,lport=$SERVER_PORT")"
printf '%s\n' "$EFFECTIVE" | grep -qx 'authenticationmethods publickey'
printf '%s\n' "$EFFECTIVE" | grep -qx 'pubkeyauthentication yes'
printf '%s\n' "$EFFECTIVE" | grep -qx 'passwordauthentication no'
printf '%s\n' "$EFFECTIVE" | grep -qx 'kbdinteractiveauthentication no'
printf '%s\n' "$EFFECTIVE" | grep -qx 'permitrootlogin no'

sudo systemctl reload ssh
```

既存の同名設定がある場合は`.previous`へroot権限のまま退避する。退避済みファイルがすでにある場合は上書きせず停止する。

`sshd -t`または5つの有効値確認が失敗した場合はreloadしない。`sshd -T -C`は現在の接続条件を使い、main設定、include順、`Match`を反映した最終値を確認する。ファイル名を`00-`で始めるのは、OpenSSHが各keywordで最初に取得した値を使うため、後続のvendor設定より前にhardeningを適用するためである。

## 3. 別terminalで再接続を検証する

現在のsessionを残したまま、別terminalからもう一度公開鍵接続する。

```sh
ssh -o BatchMode=yes -o PreferredAuthentications=publickey <linux-host> true
```

接続できた後、パスワードだけの認証が拒否されることを確認する。

```sh
ssh -o BatchMode=yes \
  -o PubkeyAuthentication=no \
  -o PreferredAuthentications=password,keyboard-interactive \
  <linux-host> true
```

後者が非ゼロで終了し、接続先sshdから`Permission denied (publickey).`と返れば成功。DNS失敗、timeout、host key不一致など、認証へ到達していない失敗は合格にしない。パスワード自体は入力・表示しない。

## 4. 問題がある場合のrollback

閉じずに残した既存sessionで、追加した1ファイルだけを削除して再検証する。

```sh
TARGET=/etc/ssh/sshd_config.d/00-mf-dashboard-hardening.conf
PREVIOUS=/etc/ssh/sshd_config.d/00-mf-dashboard-hardening.conf.previous
if sudo test -e "$PREVIOUS"; then
  sudo mv -- "$PREVIOUS" "$TARGET"
else
  sudo rm -- "$TARGET"
fi
sudo sshd -t
sudo systemctl reload ssh
```

広い設定ファイルの置換や、`~/.ssh/authorized_keys`の削除は行わない。
