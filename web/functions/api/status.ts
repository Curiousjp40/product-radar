// Cloudflare Pages Function, served at /api/status (spec section 10.4).
// The whole Pages site sits behind Cloudflare Access (see the Phase 4
// walkthrough), so this function trusts the edge to have already checked
// who's allowed in -- it only reads the authenticated email for an
// audit trail, it does not re-check authorization itself.

interface Env {
  DB: D1Database;
}

type StatusRow = {
  product_id: string;
  status: string | null;
  feedback: string | null;
};

type StatusMap = Record<string, { status?: string; feedback?: string }>;

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { results } = await context.env.DB.prepare(
    "SELECT product_id, status, feedback FROM shortlist_status",
  ).all<StatusRow>();

  const map: StatusMap = {};
  for (const row of results) {
    map[row.product_id] = {
      status: row.status ?? undefined,
      feedback: row.feedback ?? undefined,
    };
  }
  return Response.json(map);
};

const ALLOWED_FIELDS = new Set(["status", "feedback"]);

export const onRequestPost: PagesFunction<Env> = async (context) => {
  let body: { product_id?: unknown; field?: unknown; value?: unknown };
  try {
    body = await context.request.json();
  } catch {
    return new Response("invalid JSON body", { status: 400 });
  }

  const { product_id, field, value } = body;
  if (typeof product_id !== "string" || !product_id) {
    return new Response("product_id is required", { status: 400 });
  }
  if (typeof field !== "string" || !ALLOWED_FIELDS.has(field)) {
    return new Response('field must be "status" or "feedback"', { status: 400 });
  }
  if (typeof value !== "string" || !value) {
    return new Response("value is required", { status: 400 });
  }

  const updatedBy = context.request.headers.get("Cf-Access-Authenticated-User-Email") ?? "unknown";
  const updatedAt = new Date().toISOString();

  // `field` is constrained to the ALLOWED_FIELDS whitelist above, so this
  // column-name interpolation is safe -- it's never user-supplied SQL, just
  // one of two known-good strings.
  await context.env.DB.prepare(
    `INSERT INTO shortlist_status (product_id, ${field}, updated_at, updated_by)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(product_id) DO UPDATE SET ${field} = excluded.${field}, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
  )
    .bind(product_id, value, updatedAt, updatedBy)
    .run();

  return Response.json({ ok: true });
};
