# 配当・分配分析機能 実装タスク

対応計画: [plan.md](plan.md)

## Status legend

- `[x]` 完了。証拠を下のEvidence欄に残す
- `[ ]` 未着手または未完了
- `[~]` 作業中。途中成果物と残作業を残す
- `Blocked` は外部API仕様、業務定義、認証、runtimeなど、担当エージェントだけでは確定できない事項

## Current implementation status

- [x] ユーザー提供のモックv2を画面仕様として確認した
- [x] 現行のホーム・資産・保有資産・Crawler・DBの実装経路を確認した
- [x] 既存のroot `task.md` が別テーマの引き継ぎ資料であることを確認し、上書きしない方針にした
- [x] 本計画と本タスクを作成し、Downloads版の計画・タスクを統合した
- [x] Sol mediumのデータ設計レビューとUI/受入レビューを受け、統合版の指摘を反映して最終確認済み
- [x] EDINET DB APIの契約確認（実APIのendpoint・レスポンス形状・認証を確認済み。値やkeyは保存していない）
- [x] 実装ブランチを`main`から作成し、API keyを含む`.env`がGit管理外であることを確認した
- [x] 配当4テーブル、transactions rawカテゴリ列、migration、DB schema docsを追加した
- [x] EDINET DB adapter、銘柄コード解決、stage別TTL、永続budget ledger、profile完了後同期を追加した
- [ ] 配当データの保存・同期
- [ ] 配当集計クエリ
- [ ] ホームサマリー
- [ ] 株式(現物)の業種別・利回り別切替
- [ ] 配当ページ
- [ ] 配当詳細・CSV
- [ ] テスト・Storybook・runtime確認
- [ ] ユーザー受入

現時点ではDB・provider・UIの実装途中であり、機能全体は未完了。上記の`[x]`にはAPI契約確認を含む。

## Integrated baseline

- 対象: `itsuki-jp/mf-dashboard` fork。original `hiroppy/mf-dashboard`へ変更を加えない。
- Downloads版の基準: `origin/main` / `9cb06b9620901e7154f5c5b8c6e2947b29d3f2ff`。
- 実装開始時は`git branch --show-current`、`git status --short`、`git remote -v`を確認する。現在のbranch/worktreeの既存変更を戻さず、必要ならユーザー指定のbranchで作業する。今回の実装branchは`codex/dividend-income-analysis`、PR/push対象は`origin`（`itsuki-jp/mf-dashboard`）だけとする。
- Downloads版のDB名を採用する: `stock_market_data`（security master）、`stock_dividend_history`（履歴・配当event）、`market_data_sync_statuses`、`market_data_request_budgets`。履歴・statusを単純な年次履歴だけにせず、revision・stage・request予約・支払日精度まで保存する。

## Handoff rules

- 作業開始前に `plan.md` とリポジトリrootの `AGENTS.md` を読む。
- `data/moneyforward.db`、認証状態、実取引本文、個人名、口座番号、API keyをテスト・fixture・ログ・Gitへ入れない。
- 既存の含み損益、資産推移、バランスシート、保有資産一覧を削除・置換しない。
- 不明な金額・数量・利回り・支払日は `0` に変換せず、`未取得`、`データなし`、`算出不可`、`予定月未定` の状態で保持する。
- rootの既存 `task.md` と既存の別テーマの `plans/001-005` はこのタスクのために上書きしない。
- 実装と検証を同じチェックにしない。コード、単体テスト、Storybook、実ブラウザ、ユーザー受入を別々に記録する。

## Phase 0A: External contract and identity gate

### 0.1 EDINET DB API

