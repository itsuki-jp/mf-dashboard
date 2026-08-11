# 配当・分配分析機能 実装計画

ステータス: MVP実装済み・Sol medium実装レビュー対応済み / DB・EDINET同期・配当query・ホーム・資産3軸・配当ページ完了 / HTTP CSV・口座/商品filter・runtime・受入は未完了

## Latest implementation cycle

- CI修正サイクルを開始した。PR #18のCIログで、Crawlerのformat/lint警告、opsバックアップテストの時刻依存、static demo export時の配当ページ`searchParams`動的アクセスを確認した。まずformat/lint警告と型の明確化をatomic commitし、次にstatic demo対応、最後にopsテストの決定性を修正する。
- CI修正サイクル1では、`security-code.ts`をoxfmtで整形し、Crawlerのtyped mockとgroup配当ページの明示的props型でlint/typecheck警告を解消した。対象Crawler test 1件、`pnpm turbo typecheck` 8 packages、oxlint 545 files、対象format checkを通過した。
- Sol mediumの実装レビュー（Euler）で確認した、FY会社予想と暦年実績の表示混同、旧migration未適用DBの詳細画面、予想表示切替のCSV/UI不整合、同期失敗時の最終成功時刻消失を修正した。
- 配当ページは実績暦年と会社予想FYを見出し・KPI・CSVで明示的に分離し、`includeForecast=1|0`をURLへ反映する。銘柄詳細リンクは既存queryを保持する。
- 予想非表示時の画面内CSVは予想列を空欄にし、CSVセルのformula injectionを無害化する。業種・利回りの不明値は`データなし`へまとめる。
- provider同期statusのerror更新は、`lastSuccessAt`/`asOf`を未指定なら保持し、staleな最終成功データを参照できるようにする。
- 関連検証: DB 8 tests、Crawler 7 tests、Web unit 593 tests、対象Storybook 26 tests、`pnpm turbo typecheck` 8 packagesを通過。全体format/lint/knip、HTTP CSV、実ブラウザ受入は未完了。
- `itsuki-jp/mf-dashboard` のdraft PR #18（`codex/dividend-income-analysis` → `main`）を作成済み。`hiroppy/mf-dashboard`へは書き込んでいない。

## Integrated baseline and source documents

- 統合元: ユーザー提供のDownloads版`plan.md`/`task.md`、本ディレクトリの旧`plan.md`/`task.md`。
- 対象リポジトリ: `itsuki-jp/mf-dashboard`。GitHub上では`hiroppy/mf-dashboard`からforkされたリポジトリであり、originalを対象にはしない。
- Downloads版の確認基準: `origin/main` / `9cb06b9620901e7154f5c5b8c6e2947b29d3f2ff`。
- この作業の実装ブランチ: `codex/dividend-income-analysis`。作業開始時点で`main`と`origin/main`は同一commitだった。
- draft PRの対象: `itsuki-jp/mf-dashboard` のみ。`upstream`の`hiroppy/mf-dashboard`は読み取り専用とし、push・PR・issue作成を行わない。
- 現在のworktreeにある無関係な変更を戻したり、rootの`task.md`や既存の`plans/001-005`を上書きしたりしない。

Downloads版からは、EDINETの段階同期、無料枠のrequest budget、銘柄コード解決、分割調整DPS、実装ファイル一覧、demo/QAケースを取り込む。Downloads版の2テーブル案は、月別・実績/予想・改訂を表現できるように拡張し、後述の4テーブルをMVPの正本とする。

## Goal

Money Forwardから取得している「現在の保有資産・評価額・含み損益」を壊さずに、保有株式から「いつ・どの銘柄から・いくら配当を受け取ったか／受け取りそうか」を確認できる配当・分配分析機能を追加する。

この機能は、既存の資産額や含み損益を置き換えるものではない。既存機能が答える「今いくら持っていて、どれくらい評価損益があるか」に対し、追加機能は「その保有資産から、今年いくら入る見込みか、実績と予想の内訳は何か」を答える。

実装の基準画面は、ユーザー提供のローカルHTMLモックとする。モックの金額・銘柄名はサンプルであり、実データとして保存・テスト・表示しない。

## Why this is needed

現状のDashboardは資産構成、資産推移、保有資産、含み損益を表示できるが、配当の履歴・将来予測・業種別内訳・配当利回り別内訳・CSV出力は持っていない。Money Forwardの保有情報には株式コード、数量、平均取得単価、現在単価、評価額、含み損益などがあるが、配当イベントや発行会社の業種・予想DPSは別データである。

したがって、Money Forward保有データとEDINET DB等の市場データを、銘柄コードを軸に分離して結合する必要がある。受取済み配当は市場データから推定せず、Money Forwardの取引データで配当取引として確実に識別できたものだけを実績とする。

## Implementation Gate and MVP Boundary

外部APIの契約、銘柄identity、受取実績の分類規則が確定するまでは、実データを前提にしたschema・同期・集計を開始しない。Phase 0完了前に許可するのは、匿名fixtureによるadapterの変換骨格、未取得状態だけを表示するUI骨格、計画・テストケースの作成である。Phase 0AのAPI契約確認は完了したため、匿名fixtureと確定したレスポンス形状に基づくschema・adapter実装を開始する。

Phase 0が未完でもUIを先に作る場合は、画面に実額を表示するfixtureを本番経路へ接続しない。`未取得`、`対象外`、`算出不可` の状態を用いた表示確認に限定する。Phase 0完了後に、決定済みの契約に合わせてschema・同期・集計を実装する。

## Current State（コードで確認済み）

### 画面

- ホームは `apps/web/src/app/page.tsx:14-29` の `DashboardContent` が `PageLayout`、`AssetBreakdownChart`、`MonthlyBalanceCard`、`DailyChangeCard`、`AssetHistoryChart`、`MonthlyIncomeExpenseChart` を組み立てている。
- 資産画面は `apps/web/src/app/bs/page.tsx:15-27` の `BSContent` が `BalanceSheetChart`、`AssetHistoryChart`、`UnrealizedGainCard`、`HoldingsTable type="asset"`、`HoldingsTable type="liability"` を組み立てている。
- 保有資産の表示は `apps/web/src/components/info/holdings-table.tsx:29-143` と `holdings-table.client.tsx` に分かれている。サーバー側で最新値を取得し、クライアント側でカテゴリ別の円グラフ、銘柄一覧、展開行、ページング、共通フィルターを表示している。
- 現在のサイドバーは `apps/web/src/components/layout/sidebar.tsx`、ルート判定は `apps/web/src/lib/url.ts` にあり、`/dividends` と`/[groupId]/dividends`を既知パス・サイドバーへ追加済み。
- グループ別ルートは `apps/web/src/app/[groupId]/bs/page.tsx` のように、ルートページのContent関数を再利用する構成である。新規ページもルートとグループ別の両方を用意する。

