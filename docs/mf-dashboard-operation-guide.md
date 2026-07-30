# mf-dashboard 自宅Linux運用・複数Money Forwardアカウント対応 手順書

- 作成日: 2026-07-30
- 対象リポジトリ: `hiroppy/mf-dashboard`
- 想定環境: 自宅Linuxサーバー、Docker Compose
- 公開方式: Tailscale Serve（インターネット一般公開なし）
- シークレット管理: Bitwarden Secrets Manager Free
- データベース: SQLite
- 初期方針: AI機能・Slack/Discord通知は後回し

---

## 1. この手順書の目的

Money Forward MEから家計・資産データを定期取得し、自宅Linuxサーバー上のSQLiteへ長期保存し、本人の端末からだけダッシュボードを閲覧できる状態を作る。

最終的には、複数のMoney Forwardアカウントを1つのダッシュボードへ統合できるようにする。

### 最終構成

```text
Windows / Pixel
    │
    │ Tailscale
    ▼
自宅Linuxサーバー
├── Tailscale Serve
│       └── HTTPSでwebへ転送
├── mf-dashboard web
│       └── SQLiteを読み取り、全体・プロファイル別に表示
├── mf-dashboard crawler
│       ├── profile: primary
│       ├── profile: secondary
│       └── Playwrightで順番に取得
├── Bitwarden Secrets Manager
│       └── Money Forward ID / password / TOTP secret
└── data/
        ├── moneyforward.db
        └── auth/
            ├── primary.json
            └── secondary.json
```

---

## 2. 確認できている事実

1. Money Forward ME無料会員が表示・利用できる金融関連サービスは4件までである。
2. 5件以上登録していても、無料会員では選択した4件以外の明細は表示できない。
3. `mf-dashboard`は現在、1組のMoney Forward認証情報と1つのPlaywright認証状態を前提としている。
4. このforkの現在の実装はBitwarden Secrets Managerを使用し、`@1password/sdk`と`OP_*`設定は削除済みである。
5. データはSQLiteへ保存され、日次スナップショットは実行ごとに追加される。
6. 古いスナップショットを1年で削除する保持期限処理は、確認した範囲では存在しない。
7. `mf-dashboard`はMIT Licenseであり、fork・改変が可能である。ただし著作権表示とライセンス文を残す。
8. Bitwarden Secrets Manager Freeは、最大2ユーザー、3プロジェクト、3マシンアカウント、無制限のシークレット保存に対応している。
9. Tailscale ServeはローカルWebサービスをtailnet内だけへ公開できる。Funnelとは異なり、一般インターネットへ公開しない。
10. Tailscale Personalは個人利用向けの無料プランを提供している。

---

## 3. 根拠のある設計判断

### 3.1 複数Money Forwardアカウントは「プロファイル」として扱う

認証情報だけを複数に増やして、現在のDBへそのまま保存してはいけない。

現在のDBでは、Money Forward由来のIDがDB全体で一意であることを前提としている箇所がある。また、「グループ選択なし」のMoney ForwardグループIDは`0`で固定されるため、複数アカウントを同じDBへ保存すると衝突する。

したがって、すべてのMoney Forward由来データを`profile_id`でスコープする。

### 3.2 1PasswordはBitwarden Secrets Managerへ置き換える

Bitwardenへ保存するものは、各プロファイルにつき次の3つ。

```text
username
password
totp_secret
```

Bitwardenから取得するのはTOTPの6桁コードではなく、TOTPシークレットとする。crawler側で現在時刻のTOTPを生成する。

### 3.3 外部公開はCloudflareではなくTailscale Serveを使う

upstreamの推奨構成は、Cloudflare Tunnelでwebへ接続し、Cloudflare AccessのGoogle IdPとメール許可リストで利用者を認証する方式である。web側もCloudflare Access JWTを検証する。

このforkでは、その構成を意図的に採用しない。利用者が本人だけであり、Windows PCとPixelを同じtailnetへ参加させられるため、独自ドメインの継続費用とCloudflare・Google OAuth・Terraformの運用を増やさずに済むTailscale Serveを採用する。

webコンテナは`127.0.0.1`だけへ公開し、Tailscale ServeがHTTPSを終端して転送する。

この判断は、次をすべて守ることを前提とする。