- [x] 実endpointを確認する。証券コード解決は`/v1/companies?sec_code=...`、企業配当予想は`/v1/companies/{edinet_code}?fields=profile,forecast_doe`、履歴は`/v1/companies/{edinet_code}/financials?years=6`。決算短信は企業配下の`/earnings`で、単独`/v1/earnings`は使わない
- [x] API base URL、認証方法、必要な環境変数名（ローカル`.env`の`EDINETDB_KEY`）を確定する。key値は出力・保存しない
- [ ] 銘柄コード、銘柄名、市場、業種、現在利回り、予想利回りのレスポンス例を記録する（値ではなくフィールド形状のみ）
- [ ] 配当履歴の年度、期間、中間/期末、DPS、基準日、権利落ち日、支払日、予想DPSのフィールドを確定する
- [ ] ページング、最大件数、レート制限、429、認証エラー、5xx、timeoutの挙動を確定する
- [ ] 国内株式以外の対応範囲を確定する。対象外は実装上 `対象外` とする
- [ ] APIが返さない項目を一覧化し、UIで `未取得` / `算出不可` とする項目を確定する
- [ ] securityのcanonical keyを`source + externalSecurityId`、Money Forward照合キーを`source + normalizedCode`として確定する
- [ ] 同じnormalizedCodeのprovider候補が複数あるときに`ambiguous_match`へ落とすルールを確定する
- [ ] eventの`providerEventId`、`economicEventKey`、non-null `eventVersionKey`、revision/current、forecastからactualへの遷移規則を確定する
- [ ] providerが安定した経済イベントキーを返せない行は`invalid_identity`として保存せず、同期状態へ記録する
- [ ] 会社決算年度`fiscalYear`と支払暦年`paymentYear`を別フィールドとして確定する
- [ ] 利回りの単位、DPS精度、JPY整数への丸め、MVPの通貨範囲を確定する
- [ ] 無料枠100 requests/day、soft budget 90、safety reserve 5、`/usage`自身も1 requestとして数える方式を確認する。daily windowのtimezone/reset時刻も確認し、契約が異なる場合は`budgetWindowKey`へ切り替え、budgetを下げる
- [ ] mapping 30日、forecast 24時間、history 7日のTTL案、最大同時4銘柄、最大2回retry、429/5xx/networkの停止方針を確認する
- [ ] `normalizeSecurityCode`のtrim/uppercase/`.T`除去、4文字英数字候補、5桁末尾0比較、listed一意候補のみ自動採用を匿名fixtureで確定する
- [ ] `/earnings`の返却順ではなく開示日時で最新forecast-bearing recordを選び、pre-split adjusted値、indeterminate、Q4のtarget fiscal yearを確認する

Evidence:

- API仕様URLまたは受領した契約資料:
- Adapter内部型との対応:
- 未提供フィールド:
- 判定: `Ready` / `Blocked`

### Phase 0B: Money Forward actual receipt and scope gate

- [ ] 匿名化した取引fixtureまたは構造だけのread-only確認で、raw category/subCategory/descriptionによる配当分類を確定する（正規化後categoryを正本にしない）
- [ ] 税引前、税額、税引後のどれが取得可能かを確定する
- [ ] `matched` の必須条件（正の金額、日付、元取引ID、解決済みaccount、金額basis）を確定する
- [ ] accountIdがnullの取引はgroup/口座集計から除外し、`口座未解決`として扱うことを確定する
- [ ] 口座・profile・取引IDを用いたscope解決を確定する
- [ ] 一致しない・曖昧な取引を `ambiguous` として、必要入力欠落を `unavailable` として除外するルールを確定する
- [ ] 受取日がMoney Forward取引日なのか、外部の支払日なのかを画面ラベルへ反映する
- [ ] `actualReceivedNet`、`forecastAnnualGross`、`forecastRemainingGross`、`unknownPaymentMonthGross`、`calculationStatus`を別値にすることを確定する

Evidence:

- 確定した判定ルール:
- 利用できる金額基準:
- 未確定事項:
- 判定: `Ready` / `Blocked`

### 0.3 Phase 0 completion gate

- [ ] `SecurityFact` と `DividendEvent` のadapter型が確定している
- [ ] actual / forecast / estimated month / unavailable の状態語彙が確定している
- [ ] 実績と予想の金額基準を同じ画面で混同しない表示方針が確定している
- [ ] Phase 0が未完了の場合、許可するのはadapterの匿名fixture骨格と未取得UI骨格だけである
- [ ] Phase 0完了まではschema・実provider同期・actual/forecast集計を開始しない