### Money Forward取得・DB

- 株式は `apps/crawler/src/scrapers/portfolio.ts:441-487` で `.table-eq` から銘柄名、銘柄コード、口座、評価額、数量、平均取得単価、現在単価、前日比、含み損益、含み損益率を取得している。
- 型 `packages/db/src/types.ts:59-79` の `PortfolioItem` にも銘柄コードと保有情報がある。
- 保存は `packages/db/src/repositories/save-scraped-data.ts:286-308` で `holdings` と `holding_values` に行う。現行保存経路では配当情報を保存していない。
- `holdings.code` は `packages/db/src/schema/schema.ts` に存在し、最新保有値クエリ `packages/db/src/queries/holding.ts` の返却DTOへ`code`を追加済み。外部データ結合は`source + normalizedCode`で行う。
- `holding_values` は `amount`、`quantity`、`unitPrice`、`avgCostPrice`、`dailyChange`、`unrealizedGain`、`unrealizedGainPct` のみで、配当イベント・業種・利回りはない（`packages/db/src/schema/schema.ts:198-221`）。
- 既存の取引テーブルは `date`、`accountId`、`category`、`description`、`amount`、`type`、Money Forward IDなどを持つが、配当として正規化された種別はない（`packages/db/src/schema/schema.ts:227-245`）。
- `CashFlowItem` は `category`、`subCategory`、`description`、`amount`、`accountName` までで、銘柄コード、税額、gross/net区分、取引statusは持たない（`packages/db/src/types.ts:35-48`）。またCrawlerのカテゴリ決定処理は保存前のcategory/subCategoryを書き換えるため、配当分類に使うMoney Forward由来のraw値を先に保全する必要がある（`apps/crawler/src/category-decision/categorize-cash-flow.ts:58-85`、`apps/crawler/src/crawler-phases.ts:242-260,387-406`）。
- 取引は月単位で一度削除して再insertされるため、受取実績を別のmaterialized tableへ保存する場合は削除・金額訂正・分類変更とのreconciliationが必要になる（`packages/db/src/repositories/transactions.ts:148-166,238-270`）。MVPではこの古いreceipt問題を避けるため、実績は保存済みtransactionsから都度導出する。

### 既存機能として残すもの

- 含み損益カード、資産推移、バランスシート、既存の保有資産一覧、既存の銘柄別評価額・含み損益・評価損益率・前日比。
- `HoldingsTable` の負債表示、アカウント詳細画面、既存の共通フィルター、グループ/profileスコープ。
- 既存の「株式(現物)」の銘柄一覧と評価額を別の配当ページへ重複移植しない。新しいタブや詳細導線は既存の表示へ追加する。

## Target State

### 1. ホーム：配当・分配サマリーカード

`DashboardContent` に新しいServer Componentを追加し、今年の概要だけを表示する。

表示項目:

- 今年の受取済み配当・分配
- 年間予想配当・分配
- 受取進捗率。ただし実績と予想の金額基準が一致しない場合は `算出不可` とし、実績と予想を一つの割合へ混ぜない
- 残り予想額
- 次回の配当予想。支払日・月が外部ソースにない場合は `予定月未定` または `推定` と表示する
- `/dividends` への「配当・分配を詳しく見る」リンク

MVPの初期表示は、EDINET DBから確実に得られる会社予想DPS、年間予想額、予想利回り、データカバレッジを中心とする。Money Forward取引の実績分類と支払イベントのcalendar-year対応が未確定の間は、受取進捗、残り予想、正確な次回入金月を数値として表示せず、`未取得` / `算出不可` / `予定月未定`を表示する。外部providerが会計年度の年間予想しか返さない場合、画面ラベルに対象年度・基準日・「現在保有数量による参考run-rate」を併記する。

既存の資産構成・今月の収支・資産推移の意味や計算は変更しない。配当データが存在しない場合に `0円` と見せず、`配当データ未取得`、`対象銘柄なし`、`算出不可` のいずれかを状態に応じて表示する。

### 2. 資産：既存の株式(現物)表示に3つの表示軸

現行の `HoldingsTable` を全面的に作り直さず、カテゴリ `株式(現物)` に限って表示軸切替を追加する。

```text
[ 銘柄別 ] [ 業種別 ] [ 配当利回り別 ]
```

- `銘柄別`: 現行の評価額ベースの円グラフ、銘柄一覧、含み損益、評価損益率、前日比をそのまま維持する。
- `業種別`: 最新評価額を業種ごとに合算して表示する。業種不明は `業種データなし` にまとめ、0や推測の業種にしない。
- `配当利回り別`: 最新評価額を、外部ソースの予想配当利回りで次のバケットに分ける。

  - `0〜2%`
  - `2〜3%`
  - `3〜4%`
  - `4〜5%`
  - `5%以上`
  - `データなし`

- 拡張箇所は `HoldingsTableClient` の `category === "株式(現物)"` の `CategoryCard` 内に限定する。`銘柄別` だけが現行donutの銘柄色と一覧を共有する。
- 業種別・配当利回り別は、左側の集約breakdown UIを独立して描画する。右側の銘柄一覧と集約breakdownの色・tooltip・凡例を同じindexで対応付けない。
- 切替は表示軸だけを変え、既存の右側の銘柄一覧・評価額・含み損益の列を消さない。右側一覧の構成比は常に「株式(現物)カテゴリ全体に対する銘柄評価額の割合」とする。
- 共通フィルター適用時は、株式カテゴリ全体、左側の集約、右側一覧を同じfiltered holdingsから再計算する。
- 配当利回りが未取得の銘柄を0%バケットへ入れない。
- 投資信託、預金、負債など、株式以外の既存カテゴリの表示は変更しない。

### 3. 新規 `/dividends`：配当・分配の本体ページ

ルート:

- 全体表示: `/dividends`
- グループ表示: `/{groupId}/dividends`

ページ構成:

1. ページタイトル「配当・分配」と、受取実績・会社予想をまとめて確認する説明
2. 期間、現在のprofile/group scope内の口座、商品種別、銘柄の絞り込み。profile/group自体は既存ヘッダーで選択し、ページ内にprofile選択を重複させない
3. `予想を含む` / `受取済みのみ` の切替
4. 受取済み、残り予想、年間予想、受取進捗のサマリー
5. `銘柄別` / `時系列` の切替
6. 時系列選択時の `月次` / `年次` 切替
7. 実績と予想を色・ラベルで分離したグラフ
8. 銘柄別一覧。受取済み、年間予想、構成比、業種、利回りを表示
9. CSV出力
10. 銘柄行クリックで配当詳細を開く

