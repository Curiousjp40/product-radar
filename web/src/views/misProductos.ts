import { loadCandidates } from "../api";
import { assetUrl, IMG_FALLBACK } from "../asset";
import { addEntry } from "../earningsGoal";
import { t, type Lang } from "../i18n";
import {
  addMisProducto,
  daysWaiting,
  emptyMisProducto,
  getAllMisProductos,
  isOverdueToFilm,
  nextStatus,
  removeMisProducto,
  STATUS_ORDER,
  summarize,
  TERMINAL_STATUSES,
  updateMisProducto,
  type MisProducto,
  type MisProductoStatus,
} from "../misProductos";
import { setFeedback } from "../pipeline";
import type { Candidate } from "../types";

type SolicitudTab = "pendientes" | "aprobadas" | "rechazadas";

function statusLabel(status: MisProductoStatus, lang: Lang): string {
  return t(`mis_productos_status_${status}`, lang);
}

// https://www.tiktok.com/shop/pdp/{product_id} -- confirmed template, see
// docs/field_map.md and engine/run.py's tiktok_shop_url().
function parseProductIdFromTikTokShopUrl(url: string): string | null {
  const match = url.match(/\/shop\/pdp\/(\d+)/);
  return match ? match[1] : null;
}

function addFormHtml(lang: Lang): string {
  return `
    <form class="mis-productos-add-form" data-form="add">
      <input type="text" name="link_or_name" placeholder="${t("mis_productos_add_placeholder", lang)}" required />
      <input type="url" name="photo_url" placeholder="${t("mis_productos_photo_placeholder", lang)}" />
      <input type="number" name="commission_pct" min="0" max="100" step="1" placeholder="${t("mis_productos_commission_placeholder", lang)}" />
      <input type="date" name="date_requested" value="${new Date().toISOString().slice(0, 10)}" />
      <button type="submit" class="btn-primary">${t("mis_productos_add_button", lang)}</button>
    </form>
  `;
}

function itemCardHtml(item: MisProducto, lang: Lang, overdue: boolean): string {
  const next = nextStatus(item.status);
  const photo = item.photo_url ? `<img class="photo" src="${item.photo_url.startsWith("http") ? item.photo_url : assetUrl(item.photo_url)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${IMG_FALLBACK}'" />` : `<div class="photo"></div>`;
  return `
    <article class="mis-productos-card ${overdue ? "overdue" : ""}" data-id="${item.id}">
      <div class="mis-productos-card-top">
        ${photo}
        <div class="mis-productos-card-info">
          <div class="name">${item.name}</div>
          <div class="meta">
            ${item.commission_pct !== null ? `${item.commission_pct}% ${t("commission", lang)} &middot; ` : ""}
            ${t("mis_productos_requested_on", lang, { date: item.date_requested })}
          </div>
          ${overdue ? `<div class="mis-productos-overdue-flag">${t("mis_productos_overdue_flag", lang)}</div>` : ""}
          ${item.product_id ? `<a href="#/product/${item.product_id}" class="mis-productos-radar-link">${t("mis_productos_view_in_radar", lang)}</a>` : ""}
        </div>
      </div>
      <div class="mis-productos-status-row">
        <span class="mis-productos-status-badge status-${item.status}">${statusLabel(item.status, lang)}</span>
        ${next ? `<button type="button" class="btn-primary" data-action="advance" data-id="${item.id}" data-next="${next}">${t("mis_productos_advance_to", lang, { status: statusLabel(next, lang) })}</button>` : ""}
        ${!TERMINAL_STATUSES.includes(item.status) ? `<button type="button" class="btn-primary" data-action="toggle-venta" data-id="${item.id}">${t("quick_venta_button", lang)}</button>` : ""}
        ${!TERMINAL_STATUSES.includes(item.status) && item.status !== "vendiendo" ? `<button type="button" class="btn-save-pill" data-action="reject" data-id="${item.id}">${t("mis_productos_mark_rejected", lang)}</button>` : ""}
      </div>
      <form class="earnings-goal-form quick-venta-form" data-form="quick-venta-item" data-id="${item.id}" style="display:none">
        <input type="number" name="units" min="1" step="1" value="1" placeholder="${t("quick_venta_units_label", lang)}" />
        <input type="number" name="amount" min="0" step="0.01" value="${item.earnings_per_sale ?? ""}" placeholder="${t("quick_venta_amount_label", lang)}" required />
        <input type="date" name="date" value="${new Date().toISOString().slice(0, 10)}" required />
        <button type="submit" class="btn-primary">${t("quick_venta_save_button", lang)}</button>
      </form>
      <details class="mis-productos-details">
        <summary>${t("mis_productos_edit_details", lang)}</summary>
        <form class="mis-productos-detail-form" data-form="detail" data-id="${item.id}">
          <label>${t("mis_productos_notes_label", lang)}<textarea name="notes" rows="2">${item.notes}</textarea></label>
          <label>${t("mis_productos_video_links_label", lang)}<textarea name="video_links" rows="2" placeholder="${t("mis_productos_video_links_placeholder", lang)}">${item.video_links.join("\n")}</textarea></label>
          <label>${t("mis_productos_units_label", lang)}<input type="number" name="units" min="0" value="${item.units ?? ""}" /></label>
          <label>${t("mis_productos_earnings_label", lang)}<input type="number" name="earnings" min="0" step="0.01" value="${item.earnings ?? ""}" /></label>
          <label>${t("mis_productos_date_received_label", lang)}<input type="date" name="date_received" value="${item.date_received ?? ""}" /></label>
          <button type="submit" class="btn-save-pill">${t("mis_productos_save_button", lang)}</button>
          <button type="button" class="btn-not-for-me" data-action="delete" data-id="${item.id}">${t("mis_productos_delete_button", lang)}</button>
        </form>
      </details>
    </article>
  `;
}