## Phase 1: Database and provider

### 1.1 Schema and migration

- [x] `stock_market_data` schemaを追加する（security masterの実装名）
- [x] `stock_market_data`へ`source`、`externalSecurityId`、`normalizedCode`、`market`、`name`、`industryName`、`listingStatus`、`mappingStatus`、forecast fiscal year/quarter、raw/adjusted forecast DPS、split basis、`forecastPeriodBasis`、開示日、同期日時、error codeを追加する
- [x] `stock_dividend_history` schemaを追加する（履歴・配当eventの実装名）
- [x] `stock_dividend_history`へ`stockMarketDataId`、`providerEventId`、`economicEventKey`、non-null `eventVersionKey`、`revision`、`fiscalYear`、`paymentYear`、`period`、`status`、raw/adjusted DPS、`periodBasis`、announcement/record/ex/payment dates、`paymentDatePrecision`、source/asOfを追加する
- [x] `market_data_sync_statuses` schemaを追加する
- [x] `market_data_request_budgets` schemaを追加し、`source + budgetWindowKey`を一意にする。provider timezone/reset時刻を保存し、requestsReserved/Completedを原子的に更新して再起動後もdaily budgetを守る
- [x] すべての新規テーブルに`createdAt`と`updatedAt`を追加する
- [x] すべてのforeign keyに`onDelete`を指定する
- [ ] `eventVersionKey`をnon-nullで生成し、providerEventId/economicEventKeyから導出不能な行を保存拒否する
- [ ] `stock_market_data`の`source + externalSecurityId`、`stock_dividend_history`の`source + eventVersionKey`、sync statusの`source + normalizedCode + stage`を重複防止する。nullable marketをcanonical keyにしない
- [ ] sync statusへ`stage=mapping|forecast|history`を追加し、`source + normalizedCode + stage`を一意にする。stage別のTTL・成否・lastSuccessを混ぜない
- [ ] nullable marketをcanonical unique keyにしない
- [x] `packages/db/drizzle/0003_*.sql` を生成・確認する
- [x] `docs/architecture/database-schema.md` とER図・index・ON DELETE一覧を更新する
- [x] migrationを空DBへ適用できることを確認する（既存DBへの実行は行わず、匿名demo DBを再生成）
- [x] migrationで既存のdemo DBを壊さないことを確認する（demo seedを再実行）
- [ ] `packages/db/package.json`へ必要なrepository/queryのsubpath exportを追加する。`packages/db/src/index.ts`のbarrel追加は行わず、repo規約どおりsource直接importを維持する

Evidence:

- 変更ファイル:
- migration番号:
- fresh DB結果:
- demo DB結果:

### 1.2 Repository and external adapter

- [ ] `stock_market_data` のupsert/get repositoryを追加する
- [ ] `stock_dividend_history` のsource keyベースupsert/list repositoryを追加する
- [ ] `market_data_sync_statuses` のstatus/upsert/list repositoryを追加する
- [ ] `market_data_request_budgets` のprovider基準timezoneのbudget-window ledger repositoryを追加し、全provider request前に原子的なreservationを取得する
- [ ] EDINET DB clientをCrawler側へ追加し、APIレスポンスを内部型へ変換する
- [x] `apps/crawler/src/market-data/edinet-db-client.ts`、`security-code.ts`、`sync-stock-market-data.ts`を追加し、provider responseを内部security/history型へ変換する
- [x] 認証情報を引数、ログ、例外メッセージへ露出しない
- [x] 429、5xx、timeout、invalid JSON、空配列をそれぞれ状態化する
- [x] 取得日時・source・asOfを保存する
- [x] 同一レスポンスを2回同期しても行数が増えないことをテストする
- [x] 現在保有のdistinct `normalizedCode`だけを対象にする
- [x] profile loop終了後、成功profileが1件以上のときだけglobal syncし、全profile失敗時はskipする。同一codeをprofile/口座ごとに重複取得しない
- [x] mapping→forecast→historyの段階同期、daily budget、stage別TTL、部分成功、429/5xx/networkの停止・継続を実装する
- [x] mapping TTL 30日、forecast TTL 24時間、history TTL 7日、銘柄単位の部分成功、指数バックオフ付き最大2回再試行を実装する（同時実行は無料枠保護のため逐次）
- [x] 既存Crawlerの`/runs`手動実行・scheduler・lock/auth境界へEDINET syncを組み込む。別の`/dividends/refresh` endpointは追加せず、providerエラーをMoney Forward run成功/失敗へ混ぜない
- [x] API停止時に既存Money Forwardスクレイプ・資産保存を成功扱いから誤って失敗へ変えない

