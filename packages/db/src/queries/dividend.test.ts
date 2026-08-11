import { describe, expect, it } from "vitest";
import { classifyDividendTransaction, toDividendCsv, type DividendDashboardData } from "./dividend";

const baseTransaction = {
  id: 1,
  date: "2026-06-30",
  accountId: 1,
  amount: 12000,
  type: "income",
  rawCategory: "配当所得",
  rawSubCategory: "国内株式",
  isTransfer: false,
  isExcludedFromCalculation: false,
};

describe("dividend query helpers", () => {
  it("matches an income transaction using the preserved Money Forward category", () => {
    expect(classifyDividendTransaction(baseTransaction)).toEqual({
      status: "matched",
      transactionId: 1,
      date: "2026-06-30",
      netAmount: 12000,
      amountBasis: "net",
    });
  });

  it("does not guess when the raw category is unavailable", () => {
    expect(
      classifyDividendTransaction({
        ...baseTransaction,
        rawCategory: null,
        rawSubCategory: null,
      }).status,
    ).toBe("unavailable");
  });

  it("rejects transfers and non-dividend income", () => {
    expect(classifyDividendTransaction({ ...baseTransaction, isTransfer: true }).status).toBe(
      "not_dividend",
    );
    expect(
      classifyDividendTransaction({ ...baseTransaction, rawCategory: "給与", rawSubCategory: null })
        .status,
    ).toBe("not_dividend");
  });

  it("escapes values in the CSV export", () => {
    const data: DividendDashboardData = {
      year: 2026,
      forecastFiscalYears: [],
      summary: {
        actualReceivedNet: null,
        forecastAnnualGross: null,
        forecastRemainingGross: null,
        unknownPaymentMonthGross: null,
        progressPct: null,
        calculationStatus: "data_unavailable",
        periodBasis: null,
        totalStockMarketValue: 0,
        coveredMarketValue: 0,
        coveragePct: null,
        coveredHoldingCount: 0,
        totalHoldingCount: 0,
      },
      securities: [
        {
          code: "7203",
          name: '=Company "A"',
          industryName: null,
          marketValue: 100000,
          quantity: 10,
          costValue: 90000,
          forecastDps: null,
          forecastAnnualGross: null,
          forecastYieldPct: null,
          yieldOnCostPct: null,
          forecastFiscalYear: null,
          periodBasis: null,
          dataStatus: "unavailable",
        },
      ],
      industries: [],
      yieldBuckets: [],
      monthlySeries: [],
      yearlySeries: [],
      sourceAsOf: null,
    };

    expect(toDividendCsv(data)).toContain('"\'=Company ""A"""');
    expect(toDividendCsv(data, false)).toContain('"100000","10","","","","","","unavailable"');
  });
});