会社予想が`periodBasis=fiscal_year`の場合は、ページ見出し・KPI・CSVへ対象事業年度とbasisを表示し、暦年の受取実績・月次グラフ・残り予想と同じ合計へ混ぜない。`calendar_year`または`event_sum`の支払イベントがそろった場合だけ、月次/年次の将来系列と進捗をbasis一致条件付きで有効化する。

配当詳細の表示項目:

- 銘柄コード、銘柄名、市場、業種
- 年間予想配当
- 予想配当利回り
- Yield on Cost。`年間予想配当 ÷ (平均取得単価 × 保有数量)` で算出できる場合だけ表示する
- 中間・期末などの配当イベント
- 実績の受取日・税引後受取額。取引として確実に識別できた場合だけ表示する
- 予想のDPS、数量、予想金額、予想の根拠・取得日時
- 過去の配当履歴
- 支払月が外部ソースから取れない場合の `予定月未定`、月を補完した場合の `推定`

モックのモーダルは、実装では既存UIのダイアログ/シート部品に合わせる。デスクトップとモバイルの双方で閉じる操作、フォーカス、キーボード操作、画面外へのはみ出しを確認する。

ホームのカードは、現行の最初の3列grid（`AssetBreakdownChart` と `MonthlyBalanceCard`）の直後、`DailyChangeCard` の前に全幅で挿入する。既存のgrid内の列幅やカード順を組み替えない。

### UI state matrix

| 状態                             | ホーム                               | 配当ページのKPI/グラフ                   | 銘柄一覧・詳細                           | CSV                                                                                                                    |
| -------------------------------- | ------------------------------------ | ---------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| actual netのみ                   | 税引後実績を表示、予想は未取得       | 実績のみ。進捗は`算出不可`               | 実績額とnetラベル                        | actual/net行のみ                                                                                                       |
| forecast grossのみ               | 年間予想を表示、実績は`未取得`       | 予想のみ。進捗は`算出不可`               | 予想額とgrossラベル                      | forecast/gross行                                                                                                       |
| actual/forecastあり、basis一致   | 比較可能な実績・予想・進捗           | 合算と進捗を表示                         | 実績・予想・残りを表示                   | basis一致を出力                                                                                                        |
| actual/forecastあり、basis不一致 | 各金額を分け、進捗は`算出不可`       | グラフも系列を分け、混合合計を表示しない | 金額basisを必ず表示                      | net/gross列を分ける                                                                                                    |
| 保有あり、市場データ未取得       | `配当データ未取得`                   | `未取得`状態。0円/0%にしない             | 銘柄は残し、外部項目は未取得             | statusのみ、推定値なし                                                                                                 |
| 実績はあるが銘柄未解決           | 全体実績へ含め、`銘柄未確定`を明示   | 全体KPI/時系列へ含め、銘柄別集計から除外 | 銘柄別・業種別・利回り別へ推測結合しない | security列を空欄、状態を`security_unresolved`                                                                          |
| 対象銘柄なし                     | カードを`対象銘柄なし`               | empty stateと取得導線                    | 一覧なし                                 | headerのみ、exit 200                                                                                                   |
| provider失敗                     | 既存ホームは表示、配当だけ`更新失敗` | stale/未取得を区別                       | 最終成功値があればstale表示              | staleありは`200 text/csv`で`dataStatus=stale`、成功値なしは`503 application/json`。static demoではCSVを非表示/disabled |
| 支払月不明/推定                  | 次回を`予定月未定`/`推定`            | 月次の通常月へ混ぜず別集計               | イベントにprecision表示                  | `paymentDatePrecision`列                                                                                               |

### URL and filter contract

配当ページの表示状態はURL queryを正本とする。既定値は `year=現在のJST暦年`、`account=all`、`product=all`、`security=all`、`includeForecast=1`、`view=security`、`granularity=month` とする。正規形は次の通り。

```text
/dividends?year=2026&account=all&product=all&security=all&includeForecast=1&view=security&granularity=month
```

不正値は既定値へ正規化し、queryの順序は固定する。profile/groupをヘッダーで切り替えたときは、現在ページとqueryを維持する。ただし新しいscopeに存在しないaccount/securityは`all`へ戻す。ページ内の`account`は現在のprofile/group scope内だけを対象とし、profile選択を重複させない。CSVは `year/account/product/security/includeForecast` を同じquery parserで受け、`view/granularity` は明細の抽出条件ではないためファイルのメタデータに記録する。

CSVの障害契約は固定する。最終成功データがあり、今回の外部更新だけが失敗した場合は`200`、`Content-Type: text/csv; charset=utf-8`、CSV内の`dataStatus=stale`で返し、取得時刻と最終成功時刻を含める。`empty`（正常取得したが配当なし）と`unsupported`（対象外）は障害ではないため`200 text/csv`で、金額明細ではなくstatus行を返す。対象銘柄なしはheader-onlyの`200`とする。`never_synced`またはキャッシュなしの`error`はCSVを返さず、`503 application/json`で機械可読な`status`と利用者向けメッセージを返す。static demo（`output: export`）ではroute handlerが存在しないため、CSVボタンを非表示またはdisabledにし、代替のダウンロードを装わない。

### Mobile and accessibility contract

640px未満では配当一覧を行カードへ縮退し、画面には銘柄名・実績・予想・statusだけを表示する。業種・利回り・source/asOf・DPSは詳細展開で確認できるようにする。切替は`button`と`aria-pressed`、行詳細はキーボードで操作できるbutton、実績/予想/推定は色以外のテキストラベルで表す。グラフの同値一覧を必ず併置し、Dialogは初期focus、Escape、focus return、内部スクロールを確認する。

## Data Contract

### Source ownership

| データ                                       | 正本候補                                            | 表示上の意味                           |
| -------------------------------------------- | --------------------------------------------------- | -------------------------------------- |
| 現在の銘柄コード・数量・評価額・平均取得単価 | Money Forward `holdings` / `holding_values`         | 現時点の保有状態                       |
| 銘柄名・市場・業種                           | EDINET DB等の銘柄マスタ                             | 銘柄の分類情報                         |
| 過去のDPS・中間/期末                         | EDINET DB等の配当履歴                               | 発表済みまたは確定した1株配当          |
| 会社予想DPS                                  | EDINET DB等の予想データ                             | 取得時点の会社予想。確定収入ではない   |
| 予想配当利回り                               | 外部ソースの値、またはDPSと株価からの明示的な再計算 | 利回りの基準日を必ず併記               |
| 受取済み配当                                 | Money Forward取引を分類できた場合のみ               | 実際の取引金額。税引後か税引前かを明示 |
| 正確な入金日                                 | Money Forward取引の実績日、または外部ソースの支払日 | 推定日を実績日として扱わない           |

### Provider interface and security identity

EDINET DBのレスポンス形式をWeb UIやDBスキーマへ直接漏らさない。`apps/crawler/src/market-data/` などにProvider adapterを置き、最低限次の内部型へ変換する。