### 1.3 Money Forward receipt classifier

- [x] `packages/db/src/schema/schema.ts`の`transactions`へnullableな`rawCategory`、`rawSubCategory`を追加し、`packages/db/drizzle/0003_*.sql`とschema docsを更新する
- [x] `apps/crawler/src`のtransaction保存処理で、カテゴリ決定・正規化より前のMoney Forward値をraw列へ保存する。既存`description`は変更せず、カテゴリ再取得時もraw値を引き継ぐ
- [ ] transactionを`matched` / `not_dividend` / `ambiguous` / `unavailable`の判別可能unionへ分類する純粋関数を追加する
- [ ] 正規化前のraw category/subCategoryを保持できるようにする。raw値のない過去transactionは`unavailable`とする
- [ ] matchedは保存済みtransactionsから都度導出し、materialized receiptを作らない
- [ ] net amountしかない場合にgrossやtaxを逆算しない
- [ ] matchedの必須条件を満たさない全null/曖昧receiptを作らない
- [ ] accountIdがnullのtransactionを集計対象から除外する
- [ ] 銘柄コードが取引から解決できない場合、銘柄名・市場の推測で結合せず`security_unresolved`としてsecurity別集計から除外する
- [ ] `security_unresolved`は全体KPI・全体時系列・CSVへ状態付きで残し、銘柄別/業種別/利回り別へ混ぜない。金額基準不明・account未解決は`unavailable`/`account_unresolved`としてscreen金額から除外する
- [ ] transactionの削除、金額訂正、matched→ambiguousが次回queryへ反映されることを確認する
- [ ] 匿名fixtureで複数profile・複数口座・曖昧な取引を検証する

## Phase 2: Query and aggregation

### 2.1 Holding data contract

- [ ] `getHoldingsWithLatestValues` の返却DTOへ`code`を追加する
- [ ] 必要なsecurity metadataをqueryで取得できるようにする。Money Forward側にないmarketを保有データから補完しない
- [ ] 既存のHoldingsTable、AccountSummary、DailyChangeなどの呼び出し元が壊れないことを確認する
- [ ] holding IDではなく`source + normalizedCode`を外部データ結合の基本キーにする

### 2.2 Dividend query module

- [ ] `packages/db/src/queries/dividend.ts` を追加する
- [ ] summary queryを追加する
- [ ] security別queryを追加する
- [ ] monthly/yearly series queryを追加する
- [ ] industry breakdown queryを追加する
- [ ] yield bucket breakdown queryを追加する
- [ ] security detail/history queryを追加する
- [ ] CSV用の明細queryを追加する
- [ ] 予想を含む/含まない、暦年、口座、商品、銘柄、group/profileの入力型を共通化する
- [ ] queryの結果へ`actualReceivedNet`、`forecastAnnualGross`、`forecastRemainingGross`、`unknownPaymentMonthGross`、`calculationStatus`、`amountBasis`、`dataStatus`、`source`、`asOf`を含める
- [ ] queryの結果へ`periodBasis=fiscal_year|calendar_year|event_sum`を含め、全期forecastを支払暦年・月次・remainingへ配賦しない
- [ ] 月不明・推定月を通常の月へ混ぜず、別状態で返す
- [ ] forecast改訂、forecast→actual、actual二重計上をreconcileする
- [ ] `forecast_dividend_per_share`が全期予想ならeffective forecast DPSをそのまま使い、event単位しかない場合だけlatest revisionを合算する。actual化で年間予想が減らないことをテストする
- [ ] forecast計算可能な保有額 / 全保有額 / coveragePct / coveredHoldingCount / totalHoldingCountを返し、coverage未達を全体利回りと誤認させない
- [ ] providerが返す範囲で最大6年のhistoryを保存し、partial historyを`history pending`/`データなし`として返す
- [ ] `quantity=null`、DPS=null、yield=null、code=null、イベント重複、空データをテストする
- [ ] 現行の資産集計と同じgroup/profile scopeをテストする