- Tailscale Funnelを有効にしない
- webのホスト公開先を`127.0.0.1`に限定し、LANへ直接公開しない
- Tailscale Serveだけを閲覧経路にする
- tailnetのgrantsで本人だけに接続を許可し、初期状態の全端末許可を残さない
- 本番では`development`モードやローカル認証バイパスを有効にしない
- Tailscale Serveが付与する`Tailscale-User-Login`をアプリ側でも検証する
- Windows PCとPixelのTailscale端末認証・失効・更新を運用対象に含める

この構成では、利用端末にTailscaleクライアントが必要になる。一方、Cloudflare管理の独自ドメイン、Cloudflare API Token、Google OAuth client、Cloudflare Tunnel tokenは不要になる。

### 3.4 本番データ投入前に複数プロファイル対応DBを完成させる

既存データを後から複雑なDBマイグレーションで変換するより、開発中のDBを削除して作り直す方が安全である。

そのため、最初の単一アカウント試験はテストデータ扱いとし、複数プロファイル対応後に本番DBを新規作成する。

---

## 4. 未確認・運用上の注意

### 4.1 複数無料アカウントの規約上の扱い

異なるMoney Forward IDを複数所有すること自体を一律禁止する明示規定は確認できていない。

一方で、同一人物が無料枠を合算する目的で複数アカウントを運用することが公式に許容されている事実も確認できていない。

したがって、以下を区別する。

- 複数プロファイルを扱えるソフトウェア機能を実装する: 技術的に可能
- 家族・用途別・旧アカウントなどを統合する: 一般的な利用目的として説明可能
- 同一人物が無料枠を増やす目的だけで複数アカウントを作る: 規約上は未確認
- 1アカウント内で表示対象4件を自動切替し、上限を実質無効化する: 実装しない

### 4.2 スクレイピングの安定性

Money Forward側のHTML、認証フロー、追加認証、CAPTCHAなどが変わるとcrawlerが壊れる。

これは一度構築すれば永久に放置できるシステムではない。月1回程度の更新確認と、失敗通知が必要である。

---

# Part A: 初期準備

## 5. 必要なアカウント

### 必須

- GitHub
- Money Forward ME
- Bitwarden
- Tailscale

### 不要

- 1Password
- 独自ドメイン
- Cloudflare Zero Trust
- Google OAuthクライアント
- Terraform Cloud
- 公開IP
- ルーターのポート開放

---

## 6. Linuxサーバー要件

推奨最低条件:

```text
OS: Ubuntu 24.04 LTS相当
CPU: 2コア以上
RAM: 4GB以上推奨
Storage: 空き10GB以上
Architecture: amd64推奨
```

ARM64でも成立する可能性はあるが、Playwright、Chromium、Bitwarden CLIのイメージまたはバイナリ対応を個別確認する。最初の構築はamd64の方が安全。

### インストールするもの

```bash
git
docker
docker compose
tailscale
sqlite3
```

確認:

```bash
git --version
docker --version
docker compose version
tailscale version
sqlite3 --version
```

---

## 7. GitHub forkの準備

### 7.1 fork

GitHub上で`hiroppy/mf-dashboard`を自分のアカウントへforkする。

例:

```text
your-github-user/mf-dashboard
```

### 7.2 Linuxへclone

```bash
mkdir -p ~/services
cd ~/services

git clone git@github.com:your-github-user/mf-dashboard.git
cd mf-dashboard

git remote add upstream https://github.com/hiroppy/mf-dashboard.git
git remote -v
```

### 7.3 作業ブランチ

```bash
git switch -c feat/multi-profile-bitwarden-tailscale
```

### 7.4 ライセンス

`LICENSE`を削除しない。fork内のREADMEへ、原作者リポジトリを基にした改変版であることを記載する。

---

# Part B: Bitwarden Secrets Manager

## 8. Bitwardenの準備

### 8.1 Secrets Manager Freeを有効化

BitwardenでSecrets Manager用のFree組織を作成する。

### 8.2 プロジェクトを作成

```text
mf-dashboard-prod
```

プロジェクトは1つでよい。Money Forwardプロファイル数が増えても、同じプロジェクトへシークレットを追加できる。

### 8.3 Machine Accountを作成

名前:

```text
mf-dashboard-linux
```

権限:

```text
mf-dashboard-prod: Can read
```

書き込み権限は付けない。

### 8.4 Access Tokenを発行

発行したトークンは再表示できない前提で、安全な場所に保存する。

Linux上では次のファイルへ置く。

