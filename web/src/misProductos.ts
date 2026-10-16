import { pullSynced, readLocal, writeSynced } from "./syncedStorage";

/** Part C5: "Mis Productos" replaces Muestras as the full inventory/
 * pipeline of everything Roxie has or requested, synced across her phone
 * and the computer via syncedStorage's "mis_productos" key (same
 * localStorage-first, Worker-second pattern as everything else there). */

// "aprobado" added (Part 4, 2026-10-16) for the Solicitudes 3-tab flow:
// solicitado (Pendientes) branches to either aprobado (Aprobadas/en
// camino, via "Ya llegó" -> recibido) or rechazado (Rechazadas, via
// "Volver a pedir" -> back to solicitado) -- not a simple linear advance,
// so "solicitado"/"aprobado"/"rechazado" items are handled by the
// Solicitudes section's own buttons, not the generic STATUS_ORDER advance
// button below (see nextStatus).
export type MisProductoStatus =
  | "solicitado"
  | "aprobado"
  | "recibido"
  | "grabado"
  | "publicado"
  | "vendiendo"
  | "rechazado"
  | "no_llego";

export const STATUS_ORDER: MisProductoStatus[] = ["recibido", "grabado", "publicado", "vendiendo"];
export const TERMINAL_STATUSES: MisProductoStatus[] = ["rechazado", "no_llego"];
export const SOLICITUD_STATUSES: MisProductoStatus[] = ["solicitado", "aprobado", "rechazado"];

export interface MisProducto {
  id: string;
  product_id: string | null;
  name: string;
  photo_url: string | null;
  category: string | null;
  commission_pct: number | null;
  tiktok_shop_url: string | null;
  status: MisProductoStatus;
  date_requested: string; // ISO date
  date_received: string | null;
  date_posted: string | null; // Part C9: auto-set the first time status reaches "publicado"
  notes: string;
  video_links: string[];
  units: number | null;
  earnings: number | null;
  price: number | null; // Part C9: retail value, for "Productos gratis recibidos" + goal-card sale defaults
  earnings_per_sale: number | null; // Part C9: snapshotted at add-time from the matched product, used by +Venta
  effort_minutes: number | null; // Part C9: snapshotted at add-time, for Mi Dinero's $/hour
  shop_name: string | null; // Part 4, added 2026-10-16: shop-denial memory ("esta tienda te rechazo N veces")
  rejection_reason: string | null; // Part 4: optional, captured when marking a Solicitud rechazada
  // Part 4: increments every time this request is marked "rechazado",
  // including a prior cycle before "Volver a pedir" reset status back to
  // "solicitado" -- shopRejectionCount sums this across a shop's items,
  // not current status, so a past rejection isn't forgotten once she
  // re-requests.
  times_rejected: number;
}

function newId(): string {
  return `mp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function emptyMisProducto(overrides: Partial<MisProducto> = {}): MisProducto {
  return {
    id: newId(),
    product_id: null,
    name: "",
    photo_url: null,
    category: null,
    commission_pct: null,
    tiktok_shop_url: null,
    status: "solicitado",
    date_requested: new Date().toISOString().slice(0, 10),
    date_received: null,
    date_posted: null,
    notes: "",
    video_links: [],
    units: null,
    earnings: null,
    price: null,
    earnings_per_sale: null,
    effort_minutes: null,
    shop_name: null,
    rejection_reason: null,
    times_rejected: 0,
    ...overrides,
  };
}

export async function getAllMisProductos(): Promise<MisProducto[]> {
  return pullSynced<MisProducto[]>("mis_productos", readLocal("mis_productos", []));
}

export function getAllMisProductosLocal(): MisProducto[] {
  return readLocal<MisProducto[]>("mis_productos", []);
}

function saveAll(items: MisProducto[]): void {
  writeSynced("mis_productos", items);
}

export async function addMisProducto(item: MisProducto): Promise<void> {
  const items = await getAllMisProductos();
  saveAll([item, ...items]);
}

/** Part A.4 bulk mode (2026-10-16): addMisProducto is read-current-then-
 * write-back, so calling it several times concurrently (e.g. Promise.all
 * over a batch of "Ya los tengo" selections) is a real race -- every call
 * reads the same starting list and the last write wins, silently dropping
 * every item but one. This reads once and writes once for the whole
 * batch. */
export async function addMisProductos(newItems: MisProducto[]): Promise<void> {
  if (newItems.length === 0) return;
  const items = await getAllMisProductos();
  saveAll([...newItems, ...items]);
}

export async function updateMisProducto(id: string, patch: Partial<MisProducto>): Promise<void> {
  const items = await getAllMisProductos();
  saveAll(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
}

export async function removeMisProducto(id: string): Promise<void> {
  const items = await getAllMisProductos();
  saveAll(items.filter((i) => i.id !== id));
}

export function nextStatus(status: MisProductoStatus): MisProductoStatus | null {
  const idx = STATUS_ORDER.indexOf(status);
  if (idx === -1 || idx === STATUS_ORDER.length - 1) return null;
  return STATUS_ORDER[idx + 1];
}

/** "Recibido hace 7+ días y sin grabar" flag. */
export function isOverdueToFilm(item: MisProducto, today: Date): boolean {
  if (item.status !== "recibido" || !item.date_received) return false;
  const days = (today.getTime() - new Date(item.date_received).getTime()) / 86_400_000;
  return days >= 7;
}

export function summarize(items: MisProducto[]): {
  countsByStatus: Record<MisProductoStatus, number>;
  totalEarned: number;
  waitingToFilm: number;
} {
  const countsByStatus = {
    solicitado: 0,
    aprobado: 0,
    recibido: 0,
    grabado: 0,
    publicado: 0,
    vendiendo: 0,
    rechazado: 0,
    no_llego: 0,
  } as Record<MisProductoStatus, number>;
  let totalEarned = 0;
  let waitingToFilm = 0;
  const today = new Date();
  for (const item of items) {
    countsByStatus[item.status]++;
    totalEarned += item.earnings ?? 0;
    if (isOverdueToFilm(item, today)) waitingToFilm++;
  }
  return { countsByStatus, totalEarned, waitingToFilm };
}

export function ownedProductIds(items: MisProducto[]): Set<string> {
  return new Set(items.filter((i) => i.product_id).map((i) => i.product_id as string));
}

/** Part 4 (2026-10-16): builds a "solicitado" (Pendiente) record from a
 * product's own card data -- shared by every "Pedir muestra" button
 * (Hoy/Esta semana/Todos/product page) so a sample request also shows up
 * in the Solicitudes section, not just the old samples.ts tracking. */
export function solicitudFromProduct(product: {
  product_id: string;
  name: string;
  photo_url: string | null;
  category: string | null;
  commission_pct: number | null;
  tiktok_shop_url: string | null;
  price: number | null;
  earnings_per_sale: number | null;
  effort_minutes: number | null;
  shop_name: string | null;
}): MisProducto {
  return emptyMisProducto({ ...product, status: "solicitado" });
}

// Pure Solicitudes helpers (daysWaiting, shopRejectionCount, approvalRate)
// live in misProductosLogic.ts, re-exported here for existing import
// sites -- see that file's own comment for why they're split out.
export { approvalRate, daysWaiting, shopRejectionCount } from "./misProductosLogic";