### 2.3 Calculation rules

- [ ] 年間予想額を、全期forecastがある場合はeffective forecast DPS×最新保有数量、event単位しかない場合は経済イベントごとの最新revision（actual DPSがあればactual、なければforecast）合計×最新保有数量で計算する。actual化したイベントを年間予想から消さない
- [ ] 年は入金/支払の暦年、会社の決算年度は別フィールドとして扱う
- [ ] 予想を現在保有数量による参考run-rateと明示する
- [ ] `forecastRemainingGross`は将来の支払日/月があり、actualとの経済イベント対応が確定できる場合だけ計算する
- [ ] Yield on Costを計算可能な場合だけ表示する
- [ ] 利回り別バケットを評価額ベースで集計する
- [ ] 不明利回りを`データなし`バケットへ入れる
- [ ] actualとforecastを二重計上しない
- [ ] 実績と予想のbasisが異なる場合、進捗率を`算出不可`にする
- [ ] `forecastRemainingGross`だけは未来の未実績forecastに限定する
- [ ] `forecastAnnualGross`に対象年度、forecast disclosure date、source/asOf、split basis warningを含める
- [ ] 利回りは`3.5 = 3.5%`、金額はJPY整数、DPS×数量の円未満は四捨五入とする
- [ ] 金額・数量・利回りの非有限値を0へ丸めない

## Phase 3: Web implementation

### 3.1 Home summary

- [ ] `apps/web/src/components/info/dividend-summary-card.tsx` を追加する
- [ ] 対応する`dividend-summary-card.stories.tsx`を追加する
- [ ] Server Componentで`getDividendPortfolioSummary()`だけを取得し、data fetchingと表示を分離する
- [ ] `apps/web/src/app/page.tsx`へカードを追加する
- [ ] 受取済み、年間予想、進捗、残り予想、次回予想、詳細リンクを表示する
- [ ] 既存の最初の3列gridの直後、DailyChangeの前に全幅で挿入する
- [ ] `データ未取得`、`対象銘柄なし`、`算出不可`を0円と区別する
- [ ] groupIdを詳細リンクへ引き継ぐ
- [ ] 既存のカードの位置と計算を変更しない
- [ ] EDINET company fiscal forecastしかない場合、対象年度・基準日・coverageを表示し、calendar-yearの進捗や次回月を推測しない

### 3.2 Existing stock component extension

- [ ] `HoldingsTable` / `HoldingsTableClient`へ外部データを注入するDTOを追加する
- [ ] 拡張箇所を`category === "株式(現物)"`の`CategoryCard`内に限定する
- [ ] `株式(現物)`だけに`銘柄別 / 業種別 / 配当利回り別`を表示する
- [ ] `銘柄別`の既存円グラフ・銘柄一覧・含み損益・評価損益率・前日比を回帰させない
- [ ] 業種別・利回り別は左側の集約breakdownを独立描画し、右側の銘柄色/indexと共有しない
- [ ] 右側銘柄一覧の構成比は常に株式カテゴリ全体に対する評価額割合とする
- [ ] 共通filter後の同じholding集合から左集約・右一覧・カテゴリ合計を再計算する
- [ ] 業種別を評価額ベースで表示する
- [ ] 利回り別を指定バケットで表示する
- [ ] unknown industry/yieldを0や推測値へ入れない
- [ ] 投資信託・預金・負債・アカウント詳細画面へ不要なタブを表示しない
- [ ] 新規client componentにstoryと必要なa11y確認を追加する

