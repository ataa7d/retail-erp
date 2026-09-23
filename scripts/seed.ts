import "dotenv/config";
import bcrypt from "bcryptjs";
import { Client } from "pg";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query("BEGIN");

    const company = await client.query(
      `INSERT INTO companies (company_code, name_en, name_ar, cr_number, vat_registration_number, base_currency)
       VALUES ('DEMO', 'Demo Retail Group', 'مجموعة ديمو للتجزئة', '1010101010', '300000000000003', 'SAR')
       ON CONFLICT (company_code) DO UPDATE SET name_en = EXCLUDED.name_en
       RETURNING id`,
    );
    const companyId = company.rows[0].id as string;

    const branch = await client.query(
      `INSERT INTO branches (company_id, branch_code, name_en, name_ar, cr_number, vat_registration_number, city)
       VALUES ($1, 'HQ', 'Riyadh Main Branch', 'فرع الرياض الرئيسي', '1010101010', '300000000000003', 'Riyadh')
       ON CONFLICT (company_id, branch_code) DO UPDATE SET name_en = EXCLUDED.name_en
       RETURNING id`,
      [companyId],
    );
    const branchId = branch.rows[0].id as string;

    const store = await client.query(
      `INSERT INTO stores (company_id, branch_id, store_code, name_en, name_ar, store_type, city)
       VALUES ($1, $2, 'ST01', 'Riyadh Flagship Store', 'متجر الرياض الرئيسي', 'retail', 'Riyadh')
       ON CONFLICT (company_id, store_code) DO UPDATE SET name_en = EXCLUDED.name_en
       RETURNING id`,
      [companyId, branchId],
    );
    const storeId = store.rows[0].id as string;

    const passwordHash = await bcrypt.hash("ChangeMe123!", 10);
    const user = await client.query(
      `INSERT INTO users (email, password_hash, full_name_en, full_name_ar, preferred_language)
       VALUES ('admin@demo.local', $1, 'System Administrator', 'مدير النظام', 'en')
       ON CONFLICT (email) DO UPDATE SET full_name_en = EXCLUDED.full_name_en
       RETURNING id`,
      [passwordHash],
    );
    const userId = user.rows[0].id as string;

    await client.query(
      `INSERT INTO user_company_access (user_id, company_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, company_id) DO NOTHING`,
      [userId, companyId],
    );

    const role = await client.query(
      `INSERT INTO roles (company_id, name, description)
       VALUES ($1, 'Administrator', 'Full access to all modules')
       ON CONFLICT (company_id, name) DO UPDATE SET description = EXCLUDED.description
       RETURNING id`,
      [companyId],
    );
    const roleId = role.rows[0].id as string;

    await client.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT $1, id FROM permissions
       ON CONFLICT (role_id, permission_id) DO NOTHING`,
      [roleId],
    );

    await client.query(
      `INSERT INTO user_roles (user_id, company_id, role_id, store_id)
       VALUES ($1, $2, $3, NULL)
       ON CONFLICT (user_id, company_id, role_id, store_id) DO NOTHING`,
      [userId, companyId, roleId],
    );

    const fiscalYear = await client.query(
      `INSERT INTO fiscal_years (company_id, year_name, start_date, end_date)
       VALUES ($1, 'FY2026', '2026-01-01', '2026-12-31')
       ON CONFLICT (company_id, year_name) DO UPDATE SET start_date = EXCLUDED.start_date
       RETURNING id`,
      [companyId],
    );
    const fiscalYearId = fiscalYear.rows[0].id as string;

    for (let month = 1; month <= 12; month++) {
      const start = new Date(Date.UTC(2026, month - 1, 1));
      const end = new Date(Date.UTC(2026, month, 0));
      await client.query(
        `INSERT INTO fiscal_periods (fiscal_year_id, company_id, period_number, start_date, end_date)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (fiscal_year_id, period_number) DO NOTHING`,
        [fiscalYearId, companyId, month, start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)],
      );
    }

    // Minimal starter chart of accounts: top-level groups, plus the handful
    // of postable leaf accounts Phase 4's sales posting logic needs to
    // exist. Full detail is a Phase 1/4 review item, not something to
    // invent wholesale here.
    const groups: Array<[string, string, string, "asset" | "liability" | "equity" | "revenue" | "expense", "debit" | "credit"]> = [
      ["1000", "Assets", "الأصول", "asset", "debit"],
      ["2000", "Liabilities", "الخصوم", "liability", "credit"],
      ["3000", "Equity", "حقوق الملكية", "equity", "credit"],
      ["4000", "Revenue", "الإيرادات", "revenue", "credit"],
      ["5000", "Expenses", "المصروفات", "expense", "debit"],
    ];
    const groupIds: Record<string, string> = {};
    for (const [code, nameEn, nameAr, type, balance] of groups) {
      const r = await client.query(
        `INSERT INTO chart_of_accounts (company_id, account_code, name_en, name_ar, account_type, normal_balance, is_header)
         VALUES ($1, $2, $3, $4, $5, $6, true)
         ON CONFLICT (company_id, account_code) DO UPDATE SET name_en = EXCLUDED.name_en
         RETURNING id`,
        [companyId, code, nameEn, nameAr, type, balance],
      );
      groupIds[code] = r.rows[0].id as string;
    }

    const leafAccounts: Array<[string, string, string, "asset" | "liability" | "equity" | "revenue" | "expense", "debit" | "credit", string]> = [
      ["1110", "Cash & Cash Equivalents", "النقد وما في حكمه", "asset", "debit", "1000"],
      ["1120", "Accounts Receivable", "الذمم المدينة", "asset", "debit", "1000"],
      ["2110", "VAT Output Payable", "ضريبة القيمة المضافة المستحقة", "liability", "credit", "2000"],
      ["4110", "Sales Revenue", "إيرادات المبيعات", "revenue", "credit", "4000"],
      ["4120", "Sales Returns & Allowances", "مردودات ومسموحات المبيعات", "revenue", "debit", "4000"],
      ["1130", "Inventory Asset", "أصول المخزون", "asset", "debit", "1000"],
      ["5100", "Cost of Goods Sold", "تكلفة البضاعة المباعة", "expense", "debit", "5000"],
      ["5110", "Inventory Adjustments", "تسويات المخزون", "expense", "debit", "5000"],
      ["1140", "VAT Input Receivable", "ضريبة القيمة المضافة القابلة للاسترداد", "asset", "debit", "1000"],
      ["2120", "Goods Received Not Invoiced", "بضاعة مستلمة غير مفوترة", "liability", "credit", "2000"],
      ["2130", "Accounts Payable", "الذمم الدائنة", "liability", "credit", "2000"],
      ["2140", "Landed Cost Accrual", "استحقاق تكاليف الشحن والاستيراد", "liability", "credit", "2000"],
      ["5120", "Purchase Price Variance", "فرق سعر الشراء", "expense", "debit", "5000"],
      ["3100", "Retained Earnings", "الأرباح المحتجزة", "equity", "credit", "3000"],
      ["1115", "Bank - Main Account", "البنك - الحساب الرئيسي", "asset", "debit", "1000"],
      ["1210", "Fixed Assets - Equipment", "الأصول الثابتة - المعدات", "asset", "debit", "1000"],
      ["1290", "Accumulated Depreciation", "مجمع الإهلاك", "asset", "credit", "1000"],
      ["2200", "GOSI Payable", "التأمينات الاجتماعية المستحقة", "liability", "credit", "2000"],
      ["2210", "Salaries Payable", "الرواتب المستحقة", "liability", "credit", "2000"],
      ["4200", "Gain on Disposal of Assets", "أرباح استبعاد الأصول", "revenue", "credit", "4000"],
      ["5200", "Depreciation Expense", "مصروف الإهلاك", "expense", "debit", "5000"],
      ["5210", "Loss on Disposal of Assets", "خسائر استبعاد الأصول", "expense", "debit", "5000"],
      ["5300", "Salaries Expense", "مصروف الرواتب", "expense", "debit", "5000"],
      ["5310", "GOSI Expense (Employer)", "مصروف التأمينات الاجتماعية (صاحب العمل)", "expense", "debit", "5000"],
    ];
    const leafAccountIds: Record<string, string> = {};
    for (const [code, nameEn, nameAr, type, balance, parentCode] of leafAccounts) {
      const r = await client.query(
        `INSERT INTO chart_of_accounts (company_id, parent_id, account_code, name_en, name_ar, account_type, normal_balance, is_header)
         VALUES ($1, $2, $3, $4, $5, $6, $7, false)
         ON CONFLICT (company_id, account_code) DO UPDATE SET name_en = EXCLUDED.name_en
         RETURNING id`,
        [companyId, groupIds[parentCode], code, nameEn, nameAr, type, balance],
      );
      leafAccountIds[code] = r.rows[0].id as string;
    }

    // --- Phase 2: master data ---

    const pc = await client.query(
      `INSERT INTO units_of_measure (company_id, code, name_en, name_ar)
       VALUES ($1, 'PC', 'Piece', 'قطعة')
       ON CONFLICT (company_id, code) DO UPDATE SET name_en = EXCLUDED.name_en
       RETURNING id`,
      [companyId],
    );
    const pcUnitId = pc.rows[0].id as string;

    const box = await client.query(
      `INSERT INTO units_of_measure (company_id, code, name_en, name_ar)
       VALUES ($1, 'BOX', 'Box of 12', 'صندوق (12)')
       ON CONFLICT (company_id, code) DO UPDATE SET name_en = EXCLUDED.name_en
       RETURNING id`,
      [companyId],
    );
    const boxUnitId = box.rows[0].id as string;

    const taxCodes: Array<[string, string, string, string, "standard" | "zero_rated" | "exempt"]> = [
      ["VAT15", "Standard VAT 15%", "ضريبة القيمة المضافة 15%", "15", "standard"],
      ["VAT5", "Reduced VAT 5%", "ضريبة القيمة المضافة 5%", "5", "standard"],
      ["VAT0", "Zero-rated (export)", "معدل صفر (تصدير)", "0", "zero_rated"],
      ["EXEMPT", "VAT exempt", "معفى من الضريبة", "0", "exempt"],
    ];
    const taxCodeIds: Record<string, string> = {};
    for (const [code, nameEn, nameAr, rate, taxType] of taxCodes) {
      const r = await client.query(
        `INSERT INTO tax_codes (company_id, code, name_en, name_ar, rate, tax_type)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (company_id, code) DO UPDATE SET name_en = EXCLUDED.name_en
         RETURNING id`,
        [companyId, code, nameEn, nameAr, rate, taxType],
      );
      taxCodeIds[code] = r.rows[0].id as string;
    }

    const brand = await client.query(
      `INSERT INTO brands (company_id, code, name_en, name_ar)
       VALUES ($1, 'GEN', 'Generic', 'عام')
       ON CONFLICT (company_id, code) DO UPDATE SET name_en = EXCLUDED.name_en
       RETURNING id`,
      [companyId],
    );
    const brandId = brand.rows[0].id as string;

    const category = await client.query(
      `INSERT INTO categories (company_id, code, name_en, name_ar)
       VALUES ($1, 'APPAREL', 'Apparel', 'ملابس')
       ON CONFLICT (company_id, code) DO UPDATE SET name_en = EXCLUDED.name_en
       RETURNING id`,
      [companyId],
    );
    const categoryId = category.rows[0].id as string;

    const season = await client.query(
      `INSERT INTO seasons (company_id, code, name_en, name_ar)
       VALUES ($1, 'SS26', 'Spring/Summer 2026', 'ربيع/صيف 2026')
       ON CONFLICT (company_id, code) DO UPDATE SET name_en = EXCLUDED.name_en
       RETURNING id`,
      [companyId],
    );
    const seasonId = season.rows[0].id as string;

    const item = await client.query(
      `INSERT INTO items (company_id, item_code, name_en, name_ar, brand_id, category_id, season_id, item_year, default_tax_code_id)
       VALUES ($1, 'TS-001', 'Basic T-Shirt', 'تيشيرت أساسي', $2, $3, $4, 2026, $5)
       ON CONFLICT (company_id, item_code) DO UPDATE SET name_en = EXCLUDED.name_en
       RETURNING id`,
      [companyId, brandId, categoryId, seasonId, taxCodeIds.VAT15],
    );
    const itemId = item.rows[0].id as string;

    await client.query(
      `INSERT INTO item_units (item_id, unit_of_measure_id, conversion_factor, is_base)
       VALUES ($1, $2, 1, true)
       ON CONFLICT (item_id, unit_of_measure_id) DO NOTHING`,
      [itemId, pcUnitId],
    );
    await client.query(
      `INSERT INTO item_units (item_id, unit_of_measure_id, conversion_factor, is_base)
       VALUES ($1, $2, 12, false)
       ON CONFLICT (item_id, unit_of_measure_id) DO NOTHING`,
      [itemId, boxUnitId],
    );

    const variants: Array<[string, string, string, string]> = [
      ["TS-001-RED-M", "Red", "M", "6291000000011"],
      ["TS-001-RED-L", "Red", "L", "6291000000028"],
      ["TS-001-BLU-M", "Blue", "M", "6291000000035"],
    ];
    for (const [variantCode, color, size, barcode] of variants) {
      const v = await client.query(
        `INSERT INTO item_variants (company_id, item_id, variant_code, color, size)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (company_id, variant_code) DO UPDATE SET color = EXCLUDED.color
         RETURNING id`,
        [companyId, itemId, variantCode, color, size],
      );
      const variantId = v.rows[0].id as string;

      await client.query(
        `INSERT INTO item_barcodes (company_id, item_variant_id, unit_of_measure_id, barcode)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (company_id, barcode) DO NOTHING`,
        [companyId, variantId, pcUnitId, barcode],
      );
    }

    const customer = await client.query(
      `INSERT INTO customers (company_id, customer_code, name_en, name_ar, customer_type)
       VALUES ($1, 'CUST-001', 'Walk-in Customer', 'عميل نقدي', 'retail')
       ON CONFLICT (company_id, customer_code) DO UPDATE SET name_en = EXCLUDED.name_en
       RETURNING id`,
      [companyId],
    );

    await client.query(
      `INSERT INTO suppliers (company_id, supplier_code, name_en, name_ar, city, country, payment_terms_days, lead_time_days)
       VALUES ($1, 'SUP-001', 'Demo Textile Supplier', 'مورد المنسوجات التجريبي', 'Jeddah', 'Saudi Arabia', 30, 14)
       ON CONFLICT (company_id, supplier_code) DO UPDATE SET name_en = EXCLUDED.name_en`,
      [companyId],
    );

    const priceList = await client.query(
      `INSERT INTO price_lists (company_id, code, name_en, name_ar, price_includes_vat, is_default)
       VALUES ($1, 'RETAIL', 'Retail Price List', 'قائمة أسعار التجزئة', true, true)
       ON CONFLICT (company_id, code) DO UPDATE SET name_en = EXCLUDED.name_en
       RETURNING id`,
      [companyId],
    );
    const priceListId = priceList.rows[0].id as string;

    const priceListVariants = await client.query(
      `SELECT id FROM item_variants WHERE item_id = $1`,
      [itemId],
    );
    for (const row of priceListVariants.rows as Array<{ id: string }>) {
      await client.query(
        `INSERT INTO price_list_items (price_list_id, item_variant_id, price)
         VALUES ($1, $2, 49.00)
         ON CONFLICT (price_list_id, item_variant_id) DO NOTHING`,
        [priceListId, row.id],
      );
    }

    await client.query(
      `INSERT INTO asset_categories
         (company_id, code, name_en, name_ar, default_useful_life_months,
          asset_account_id, accumulated_depreciation_account_id, depreciation_expense_account_id)
       VALUES ($1, 'EQUIP', 'Equipment', 'معدات', 36, $2, $3, $4)
       ON CONFLICT (company_id, code) DO UPDATE SET name_en = EXCLUDED.name_en`,
      [companyId, leafAccountIds["1210"], leafAccountIds["1290"], leafAccountIds["5200"]],
    );

    const device = await client.query(
      `INSERT INTO pos_devices (company_id, store_id, device_code, device_name, series_prefix, created_by)
       VALUES ($1, $2, 'POS1', 'Flagship Till 1', 'ST01-POS1-', $3)
       ON CONFLICT (company_id, device_code) DO UPDATE SET device_name = EXCLUDED.device_name
       RETURNING id`,
      [companyId, storeId, userId],
    );
    const deviceId = device.rows[0].id as string;
    await client.query(
      `INSERT INTO pos_device_sequences (device_id, document_type)
       VALUES ($1, 'pos_invoice'), ($1, 'credit_note')
       ON CONFLICT (device_id, document_type) DO NOTHING`,
      [deviceId],
    );

    await client.query("COMMIT");
    console.log("Seed complete.");
    console.log(`  company_id = ${companyId}`);
    console.log(`  admin login = admin@demo.local / ChangeMe123!`);
    console.log(`  demo pos device = POS1 (series ST01-POS1-)`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