function solicitudCardHtml(item: MisProducto, lang: Lang, tab: SolicitudTab, today: Date): string {
  const photo = item.photo_url ? `<img class="photo" src="${item.photo_url.startsWith("http") ? item.photo_url : assetUrl(item.photo_url)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${IMG_FALLBACK}'" />` : `<div class="photo"></div>`;
  const waiting = daysWaiting(item, today);
  const amber = tab === "pendientes" && waiting >= 7;
  return `
    <article class="mis-productos-card solicitud-card ${amber ? "overdue" : ""}" data-id="${item.id}">
      <div class="mis-productos-card-top">
        ${photo}
        <div class="mis-productos-card-info">
          <div class="name">${item.name}</div>
          <div class="meta">
            ${item.shop_name ? `${item.shop_name} &middot; ` : ""}${t("mis_productos_requested_on", lang, { date: item.date_requested })}
          </div>
          ${tab === "pendientes" ? `<div class="${amber ? "mis-productos-overdue-flag" : "meta"}">${t("solicitudes_days_waiting", lang, { n: waiting })}</div>` : ""}
          ${tab === "rechazadas" && item.rejection_reason ? `<div class="meta">${item.rejection_reason}</div>` : ""}
          ${item.product_id ? `<a href="#/product/${item.product_id}" class="mis-productos-radar-link">${t("mis_productos_view_in_radar", lang)}</a>` : ""}
        </div>
      </div>
      <div class="mis-productos-status-row">
        ${
          tab === "pendientes"
            ? `
              ${item.tiktok_shop_url ? `<a class="btn-save-pill" href="${item.tiktok_shop_url}" target="_blank" rel="noopener">${t("solicitudes_remind_shop", lang)}</a>` : ""}
              <button type="button" class="btn-not-for-me" data-action="solicitud-cancel" data-id="${item.id}">${t("solicitudes_cancel", lang)}</button>
              <button type="button" class="btn-primary" data-action="solicitud-approve" data-id="${item.id}">${t("solicitudes_mark_approved", lang)}</button>
              <button type="button" class="btn-save-pill" data-action="solicitud-reject" data-id="${item.id}">${t("solicitudes_mark_rejected", lang)}</button>
            `
            : ""
        }
        ${tab === "aprobadas" ? `<button type="button" class="btn-primary" data-action="solicitud-arrived" data-id="${item.id}">${t("solicitudes_arrived", lang)}</button>` : ""}
        ${
          tab === "rechazadas"
            ? `
              <button type="button" class="btn-primary" data-action="solicitud-again" data-id="${item.id}">${t("solicitudes_request_again", lang)}</button>
              <button type="button" class="btn-not-for-me" data-action="solicitud-hide" data-id="${item.id}" data-product-id="${item.product_id ?? ""}">${t("solicitudes_hide_product", lang)}</button>
            `
            : ""
        }
      </div>
    </article>
  `;
}