### 3.3 Dividend page and routing

- [ ] `apps/web/src/components/info/dividend-dashboard.tsx` / `.client.tsx` / `.stories.tsx`を追加し、Server ComponentはDB query、clientは操作だけを担当する
- [ ] `apps/web/src/components/charts/dividend-composition-chart.tsx` / `.stories.tsx`、`dividend-history-chart.tsx` / `.stories.tsx`を追加する。chartとdata fetchを混ぜない
- [ ] `apps/web/src/app/dividends/page.tsx` を追加する
- [ ] `apps/web/src/app/[groupId]/dividends/page.tsx` を追加する
- [ ] 配当ページ用のServer Componentと必要なclient componentを分離する
- [ ] Sidebarへ`配当・分配`を追加する
- [ ] `apps/web/src/lib/url.ts` のknown pathとactive判定を更新する
- [ ] profile切替・group切替後も`/dividends`ページを維持する
- [ ] `apps/web/src/components/layout/group-selector.client.tsx`と`profile-selector.client.tsx`で現在ページとqueryを維持し、scope変更後に存在しないaccount/securityを`all`へ戻す
- [ ] URL queryを正本にする: `year`, `account`, `product`, `security`, `includeForecast`, `view`, `granularity`
- [ ] 既定値・不正値・query順序・profile/group切替時の無効account/securityの扱いを実装する
- [ ] ページ内は現在scope内の口座・商品・銘柄・期間だけをfilterし、profile選択を重複させない
- [ ] 予想を含む/含まないを実装する
- [ ] 銘柄別/時系列、月次/年次を実装する
- [ ] 実績と予想の凡例とラベルを実装する
- [ ] `periodBasis=fiscal_year`の会社予想をcalendar-year実績・月次・remainingへ混ぜず、対象事業年度とbasisをKPI/一覧/CSVへ表示する
- [ ] 配当一覧を実装する
- [ ] 行クリックで詳細ダイアログまたはシートを開く
- [ ] 詳細に年間予想、予想利回り、Yield on Cost、イベント、履歴、source/asOfを表示する
- [ ] 詳細に現在数量、現在単価、平均取得単価、forecast DPS、対象年度、開示日、split basis warning、最大6年履歴を表示する
- [ ] 不明支払月を予定月未定/推定として表示する
- [ ] 640px未満で一覧を行カードへ縮退し、必要な業種・利回り・source/asOfを詳細展開で確認できる
- [ ] 切替buttonへ`aria-pressed`、行詳細へkeyboard操作、実績/予想/推定へテキストlabelを付ける
- [ ] グラフと同内容のテキスト一覧、Dialogの初期focus/Escape/focus return/内部scrollを確認する

### 3.4 CSV export

- [ ] `GET /api/dividends/export` などのrouteで既存`hasValidDashboardAccess()`を必須にする
- [ ] 画面と同じfilter/scopeをrouteで適用する
- [ ] URLのfilter parserを画面とCSVで共有し、view/granularityはファイルメタデータへ記録する
- [ ] UTF-8 BOM、`Content-Disposition`の安全なfilename、`Cache-Control: private, no-store`、basePath/trailingSlashを実装する
- [ ] 対象銘柄なしはdetail rowのないheader-only `200`、provider `empty`/`unsupported`は`200 text/csv`のstatus row、最終成功データありの更新失敗は`200 text/csv`で`dataStatus=stale`を返す
- [ ] `never_synced`またはキャッシュなしの`error`は`503 application/json`でCSVを返さず、statusと利用者向けメッセージを返す
- [ ] static demo（`output: export`）ではroute handlerがないためCSVボタンを非表示またはdisabledにする
- [ ] `=`, `+`, `-`, `@`で始まる文字列をformula injectionとして無害化する
- [ ] 次の列を最低限含める: 年、状態、受取/予想日、銘柄コード、銘柄名、市場、業種、口座、数量、DPS、金額、金額基準、税額、source、asOf
- [ ] 実績・予想・推定月・データなしをCSV列で区別する
- [ ] 別profile/groupの行を出力しない
- [ ] API keyや内部エラー本文をCSVへ出さない

