import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, withTransaction } from "../db.js";
import {
  createPurchaseOrder,
  postPurchaseOrder,
  createGoodsReceipt,
  postGoodsReceipt,
  createSupplierInvoice,
  postSupplierInvoice,
} from "../../purchasing/purchasingService.js";
import { NotFoundError } from "../errors.js";

const lineSchema = z.object({
  itemVariantId: z.string().uuid(),
  qty: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  discountAmount: z.number().nonnegative().default(0),
  vatRate: z.number().nonnegative(),
  priceIncludesVat: z.boolean(),
});

const currencyCode = z.string().regex(/^[A-Z]{3}$/, "currency must be a 3-letter ISO code like USD");

const createSchema = z.object({
  storeId: z.string().uuid(),
  supplierId: z.string().uuid(),
  orderDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  expectedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  fiscalPeriodId: z.string().uuid(),
  lines: z.array(lineSchema).min(1),
  currency: currencyCode.optional(),
  exchangeRate: z.number().positive().nullable().optional(),
});

const goodsReceiptLineSchema = z.object({
  purchaseOrderLineId: z.string().uuid(),
  itemVariantId: z.string().uuid(),
  qtyReceived: z.number().positive(),
});

const goodsReceiptChargeSchema = z.object({
  chargeType: z.string().min(1),
  amount: z.number().nonnegative(),
  allocationBasis: z.enum(["value", "weight"]).default("value"),
  description: z.string().optional(),
});

const goodsReceiptCreateSchema = z.object({
  storeId: z.string().uuid(),
  purchaseOrderId: z.string().uuid(),
  supplierId: z.string().uuid(),
  receiptDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fiscalPeriodId: z.string().uuid(),
  lines: z.array(goodsReceiptLineSchema).min(1),
  charges: z.array(goodsReceiptChargeSchema).optional(),
  exchangeRate: z.number().positive().nullable().optional(),
});

const supplierInvoiceLineSchema = z.object({
  goodsReceiptLineId: z.string().uuid(),
  itemVariantId: z.string().uuid(),
  qty: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  discountAmount: z.number().nonnegative().default(0),
  vatRate: z.number().nonnegative(),
  priceIncludesVat: z.boolean(),
});

const supplierInvoiceCreateSchema = z.object({
  supplierId: z.string().uuid(),
  purchaseOrderId: z.string().uuid(),
  supplierInvoiceNumber: z.string().min(1),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fiscalPeriodId: z.string().uuid(),
  lines: z.array(supplierInvoiceLineSchema).min(1),
  exchangeRate: z.number().positive().nullable().optional(),
});

const createSupplierSchema = z.object({
  supplierCode: z.string().min(1),
  nameEn: z.string().min(1),
  nameAr: z.string().min(1),
  crNumber: z.string().nullable().optional(),
  vatRegistrationNumber: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  paymentTermsDays: z.number().int().nonnegative().default(0),
  leadTimeDays: z.number().int().nonnegative().nullable().optional(),
  currency: currencyCode.optional(),
});

const setSupplierPriceSchema = z.object({
  itemVariantId: z.string().uuid(),
  unitCost: z.number().nonnegative(),
  currency: z.string().min(1).default("SAR"),
  leadTimeDays: z.number().int().nonnegative().nullable().optional(),
  moq: z.number().positive().nullable().optional(),
});