function solicitudesSectionHtml(items: MisProducto[], tab: SolicitudTab, lang: Lang, today: Date): string {
  const pendientes = items.filter((i) => i.status === "solicitado");
  const aprobadas = items.filter((i) => i.status === "aprobado");
  const rechazadas = items.filter((i) => i.status === "rechazado");
  const byTab: Record<SolicitudTab, MisProducto[]> = { pendientes, aprobadas, rechazadas };
  const visible = byTab[tab];
  return `
    <div class="insight-card solicitudes-section">
      <h3>${t("solicitudes_title", lang)}</h3>
      <div class="group-tabs solicitudes-tabs">
        <button type="button" data-solicitud-tab="pendientes" class="${tab === "pendientes" ? "active" : ""}">${t("solicitudes_tab_pendientes", lang)} ${pendientes.length}</button>
        <button type="button" data-solicitud-tab="aprobadas" class="${tab === "aprobadas" ? "active" : ""}">${t("solicitudes_tab_aprobadas", lang)} ${aprobadas.length}</button>
        <button type="button" data-solicitud-tab="rechazadas" class="${tab === "rechazadas" ? "active" : ""}">${t("solicitudes_tab_rechazadas", lang)} ${rechazadas.length}</button>
      </div>
      ${
        visible.length === 0
          ? `<p class="empty-state">${t(`solicitudes_empty_${tab}`, lang)}</p>`
          : `<div class="mis-productos-list">${visible.map((i) => solicitudCardHtml(i, lang, tab, today)).join("")}</div>`
      }
    </div>
  `;
}