```bash
sudo install -d -m 700 -o "$USER" -g "$USER" ~/services/mf-dashboard/secrets
umask 077
cat > ~/services/mf-dashboard/secrets/bws-access-token
```

貼り付け後、`Ctrl+D`。

```bash
chmod 600 ~/services/mf-dashboard/secrets/bws-access-token
```

トークンをGitへ追加してはいけない。

### 8.5 Money Forwardシークレットを登録

最初のプロファイル:

```text
MF_PRIMARY_USERNAME
MF_PRIMARY_PASSWORD
MF_PRIMARY_TOTP_SECRET
```

2つ目:

```text
MF_SECONDARY_USERNAME
MF_SECONDARY_PASSWORD
MF_SECONDARY_TOTP_SECRET
```

実装ではシークレット名ではなく、BitwardenのSecret IDを設定ファイルへ保存する。

### 8.6 TOTPシークレットの取得

Money Forward MEで二段階認証を設定するときに表示されるQRコードまたはセットアップキーから、TOTPシークレットを取得する。

すでに設定済みで秘密鍵を確認できない場合は、二段階認証をいったん再設定する必要がある可能性がある。

TOTPシークレットをログへ出力してはいけない。

---

# Part C: 実装フェーズ1 — Secret Providerの置換

## 9. 目的

1Password依存を直接Bitwardenへ書き換えるのではなく、認証情報の取得方式を抽象化する。

### 9.1 インターフェース

例:

```ts
export interface MoneyForwardCredentials {
  username: string;
  password: string;
  totpSecret: string;
}

export interface SecretProvider {
  getMoneyForwardCredentials(profile: MoneyForwardProfileConfig): Promise<MoneyForwardCredentials>;
}
```

### 9.2 Provider

最低限、次を実装する。

```text
BitwardenSecretProvider
FileSecretProvider（テスト・緊急復旧用）
```

本番のデフォルトはBitwardenとする。

### 9.3 Bitwarden CLIの利用方針

Bitwarden公式の`bws` CLIをcrawlerイメージへ追加する。

推奨動作:

1. `/run/secrets/bws_access_token`を読み取る
2. `BWS_ACCESS_TOKEN`を子プロセスの環境変数へ渡す
3. Secret IDを指定して`bws secret get`を実行
4. JSONから`value`だけを取り出す
5. 取得値はメモリ上だけで保持する
6. ログへ値を出さない

`bws run`で任意のシークレット名を環境変数へ一括注入する方式は使わない。名前衝突や意図しない環境変数上書きを避ける。

### 9.4 TOTP生成

TOTPはRFC 6238対応の保守されているライブラリを利用する。

要件:

- デフォルト30秒
- 6桁
- SHA-1
- 現在時刻から生成
- シークレットをログ出力しない
- 既知のテストベクトルで単体テストする
- 実際のMoney Forwardログインで確認する

ライブラリのバージョンは実装時にNode.jsとの互換性を確認し、固定する。

### 9.5 1Passwordの削除

削除対象:

```text
@1password/sdk
OP_SERVICE_ACCOUNT_TOKEN
OP_VAULT
OP_ITEM
OP_TOTP_FIELD
```

README、`.env.example`、セットアップ文書、テストも更新する。

### 9.6 フェーズ1の完了条件

- 1Password契約なしでログインできる
- 既存の単一Money Forwardアカウントを取得できる
- TOTP要求時に自動ログインできる
- 認証状態を保存し、次回は再利用できる
- ログにID、パスワード、TOTP secret、Bitwarden tokenが出ない
- 既存のcrawlerテストが通る

---

# Part D: 実装フェーズ2 — プロファイル設定

## 10. プロファイル設定ファイル

シークレット値は含めず、Bitwarden Secret IDだけを持たせる。

`config/money-forward-profiles.json`:

```json
{
  "profiles": [
    {
      "id": "primary",
      "name": "メイン",
      "enabled": true,
      "usernameSecretId": "<BITWARDEN_SECRET_ID>",
      "passwordSecretId": "<BITWARDEN_SECRET_ID>",
      "totpSecretId": "<BITWARDEN_SECRET_ID>"
    },
    {
      "id": "secondary",
      "name": "追加口座",
      "enabled": false,
      "usernameSecretId": "<BITWARDEN_SECRET_ID>",
      "passwordSecretId": "<BITWARDEN_SECRET_ID>",
      "totpSecretId": "<BITWARDEN_SECRET_ID>"
    }
  ]
}
```

