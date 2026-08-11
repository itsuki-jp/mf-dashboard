import { relations } from "drizzle-orm";
import {
  foreignKey,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// ============================================================================
// マスタ系
// ============================================================================

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

export const groups = sqliteTable(
  "groups",
  {
    // Money Forwardのraw IDはmfGroupIdに保持し、idはprofileId:mfGroupIdで名前空間化する。
    id: text("id").primaryKey(),
    profileId: text("profile_id")
      .notNull()
      .references(() => moneyForwardProfiles.id, { onDelete: "cascade" }),
    mfGroupId: text("mf_group_id").notNull(),
    name: text("name").notNull(),
    isCurrent: integer("is_current", { mode: "boolean" }).default(false),
    lastScrapedAt: text("last_scraped_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("groups_profile_mf_group_idx").on(table.profileId, table.mfGroupId),
    uniqueIndex("groups_profile_id_pair_idx").on(table.profileId, table.id),
    index("groups_profile_id_idx").on(table.profileId),
  ],
);

// グループとアカウントの多対多関係を管理する中間テーブル
export const groupAccounts = sqliteTable(
  "group_accounts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    profileId: text("profile_id")
      .notNull()
      .references(() => moneyForwardProfiles.id, { onDelete: "cascade" }),
    groupId: text("group_id").notNull(),
    accountId: integer("account_id").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    foreignKey({
      name: "group_accounts_profile_group_fk",
      columns: [table.profileId, table.groupId],
      foreignColumns: [groups.profileId, groups.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "group_accounts_profile_account_fk",
      columns: [table.profileId, table.accountId],
      foreignColumns: [accounts.profileId, accounts.id],
    }).onDelete("cascade"),
    uniqueIndex("group_accounts_group_account_idx").on(table.groupId, table.accountId),
    index("group_accounts_group_id_idx").on(table.groupId),
    index("group_accounts_account_id_idx").on(table.accountId),
  ],
);

export const institutionCategories = sqliteTable("institution_categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  displayOrder: integer("display_order"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const accounts = sqliteTable(
  "accounts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    profileId: text("profile_id")
      .notNull()
      .references(() => moneyForwardProfiles.id, { onDelete: "cascade" }),
    mfId: text("mf_id").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull(), // "自動連携" / "手動"
    institution: text("institution"),
    categoryId: integer("category_id").references(() => institutionCategories.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    isActive: integer("is_active", { mode: "boolean" }).default(true),
  },
  (table) => [
    uniqueIndex("accounts_profile_mf_id_idx").on(table.profileId, table.mfId),
    uniqueIndex("accounts_profile_id_pair_idx").on(table.profileId, table.id),
    index("accounts_profile_id_idx").on(table.profileId),
    index("accounts_category_id_idx").on(table.categoryId),
  ],
);

export const assetCategories = sqliteTable("asset_categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ============================================================================
// ステータス系
// ============================================================================

// アカウントステータス（常に最新状態をupsert）
export const accountStatuses = sqliteTable("account_statuses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  accountId: integer("account_id")
    .notNull()
    .unique()
    .references(() => accounts.id, { onDelete: "cascade" }),
  status: text("status").notNull(), // "ok" / "error" / "updating" / "suspended" / "unknown"
  lastUpdated: text("last_updated"), // ISO 8601形式
  totalAssets: integer("total_assets").default(0), // /accountsページから取得した資産額
  errorMessage: text("error_message"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ============================================================================
// 銘柄・資産マスタ
// ============================================================================

// 銘柄マスタ（資産と負債を統一管理）
// Note: No unique constraint on (accountId, name, type) to allow duplicates
// (e.g., same fund in NISA/特定/一般 accounts)
export const holdings = sqliteTable(
  "holdings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    profileId: text("profile_id")
      .notNull()
      .references(() => moneyForwardProfiles.id, { onDelete: "cascade" }),
    mfId: text("mf_id"), // MFのraw識別子（ない場合もある）
    accountId: integer("account_id").notNull(),
    categoryId: integer("category_id").references(() => assetCategories.id, {
      onDelete: "set null",
    }), // 負債はnull
    name: text("name").notNull(),
    code: text("code"), // 銘柄コード（株式のみ）
    type: text("type").notNull(), // "asset" | "liability"
    liabilityCategory: text("liability_category"), // 負債の場合のカテゴリ（カード、ローン等）
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    isActive: integer("is_active", { mode: "boolean" }).default(true),
  },
  (table) => [
    foreignKey({
      name: "holdings_profile_account_fk",
      columns: [table.profileId, table.accountId],
      foreignColumns: [accounts.profileId, accounts.id],
    }).onDelete("cascade"),
    uniqueIndex("holdings_profile_mf_id_idx").on(table.profileId, table.mfId),
    index("holdings_profile_id_idx").on(table.profileId),
    index("holdings_account_id_idx").on(table.accountId),
  ],
);

// ============================================================================
// 市場データ・配当系
// ============================================================================

export const stockMarketData = sqliteTable(
  "stock_market_data",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    source: text("source").notNull(),
    externalSecurityId: text("external_security_id").notNull(),
    normalizedCode: text("normalized_code").notNull(),
    market: text("market"),
    name: text("name").notNull(),
    industryName: text("industry_name"),
    listingStatus: text("listing_status").notNull(),
    mappingStatus: text("mapping_status").notNull(),
    forecastFiscalYear: integer("forecast_fiscal_year"),
    forecastQuarter: text("forecast_quarter"),
    forecastDpsRaw: real("forecast_dps_raw"),
    forecastDpsAdjusted: real("forecast_dps_adjusted"),
    forecastShareBasis: text("forecast_share_basis"),
    forecastPeriodBasis: text("forecast_period_basis"),
    forecastSourceDisclosureDate: text("forecast_source_disclosure_date"),
    forecastAsOf: text("forecast_as_of"),
    lastMappedAt: text("last_mapped_at"),
    lastForecastFetchedAt: text("last_forecast_fetched_at"),
    lastHistoryFetchedAt: text("last_history_fetched_at"),
    lastErrorCode: text("last_error_code"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("stock_market_data_source_external_idx").on(table.source, table.externalSecurityId),
    uniqueIndex("stock_market_data_source_code_idx").on(table.source, table.normalizedCode),
    index("stock_market_data_industry_idx").on(table.industryName),
    index("stock_market_data_mapping_status_idx").on(table.mappingStatus),
  ],
);

export const stockDividendHistory = sqliteTable(
  "stock_dividend_history",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    stockMarketDataId: integer("stock_market_data_id")
      .notNull()
      .references(() => stockMarketData.id, { onDelete: "cascade" }),
    providerEventId: text("provider_event_id"),
    economicEventKey: text("economic_event_key").notNull(),
    eventVersionKey: text("event_version_key").notNull(),
    revision: integer("revision").notNull().default(1),
    fiscalYear: integer("fiscal_year").notNull(),
    paymentYear: integer("payment_year"),
    period: text("period"),
    status: text("status").notNull(),
    dpsRaw: real("dps_raw"),
    dpsAdjusted: real("dps_adjusted"),
    periodBasis: text("period_basis").notNull(),
    announcedAt: text("announced_at"),
    recordDate: text("record_date"),
    exDate: text("ex_date"),
    paymentDate: text("payment_date"),
    paymentDatePrecision: text("payment_date_precision").notNull(),
    source: text("source").notNull(),
    asOf: text("as_of"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("stock_dividend_history_source_event_version_idx").on(
      table.source,
      table.eventVersionKey,
    ),
    index("stock_dividend_history_stock_fiscal_idx").on(table.stockMarketDataId, table.fiscalYear),
    index("stock_dividend_history_payment_date_idx").on(table.paymentDate),
  ],
);

export const marketDataSyncStatuses = sqliteTable(
  "market_data_sync_statuses",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    source: text("source").notNull(),
    normalizedCode: text("normalized_code").notNull(),
    stage: text("stage").notNull(),
    status: text("status").notNull(),
    errorCode: text("error_code"),
    lastAttemptedAt: text("last_attempted_at"),
    lastSuccessAt: text("last_success_at"),
    nextAllowedAt: text("next_allowed_at"),
    ttlSeconds: integer("ttl_seconds"),
    asOf: text("as_of"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("market_data_sync_statuses_source_code_stage_idx").on(
      table.source,
      table.normalizedCode,
      table.stage,
    ),
    index("market_data_sync_statuses_status_idx").on(table.status),
  ],
);

export const marketDataRequestBudgets = sqliteTable(
  "market_data_request_budgets",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    source: text("source").notNull(),
    budgetWindowKey: text("budget_window_key").notNull(),
    providerTimezone: text("provider_timezone").notNull(),
    dailyLimit: integer("daily_limit").notNull(),
    softLimit: integer("soft_limit").notNull(),
    safetyReserve: integer("safety_reserve").notNull(),
    requestsReserved: integer("requests_reserved").notNull().default(0),
    requestsCompleted: integer("requests_completed").notNull().default(0),
    windowResetAt: text("window_reset_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("market_data_request_budgets_source_window_idx").on(
      table.source,
      table.budgetWindowKey,
    ),
  ],
);

// ============================================================================
// スナップショット系
// ============================================================================

export const dailySnapshots = sqliteTable(
  "daily_snapshots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    refreshCompleted: integer("refresh_completed", { mode: "boolean" }).default(true),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("daily_snapshots_date_idx").on(table.date)],
);

// 銘柄の日次評価額
export const holdingValues = sqliteTable(
  "holding_values",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    holdingId: integer("holding_id")
      .notNull()
      .references(() => holdings.id, { onDelete: "cascade" }),
    snapshotId: integer("snapshot_id")
      .notNull()
      .references(() => dailySnapshots.id, { onDelete: "cascade" }),
    amount: integer("amount").notNull(), // 評価額
    quantity: real("quantity"), // 数量（株式・投信）
    unitPrice: real("unit_price"), // 単価
    avgCostPrice: real("avg_cost_price"), // 平均取得単価
    dailyChange: integer("daily_change"), // 前日比（円）
    unrealizedGain: integer("unrealized_gain"), // 含み損益
    unrealizedGainPct: real("unrealized_gain_pct"), // 含み損益率
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("holding_values_holding_snapshot_idx").on(table.holdingId, table.snapshotId),
  ],
);

// ============================================================================
// 収支系
// ============================================================================

export const transactions = sqliteTable(
  "transactions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    profileId: text("profile_id")
      .notNull()
      .references(() => moneyForwardProfiles.id, { onDelete: "cascade" }),
    mfId: text("mf_id").notNull(),
    date: text("date").notNull(),
    accountId: integer("account_id"),
    category: text("category"), // 大項目 null = 振替（カテゴリなし）
    subCategory: text("sub_category"), // 中項目
    rawCategory: text("raw_category"), // Money Forwardから取得した正規化前の大項目
    rawSubCategory: text("raw_sub_category"), // Money Forwardから取得した正規化前の中項目
    description: text("description"),
    amount: integer("amount").notNull(),
    type: text("type").notNull(), // "income" / "expense" / "transfer"
    isTransfer: integer("is_transfer", { mode: "boolean" }).notNull().default(false),
    isExcludedFromCalculation: integer("is_excluded_from_calculation", {
      mode: "boolean",
    })
      .notNull()
      .default(false), // mf-grayout class
    transferTarget: text("transfer_target"),
    transferTargetAccountId: integer("transfer_target_account_id").references(() => accounts.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    foreignKey({
      name: "transactions_profile_account_fk",
      columns: [table.profileId, table.accountId],
      foreignColumns: [accounts.profileId, accounts.id],
    }).onDelete("cascade"),
    uniqueIndex("transactions_profile_mf_id_idx").on(table.profileId, table.mfId),
    index("transactions_profile_id_idx").on(table.profileId),
    index("transactions_profile_date_idx").on(table.profileId, table.date),
    index("transactions_profile_account_idx").on(table.profileId, table.accountId),
    index("transactions_date_idx").on(table.date),
    index("transactions_account_id_idx").on(table.accountId),
  ],
);

// ============================================================================
// 資産履歴系
// ============================================================================

export const assetHistory = sqliteTable(
  "asset_history",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    totalAssets: integer("total_assets").notNull(),
    change: integer("change").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("asset_history_group_date_idx").on(table.groupId, table.date),
    index("asset_history_group_id_idx").on(table.groupId),
  ],
);

export const assetHistoryCategories = sqliteTable(
  "asset_history_categories",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    assetHistoryId: integer("asset_history_id")
      .notNull()
      .references(() => assetHistory.id, { onDelete: "cascade" }),
    categoryName: text("category_name").notNull(),
    amount: integer("amount").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("asset_history_categories_history_category_idx").on(
      table.assetHistoryId,
      table.categoryName,
    ),
  ],
);

