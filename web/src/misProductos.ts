import { pullSynced, readLocal, writeSynced } from "./syncedStorage";

/** Part C5: "Mis Productos" replaces Muestras as the full inventory/
 * pipeline of everything Roxie has or requested, synced across her phone
 * and the computer via syncedStorage's "mis_productos" key (same
 * localStorage-first, Worker-second pattern as everything else there). */

export type MisProductoStatus = "solicitado" | "recibido" | "grabado" | "publicado" | "vendiendo" | "rechazado" | "no_llego";

export const STATUS_ORDER: MisProductoStatus[] = ["solicitado", "recibido", "grabado", "publicado", "vendiendo"];
export const TERMINAL_STATUSES: MisProductoStatus[] = ["rechazado", "no_llego"];

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
  notes: string;
  video_links: string[];
  units: number | null;
  earnings: number | null;
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
    notes: "",
    video_links: [],
    units: null,
    earnings: null,
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
  const countsByStatus = { solicitado: 0, recibido: 0, grabado: 0, publicado: 0, vendiendo: 0, rechazado: 0, no_llego: 0 } as Record<
    MisProductoStatus,
    number
  >;
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