### バリデーション

起動時に次を検証する。

- `id`が英小文字、数字、`-`、`_`だけ
- `id`が重複していない
- Secret IDが空でない
- enabledなプロファイルが1つ以上ある
- `id`にパス区切り、`..`、空白を許可しない

DBが`profile_id`へ対応し、Part Fの直列profile loopと失敗分離が完成するまでは、データ衝突や非決定的な画面表示を避けるためenabledなプロファイルを最大1件に制限する。2件以上ならMoney Forwardへ接続する前に停止し、Part Fの実装・検証と同じPRでこの暫定制限を外す。

### 環境変数

```dotenv
MF_PROFILES_CONFIG_PATH=/app/config/money-forward-profiles.json
BWS_ACCESS_TOKEN_FILE=/run/secrets/bws_access_token
```

---

## 11. プロファイルごとの認証状態

現在の単一`auth-state.json`を廃止し、次へ変更する。

```text
/app/crawler-state/
├── primary.json
└── secondary.json
```

実装例:

```ts
function getAuthStatePath(profileId: string): string {
  return path.join(authStateRoot, `${profileId}.json`);
}
```

要件:

- profile IDを必ず検証してからパスへ使う
- プロファイル間で認証状態を共有しない
- 認証失敗時に他プロファイルの認証状態を削除しない
- 再ログイン成功時だけ上書きする

---

# Part E: 実装フェーズ3 — DBの複数プロファイル対応

## 12. 重要方針

複数プロファイル対応前のDBは本番利用しない。

この段階では、開発用DBを削除して新しいスキーマから作り直してよい。

```bash
docker compose down
rm -f data/moneyforward.db data/moneyforward.db-wal data/moneyforward.db-shm
```

本番開始後はこのコマンドを実行してはいけない。

Gitのcheckout/merge hookや通常のデプロイ手順から`*.db-wal`・`*.db-shm`だけを削除してはいけない。稼働中DBの補助ファイルはSQLiteに管理させ、開発DBを作り直す場合も先にComposeを停止してDB本体と同じ単位で扱う。

---

## 13. DBスキーマ

### 13.1 新規テーブル

```text
money_forward_profiles
```

例:

```ts
export const moneyForwardProfiles = sqliteTable("money_forward_profiles", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  lastScrapedAt: text("last_scraped_at"),
  lastStatus: text("last_status"),
  lastError: text("last_error"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
```

### 13.2 groups

現在のMoney ForwardグループIDだけを主キーとして使わない。

実装上は既存FKへの影響を抑えるため、内部IDを名前空間化する。

```text
groups.id = "<profile_id>:<mf_group_id>"
```

列:

```text
id
profile_id
mf_group_id
name
...
```

制約:

```text
UNIQUE(profile_id, mf_group_id)
```

### 13.3 accounts

追加:

```text
profile_id
```

変更:

```text
UNIQUE(mf_id)
```

から、

```text
UNIQUE(profile_id, mf_id)
```

へ変更する。

### 13.4 transactions

追加:

```text
profile_id
```

変更:

```text
UNIQUE(mf_id)
```

から、

```text
UNIQUE(profile_id, mf_id)
```

へ変更する。

### 13.5 holdings

`mf_id`の一意性をプロファイルまたは口座単位へ変更する。

推奨:

```text
UNIQUE(profile_id, mf_id)
```

ただし`mf_id`がnullの保有資産を考慮する。

### 13.6 その他のテーブル

以下は`group_id`または`account_id`経由でプロファイルを特定できる。

- `group_accounts`
- `account_statuses`
- `daily_snapshots`
- `holding_values`
- `asset_history`
- `asset_history_categories`
- `spending_targets`
- `analytics_reports`

ただし、クエリの安全性と性能のため、必要な箇所へprofile indexを追加する。

---

## 14. IDスコープ関数

Money Forward由来IDをDBへ保存する箇所で、処理をばらばらに実装しない。

共通関数を作る。

```ts
scopeGroupId(profileId, mfGroupId);
scopeExternalId(profileId, mfId);
```

ただし、DB列に`profile_id`を持つ場合、画面表示用の`mf_id`自体を破壊的に書き換えず、内部IDだけを名前空間化する。

### テスト

- primaryのgroup `0`
- secondaryのgroup `0`

が別レコードとして保存されること。