```ts
interface SecurityFact {
  source: "edinet-db" | string;
  externalSecurityId: string | null;
  normalizedCode: string;
  market: string | null;
  name: string;
  industryName: string | null;
  currency: "JPY" | "USD" | string | null;
  currentDividendYield: number | null;
  forecastDividendYield: number | null;
  forecastPeriodBasis: "fiscal_year" | "calendar_year" | "event_sum" | null;
  asOf: string | null;
  fetchedAt: string;
}

interface DividendEvent {
  source: "edinet-db" | string;
  externalSecurityId: string | null;
  providerEventId: string | null;
  economicEventKey: string;
  eventVersionKey: string;
  revision: number | null;
  normalizedCode: string;
  fiscalYear: number;
  paymentYear: number | null;
  period: "interim" | "year_end" | "q1" | "q3" | "unknown";
  status: "actual" | "forecast";
  dpsGross: number | null;
  announcedAt: string | null;
  recordDate: string | null;
  exDate: string | null;
  paymentDate: string | null;
  paymentMonth: string | null;
  paymentDatePrecision: "exact" | "month_estimate" | "unknown";
  periodBasis: "fiscal_year" | "calendar_year" | "event_sum";
  sourceUpdatedAt: string | null;
  fetchedAt: string;
}
```

実際のEDINET DB API契約を受領したら、フィールド名・ページング・レート制限・HTTPエラー・認証方式をこのadapter内で確定する。UIやDB側でAPIレスポンスの推測をしない。

MVPはEDINET DBで一意に同定できる国内上場株式を対象とする。Money Forward側は銘柄コードしか持たないため、保有側の結合キーは `normalizedCode` を基本とし、marketは外部metadataとして保持する。providerの同一 `normalizedCode` に複数候補がある場合、marketを推測して結合せず `ambiguous_match` として除外する。DBのcanonical keyは `source + externalSecurityId`、Money Forwardからの照合キーは `source + normalizedCode` とし、nullable marketを一意制約の主キーにしない。

### EDINET DB operational profile（Downloads版から統合）

実API確認日: 2026-08-11。Downloads版の想定を実レスポンスで補正し、次を実装プロファイルとして採用する。

- ベースURLは`https://edinetdb.jp/v1`、認証は`X-API-Key`。Webのrender中には呼ばず、Crawler側adapterだけから呼ぶ。
- 証券コード解決は`GET /companies?sec_code={4桁または末尾0付き5桁}`。レスポンスの候補は`edinet_code`, `sec_code`, `name`, `industry`, `listing_status`, `is_delisted`を持つ。
- 企業情報・業種・配当予想は`GET /companies/{edinetCode}?fields=profile,forecast_doe`。`forecast_doe`は`forecast_dividend_per_share`, `forecast_dividend_total`, `forecast_fiscal_year`, `source_disclosure_date`, `source_quarter`, `value`を返す。
- 過去履歴は`GET /companies/{edinetCode}/financials?years=6`。実レスポンスには`fiscal_year`, `dividend_per_share`, `adjusted_dividend_per_share`, `adjusted_interim_dividend_per_share`, `adjusted_yearend_dividend_per_share`, `dividends_total_announced`, `submit_date`等が含まれる。
- 決算短信は企業配下の`/companies/{edinetCode}/earnings`であり、単独の`/v1/earnings` endpointは実装前提にしない。
- `GET /usage`は`data`内に`daily_limit`, `daily_remaining`, `today_count`, `monthly_limit`, `monthly_remaining`, `plan`等を返す。同期実装では予算台帳を正本とし、usageは観測用に扱う。
- 無料枠の暫定上限は100 requests/day、soft budgetは90、safety reserveは5とする。`/usage`自身も1 requestとして数え、APIのremaining値だけに依存せず当該runの実行数をローカルで数える。daily windowのtimezone・reset時刻はPhase 0でprovider仕様を確認し、JSTと異なる場合は`budgetWindowKey`をprovider基準で作る。
- 初回同期は、distinctな保有銘柄コードを対象に mapping → 最新予想 → 過去履歴の順で段階実行する。例えば37銘柄ならmapping 37件と予想37件を優先し、履歴は残budget分だけにして翌runへ繰り越す。100件を超える全件一括取得は禁止する。
- 暫定TTLはmapping 30日、forecast 24時間、history 7日。新規銘柄はTTLより優先する。429は当該EDINET runを停止し、5xx/networkは銘柄単位でerror保存して次へ進む。連続失敗閾値や並列数はAPI契約に合わせて下げられる。
- 暫定実行制限は最大同時4銘柄、指数backoff付き最大2回retry、銘柄単位の部分成功とする。既存Money Forward scrapeの成功/失敗とEDINET同期の成功/失敗は別状態にする。

### 銘柄コード解決

`normalizeSecurityCode`を純粋関数として作り、trim、uppercase、末尾`.T`除去を行う。4文字の英数字で少なくとも1文字が数字のものを国内株候補とし、条件外は`unsupported`とする。5桁の証券コードが返り、Money Forward側が4桁の場合は数字のみ末尾`0`を除いた比較を候補にするが、自動採用は候補が1件かつ`sec_code`一致・`listing_status=listed`の場合だけに限定する。0件、複数件、未知の上場状態、企業名だけの一致は`unresolved`/`ambiguous_match`とし、market推測や名前の曖昧一致で結合しない。

### 予想DPSと分割調整

`earnings`の返却順を正本にせず、forecast DPSがnullでない開示レコードを開示日時・訂正情報で比較し、最新のforecast-bearing recordを選ぶ。`forecast_share_basis=pre_split`かつadjusted値がある場合だけadjusted forecast DPSを表示・利回り計算へ使う。`indeterminate`はraw値を保持し、分割基準要確認として表示する。Q1〜Q3とQ4のforecast target fiscal yearの対応はAPI契約で確認し、確認できない場合は推測せず`forecast target year unavailable`とする。

EDINETが全期の会社予想DPSを返す場合、`forecastAnnualGross = effectiveForecastDps × 現在数量`を基本とする。イベント単位のforecastしか返さない場合は、経済イベントごとの最新revision（actualがあればactual、なければforecast）を合算して同じDTOへ正規化する。actual化で年間予想が不自然に減らないよう、年間会社予想と受取実績は別系列で保持し、`forecastRemainingGross`だけを未来の未実績forecastへ限定する。

### Crawler同期の境界

Money Forwardのprofileループ終了後、成功profileが1件以上ある場合だけ、DBへ保存された最新holdingsからglobalなdistinct `normalizedCode`を集めてEDINET同期を1回行う。全profileが失敗した場合はEDINET同期をskipする。EDINET同期のwarningやnotifyWebRefresh失敗をMoney Forwardのfailure aggregateへ混ぜない。API keyはCrawler processだけへ渡し、レスポンス本文・key・個人データをログに出さない。