// ============================================================================
// 予算系
// ============================================================================

export const spendingTargets = sqliteTable(
  "spending_targets",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    largeCategoryId: integer("large_category_id").notNull(),
    categoryName: text("category_name").notNull(),
    type: text("type").notNull(), // "fixed" | "variable"
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("spending_targets_group_category_idx").on(table.groupId, table.largeCategoryId),
    index("spending_targets_group_id_idx").on(table.groupId),
  ],
);

// ============================================================================
// リレーション定義
// ============================================================================

export const moneyForwardProfilesRelations = relations(moneyForwardProfiles, ({ many }) => ({
  groups: many(groups),
  accounts: many(accounts),
  groupAccounts: many(groupAccounts),
  holdings: many(holdings),
  transactions: many(transactions),
}));

export const groupsRelations = relations(groups, ({ one, many }) => ({
  profile: one(moneyForwardProfiles, {
    fields: [groups.profileId],
    references: [moneyForwardProfiles.id],
  }),
  snapshots: many(dailySnapshots),
  groupAccounts: many(groupAccounts),
  assetHistories: many(assetHistory),
  spendingTargets: many(spendingTargets),
}));

export const groupAccountsRelations = relations(groupAccounts, ({ one }) => ({
  profile: one(moneyForwardProfiles, {
    fields: [groupAccounts.profileId],
    references: [moneyForwardProfiles.id],
  }),
  group: one(groups, {
    fields: [groupAccounts.profileId, groupAccounts.groupId],
    references: [groups.profileId, groups.id],
  }),
  account: one(accounts, {
    fields: [groupAccounts.profileId, groupAccounts.accountId],
    references: [accounts.profileId, accounts.id],
  }),
}));