同じ名称の金融機関が両プロファイルに存在しても、別口座として保存されること。

---

# Part F: 実装フェーズ4 — crawlerの複数プロファイル化

## 15. 実行方式

プロファイルは並列ではなく直列で処理する。

```text
global crawler lock
  ├── primary
  │    ├── secrets取得
  │    ├── browser起動
  │    ├── login
  │    ├── scrape
  │    ├── DB保存
  │    └── browser終了
  └── secondary
       ├── secrets取得
       ├── browser起動
       ├── login
       ├── scrape
       ├── DB保存
       └── browser終了
```

理由:

- Playwrightの同時実行によるメモリ増加を避ける
- Money Forwardへの同時アクセスを避ける
- 認証状態の混線を避ける
- ログと障害原因を追いやすくする

---

## 16. 障害分離

1プロファイルが失敗しても、他プロファイルは継続する。

例:

```text
primary: success
secondary: auth_failed
overall: partial_success
```

失敗したプロファイルについては、

- 既存DBデータを削除しない
- `last_status`と`last_error`だけ更新する
- 認証成功前に古いデータをinactive扱いにしない
- 他プロファイルのcleanup対象にしない

### ログ形式

すべてのcrawlerログへprofile IDを付ける。

```text
[profile=primary] login successful
[profile=secondary] OTP required
```

シークレット値は絶対に出力しない。

---

## 17. スケジュール

### 初期2週間

```text
毎日 06:30 JST に1回
```

### 安定後

```text
毎日 06:30 JST
毎日 15:30 JST
```

複数プロファイルを数分間隔で直列処理する。短時間に再試行を繰り返さない。

### 再試行

推奨:

```text
最大2回
初回失敗後: 10分待機
2回目失敗: その日の自動処理を停止
```

認証失敗やCAPTCHAを無限再試行しない。

---

# Part G: 実装フェーズ5 — Web画面

## 18. 認証方式

現在のCloudflare Access JWT前提を切り替えられるようにする。

```dotenv
AUTH_MODE=tailscale
```

モード:

```text
cloudflare
tailscale
development
```

本番で`development`を許可しない。

### tailscaleモード

次をすべて満たす。

- webは`127.0.0.1`でのみホストへ公開
- Tailscale Serveだけが到達経路
- ルーターのポート開放なし
- Tailscale Funnelを使わない
- Tailscaleのgrantsで本人だけ許可
- `Tailscale-User-Login`が設定した本人のログイン名と一致することを検証
- `ALLOW_LOCAL_AUTH_BYPASS`を本番で有効にしない

```dotenv
TAILSCALE_ALLOWED_LOGIN=<TAILSCALE_LOGIN_NAME>
```

Tailscale Serveはproxy時に利用者のidentity headerを付与し、受信時に同名の偽装headerを除去する。ただし、バックエンドへ直接到達できる経路があるとheaderを偽装できるため、webのlocalhost bindは必須とする。

ネットワーク到達制御を主防御とし、identity header検証を追加の防御とする。localhost上の別プロセスは信頼境界内として扱う。

既存の`hasValidCloudflareAccess`をそのまま流用せず、provider非依存の認証関数へ置き換える。ブラウザから呼ばれるchat APIとcrawler手動更新APIは`AUTH_MODE`に応じて検証し、crawlerからwebへの内部更新APIは既存の`REFRESH_TOKEN`認証を維持する。

---

## 19. Compose変更

upstream追従を容易にするため、Cloudflare認証コード、`cloudflared`サービス、Terraformファイルは削除しない。`cloudflared`をCompose profileで任意化し、Tailscale運用では起動しない。Cloudflare用シークレットと環境変数も、`AUTH_MODE=cloudflare`またはCloudflare profileを選んだ場合だけ必須にする。

web:

```yaml
services:
  web:
    ports:
      - "127.0.0.1:8765:8765"

  cloudflared:
    profiles:
      - cloudflare
```

crawlerとwebの共有:

```yaml
volumes:
  - ./data:/app/data
```

Bitwarden Access Token:

```yaml
secrets:
  bws_access_token:
    file: ./secrets/bws-access-token
```

crawler:

```yaml
secrets:
  - bws_access_token
environment:
  BWS_ACCESS_TOKEN_FILE: /run/secrets/bws_access_token
  MF_PROFILES_CONFIG_PATH: /app/config/money-forward-profiles.json
volumes:
  - ./config:/app/config:ro
```