数値契約は次で固定する。利回りはパーセント値（`3.5` = 3.5%）、DPSはsourceの小数を保持、予想金額・実績金額・税額はJPY整数、DPS×数量の円未満は`Math.round`相当の四捨五入とする。MVPではJPY以外の通貨換算をしない。

銘柄単位の派生値は、query/domain function側で一貫して計算する。

```text
annualForecastGross = effectiveForecastDps * quantity
currentDividendYieldPct = effectiveForecastDps / unitPrice * 100
yieldOnCostPct = effectiveForecastDps / avgCostPrice * 100
```

`quantity`、`unitPrice`、`avgCostPrice`、`effectiveForecastDps`がnullまたは非有限、価格が0以下の場合は該当値を`算出不可`とする。ポートフォリオでは`totalStockMarketValue`、forecastが計算可能な`coveredMarketValue`、`coveragePct = coveredMarketValue / totalStockMarketValue * 100`、covered/total holding countを別々に返し、coverage未達の利回りに「全保有銘柄」と誤解させるラベルを付けない。

### Actual receipt contract

Money Forwardの取引から配当を分類する場合は、次の判別可能な4状態を返す。

- `matched`: 配当取引と確定できる。受取日、金額、口座、元取引IDを含むDTOを返す
- `not_dividend`: 配当ではない。配当集計へ入れない
- `ambiguous`: 配当の可能性はあるが確定できない。実績へ入れず、内部ログにも個人情報や取引本文を残さない
- `unavailable`: raw分類値・金額基準・口座など必要な入力が欠け、配当/非配当を判定できない。実績へ入れず、`算出不可`として扱う

金額が税引後しかない場合は `netAmount` のみ返し、税引前を逆算しない。実績と予想で金額基準が違う場合は、画面の各カード・CSVに `税引後実績` / `税引前予想` を明示する。両者を合算した「進捗率」は比較可能な場合のみ数値化する。`matched` の必須条件は正のJPY金額、日付、元取引ID、解決済みaccount、確定済みのraw配当分類とし、全amountがnullのreceiptは作らない。

## Proposed Data Model

名称は実装時に既存の命名規則とEDINET DBの契約に照合するが、責務は次のように分ける。

### `stock_market_data`（security masterの実装名）

外部データを銘柄コード単位でキャッシュする。profileやgroupに依存しない。Downloads版の`stock_market_data`を採用しつつ、provider固有のEDINET codeと将来providerを区別できる列を必須にする。

- `id`, `source`, `externalSecurityId`, `normalizedCode`, `market`, `name`, `industryName`, `currency`, `listingStatus`, `mappingStatus`
- `currentDividendYield`, `forecastDividendYield`
- `forecastSourceFiscalYear`, `forecastTargetFiscalYear`, `forecastSourceQuarter`, `forecastDpsGross`, `adjustedForecastDpsGross`, `forecastShareBasis`, `forecastPeriodBasis`, `forecastDisclosureDate`
- `sourceAsOf`, `lastForecastSyncedAt`, `lastHistorySyncedAt`, `fetchedAt`, `lastSyncErrorCode`
- `createdAt`, `updatedAt`
- `source + externalSecurityId` の一意制約（未解決でnullの行はpartial uniqueまたはSQLiteのNULL semanticsを確認）。現在保有とのcache rowは`source + normalizedCode`で一意にし、provider候補が曖昧な場合は候補を保存して推測結合せず、同じrowを`mappingStatus=ambiguous`にする
- `mappingStatus` は`pending` / `resolved` / `unresolved` / `ambiguous` / `unsupported`、`lastSyncErrorCode`は機械可読な短いコードだけを保存する

### `stock_dividend_history`（履歴・配当eventの実装名）

発表済み実績・会社予想をイベント単位で保存する。テーブル名はDownloads版に合わせるが、年次履歴だけではなく中間/期末・forecast改訂・支払日精度も保存する。

- `id`, `stockMarketDataId`, `providerEventId`, `economicEventKey`, `eventVersionKey`, `revision`, `fiscalYear`, `paymentYear`, `period`, `status`
- `dpsGross`, `adjustedDpsGross`, `announcedAt`, `recordDate`, `exDate`, `paymentDate`, `paymentMonth`, `periodBasis`
- `paymentDatePrecision`, `source`, `sourceUpdatedAt`, `fetchedAt`
- `createdAt`, `updatedAt`
- `eventVersionKey` はnon-nullとし、`providerEventId + revision` または `economicEventKey + revision` から正規化して生成する。provider応答から経済イベントを一意に導出できずキーを作れない行は保存拒否し、sync statusを`status=error, sourceErrorCode=invalid_identity`として記録する。DBでは`source + eventVersionKey`を一意にする
- `stockMarketDataId` FKには`onDelete: cascade`、`source + eventVersionKey` unique、銘柄・決算年度・支払年度・status用indexを付ける
- forecastからactualへ遷移したときに同じ経済イベントを二重計上しないcurrent/revision規則

### `market_data_sync_statuses`

銘柄ごとの外部データ同期状態を保存し、未同期・配当なし・対象外・API失敗・古い成功を区別する。

- `id`, `source`, `normalizedCode`, `externalSecurityId` nullable
- `stage` (`mapping` / `forecast` / `history`)
- `status` (`never_synced` / `success` / `empty` / `unsupported` / `error` / `stale`)
- `lastAttemptAt`, `lastSuccessAt`, `fetchedAt`, `sourceErrorCode` nullable
- `createdAt`, `updatedAt`
- `source + normalizedCode + stage` の一意制約。外部IDが不明な対象も状態を保存できるようにする

### `market_data_request_budgets`

プロセス再起動・scheduler/manual runの並行実行後も、providerの日次request budgetを守るための永続ledger。実行内カウンタだけで上限を判断しない。

- `id`, `source`, `budgetWindowKey`, `providerTimezone`, `dailyLimit`, `softLimit`, `requestsReserved`, `requestsCompleted`, `lastUsageFetchedAt`
- `createdAt`, `updatedAt`
- `source + budgetWindowKey` の一意制約
- 全provider requestは、Phase 0で確定したprovider基準timezoneのwindow ledgerに対する原子的なreservationを先に取得する。reservation失敗時はAPIを呼ばず、sync statusを`status=error, sourceErrorCode=budget_exhausted`として記録する
- `/usage`もreservation対象に含める。Crawler runは単一sync lockを使うが、lockだけでbudget上限を代替しない