export const accountsRelations = relations(accounts, ({ many, one }) => ({
  profile: one(moneyForwardProfiles, {
    fields: [accounts.profileId],
    references: [moneyForwardProfiles.id],
  }),
  holdings: many(holdings),
  status: one(accountStatuses, {
    fields: [accounts.id],
    references: [accountStatuses.accountId],
  }),
  transactions: many(transactions),
  groupAccounts: many(groupAccounts),
}));

export const accountStatusesRelations = relations(accountStatuses, ({ one }) => ({
  account: one(accounts, {
    fields: [accountStatuses.accountId],
    references: [accounts.id],
  }),
}));

export const holdingsRelations = relations(holdings, ({ one, many }) => ({
  profile: one(moneyForwardProfiles, {
    fields: [holdings.profileId],
    references: [moneyForwardProfiles.id],
  }),
  account: one(accounts, {
    fields: [holdings.profileId, holdings.accountId],
    references: [accounts.profileId, accounts.id],
  }),
  category: one(assetCategories, {
    fields: [holdings.categoryId],
    references: [assetCategories.id],
  }),
  values: many(holdingValues),
}));

export const stockMarketDataRelations = relations(stockMarketData, ({ many }) => ({
  dividendHistory: many(stockDividendHistory),
}));

export const stockDividendHistoryRelations = relations(stockDividendHistory, ({ one }) => ({
  stockMarketData: one(stockMarketData, {
    fields: [stockDividendHistory.stockMarketDataId],
    references: [stockMarketData.id],
  }),
}));

