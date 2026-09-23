import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, withTransaction } from "../db.js";
import { syncPosInvoice, syncPosCreditNote } from "../../sync/syncService.js";

const lineSchema = z.object({
  itemVariantId: z.string().uuid().nullable(),
  itemDescription: z.string().min(1),
  lineType: z.enum(["item", "charge"]).optional(),
  qty: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  discountAmount: z.number().nonnegative().default(0),
  vatRate: z.number().nonnegative(),
  priceIncludesVat: z.boolean(),
});

const paymentSchema = z.object({
  paymentMethod: z.enum(["cash", "card", "credit", "points", "gift_card"]),
  amount: z.number().positive(),
  reference: z.string().optional(),
});

const invoiceSyncSchema = z.object({
  clientUuid: z.string().uuid(),
  deviceSequenceNumber: z.number().int().positive(),
  storeId: z.string().uuid(),
  // zatcaInvoiceCategory is still required from the client rather than
  // hardcoded to 'simplified' here — the DB trigger (0043) is the actual
  // enforcement point, so a client bug that sends 'standard' gets a clear
  // 400 from the trigger instead of being silently overridden.
  zatcaInvoiceCategory: z.enum(["simplified", "standard"]),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fiscalPeriodId: z.string().uuid(),
  customerId: z.string().uuid().nullable().optional(),
  salespersonId: z.string().uuid().nullable().optional(),
  priceListId: z.string().uuid().nullable().optional(),
  lines: z.array(lineSchema).min(1),
  payments: z.array(paymentSchema).optional(),
});

const pushInvoicesSchema = z.object({
  deviceId: z.string().uuid(),
  invoices: z.array(invoiceSyncSchema).min(1),
});

const creditNoteLineSyncSchema = z.object({
  sourceLineId: z.string().uuid(),
  itemVariantId: z.string().uuid().nullable(),
  itemDescription: z.string().min(1),
  qty: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  discountAmount: z.number().nonnegative().default(0),
  vatRate: z.number().nonnegative(),
  priceIncludesVat: z.boolean(),
});

const creditNoteSyncSchema = z.object({
  clientUuid: z.string().uuid(),
  deviceSequenceNumber: z.number().int().positive(),
  storeId: z.string().uuid(),
  originalInvoiceId: z.string().uuid(),
  zatcaInvoiceCategory: z.enum(["simplified", "standard"]),
  creditNoteDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fiscalPeriodId: z.string().uuid(),
  customerId: z.string().uuid().nullable().optional(),
  reason: z.string().min(1),
  lines: z.array(creditNoteLineSyncSchema).min(1),
});

const pushCreditNotesSchema = z.object({
  deviceId: z.string().uuid(),
  creditNotes: z.array(creditNoteSyncSchema).min(1),
});

const pullQuerySchema = z.object({
  storeId: z.string().uuid(),
  since: z.string().datetime().optional(),
});

interface SyncItemResult {
  clientUuid: string;
  status: "synced" | "already_synced" | "error";
  id?: string;
  error?: string;
}

