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

const createSchema = z.object({
  storeId: z.string().uuid(),
  supplierId: z.string().uuid(),
  orderDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  expectedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  fiscalPeriodId: z.string().uuid(),
  lines: z.array(lineSchema).min(1),
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
              po.net_amount, po.vat_amount, po.gross_amount,
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
      `SELECT id, supplier_code, name_en, name_ar, city, country, payment_terms_days, lead_time_days, is_active
       FROM suppliers WHERE company_id = $1 ORDER BY name_en`,
      [request.companyId],
    );
    return result.rows;
  });

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
      `SELECT gr.id, gr.document_number, gr.receipt_date, gr.document_status, gr.purchase_order_id,
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
              si.gross_amount, s.name_en AS supplier_name_en, s.name_ar AS supplier_name_ar
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