注意:

Docker ComposeのsecretはSwarmの暗号化secret storeではない。元ファイルはLinuxディスク上に存在するため、ファイル権限、SSH、ディスク、バックアップを保護する。

---

## 20. プロファイル選択UI

画面へ次を追加する。

```text
表示対象
- すべて
- メイン
- 追加口座
```

### 「すべて」

- 総資産を合算
- 負債を合算
- 収入・支出を合算
- 資産カテゴリを合算
- 同じ銘柄をまとめるかは画面ごとに判断
- 金融機関・口座一覧ではプロファイル名を表示

### プロファイル別

そのMoney Forwardアカウント由来のデータだけを表示する。

### 重複表示

同じ名前の口座や銘柄が複数プロファイルにある場合、

```text
楽天証券（メイン）
楽天証券（追加口座）
```

のように区別する。

---

## 21. 更新画面

手動更新は次を選べるようにする。

```text
すべて更新
メインだけ更新
追加口座だけ更新
```

ステータス:

```text
idle
running
success
partial_success
auth_failed
scrape_failed
```

各プロファイルの最終成功日時を表示する。

---

# Part H: Tailscale

## 22. LinuxへのTailscale導入

公式手順でTailscaleをインストールし、個人のtailnetへ参加させる。

```bash
sudo tailscale up
tailscale status
```

サーバー名は分かりやすくする。

例:

```text
mf-dashboard
```

### WindowsとPixel

同じTailscaleアカウントでログインする。

---

## 23. Tailscale Serve

webが起動し、Linuxホストの`127.0.0.1:8765`で応答することを確認する。

```bash
curl -I http://127.0.0.1:8765
```

Serveを設定する。

```bash
tailscale serve --bg 8765
```

確認:

```bash
tailscale serve status
```

表示された、

```text
https://mf-dashboard.<tailnet>.ts.net
```

へWindowsまたはPixelからアクセスする。

### 禁止

```bash
tailscale funnel ...
```

は実行しない。Funnelは一般インターネット公開用である。

---

# Part I: テスト

## 24. 単体テスト

最低限:

- プロファイル設定バリデーション
- profile IDのパストラバーサル防止
- Bitwarden JSONのparse
- Bitwarden失敗時に値をログへ出さない
- TOTP既知ベクトル
- profile別auth-state path
- group IDの名前空間化
- accountの複合unique
- transactionの複合unique
- profile filter
- 全プロファイル集計

---

## 25. 結合テスト

### 25.1 モック2プロファイル

以下をモックデータで保存する。

```text
primary
- group id: 0
- 楽天証券
- 楽天カード

secondary
- group id: 0
- 野村證券
- 別カード
```

確認:

- groupが上書きされない
- 口座が混線しない
- 取引が重複・上書きされない
- 全体表示が合算される
- profile別表示が分離される

### 25.2 実アカウント1つ

最初は`primary`だけをenabledにする。

```json
"enabled": true
```

secondaryはfalse。

確認:

- ログイン
- OTP
- 資産取得
- 取引取得
- 2回目のセッション再利用
- 手動更新
- Tailscale経由表示

### 25.3 実アカウント2つ

単一アカウントで1週間程度安定してからsecondaryを有効化する。

確認:

- 認証状態が別ファイル
- primary失敗時もsecondaryを処理
- secondary失敗時もprimaryデータを維持
- 全体の資産額がMoney Forward各画面の合計と一致

---

## 26. 本番移行の受入条件

以下をすべて満たすまで本番扱いにしない。

- [ ] Bitwardenから認証情報を取得できる
- [ ] 1Password関連コードと設定を削除した
- [ ] シークレットがログへ出ていない
- [ ] webが`127.0.0.1`以外へbindされていない
- [ ] Tailscale Serve経由でのみ閲覧できる
- [ ] Funnelが無効
- [ ] primaryの自動取得が7日以上成功
- [ ] secondary追加後もデータが混線しない
- [ ] 総資産が手計算と一致する
- [ ] 収支がプロファイル別・全体とも一致する
- [ ] 日次バックアップから復元できる
- [ ] crawler失敗を検知できる
- [ ] upstream更新手順を文書化した

---

# Part J: バックアップ

## 27. バックアップ対象

必須:

```text
data/moneyforward.db
config/money-forward-profiles.json
compose.yml
自分のforkのGitリポジトリ
```