## Phase 4: Verification

### 4.1 Unit and integration tests

- [ ] DB schema/repository/query testsを追加する
- [ ] EDINET adapterの正常・空・429・5xx・invalid response testsを追加する
- [ ] `security-code`のtrim/uppercase/`.T`/4桁・5桁末尾0/listed一意候補/ambiguous testsを追加する
- [ ] budget 0/1/89/90/100境界、`/usage`込みのrequest count、37銘柄の段階同期、TTL、partial success testsを追加する
- [ ] forecast latest disclosure、訂正、pre-split adjusted、indeterminate、Q4 target fiscal year testsを追加する
- [ ] receipt classifier testsを追加する
- [ ] group/profile/account filtering testsを追加する
- [ ] actual/forecast dedupe testsを追加する
- [ ] monthly/yearly and unknown payment month testsを追加する
- [ ] yield bucket and Yield on Cost boundary testsを追加する
- [ ] CSV serialization and filter testsを追加する
- [ ] url helper testsへ`dividends`を追加する
- [ ] component unit testsまたはStorybook storiesを追加する
- [ ] demo seedへforecastあり/なし、industry null、split adjusted、6年履歴、partial history、同一code複数口座、`security_unresolved` actual receiptの匿名ケースを追加する
- [ ] a11y fixtureへroot/groupの`dividends`を追加する
- [ ] `/dividends`の通常表示、filter展開後、詳細Dialog表示中にaxeを実行する
- [ ] `group-selector`/`profile-selector`経由のscope変更でもURL queryが維持・正規化されることをE2Eで確認する

### 4.2 Commands

実装後、変更範囲に応じて次を実行し、結果をEvidenceへ記録する。リポジトリ規約により開発中の`pnpm build`は、ユーザーが明示的に依頼するまで実行しない。

- [ ] `pnpm --filter @mf-dashboard/db test`
- [ ] `pnpm --filter @mf-dashboard/crawler test`
- [ ] `pnpm --filter @mf-dashboard/web test:unit`
- [ ] `pnpm --filter @mf-dashboard/web test:storybook`
- [ ] `pnpm --filter @mf-dashboard/db build:demo`（Playwright/E2Eとruntime起動より前）
- [ ] `pnpm --filter @mf-dashboard/web test:e2e`
- [ ] `pnpm turbo typecheck`
- [ ] `pnpm lint`
- [ ] `pnpm format:check`
- [ ] `pnpm knip`

### 4.3 Runtime and visual acceptance

- [ ] migration済み・seed済みの匿名demo DBでNext.jsを起動する
- [ ] ホームの既存カードと新規配当サマリーを確認する
- [ ] 資産の株式(現物)で3軸を切り替える
- [ ] 既存の含み損益・保有資産・資産推移が残っていることを確認する
- [ ] 配当ページの予想切替、期間、口座、商品、銘柄フィルターを確認する
- [ ] 銘柄別/時系列、月次/年次、詳細、CSVを確認する
- [ ] group/profile切替でscopeが混ざらないことを確認する
- [ ] API未取得、空データ、曖昧な実績、予定月不明で画面が壊れないことを確認する
- [ ] 銘柄未解決の実績が全体KPI・全体時系列・CSVには入り、銘柄別・業種別・利回り別には入らないことを確認する
- [ ] 銘柄未解決のCSVはsecurity列を空欄、状態列を`security_unresolved`とし、全体実績が銘柄解決済み＋銘柄未解決になることを確認する
- [ ] デスクトップと390px前後のモバイル幅で横overflowがないことを確認する
- [ ] a11yの主要エラー、フォーカス、ダイアログ閉じる操作を確認する
- [ ] 既存Playwright projectのChromium、Pixel 7、iPhone 14でsidebar遷移、group/profile scope、filter、detail、CSV、横overflowを確認する
- [ ] EDINET integration確認時はAPI keyを出さず、取得日時・件数・成功/失敗だけをEvidenceへ記録する