export async function renderMisProductos(container: HTMLElement, lang: Lang): Promise<void> {
  container.innerHTML = `<p class="empty-state">...</p>`;
  const [items, { data: candidatesData }] = await Promise.all([getAllMisProductos(), loadCandidates()]);
  const byProductId = new Map(candidatesData.candidates.map((c) => [c.product_id, c]));
  const today = new Date();
  let solicitudTab: SolicitudTab = "pendientes";

  const draw = () => {
    const summary = summarize(items);
    // Solicitud-stage items (solicitado/aprobado/rechazado) live in their
    // own Solicitudes section below, not this pipeline list -- it now
    // starts at "recibido" (STATUS_ORDER no longer includes "solicitado").
    const pipelineItems = items.filter((i) => !(["solicitado", "aprobado", "rechazado"] as MisProductoStatus[]).includes(i.status));
    const sorted = [...pipelineItems].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));

    container.innerHTML = `
      <h2 class="view-title">${t("mis_productos_title", lang)}</h2>
      <div class="mis-productos-summary">
        ${STATUS_ORDER.concat(TERMINAL_STATUSES)
          .map((s) => `<div class="mis-productos-summary-chip"><b>${summary.countsByStatus[s]}</b><span>${statusLabel(s, lang)}</span></div>`)
          .join("")}
      </div>
      <div class="mis-productos-summary-line">
        ${t("mis_productos_total_earned", lang, { amount: `$${summary.totalEarned.toFixed(2)}` })}
        ${summary.waitingToFilm > 0 ? ` &middot; ${t("mis_productos_waiting_to_film", lang, { n: summary.waitingToFilm })}` : ""}
      </div>
      ${solicitudesSectionHtml(items, solicitudTab, lang, today)}
      ${addFormHtml(lang)}
      ${pipelineItems.length === 0 ? `<p class="empty-state">${t("mis_productos_empty", lang)}</p>` : `<div class="mis-productos-list">${sorted.map((i) => itemCardHtml(i, lang, isOverdueToFilm(i, today))).join("")}</div>`}
    `;

    container.querySelectorAll<HTMLButtonElement>("[data-solicitud-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        solicitudTab = btn.dataset.solicitudTab as SolicitudTab;
        draw();
      });
    });

    container.querySelectorAll<HTMLButtonElement>('[data-action="solicitud-cancel"]').forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id!;
        await removeMisProducto(id);
        const idx = items.findIndex((i) => i.id === id);
        if (idx >= 0) items.splice(idx, 1);
        draw();
      });
    });

    container.querySelectorAll<HTMLButtonElement>('[data-action="solicitud-approve"]').forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id!;
        await updateMisProducto(id, { status: "aprobado" });
        const item = items.find((i) => i.id === id);
        if (item) item.status = "aprobado";
        draw();
      });
    });

    container.querySelectorAll<HTMLButtonElement>('[data-action="solicitud-reject"]').forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id!;
        const item = items.find((i) => i.id === id);
        if (!item) return;
        const reason = window.prompt(t("solicitudes_rejection_reason_prompt", lang), "") || null;
        const patch: Partial<MisProducto> = {
          status: "rechazado",
          rejection_reason: reason,
          times_rejected: item.times_rejected + 1,
        };
        await updateMisProducto(id, patch);
        Object.assign(item, patch);
        draw();
      });
    });

    container.querySelectorAll<HTMLButtonElement>('[data-action="solicitud-arrived"]').forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id!;
        const patch: Partial<MisProducto> = { status: "recibido", date_received: new Date().toISOString().slice(0, 10) };
        await updateMisProducto(id, patch);
        const item = items.find((i) => i.id === id);
        if (item) Object.assign(item, patch);
        draw();
      });
    });

    container.querySelectorAll<HTMLButtonElement>('[data-action="solicitud-again"]').forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id!;
        const patch: Partial<MisProducto> = { status: "solicitado", date_requested: new Date().toISOString().slice(0, 10) };
        await updateMisProducto(id, patch);
        const item = items.find((i) => i.id === id);
        if (item) Object.assign(item, patch);
        solicitudTab = "pendientes";
        draw();
      });
    });

    container.querySelectorAll<HTMLButtonElement>('[data-action="solicitud-hide"]').forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id!;
        const productId = btn.dataset.productId;
        if (productId) await setFeedback(productId, "not_for_me");
        await removeMisProducto(id);
        const idx = items.findIndex((i) => i.id === id);
        if (idx >= 0) items.splice(idx, 1);
        draw();
      });
    });

    container.querySelector('[data-form="add"]')?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.currentTarget as HTMLFormElement;
      const linkOrName = (form.elements.namedItem("link_or_name") as HTMLInputElement).value.trim();
      const photoUrl = (form.elements.namedItem("photo_url") as HTMLInputElement).value.trim() || null;
      const commissionPct = Number((form.elements.namedItem("commission_pct") as HTMLInputElement).value) || null;
      const dateRequested = (form.elements.namedItem("date_requested") as HTMLInputElement).value;
      const productId = parseProductIdFromTikTokShopUrl(linkOrName);
      const matched: Candidate | undefined = productId ? byProductId.get(productId) : undefined;
      const item = emptyMisProducto({
        product_id: matched?.product_id ?? productId,
        name: matched?.clean_title ?? linkOrName,
        photo_url: matched?.image_url ?? photoUrl,
        category: matched?.category ?? null,
        commission_pct: matched ? Math.round(matched.commission_rate * 100) : commissionPct,
        tiktok_shop_url: matched?.tiktok_shop_url ?? (productId ? linkOrName : null),
        price: matched?.price ?? null,
        earnings_per_sale: matched?.earnings_per_sale ?? null,
        effort_minutes: matched?.effort_minutes ?? null,
        date_requested: dateRequested || new Date().toISOString().slice(0, 10),
      });
      await addMisProducto(item);
      items.unshift(item);
      draw();
    });

    container.querySelectorAll<HTMLButtonElement>('[data-action="advance"]').forEach((btn) => {
      btn.addEventListener("click", async () => {
        const { id, next } = btn.dataset;
        if (!id || !next) return;
        const patch: Partial<MisProducto> = { status: next as MisProductoStatus };
        if (next === "recibido") patch.date_received = new Date().toISOString().slice(0, 10);
        if (next === "publicado") patch.date_posted = new Date().toISOString().slice(0, 10);
        await updateMisProducto(id, patch);
        const item = items.find((i) => i.id === id);
        if (item) Object.assign(item, patch);
        draw();
      });
    });

    container.querySelectorAll<HTMLButtonElement>('[data-action="toggle-venta"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        const form = container.querySelector<HTMLElement>(`[data-form="quick-venta-item"][data-id="${btn.dataset.id}"]`);
        if (form) form.style.display = form.style.display === "none" ? "flex" : "none";
      });
    });

    container.querySelectorAll<HTMLFormElement>('[data-form="quick-venta-item"]').forEach((form) => {
      const unitsInput = form.querySelector<HTMLInputElement>('[name="units"]');
      const amountInput = form.querySelector<HTMLInputElement>('[name="amount"]');
      const item = items.find((i) => i.id === form.dataset.id);
      unitsInput?.addEventListener("input", () => {
        if (item?.earnings_per_sale) {
          amountInput!.value = (item.earnings_per_sale * (Number(unitsInput.value) || 1)).toFixed(2);
        }
      });
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const id = form.dataset.id!;
        const current = items.find((i) => i.id === id);
        if (!current) return;
        const units = Number(unitsInput?.value) || 1;
        const amount = Number(amountInput?.value);
        const date = (form.elements.namedItem("date") as HTMLInputElement).value;
        if (!(amount > 0) || !date) return;
        await addEntry(amount, date, { productId: id, units });
        const patch: Partial<MisProducto> = {
          units: (current.units ?? 0) + units,
          earnings: (current.earnings ?? 0) + amount,
          status: current.status === "vendiendo" ? current.status : "vendiendo",
        };
        await updateMisProducto(id, patch);
        Object.assign(current, patch);
        draw();
      });
    });

    container.querySelectorAll<HTMLButtonElement>('[data-action="reject"]').forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id!;
        await updateMisProducto(id, { status: "rechazado" });
        const item = items.find((i) => i.id === id);
        if (item) item.status = "rechazado";
        draw();
      });
    });

    container.querySelectorAll<HTMLButtonElement>('[data-action="delete"]').forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id!;
        await removeMisProducto(id);
        const idx = items.findIndex((i) => i.id === id);
        if (idx >= 0) items.splice(idx, 1);
        draw();
      });
    });

    container.querySelectorAll<HTMLFormElement>('[data-form="detail"]').forEach((form) => {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const id = form.dataset.id!;
        const notes = (form.elements.namedItem("notes") as HTMLTextAreaElement).value;
        const videoLinksRaw = (form.elements.namedItem("video_links") as HTMLTextAreaElement).value;
        const units = Number((form.elements.namedItem("units") as HTMLInputElement).value) || null;
        const earnings = Number((form.elements.namedItem("earnings") as HTMLInputElement).value) || null;
        const dateReceived = (form.elements.namedItem("date_received") as HTMLInputElement).value || null;
        const patch: Partial<MisProducto> = {
          notes,
          video_links: videoLinksRaw.split("\n").map((s) => s.trim()).filter(Boolean),
          units,
          earnings,
          date_received: dateReceived,
        };
        await updateMisProducto(id, patch);
        const item = items.find((i) => i.id === id);
        if (item) Object.assign(item, patch);
        draw();
      });
    });
  };

  draw();
}