profile別auth-stateはcredential相当のため通常のバックアップ対象から除外し、crawler専用volumeだけに保持する。障害時は保存済みstateを使わず再ログインする。例外的にバックアップが必要な場合も、GitHub Actions cacheやGitへ保存せず、暗号化と厳格なアクセス制限を必須とする。

Bitwardenシークレット自体はDBバックアップへ含めない。

---

## 28. SQLiteバックアップ

単純な稼働中ファイルコピーではなく、SQLiteのbackup機能を使う。

例:

```bash
#!/usr/bin/env bash
set -euo pipefail

BASE="$HOME/services/mf-dashboard"
DB="$BASE/data/moneyforward.db"
DEST="$BASE/backups"
DATE="$(date +%F-%H%M%S)"
TMP="$DEST/moneyforward-$DATE.db"

mkdir -p "$DEST"

sqlite3 "$DB" ".timeout 10000" ".backup '$TMP'"
sqlite3 "$TMP" "PRAGMA integrity_check;" | grep -qx "ok"

# ここでage等により暗号化する
# 暗号化成功後に平文TMPを削除する
```

### 保持期間

例:

```text
日次: 14日
週次: 8週
月次: 12か月
```

### オフホスト

最低1コピーはLinuxサーバー以外へ置く。

候補:

- 暗号化してクラウドストレージ
- NAS
- 外付けストレージ
- 別の無料オブジェクトストレージ

保存先は別途選定する。

---

## 29. 復元テスト

月1回、バックアップを別ファイルへ復元し、次を確認する。

```bash
sqlite3 restored.db "PRAGMA integrity_check;"
sqlite3 restored.db "SELECT COUNT(*) FROM transactions;"
sqlite3 restored.db "SELECT COUNT(*) FROM daily_snapshots;"
```

復元テストをしていないバックアップは、存在していても信頼しない。

---

# Part K: 日常運用

## 30. 毎日

自動化:

- crawler実行
- 成功・失敗記録
- SQLiteバックアップ
- integrity check
- バックアップ暗号化
- 古いバックアップ整理

ユーザーが毎日確認する必要はない。

---

## 31. 週1回

確認:

```bash
cd ~/services/mf-dashboard
docker compose ps
docker compose logs --since=7d crawler
tailscale serve status
df -h
```

画面で確認:

- 最終更新日時
- 各プロファイルのstatus
- 資産額に異常な急増・急減がないか
- 取引の欠落がないか

---

## 32. 月1回

```bash
git fetch upstream
git log --oneline --decorate --graph HEAD..upstream/main
docker compose pull
```

upstreamを自動マージしない。

手順:

1. DBバックアップ
2. upstreamの変更確認
3. 作業ブランチへmergeまたはrebase
4. テスト
5. 開発用DBで起動
6. 本番へ反映

スクレイパー関連変更は特に慎重に確認する。

---

## 33. 半年ごと

- Bitwarden Machine Account tokenをローテーション
- LinuxのSSH鍵とユーザー確認
- Tailscale端末一覧から不要端末削除
- Money Forward連携先の棚卸し
- バックアップ復元手順の見直し
- forkとupstreamの乖離確認

---

# Part L: 障害時対応

## 34. 認証失敗

症状:

```text
auth_failed
OTP failed
redirect timeout
```

順番:

1. Money Forwardへ手動ログインできるか確認
2. 二段階認証方式が変わっていないか確認
3. Bitwardenのusername/password/totp_secretを確認
4. 該当profileのauth-stateだけ退避
5. crawlerを手動実行
6. CAPTCHAや追加認証なら自動再試行を止める

```bash
docker compose exec crawler \
  mv -- /app/crawler-state/primary.json /app/crawler-state/primary.json.bak
```

他プロファイルのauth-stateを削除しない。

---

## 35. スクレイピング失敗

1. upstreamのIssue・コミットを確認
2. DEBUGを一時的に有効化
3. スクリーンショットまたはHTMLを保存
4. 金融データや認証情報をIssueへ貼らない
5. セレクター変更を小さなPRで修正
6. 実アカウントE2Eを再実行

---

## 36. DB不整合

```bash
docker compose down
cp data/moneyforward.db data/moneyforward.db.corrupt
sqlite3 data/moneyforward.db "PRAGMA integrity_check;"
```

`ok`でなければ、直近の正常バックアップから復元する。

破損DBへ直接修復を重ねる前に、必ずコピーを保存する。