受取済み配当はMVPでは新規テーブルへmaterializeしない。保存済み `transactions` から `DividendReceipt` DTOを都度導出する。これにより月次の削除・再insert、金額訂正、分類変更が次回queryに反映される。Crawlerが正規化前のcategory/subCategoryを上書きするため、`transactions`へnullableな`rawCategory`、`rawSubCategory`を追加し、保存時にMoney Forward由来の値を先に保全する。`description`が保存前に変換されないことを確認し、変換される場合だけ`rawDescription`追加を別migrationとして行う。過去行にraw値がない場合は `unavailable` とする。安定したmaterialized receiptへ移行する場合は、元transaction FK、再分類version、削除・訂正reconciliationを別計画として追加する。

すべての新規テーブルに `createdAt` / `updatedAt` と明示的な外部キーの `onDelete` を付ける。スキーマ変更時は `packages/db/drizzle/0003_*.sql` と `docs/architecture/database-schema.md` を同時に更新する。実DBをmigrationテストに使わず、空DBまたはdemo DBだけを使う。

## Aggregation Rules

1. グループ/profileのscopeは、既存の `getHoldingsWithLatestValues` と同じ解決規則を使う。全体表示でprofileを跨ぐときも、口座・取引・配当イベントを二重加算しない。accountIdがnullの取引はgroup/口座集計へ入れず、`口座未解決` として状態だけを残す。
2. 銘柄結合は `source + normalizedCode` を基本にし、provider側で一意に解決できる場合だけsecurityへ結合する。銘柄名の完全一致、市場の推測、同一コードの曖昧な候補への自動結合はしない。
3. actualの画面年は入金・支払の暦年とし、外部イベントの会社決算年度 `fiscalYear` と、配当の支払暦年 `paymentYear` を別に保存する。全期会社forecastは`periodBasis=fiscal_year`として対象事業年度の予想と表示し、支払イベントがない限り暦年・月次・remainingへ配賦しない。event単位の予想だけを合算した場合は`periodBasis=event_sum`と表示し、権利日時点の受給資格を保証しない。
4. `forecastAnnualGross` は、providerが全期forecast DPSを返す場合はeffective forecast DPS × 最新保有数量、event単位forecastしか返さない場合は各経済イベントの最新revision（actual DPSがあればactual、なければforecast）合計 × 最新保有数量で計算する。結果へ`periodBasis`を付け、数量が取れない場合は `算出不可` とし、actual化で年間予想が不自然に減らないことを確認する。
5. `forecastRemainingGross` は支払日がasOfより未来、または将来月と明示できる予想イベントだけを対象とする。actualとの経済イベント対応キーが確定できない場合は、残り予想を表示せず `算出不可` とする。
6. 予想イベントが重複する場合は`source + eventVersionKey`でdedupeする。経済イベントごとに最新revisionを選び、actualがあればactual DPS、actualがなければforecast DPSを年間予想へ採用する。forecastからactualへ遷移したイベントはactualを優先し、actual化済みのDPSを年間予想から消さない。`forecastRemainingGross`だけは未来の未実績forecastに限定する。
7. 予想配当利回りは、外部値の基準日とsourceを保持する。外部値がない銘柄は利回り不明であり、0%ではない。
8. Yield on Costは平均取得単価・数量・年間予想DPSのすべてが有限値の場合だけ計算する。分母0、数量不明、銘柄コード不明は `算出不可`。
9. 月次集計は `paymentDate` があるイベントをその月へ置く。日付がなく月だけある場合は `month_estimate`、どちらもない場合は `予定月未定` に分ける。決算月から支払月を暗黙に断定しない。
10. 受取実績は保存済みtransactionsから、`mfId`、日付、解決済みaccount、正の金額、確定済みのraw配当分類がそろったものだけを導出する。銘柄まで解決できた行は銘柄別・全体時系列・CSVへ入れる。銘柄コード欠落/曖昧の`security_unresolved`行は全体KPI・全体時系列・CSVには入れるが、銘柄別/業種別/利回り別へ推測結合せず、未確定額として明示する。金額基準不明またはaccount未解決はscreenの金額集計から除外し、`unavailable`/`account_unresolved`状態で残す。
11. Money Forwardの同一取引を、外部イベントのactualとして再度加算しない。実績と予想は状態・source・event keyで分離する。

## Implementation Phases

### Phase 0A: External contract and identity gate

- EDINET DB APIのbase URL、認証、レスポンス例、ページング、レート制限、対象市場、業種、DPS、予想DPS、利回り、配当履歴、支払日を一次資料で確認する。
- APIにない項目を「ある」と前提にしない。特に正確な税引後受取額と将来入金月は、Money Forward取引やAPIのどちらにもない場合がある。
- 国内株式をMVP対象とし、対象外市場は `対象外` / `データなし` として安全に表示する。米国株対応を追加する場合は、別Providerを同じ内部型へ変換する設計にする。
- `EDINET_DB_API_KEY` 等のsecretは`.env`、DB、Git、テストログに書かない。
- Gate通過条件: adapterの内部型、`source + externalSecurityId` / `source + normalizedCode` のidentity、eventの改訂キー、会社年度と支払暦年、数値単位、取得不能時のUI状態が文書で確定している。

### Phase 0B: Receipt and scope gate

- Money Forwardの配当分類は、正規化categoryではなく保存前のraw category/subCategory/descriptionを対象にする。raw値を保全できない過去取引は `unavailable` とする。
- `matched` の必須条件、accountId未解決の扱い、銘柄コード照合不能の扱い、actual net/gross/taxの基準を確定する。
- 画面のKPIを `actualReceivedNet`、`forecastAnnualGross`、`forecastRemainingGross`、`unknownPaymentMonthGross`、`calculationStatus` に分離し、合算可能な条件を確定する。
- Gate通過条件: group/profile/account scopeと、actual/forecastを二重計上しないreconciliation規則が文書で確定している。

### Phase 1: Storage and provider（Phase 0A/0B完了後）

- `stock_market_data`、`stock_dividend_history`、`market_data_sync_statuses` のDrizzle schema・migration・repositoryを追加する。
- EDINET DB adapter、レスポンス変換、ページング、429/5xx/認証エラー、timeout、空レスポンスを実装する。
- source keyを決め、同じレスポンスを2回取り込んでも件数・値が増えないupsertを実装する。
- Money Forward取引のraw値を保全できるようにし、配当分類を匿名fixtureで `matched` / `not_dividend` / `ambiguous` / `unavailable` に分ける。分類結果はtransactionsから都度導出し、materialized receiptは作らない。
- 外部データ更新はMoney Forwardのブラウザscrapeと分離し、API keyを持つCrawler側のmarket-data syncから実行する。UIのrender中に外部APIへ直接アクセスしない。
- EDINET syncは既存Crawlerの`/runs`手動実行・scheduler・lock/auth境界へ組み込み、別の`/dividends/refresh` endpointをMVPの必須条件にしない。データだけを更新する専用endpointを後から追加する場合も、既存Bearer認証・lock・progressを再利用する。対象は現在保有のdistinct `normalizedCode`に限定し、既定TTLはmapping 30日、forecast 24時間、history 7日、最大同時4銘柄、銘柄単位の部分成功、指数バックオフ付き最大2回再試行とし、`market_data_sync_statuses`へ結果を保存する。Money Forwardのscrape失敗と外部API失敗を同じ成功状態にしない。