### 4.4 User acceptance scenarios

- [ ] ホームから現在のprofile/group scopeを保ったまま配当ページへ移動できる
- [ ] 今年の実績・予想のbasis（税引後/税引前）を画面だけで誤解しない
- [ ] 資産の3軸を切り替えても、既存の銘柄評価額・含み損益・前日比を確認できる
- [ ] 配当ページでfilterを変えたあと、画面の明細とCSVの明細が一致する
- [ ] mobileで一覧の省略項目を詳細から確認できる
- [ ] `未取得` / `対象外` / `算出不可` と実際の0円を識別できる
- [ ] 予定月不明・推定月が確定月として表示されない

Runtime evidence:

- 起動コマンド:
- URL:
- 使用DB: `demo.db` / その他の匿名fixture（実DBは禁止）
- 確認した画面:
- 目視確認:
- ブラウザ操作確認:
- 未確認事項:

## Phase 5: Completion and handoff

- [ ] `git diff --check` を実行する
- [ ] 変更ファイル一覧を確認し、実DB・secret・個人情報が含まれていないことを確認する
- [ ] plan.mdのAcceptance Criteriaを1つずつ判定する
- [ ] 本task.mdのチェックとEvidenceを更新する
- [ ] 実装済み、テスト済み、runtime確認済み、ユーザー未確認を分けて報告する
- [ ] ユーザーが明示しない限り、commit、push、PR、deploy、外部サービスへの書き込みを行わない

## Review record

### Sol medium review 1

- Agent: Dirac（Sol medium / plan-critic）
- Focus: data model / provider / aggregation / migration
- Result: `実施済み。High指摘を反映`
- Findings: marketを持たないMoney Forward側とのidentity、event改訂、receipt再同期、raw transaction、account未解決scope、sync status、年度/単位、Phase gate矛盾
- Accepted changes: `source + externalSecurityId` / `source + normalizedCode`、event economic key/revision、transactionsからの実績都度導出、raw値保全、sync status、暦年と決算年度分離、数値単位、Phase 0A/0Bを追加

### Sol medium review 2

- Agent: Poincare（Sol medium / plan-critic）
- Focus: UI / routing / acceptance / regression
- Result: `実施済み。High/Medium指摘を反映`
- Findings: 3軸breakdownの責務、URL query、state matrix、CSV auth/basePath、mobile/a11y、ホーム配置、E2E/user acceptance不足
- Accepted changes: 株式CategoryCard限定・母数同期、URL正本と既定値、状態マトリクス、CSV認証/headers/injection、mobile縮退/ARIA、ホーム挿入位置、Playwright E2Eと受入シナリオを追加

### Sol medium integrated review

- Agent: Dirac / Poincare（Sol medium / plan-critic）
- Focus: Downloads版統合後のdata model、EDINET budget、period basis、raw receipt、file map、UI/QA整合性
- Result: `最終確認OK`
- Accepted changes: stage別sync status、永続request budget ledger、rawCategory/rawSubCategory migration、`periodBasis`、既存`/runs`境界、selector/query維持、匿名`security_unresolved` seed、`build:demo`先行、DB subpath export、crawler server/file mapを追加

## Final evidence summary

| Evidence layer                 | Status | Evidence                       |
| ------------------------------ | ------ | ------------------------------ |
| Requirements and mock reviewed | 完了   | `plan.md` / user-provided mock |
| Current code investigation     | 完了   | plan.md Current State          |
| Production code                | 未着手 |                                |
| DB migration                   | 未着手 |                                |
| Unit tests                     | 未着手 |                                |
| Storybook/a11y                 | 未着手 |                                |
| Browser runtime                | 未着手 |                                |
| User acceptance                | 未実施 |                                |