---

## 37. Bitwarden障害

通常は復旧を待つ。

緊急時だけ`FileSecretProvider`を使えるようにしておくが、デフォルト無効とする。

```dotenv
SECRET_PROVIDER=file
```

ファイルproviderを使う場合:

- rootまたは専用ユーザーだけ読める
- Git管理しない
- 復旧後にファイルを削除
- 認証情報をローテーション

---

# Part M: 実装順序

## 38. Codexへ実装を依頼する順序

### PR 1: Secret Provider抽象化

- 既存1Password処理をinterfaceの背後へ移動
- テスト追加
- 挙動は変えない

### PR 2: Bitwarden Provider

- bws CLI導入
- Bitwarden Secret IDから取得
- TOTP生成
- 1Password providerと切替可能
- 単一アカウントE2E

### PR 3: 1Password削除

- `@1password/sdk`削除
- OP環境変数削除
- ドキュメント更新

### PR 4: Profile Configと認証状態分離

- JSON schema
- profile-awareな実行経路（DB対応前はenabled 1件にfail-closed）
- profile別auth-state
- DB保存はまだprimaryだけでもよい

### PR 5: DB複数プロファイル化

- profiles table
- profile_id追加
- unique制約変更
- group内部IDの名前空間化
- DB新規作成
- 2プロファイルの結合テスト

### PR 6: crawler障害分離

- profile別結果
- partial_success
- profile別cleanup
- profile別手動更新

### PR 7: Webのprofile filterと合算

- all / primary / secondary
- profile label
- profile別status

### PR 8: Tailscale運用

- Cloudflare認証を切替可能にする
- cloudflaredをCompose profileで任意化し、Terraformはupstream互換のため保持
- localhost bind
- Tailscaleセットアップ文書

### PR 9: バックアップと監視

- backup script
- integrity check
- retention
- 通知

1つの巨大PRにまとめない。

---

# Part N: 最終的な運用費用

既存Linuxサーバーを使う場合:

| 項目                           |                        想定費用 |
| ------------------------------ | ------------------------------: |
| mf-dashboard                   |                             0円 |
| Docker                         |                             0円 |
| SQLite                         |                             0円 |
| Bitwarden Secrets Manager Free |                             0円 |
| Tailscale Personal             |                             0円 |
| 独自ドメイン                   |                            不要 |
| 1Password                      |                            不要 |
| Cloudflare                     |                            不要 |
| Google OAuth                   |                            不要 |
| Money Forward ME               | 無料アカウントを使う範囲では0円 |
| バックアップ先                 |                        選定次第 |

電気代、Linuxサーバー本体、将来無料枠が変更された場合の費用は別。

---

# Part O: 最終チェックリスト

## セキュリティ

- [ ] webはlocalhost bind
- [ ] Tailscale Serveのみ
- [ ] Funnel未使用
- [ ] SSHパスワードログイン無効
- [ ] Bitwarden tokenは600
- [ ] Bitwarden Machine Accountはread only
- [ ] secret値をログ出力しない
- [ ] `.env`、config、auth-state、DBをGitへ追加しない
- [ ] バックアップを暗号化
- [ ] AI機能は初期無効

## データ

- [ ] profile間でgroup `0`が衝突しない
- [ ] accountがprofileで分離される
- [ ] transactionがprofileで分離される
- [ ] 取得失敗時に過去データを消さない
- [ ] 全体合算が手計算と一致
- [ ] バックアップ復元成功

## 運用

- [ ] 1アカウントで7日安定
- [ ] 2アカウントで7日安定
- [ ] 自動取得は初期1日1回
- [ ] 無限再試行なし
- [ ] 月次upstream確認
- [ ] 規約上の不明点を認識したうえで運用判断

---

# 参考資料

- Money Forward MEサポート: 無料会員の金融関連サービス連携上限は4件
- Money Forward MEサポート: 上限外口座の明細は無料会員では非表示
- Bitwarden: Secrets Manager Plans
- Bitwarden: Machine Accounts
- Bitwarden: Secrets Manager CLI
- Tailscale: Serve — https://tailscale.com/docs/features/tailscale-serve
- Tailscale: Grants — https://tailscale.com/docs/features/access-control/grants
- Tailscale: Pricing
- hiroppy/mf-dashboard: README、setup、compose、DB schema、auth implementation
- hiroppy/mf-dashboard: MIT License