### Phase 2: Queries and aggregation

- `getHoldingsWithLatestValues` 等に`code`、必要なsecurity metadataを追加する。Money Forward側にmarketがないため、marketを保有データから埋めない。
- `packages/db/src/queries/dividend.ts` に、summary、monthly/yearly series、by-security、by-industry、by-yield、detail、CSV用の共通queryを追加する。
- group/profile/account/period/filterを共通入力型で扱い、Server ComponentとCSV routeで集計結果が一致するようにする。
- 未取得、対象外、推定、算出不可、実績、予想の状態をDTOで明示する。
- 年度境界、月境界、JST、未来期間、空scope、複数profileをテストする。

### Phase 3: Web UI

- `DividendSummaryCard` をホームへ追加する。既存カードの計算・表示は変更しない。
- `HoldingsTable` の `株式(現物)` カテゴリだけに `銘柄別 / 業種別 / 配当利回り別` の表示軸を追加する。既存の銘柄明細と共通フィルターを維持する。
- `apps/web/src/app/dividends/page.tsx` と `apps/web/src/app/[groupId]/dividends/page.tsx` を追加する。
- Sidebarの既知パス・表示項目・active判定を更新する。profile/group切替で現在のページを維持する。
- 配当ページに期間・口座・商品・銘柄フィルター、予想切替、銘柄別/時系列、月次/年次、詳細ダイアログ、CSV導線を追加する。
- 既存のCard、Table、Dialog、AmountDisplay、Recharts、semantic monetary color classを再利用し、配当固有のCSSを必要最小限にする。
- 新規componentsには対応する`.stories.tsx`を作る。実データではなく匿名のdemo propsを使う。

### Phase 4: Verification and rollout

- DB migrationを空DBとdemo DBで検証する。`data/moneyforward.db` は使わない。
- DB query、Crawler adapter/classifier、Web component、URL helper、CSV routeに単体テストを追加する。
- Storybookのa11y、web unit、db/crawler test、typecheckを実行する。
- `pnpm --filter @mf-dashboard/db build:demo`で匿名demo DBを再生成してから、Playwright/runtime確認を行う。実DBをseed sourceにしない。
- 既存のPlaywright project（Chromium、Pixel 7、iPhone 14）で`/dividends`のsidebar遷移、group/profile query維持、filter/CSV、mobile表示をE2E検証する。
- demo DBで実際のNext.js画面を起動し、ホーム、資産、配当ページ、詳細、フィルター、CSV、グループ切替、モバイル幅をブラウザで確認する。既存のChromium、Pixel 7、iPhone 14のPlaywright projectを使用する。
- EDINET DB APIを使うintegration確認は、API keyをログへ出さず、取得日時・件数・成功/失敗だけを記録する。
- 実装完了判定は、コード・テスト・runtime・ユーザー受入を分けてtask.mdへ記録する。

## Concrete implementation map

この節はDownloads版のファイル粒度を統合した実装順の索引である。別エージェントは新規ファイル名を勝手に増やさず、既存の責務分離に合わせて配置する。

### DB / repository / query

- `packages/db/src/schema/schema.ts`: `stock_market_data`、`stock_dividend_history`、`market_data_sync_statuses`、`market_data_request_budgets`。加えて`transactions.rawCategory/rawSubCategory`を必要なmigrationとして扱う。
- `packages/db/src/repositories/stock-market-data.ts`: sync対象コード取得、security upsert、forecast/history upsert、mapping/status更新。
- `packages/db/src/repositories/market-data-budget.ts`: provider基準timezoneのbudget windowに対する原子的reservation/completion。
- `packages/db/src/queries/dividend.ts`: summary、security rows、monthly/yearly、industry、yield bucket、detail、CSV query。
- `packages/db/package.json`: 必要なrepository/queryのsubpath export。`packages/db/src/index.ts`へ新たなbarrel exportを追加しない。
- `packages/db/drizzle/0003_*.sql` と `docs/architecture/database-schema.md`: migration、index、FK `onDelete`、ERDを同時更新する。

### Crawler / provider

- `apps/crawler/src/market-data/edinet-db-client.ts`: base URL、X-API-Key、timeout、HTTP/JSON parse、sanitized error。
- `apps/crawler/src/market-data/security-code.ts`: code normalizationとmapping candidate判定。
- `apps/crawler/src/market-data/sync-stock-market-data.ts`: budget、TTL、dedupe、partial success、retry、status保存。
- `apps/crawler/src/server.ts` と関連server tests: 既存`/runs`のBearer auth・同時実行・レスポンス契約を変更せず、必要なら同期statusをprogressへ反映する。
- `apps/crawler/src/run.ts` / `crawler-phases.ts`: Money Forward保存後のEDINET sync接続。
- 各`*.test.ts`: API response shape、code normalization、split basis、budget、429/5xx/empty、同一レスポンス再同期を匿名fixtureで検証する。
- `apps/crawler/src/run.ts`、`crawler-phases.ts`、`server.ts`、`crawler-run-lock.ts`、`crawler-progress.ts`の既存profile loop・manual `/runs`・lock・progressへ接続する。成功profileが1件以上の場合だけglobal syncをbest-effortで実行し、Money Forward failure aggregateと分離する。

### Web / route / component

- `apps/web/src/components/info/dividend-summary-card.tsx` と`.stories.tsx`: ホームsummaryのServer Componentと匿名Story。
- `apps/web/src/components/info/dividend-dashboard.tsx` / `.client.tsx` / `.stories.tsx`: 配当ページのfetchとinteractive UI。
- `apps/web/src/components/charts/dividend-composition-chart.tsx` / `.stories.tsx`、`dividend-history-chart.tsx` / `.stories.tsx`: pure chart。
- `apps/web/src/app/dividends/page.tsx`、`apps/web/src/app/[groupId]/dividends/page.tsx`: root/group route。
- `apps/web/src/app/api/dividends/export/route.ts`（または既存route規約に合う同等path）: 認証済みCSV export。static exportではbuttonをdisabled/非表示。
- `apps/web/src/app/page.tsx`、`apps/web/src/components/info/holdings-table*.tsx`: 既存表示を維持した追加。
- `apps/web/src/components/layout/sidebar.tsx`、`apps/web/src/lib/url.ts`、対応stories/tests: `dividends` pathとactive判定。
- `apps/web/src/components/layout/group-selector.client.tsx`、`profile-selector.client.tsx`、関連stories/tests: scope変更時の現在ページ・query維持と無効filter解除。
- `packages/db/src/seed.ts`および必要な匿名seed module: forecast有無、industry null、split adjusted、6年/partial history、同一code複数口座、`security_unresolved`のケース。

