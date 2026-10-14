import { loadCandidates } from "../api";
import { t, type Lang } from "../i18n";
import { getAllStatuses, setStatus } from "../pipeline";
import type { PipelineStatusName } from "../types";

const STATUSES: PipelineStatusName[] = [
  "shortlisted",
  "sample_requested",
  "sample_received",
  "filmed",
  "posted",
  "skipped",
];

export async function renderPipeline(container: HTMLElement, lang: Lang): Promise<void> {
  container.innerHTML = `<p class="empty-state">...</p>`;
  const { data } = await loadCandidates();
  const statuses = await getAllStatuses();
  const trackedIds = Object.keys(statuses);
  const rows = data.candidates.filter((c) => trackedIds.includes(c.product_id));

  if (rows.length === 0) {
    container.innerHTML = `
      <h2 class="view-title">${t("pipeline_title", lang)}</h2>
      <p class="empty-state">${lang === "es" ? "Todavia no has agregado nada a tu lista." : "You haven't shortlisted anything yet."}</p>
    `;
    return;
  }

  container.innerHTML = `
    <h2 class="view-title">${t("pipeline_title", lang)}</h2>
    <div class="table-scroll">
      <table class="radar-table">
        <thead>
          <tr>
            <th>${lang === "es" ? "Producto" : "Product"}</th>
            <th>${t("category", lang)}</th>
            <th>${lang === "es" ? "Estado" : "Status"}</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (c) => `
            <tr data-product-id="${c.product_id}">
              <td>${c.title}</td>
              <td>${c.category}</td>
              <td>
                <select class="status-select">
                  ${STATUSES.map((s) => `<option value="${s}" ${statuses[c.product_id] === s ? "selected" : ""}>${t(`status_${s}`, lang)}</option>`).join("")}
                </select>
              </td>
            </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;

  container.querySelectorAll<HTMLTableRowElement>("tr[data-product-id]").forEach((row) => {
    const productId = row.dataset.productId!;
    row.querySelector("select")?.addEventListener("change", (e) => {
      void setStatus(productId, (e.target as HTMLSelectElement).value as PipelineStatusName);
    });
  });
}