export async function purchasingRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/purchase-orders",
    { preHandler: [app.authenticate, app.requirePermission("purchasing.po.create")] },
    async (request, reply) => {
      const body = createSchema.parse(request.body);
      const id = await withTransaction(
        (client) =>
          createPurchaseOrder(client, {
            companyId: request.companyId,
            storeId: body.storeId,
            supplierId: body.supplierId,
            orderDate: body.orderDate,
            expectedDate: body.expectedDate ?? null,
            fiscalPeriodId: body.fiscalPeriodId,
            createdBy: request.authUser.id,
            lines: body.lines,
            currency: body.currency ?? null,
            exchangeRate: body.exchangeRate ?? null,
          }),
        request.authUser.id,
      );
      reply.status(201);
      return { id };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/purchase-orders/:id/post",
    { preHandler: [app.authenticate, app.requirePermission("purchasing.po.create")] },
    async (request) => {
      await withTransaction(async (client) => {
        const existing = await client.query(`SELECT id FROM purchase_orders WHERE id = $1 AND company_id = $2`, [
          request.params.id,
          request.companyId,
        ]);
        if (existing.rows.length === 0) throw new NotFoundError("purchase order not found");
        await postPurchaseOrder(client, request.params.id, request.authUser.id);
      }, request.authUser.id);
      return { id: request.params.id, status: "posted" };
    },
  );

  app.get("/purchase-orders", { preHandler: app.authenticate }, async (request) => {
    const result = await pool.query(
      `SELECT po.id, po.document_number, po.order_date, po.expected_date, po.document_status,
              po.net_amount, po.vat_amount, po.gross_amount, po.currency, po.exchange_rate,
              s.name_en AS supplier_name_en, s.name_ar AS supplier_name_ar
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       WHERE po.company_id = $1
       ORDER BY po.order_date DESC`,
      [request.companyId],
    );
    return result.rows;
  });

  app.get<{ Params: { id: string } }>("/purchase-orders/:id", { preHandler: app.authenticate }, async (request) => {
    const header = await pool.query(
      `SELECT po.*, s.name_en AS supplier_name_en, s.name_ar AS supplier_name_ar
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       WHERE po.id = $1 AND po.company_id = $2`,
      [request.params.id, request.companyId],
    );
    if (header.rows.length === 0) throw new NotFoundError("purchase order not found");

    const lines = await pool.query(
      `SELECT pol.*, iv.variant_code, i.name_en AS item_name_en, i.name_ar AS item_name_ar
       FROM purchase_order_lines pol
       JOIN item_variants iv ON iv.id = pol.item_variant_id
       JOIN items i ON i.id = iv.item_id
       WHERE pol.purchase_order_id = $1
       ORDER BY pol.line_number`,
      [request.params.id],
    );
    return { ...header.rows[0], lines: lines.rows };
  });

  app.get("/suppliers", { preHandler: app.authenticate }, async (request) => {
    const result = await pool.query(
      `SELECT id, supplier_code, name_en, name_ar, cr_number, vat_registration_number, address,
              city, country, phone, email, payment_terms_days, lead_time_days, currency, is_active
       FROM suppliers WHERE company_id = $1 ORDER BY name_en`,
      [request.companyId],
    );
    return result.rows;
  });

  app.post(
    "/suppliers",
    { preHandler: [app.authenticate, app.requirePermission("purchasing.supplier.manage")] },
    async (request, reply) => {
      const body = createSupplierSchema.parse(request.body);
      const result = await pool.query<{ id: string }>(
        `INSERT INTO suppliers
           (company_id, supplier_code, name_en, name_ar, cr_number, vat_registration_number,
            address, city, country, phone, email, payment_terms_days, lead_time_days, currency)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                 COALESCE($14, (SELECT base_currency FROM companies WHERE id = $1))) RETURNING id`,
        [
          request.companyId,
          body.supplierCode,
          body.nameEn,
          body.nameAr,
          body.crNumber ?? null,
          body.vatRegistrationNumber ?? null,
          body.address ?? null,
          body.city ?? null,
          body.country ?? null,
          body.phone ?? null,
          body.email ?? null,
          body.paymentTermsDays,
          body.leadTimeDays ?? null,
          body.currency ?? null,
        ],
      );
      reply.status(201);
      return { id: result.rows[0]!.id };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/suppliers/:id/deactivate",
    { preHandler: [app.authenticate, app.requirePermission("purchasing.supplier.manage")] },
    async (request) => {
      const existing = await pool.query(`SELECT id FROM suppliers WHERE id = $1 AND company_id = $2`, [
        request.params.id,
        request.companyId,
      ]);
      if (existing.rows.length === 0) throw new NotFoundError("supplier not found");
      await pool.query(`UPDATE suppliers SET is_active = false WHERE id = $1`, [request.params.id]);
      return { id: request.params.id, status: "inactive" };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/suppliers/:id/reactivate",
    { preHandler: [app.authenticate, app.requirePermission("purchasing.supplier.manage")] },
    async (request) => {
      const existing = await pool.query(`SELECT id FROM suppliers WHERE id = $1 AND company_id = $2`, [
        request.params.id,
        request.companyId,
      ]);
      if (existing.rows.length === 0) throw new NotFoundError("supplier not found");
      await pool.query(`UPDATE suppliers SET is_active = true WHERE id = $1`, [request.params.id]);
      return { id: request.params.id, status: "active" };
    },
  );

  // ---- Supplier item prices (cost catalog) ----
  // Every purchase order also upserts this catalog (see
  // purchasingService.createPurchaseOrder) so it stays current with what
  // was actually last paid; these routes let it be reviewed and edited by
  // hand too -- e.g. entering a supplier's quoted price before ever placing
  // an order against it.

  app.get("/supplier-item-prices", { preHandler: app.authenticate }, async (request) => {
    const query = z.object({ supplierId: z.string().uuid() }).parse(request.query);
    const result = await pool.query(
      `SELECT sip.id, sip.item_variant_id, sip.unit_cost, sip.currency, sip.lead_time_days, sip.moq, sip.is_active
       FROM supplier_item_prices sip
       JOIN suppliers s ON s.id = sip.supplier_id
       WHERE sip.supplier_id = $1 AND s.company_id = $2 AND sip.is_active = true`,
      [query.supplierId, request.companyId],
    );
    return result.rows;
  });

  app.post<{ Params: { id: string } }>(
    "/suppliers/:id/prices",
    { preHandler: [app.authenticate, app.requirePermission("purchasing.supplier.manage")] },
    async (request, reply) => {
      const body = setSupplierPriceSchema.parse(request.body);
      await withTransaction(async (client) => {
        const supplier = await client.query(`SELECT id FROM suppliers WHERE id = $1 AND company_id = $2`, [
          request.params.id,
          request.companyId,
        ]);
        if (supplier.rows.length === 0) throw new NotFoundError("supplier not found");

        await client.query(
          `INSERT INTO supplier_item_prices (company_id, supplier_id, item_variant_id, unit_cost, currency, lead_time_days, moq, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, true)
           ON CONFLICT (supplier_id, item_variant_id)
             DO UPDATE SET unit_cost = EXCLUDED.unit_cost, currency = EXCLUDED.currency,
                            lead_time_days = EXCLUDED.lead_time_days, moq = EXCLUDED.moq, is_active = true`,
          [request.companyId, request.params.id, body.itemVariantId, body.unitCost, body.currency, body.leadTimeDays ?? null, body.moq ?? null],
        );
      }, request.authUser.id);
      reply.status(200);
      return { itemVariantId: body.itemVariantId, unitCost: body.unitCost };
    },
  );

  app.post<{ Params: { id: string; variantId: string } }>(
    "/suppliers/:id/prices/:variantId/remove",
    { preHandler: [app.authenticate, app.requirePermission("purchasing.supplier.manage")] },
    async (request) => {
      await withTransaction(async (client) => {
        const supplier = await client.query(`SELECT id FROM suppliers WHERE id = $1 AND company_id = $2`, [
          request.params.id,
          request.companyId,
        ]);
        if (supplier.rows.length === 0) throw new NotFoundError("supplier not found");
        await client.query(
          `UPDATE supplier_item_prices SET is_active = false WHERE supplier_id = $1 AND item_variant_id = $2`,
          [request.params.id, request.params.variantId],
        );
      }, request.authUser.id);
      return { itemVariantId: request.params.variantId, status: "removed" };
    },
  );

  // ---- Goods receipts ----
  // Reuses purchasing.goods_receipt.post for both create and post (same
  // pattern as accounting.journal.post covering receipts/payments) --
  // there's no separate "create" permission for this document in the
  // catalog, and receiving goods is one continuous action in practice.

  app.post(
    "/goods-receipts",
    { preHandler: [app.authenticate, app.requirePermission("purchasing.goods_receipt.post")] },
    async (request, reply) => {
      const body = goodsReceiptCreateSchema.parse(request.body);
      const id = await withTransaction(
        (client) =>
          createGoodsReceipt(client, {
            companyId: request.companyId,
            storeId: body.storeId,
            purchaseOrderId: body.purchaseOrderId,
            supplierId: body.supplierId,
            receiptDate: body.receiptDate,
            fiscalPeriodId: body.fiscalPeriodId,
            createdBy: request.authUser.id,
            lines: body.lines,
            charges: body.charges,
            exchangeRate: body.exchangeRate ?? null,
          }),
        request.authUser.id,
      );
      reply.status(201);
      return { id };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/goods-receipts/:id/post",
    { preHandler: [app.authenticate, app.requirePermission("purchasing.goods_receipt.post")] },
    async (request) => {
      await withTransaction(async (client) => {
        const existing = await client.query(`SELECT id FROM goods_receipts WHERE id = $1 AND company_id = $2`, [
          request.params.id,
          request.companyId,
        ]);
        if (existing.rows.length === 0) throw new NotFoundError("goods receipt not found");
        await postGoodsReceipt(client, request.params.id, request.authUser.id);
      }, request.authUser.id);
      return { id: request.params.id, status: "posted" };
    },
  );

  app.get("/goods-receipts", { preHandler: app.authenticate }, async (request) => {
    const result = await pool.query(
      `SELECT gr.id, gr.document_number, gr.receipt_date, gr.document_status, gr.purchase_order_id, gr.currency, gr.exchange_rate,
              po.document_number AS po_document_number,
              s.name_en AS supplier_name_en, s.name_ar AS supplier_name_ar
       FROM goods_receipts gr
       JOIN suppliers s ON s.id = gr.supplier_id
       JOIN purchase_orders po ON po.id = gr.purchase_order_id
       WHERE gr.company_id = $1
       ORDER BY gr.receipt_date DESC`,
      [request.companyId],
    );
    return result.rows;
  });

  app.get<{ Params: { id: string } }>("/goods-receipts/:id", { preHandler: app.authenticate }, async (request) => {
    const header = await pool.query(
      `SELECT gr.*, s.name_en AS supplier_name_en, s.name_ar AS supplier_name_ar
       FROM goods_receipts gr
       JOIN suppliers s ON s.id = gr.supplier_id
       WHERE gr.id = $1 AND gr.company_id = $2`,
      [request.params.id, request.companyId],
    );
    if (header.rows.length === 0) throw new NotFoundError("goods receipt not found");

    const lines = await pool.query(
      `SELECT grl.*, iv.variant_code, i.name_en AS item_name_en, i.name_ar AS item_name_ar
       FROM goods_receipt_lines grl
       JOIN item_variants iv ON iv.id = grl.item_variant_id
       JOIN items i ON i.id = iv.item_id
       WHERE grl.goods_receipt_id = $1
       ORDER BY grl.line_number`,
      [request.params.id],
    );
    return { ...header.rows[0], lines: lines.rows };
  });

  // ---- Supplier invoices (3-way match) ----

  app.post(
    "/supplier-invoices",
    { preHandler: [app.authenticate, app.requirePermission("purchasing.goods_receipt.post")] },
    async (request, reply) => {
      const body = supplierInvoiceCreateSchema.parse(request.body);
      const id = await withTransaction(
        (client) =>
          createSupplierInvoice(client, {
            companyId: request.companyId,
            supplierId: body.supplierId,
            purchaseOrderId: body.purchaseOrderId,
            supplierInvoiceNumber: body.supplierInvoiceNumber,
            invoiceDate: body.invoiceDate,
            fiscalPeriodId: body.fiscalPeriodId,
            createdBy: request.authUser.id,
            lines: body.lines,
            exchangeRate: body.exchangeRate ?? null,
          }),
        request.authUser.id,
      );
      reply.status(201);
      return { id };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/supplier-invoices/:id/post",
    { preHandler: [app.authenticate, app.requirePermission("purchasing.goods_receipt.post")] },
    async (request) => {
      await withTransaction(async (client) => {
        const existing = await client.query(`SELECT id FROM supplier_invoices WHERE id = $1 AND company_id = $2`, [
          request.params.id,
          request.companyId,
        ]);
        if (existing.rows.length === 0) throw new NotFoundError("supplier invoice not found");
        await postSupplierInvoice(client, request.params.id, request.authUser.id);
      }, request.authUser.id);
      return { id: request.params.id, status: "posted" };
    },
  );

  app.get("/supplier-invoices", { preHandler: app.authenticate }, async (request) => {
    const result = await pool.query(
      `SELECT si.id, si.document_number, si.supplier_invoice_number, si.invoice_date, si.document_status,
              si.gross_amount, si.currency, si.exchange_rate, si.base_gross_amount,
              s.name_en AS supplier_name_en, s.name_ar AS supplier_name_ar
       FROM supplier_invoices si
       JOIN suppliers s ON s.id = si.supplier_id
       WHERE si.company_id = $1
       ORDER BY si.invoice_date DESC`,
      [request.companyId],
    );
    return result.rows;
  });

  app.get<{ Params: { id: string } }>("/supplier-invoices/:id", { preHandler: app.authenticate }, async (request) => {
    const header = await pool.query(
      `SELECT si.*, s.name_en AS supplier_name_en, s.name_ar AS supplier_name_ar
       FROM supplier_invoices si
       JOIN suppliers s ON s.id = si.supplier_id
       WHERE si.id = $1 AND si.company_id = $2`,
      [request.params.id, request.companyId],
    );
    if (header.rows.length === 0) throw new NotFoundError("supplier invoice not found");

    const lines = await pool.query(
      `SELECT sil.*, iv.variant_code, i.name_en AS item_name_en, i.name_ar AS item_name_ar
       FROM supplier_invoice_lines sil
       JOIN item_variants iv ON iv.id = sil.item_variant_id
       JOIN items i ON i.id = iv.item_id
       WHERE sil.supplier_invoice_id = $1
       ORDER BY sil.line_number`,
      [request.params.id],
    );
    return { ...header.rows[0], lines: lines.rows };
  });
}