export const dailySnapshotsRelations = relations(dailySnapshots, ({ one, many }) => ({
  group: one(groups, {
    fields: [dailySnapshots.groupId],
    references: [groups.id],
  }),
  holdingValues: many(holdingValues),
}));

export const holdingValuesRelations = relations(holdingValues, ({ one }) => ({
  holding: one(holdings, {
    fields: [holdingValues.holdingId],
    references: [holdings.id],
  }),
  snapshot: one(dailySnapshots, {
    fields: [holdingValues.snapshotId],
    references: [dailySnapshots.id],
  }),
}));

export const transactionsRelations = relations(transactions, ({ one }) => ({
  profile: one(moneyForwardProfiles, {
    fields: [transactions.profileId],
    references: [moneyForwardProfiles.id],
  }),
  account: one(accounts, {
    fields: [transactions.profileId, transactions.accountId],
    references: [accounts.profileId, accounts.id],
  }),
}));

export const assetHistoryRelations = relations(assetHistory, ({ one, many }) => ({
  group: one(groups, {
    fields: [assetHistory.groupId],
    references: [groups.id],
  }),
  categories: many(assetHistoryCategories),
}));

export const assetHistoryCategoriesRelations = relations(assetHistoryCategories, ({ one }) => ({
  assetHistory: one(assetHistory, {
    fields: [assetHistoryCategories.assetHistoryId],
    references: [assetHistory.id],
  }),
}));

export const spendingTargetsRelations = relations(spendingTargets, ({ one }) => ({
  group: one(groups, {
    fields: [spendingTargets.groupId],
    references: [groups.id],
  }),
}));

// ============================================================================
// 分析系
// ============================================================================

export const analyticsReports = sqliteTable(
  "analytics_reports",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    // LLM生成コンテンツ
    summary: text("summary"),
    savingsInsight: text("savings_insight"),
    investmentInsight: text("investment_insight"),
    spendingInsight: text("spending_insight"),
    balanceInsight: text("balance_insight"),
    liabilityInsight: text("liability_insight"),
    // メタデータ
    model: text("model"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("analytics_reports_group_date_idx").on(table.groupId, table.date),
    index("analytics_reports_group_id_idx").on(table.groupId),
  ],
);

export const analyticsReportsRelations = relations(analyticsReports, ({ one }) => ({
  group: one(groups, {
    fields: [analyticsReports.groupId],
    references: [groups.id],
  }),
}));
