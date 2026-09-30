/**
 * Everything a brand-new company needs to be immediately usable, factored
 * out of scripts/seed.ts (which does this by hand for the one demo
 * company) so POST /companies can do the same for a real one: the company
 * row itself, one branch + store to attach stock/sales to, a fiscal year
 * with 12 monthly periods, a starter chart of accounts, one unit of
 * measure, a handful of tax codes at the rate the admin enters, and an
 * Administrator role (every permission) granted to whoever created it.
 *
 * Deliberately NOT cloned from seed.ts: demo items/customers/suppliers/
 * price lists/POS devices. Those are real catalog/master data the admin
 * adds themselves through screens that already exist -- a brand-new
 * company isn't supposed to start with someone else's fake data in it.
 */
import type { PoolClient } from "pg";

export interface BootstrapCompanyParams {
  companyCode: string;
  nameEn: string;
  nameAr: string;
  country: string;
  baseCurrency: string;
  crNumber?: string | null;
  vatRegistrationNumber?: string | null;
  vatRate: number;
  fiscalYearStart: string; // 'YYYY-MM-DD', first day of the fiscal year
  createdByUserId: string;
}

const COA_GROUPS: Array<[string, string, string, "asset" | "liability" | "equity" | "revenue" | "expense", "debit" | "credit"]> = [
  ["1000", "Assets", "الأصول", "asset", "debit"],
  ["2000", "Liabilities", "الخصوم", "liability", "credit"],
  ["3000", "Equity", "حقوق الملكية", "equity", "credit"],
  ["4000", "Revenue", "الإيرادات", "revenue", "credit"],
  ["5000", "Expenses", "المصروفات", "expense", "debit"],
];

// Same generic starter set seed.ts uses -- covers every posting path
// (sales, purchasing, inventory, payroll, fixed assets, gift
// cards/loyalty/deposits) without being Saudi-specific beyond the
// bilingual names, which this app carries everywhere regardless of
// company country.
const COA_LEAVES: Array<[string, string, string, "asset" | "liability" | "equity" | "revenue" | "expense", "debit" | "credit", string]> = [
  ["1110", "Cash & Cash Equivalents", "النقد وما في حكمه", "asset", "debit", "1000"],
  ["1115", "Bank - Main Account", "البنك - الحساب الرئيسي", "asset", "debit", "1000"],
  ["1120", "Accounts Receivable", "الذمم المدينة", "asset", "debit", "1000"],
  ["1130", "Inventory Asset", "أصول المخزون", "asset", "debit", "1000"],
  ["1140", "VAT Input Receivable", "ضريبة القيمة المضافة القابلة للاسترداد", "asset", "debit", "1000"],
  ["1210", "Fixed Assets - Equipment", "الأصول الثابتة - المعدات", "asset", "debit", "1000"],
  ["1290", "Accumulated Depreciation", "مجمع الإهلاك", "asset", "credit", "1000"],
  ["2110", "VAT Output Payable", "ضريبة القيمة المضافة المستحقة", "liability", "credit", "2000"],
  ["2120", "Goods Received Not Invoiced", "بضاعة مستلمة غير مفوترة", "liability", "credit", "2000"],
  ["2130", "Accounts Payable", "الذمم الدائنة", "liability", "credit", "2000"],
  ["2140", "Landed Cost Accrual", "استحقاق تكاليف الشحن والاستيراد", "liability", "credit", "2000"],
  ["2150", "Gift Card Liability", "التزام بطاقات الهدايا", "liability", "credit", "2000"],
  ["2160", "Loyalty Points Liability", "التزام نقاط الولاء", "liability", "credit", "2000"],
  ["2170", "Customer Deposits", "دفعات العملاء المقدمة", "liability", "credit", "2000"],
  ["2200", "GOSI Payable", "التأمينات الاجتماعية المستحقة", "liability", "credit", "2000"],
  ["2210", "Salaries Payable", "الرواتب المستحقة", "liability", "credit", "2000"],
  ["3100", "Retained Earnings", "الأرباح المحتجزة", "equity", "credit", "3000"],
  ["4110", "Sales Revenue", "إيرادات المبيعات", "revenue", "credit", "4000"],
  ["4120", "Sales Returns & Allowances", "مردودات ومسموحات المبيعات", "revenue", "debit", "4000"],
  ["4200", "Gain on Disposal of Assets", "أرباح استبعاد الأصول", "revenue", "credit", "4000"],
  ["5100", "Cost of Goods Sold", "تكلفة البضاعة المباعة", "expense", "debit", "5000"],
  ["5110", "Inventory Adjustments", "تسويات المخزون", "expense", "debit", "5000"],
  ["5120", "Purchase Price Variance", "فرق سعر الشراء", "expense", "debit", "5000"],
  ["5130", "Loyalty Program Expense", "مصروف برنامج الولاء", "expense", "debit", "5000"],
  ["5200", "Depreciation Expense", "مصروف الإهلاك", "expense", "debit", "5000"],
  ["5210", "Loss on Disposal of Assets", "خسائر استبعاد الأصول", "expense", "debit", "5000"],
  ["5300", "Salaries Expense", "مصروف الرواتب", "expense", "debit", "5000"],
  ["5310", "GOSI Expense (Employer)", "مصروف التأمينات الاجتماعية (صاحب العمل)", "expense", "debit", "5000"],
  ["5400", "Foreign Exchange Gain/Loss", "أرباح وخسائر فروق العملة", "expense", "debit", "5000"],
];

