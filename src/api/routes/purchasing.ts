import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, withTransaction } from "../db.js";
import { createPurchaseOrder, postPurchaseOrder } from "../../purchasing/purchasingService.js";
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
}