### Recommended query DTOs

```ts
getDividendPortfolioSummary(scope, filters): Promise<DividendPortfolioSummary>
getDividendHoldingRows(scope, filters): Promise<DividendHoldingRow[]>
getStockPortfolioBreakdown(scope, filters): Promise<StockPortfolioBreakdown>
getStockDividendDetail(scope, securityId): Promise<StockDividendDetail | null>
getDividendExportRows(scope, filters): Promise<DividendExportRow[]>
```

既存の`resolveGroupIds`、`getAccountIdsForGroups`、`hasValidDashboardAccess`を再利用し、Web queryとCSV routeでscope resolver・filter parser・計算結果を共有する。

## Acceptance Criteria

### Data correctness

- 同じ外部APIレスポンスを再取り込みしても、security/event/sync-statusの重複行が増えない。
- 同一provider budget window内のrequestをprocess再起動やmanual/scheduler競合をまたいで予約しても、`market_data_request_budgets`のdaily limitを超えない。
- `source + externalSecurityId` とeventのeconomic key/revisionで、forecast改訂・forecastからactualへの遷移を再現できる。
- Money Forward取引の削除、金額訂正、matchedからambiguousへの変更が次の集計へ反映され、古いreceiptが残らない。
- Money Forward由来のrawCategory/rawSubCategoryが正規化categoryとは別に保全され、raw値がない過去行は`unavailable`になる。
- 銘柄コードが同じでもprovider候補が曖昧な場合にmarketを推測して誤結合しない。
- 保有数量・DPS・利回り・支払日がない場合、0円・0%・確定日へ補完しない。
- actual receiptは確実に分類されたMoney Forward取引だけで、外部のactual dividend eventと二重計上しない。
- 税引後実績と税引前予想を画面・CSV上で区別する。
- `periodBasis=fiscal_year`の全期会社forecastがcalendar-year実績、月次、remainingへ誤配賦されず、対象年度とbasisが画面・CSVに出る。
- `groupId`、profile、口座、期間フィルターが既存のscopeと一致し、別profileの配当が混ざらない。
- URL queryの既定値・不正値・profile/group切替後の維持規則が固定され、画面とCSVが同じfilter parserを使う。
- mapping・forecast・historyを段階同期し、soft budgetと実行済みrequest数の両方で1日100 requestsを超えない。
- 最新のforecast-bearing recordを開示日時で選び、split-adjusted値の採用条件と`indeterminate`状態を保持する。
- providerが返す範囲で過去最大6年のDPS履歴を保存し、partial historyをエラーではなく`history pending`/`データなし`として表示する。
- forecastが計算可能な保有額と全保有額を分け、coverage 100%未満の利回りを全体利回りと誤認させない。

### UI behavior

- ホームにサマリーカードが表示され、詳細リンクで現在のgroup/profileを保ったまま配当ページへ遷移する。
- 資産画面で銘柄別・業種別・配当利回り別を切り替えても、既存の含み損益・評価額・銘柄一覧が消えない。
- 配当ページで予想の有無、年、口座/商品を切り替えると、サマリー・グラフ・一覧が同じscopeで更新される。
- 銘柄別と時系列、月次と年次、詳細ダイアログ、CSV出力が動作する。
- 予定月不明・推定・データなし・算出不可が視覚的に区別される。
- 空データ、外部API未取得、APIエラー、銘柄コードなしでもページ全体が壊れない。
- 既存のホーム・資産・アカウント画面に回帰がない。モバイル幅で横スクロールを発生させない。
- 業種別・利回り別の集約グラフと右側銘柄一覧が別の責務で描画され、共有フィルター後の母数だけが一致する。

### Operational and privacy

- API key、実DB、実取引本文、個人名、口座番号をfixture、story、ログ、Gitへ書かない。
- 外部API停止時は既存のMoney Forward資産画面を表示でき、配当領域だけが未取得状態になる。
- API更新の失敗とMoney Forward scrapeの失敗を別状態として表示・記録する。
- CSV routeは既存の `hasValidDashboardAccess()` でfail closedし、profile/group scopeを共通resolverで検証する。`Cache-Control: private, no-store`、UTF-8 BOM、`Content-Disposition`の安全なfilename、0件時のheaderのみ、CSV formula injection対策、basePath/trailingSlashを受入条件にする。

## Risks and Open Questions

### Open questions before implementation

1. EDINET DB APIは国内株式以外の銘柄、米国株、ETF、投資信託をどこまで返すか。MVPは国内上場株式以外を対象外とする。
2. `forecast_dividend_per_share` は会社予想かデータ提供元の推定か。予想の基準日・改訂履歴を保存できるか。
3. 配当履歴の対象日は権利落ち日、基準日、支払日、決算年度のどれか。画面の月次軸に使える支払日が取得できるか。
4. Money Forward取引で配当を確実に分類できるカテゴリ・description・口座条件は何か。税引前、税額、税引後がそれぞれ取得できるか。
5. 税引後予想への換算はMVPでは行わない。APIまたは業務ルールが確定した場合だけ、別タスクで追加する。
6. APIレート制限・認証方式が、既定TTL24時間・最大同時4銘柄・最大2回再試行で安全か。超える場合はprovider契約に合わせて数値を下げる。
7. CSVには現在scope内の口座名を含め、profile名は現在scopeの識別に必要な場合だけ含める。認証・scope検証は既存helperへ統一する。

### Fail-safe decisions

- 上記の回答が未確定でも、既存の資産・含み損益を壊さず、配当ページを `データ未取得` として実装できる。
- 正確な税引後実績が取れなければ、実績を0円とせず、実績カードを `算出不可` にする。
- 正確な将来入金月が取れなければ、月次グラフに無理に割り当てず `予定月未定` を別集計する。
- APIが返さない業種・利回りは、`業種データなし` / `データなし` へ分け、推定値で埋めない。

## Non-goals

- 既存の含み損益、資産推移、バランスシート、保有資産一覧を新しい投資分析画面へ置き換えること。
- 売買注文、投資助言、銘柄の売買推奨、自動リバランス。
- APIに存在しない税引後配当や支払日を、税率・決算月・一般的な慣行から断定すること。
- 実DBや個人のMoney Forward認証状態をfixtureとして利用すること。

## Handoff

実装担当は最初にこの `plan.md` と同じディレクトリの `task.md` を読み、Phase 0A/0Bのgateを完了してからschema・同期・集計のコード変更へ進む。gate前に許可するのは匿名fixtureによるadapter骨格と未取得UI骨格だけである。未確認の業務定義はtask.mdのOpen Questionsへ追記し、勝手に0や推定値へ寄せない。作業対象外のルート・既存機能・rootの `task.md` は変更しない。