export async function bootstrapCompany(client: PoolClient, p: BootstrapCompanyParams): Promise<{ companyId: string }> {
  const company = await client.query<{ id: string }>(
    `INSERT INTO companies (company_code, name_en, name_ar, country, base_currency, cr_number, vat_registration_number)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [p.companyCode, p.nameEn, p.nameAr, p.country, p.baseCurrency, p.crNumber ?? null, p.vatRegistrationNumber ?? null],
  );
  const companyId = company.rows[0]!.id;

  const branch = await client.query<{ id: string }>(
    `INSERT INTO branches (company_id, branch_code, name_en, name_ar) VALUES ($1, 'HQ', 'Head Office', 'المكتب الرئيسي') RETURNING id`,
    [companyId],
  );
  const branchId = branch.rows[0]!.id;

  await client.query(
    `INSERT INTO stores (company_id, branch_id, store_code, name_en, name_ar) VALUES ($1, $2, 'ST01', 'Main Store', 'المتجر الرئيسي')`,
    [companyId, branchId],
  );

  const role = await client.query<{ id: string }>(
    `INSERT INTO roles (company_id, name, description) VALUES ($1, 'Administrator', 'Full access to all modules') RETURNING id`,
    [companyId],
  );
  const roleId = role.rows[0]!.id;
  await client.query(`INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions`, [roleId]);
  await client.query(`INSERT INTO user_company_access (user_id, company_id) VALUES ($1, $2)`, [p.createdByUserId, companyId]);
  await client.query(`INSERT INTO user_roles (user_id, company_id, role_id, store_id) VALUES ($1, $2, $3, NULL)`, [
    p.createdByUserId,
    companyId,
    roleId,
  ]);

  const startDate = new Date(p.fiscalYearStart + "T00:00:00Z");
  const yearName = `FY${startDate.getUTCFullYear()}`;
  const fiscalYear = await client.query<{ id: string }>(
    `INSERT INTO fiscal_years (company_id, year_name, start_date, end_date) VALUES ($1, $2, $3, $4) RETURNING id`,
    [companyId, yearName, p.fiscalYearStart, new Date(Date.UTC(startDate.getUTCFullYear() + 1, startDate.getUTCMonth(), startDate.getUTCDate() - 1)).toISOString().slice(0, 10)],
  );
  const fiscalYearId = fiscalYear.rows[0]!.id;
  for (let month = 0; month < 12; month++) {
    const periodStart = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + month, startDate.getUTCDate()));
    const periodEnd = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + month + 1, startDate.getUTCDate() - 1));
    await client.query(
      `INSERT INTO fiscal_periods (fiscal_year_id, company_id, period_number, start_date, end_date) VALUES ($1, $2, $3, $4, $5)`,
      [fiscalYearId, companyId, month + 1, periodStart.toISOString().slice(0, 10), periodEnd.toISOString().slice(0, 10)],
    );
  }

  const groupIds: Record<string, string> = {};
  for (const [code, nameEn, nameAr, type, balance] of COA_GROUPS) {
    const r = await client.query<{ id: string }>(
      `INSERT INTO chart_of_accounts (company_id, account_code, name_en, name_ar, account_type, normal_balance, is_header)
       VALUES ($1, $2, $3, $4, $5, $6, true) RETURNING id`,
      [companyId, code, nameEn, nameAr, type, balance],
    );
    groupIds[code] = r.rows[0]!.id;
  }
  for (const [code, nameEn, nameAr, type, balance, parentCode] of COA_LEAVES) {
    await client.query(
      `INSERT INTO chart_of_accounts (company_id, parent_id, account_code, name_en, name_ar, account_type, normal_balance, is_header)
       VALUES ($1, $2, $3, $4, $5, $6, $7, false)`,
      [companyId, groupIds[parentCode], code, nameEn, nameAr, type, balance],
    );
  }

  await client.query(
    `INSERT INTO units_of_measure (company_id, code, name_en, name_ar) VALUES ($1, 'PC', 'Piece', 'قطعة')`,
    [companyId],
  );

  const rate = p.vatRate.toString();
  const taxCodes: Array<[string, string, string, string, "standard" | "zero_rated" | "exempt"]> = [
    ["STD", `Standard VAT ${p.vatRate}%`, `ضريبة القيمة المضافة ${p.vatRate}%`, rate, "standard"],
    ["ZERO", "Zero-rated (export)", "معدل صفر (تصدير)", "0", "zero_rated"],
    ["EXEMPT", "VAT exempt", "معفى من الضريبة", "0", "exempt"],
  ];
  for (const [code, nameEn, nameAr, taxRate, taxType] of taxCodes) {
    await client.query(
      `INSERT INTO tax_codes (company_id, code, name_en, name_ar, rate, tax_type) VALUES ($1, $2, $3, $4, $5, $6)`,
      [companyId, code, nameEn, nameAr, taxRate, taxType],
    );
  }

  return { companyId };
}