export async function syncRoutes(app: FastifyInstance): Promise<void> {
  // Each offline document syncs in its OWN transaction — one bad or
  // duplicate record in a batch must never roll back the others that
  // already synced cleanly. This is why the response is a per-item result
  // list rather than a single success/failure for the whole call.
  app.post(
    "/sync/push/invoices",
    { preHandler: [app.authenticate, app.requirePermission("sales.pos_invoice.create")] },
    async (request) => {
      const body = pushInvoicesSchema.parse(request.body);
      const results: SyncItemResult[] = [];

      for (const inv of body.invoices) {
        try {
          const result = await withTransaction(async (client) => {
            return syncPosInvoice(client, {
              companyId: request.companyId,
              deviceId: body.deviceId,
              clientUuid: inv.clientUuid,
              deviceSequenceNumber: inv.deviceSequenceNumber,
              storeId: inv.storeId,
              zatcaInvoiceCategory: inv.zatcaInvoiceCategory,
              invoiceDate: inv.invoiceDate,
              fiscalPeriodId: inv.fiscalPeriodId,
              customerId: inv.customerId ?? null,
              salespersonId: inv.salespersonId ?? null,
              priceListId: inv.priceListId ?? null,
              createdBy: request.authUser.id,
              lines: inv.lines,
              payments: inv.payments,
            });
          }, request.authUser.id);
          results.push({
            clientUuid: inv.clientUuid,
            status: result.alreadySynced ? "already_synced" : "synced",
            id: result.id,
          });
        } catch (err) {
          results.push({ clientUuid: inv.clientUuid, status: "error", error: err instanceof Error ? err.message : String(err) });
        }
      }

      return { results };
    },
  );

  app.post(
    "/sync/push/credit-notes",
    { preHandler: [app.authenticate, app.requirePermission("sales.return.create")] },
    async (request) => {
      const body = pushCreditNotesSchema.parse(request.body);
      const results: SyncItemResult[] = [];

      for (const cn of body.creditNotes) {
        try {
          const result = await withTransaction(async (client) => {
            return syncPosCreditNote(client, {
              companyId: request.companyId,
              deviceId: body.deviceId,
              clientUuid: cn.clientUuid,
              deviceSequenceNumber: cn.deviceSequenceNumber,
              storeId: cn.storeId,
              originalInvoiceId: cn.originalInvoiceId,
              zatcaInvoiceCategory: cn.zatcaInvoiceCategory,
              creditNoteDate: cn.creditNoteDate,
              fiscalPeriodId: cn.fiscalPeriodId,
              customerId: cn.customerId ?? null,
              reason: cn.reason,
              createdBy: request.authUser.id,
              lines: cn.lines,
            });
          }, request.authUser.id);
          results.push({
            clientUuid: cn.clientUuid,
            status: result.alreadySynced ? "already_synced" : "synced",
            id: result.id,
          });
        } catch (err) {
          results.push({ clientUuid: cn.clientUuid, status: "error", error: err instanceof Error ? err.message : String(err) });
        }
      }

      return { results };
    },
  );

  // A single consolidated pull: what an offline device needs to refresh its
  // local cache before going offline again, in one round trip. Items
  // support a true updatedSince delta (0018+); customers and price lists
  // don't carry updated_at yet, so they're a full pull each time — a
  // documented limitation, not an oversight (see README).
  app.get("/sync/pull", { preHandler: app.authenticate }, async (request) => {
    const query = pullQuerySchema.parse(request.query);
    const since = query.since ?? null;
    const serverTime = new Date().toISOString();

    const store = await pool.query(`SELECT company_id FROM stores WHERE id = $1`, [query.storeId]);
    if (store.rows.length === 0 || store.rows[0]!.company_id !== request.companyId) {
      return { since: query.since ?? null, serverTime, items: [], customers: [], priceLists: [], stockBalances: [] };
    }

    const items = await pool.query(
      `SELECT id, item_code, name_en, name_ar, brand_id, category_id, season_id, item_year,
              default_tax_code_id, is_active, updated_at
       FROM items
       WHERE company_id = $1 AND ($2::timestamptz IS NULL OR updated_at > $2)
       ORDER BY updated_at`,
      [request.companyId, since],
    );

    const variants = await pool.query(
      `SELECT iv.id, iv.item_id, iv.variant_code, iv.color, iv.size, iv.is_active,
              json_agg(json_build_object('barcode', ib.barcode, 'unitOfMeasureId', ib.unit_of_measure_id, 'isPrimary', ib.is_primary))
                FILTER (WHERE ib.id IS NOT NULL) AS barcodes
       FROM item_variants iv
       LEFT JOIN item_barcodes ib ON ib.item_variant_id = iv.id
       WHERE iv.company_id = $1
       GROUP BY iv.id`,
      [request.companyId],
    );
    const variantsByItem = new Map<string, unknown[]>();
    for (const v of variants.rows) {
      const list = variantsByItem.get(v.item_id) ?? [];
      list.push(v);
      variantsByItem.set(v.item_id, list);
    }
    const itemsWithVariants = items.rows.map((item) => ({ ...item, variants: variantsByItem.get(item.id) ?? [] }));

    const customers = await pool.query(
      `SELECT id, customer_code, name_en, name_ar, customer_type, vat_registration_number,
              credit_limit, payment_terms_days, is_loyalty_member, loyalty_card_number, is_active
       FROM customers WHERE company_id = $1 ORDER BY name_en`,
      [request.companyId],
    );

    const priceLists = await pool.query(
      `SELECT pl.id, pl.code, pl.name_en, pl.name_ar, pl.currency, pl.price_includes_vat, pl.is_default,
              json_agg(json_build_object('itemVariantId', pli.item_variant_id, 'price', pli.price))
                FILTER (WHERE pli.id IS NOT NULL) AS items
       FROM price_lists pl
       LEFT JOIN price_list_items pli ON pli.price_list_id = pl.id AND pli.is_active = true
       WHERE pl.company_id = $1 AND pl.is_active = true
       GROUP BY pl.id
       ORDER BY pl.code`,
      [request.companyId],
    );

    const stockBalances = await pool.query(
      `SELECT item_variant_id, qty_on_hand, avg_unit_cost, last_movement_at
       FROM stock_balances WHERE store_id = $1`,
      [query.storeId],
    );

    return {
      since: query.since ?? null,
      serverTime,
      items: itemsWithVariants,
      customers: customers.rows,
      priceLists: priceLists.rows,
      stockBalances: stockBalances.rows,
    };
  });
}
