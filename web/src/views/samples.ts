import { loadPicks } from "../api";
import { t, type Lang } from "../i18n";
import { deleteSample, getAllSamples, newSampleId, upsertSample } from "../samples";
import {
  defaultPostByDate,
  daysUntilPostBy,
  sampleUrgency,
  samplesSummary,
  samplesToCsv,
  sortSamplesByUrgency,
  type Sample,
  type SampleStatus,
} from "../samplesLogic";
import type { Pick } from "../types";

const NEXT_STATUS: Record<SampleStatus, SampleStatus | null> = {
  received: "filmed",
  filmed: "posted",
  posted: null,
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function summaryHtml(samples: Sample[], today: Date, lang: Lang): string {
  const s = samplesSummary(samples, today);
  return `
    <div class="stat-row">
      <div class="stat"><b>${s.pending}</b><span>${t("summary_pending_label", lang)}</span></div>
      <div class="stat"><b>${s.overdue}</b><span>${t("summary_overdue_label", lang)}</span></div>
      <div class="stat"><b>$${s.totalValueThisYear.toFixed(0)}</b><span>${t("summary_value_year_label", lang)}</span></div>
    </div>
  `;
}

function urgencyBadgeHtml(sample: Sample, today: Date, lang: Lang): string {
  const urgency = sampleUrgency(sample, today);
  if (urgency === "posted" || urgency === "ok") return "";
  if (urgency === "overdue") {
    return `<span class="urgency-badge urgency-overdue">${t("urgency_overdue_label", lang)}</span>`;
  }
  const days = Math.max(daysUntilPostBy(sample.post_by_date, today), 0);
  return `<span class="urgency-badge urgency-due-soon">${t("urgency_due_soon_label", lang, { days })}</span>`;
}

function sampleRowHtml(sample: Sample, today: Date, lang: Lang): string {
  const next = NEXT_STATUS[sample.status];
  return `
    <div class="sample-row" data-sample-id="${sample.id}">
      <div class="sample-row-top">
        <span class="sample-name">${sample.name}</span>
        ${urgencyBadgeHtml(sample, today, lang)}
      </div>
      <div class="sample-meta">
        ${t("sample_date_received_label", lang)}: ${sample.date_received} &middot;
        $${sample.value_usd.toFixed(2)} &middot;
        ${t("sample_post_by_label", lang)}: ${sample.post_by_date}
      </div>
      ${sample.notes ? `<p class="sample-notes">${sample.notes}</p>` : ""}
      ${sample.tiktok_url ? `<a class="sample-tiktok-link" href="${sample.tiktok_url}" target="_blank" rel="noopener">${sample.tiktok_url}</a>` : ""}
      <div class="sample-row-actions">
        <span class="sample-status-label">${t(`status_${sample.status === "filmed" ? "filmed_sample" : sample.status === "posted" ? "posted_sample" : "received"}`, lang)}</span>
        ${next ? `<button type="button" class="btn-sample-advance" data-action="advance">${t(`status_${next === "filmed" ? "filmed_sample" : "posted_sample"}`, lang)} &rarr;</button>` : ""}
        <button type="button" class="btn-sample-delete" data-action="delete">${t("delete_button", lang)}</button>
      </div>
    </div>
  `;
}

function addFormHtml(picks: Pick[], lang: Lang): string {
  return `
    <form id="add-sample-form" class="sample-form">
      <label>
        ${t("sample_pick_product_label", lang)}
        <select id="sample-product-select">
          <option value="">--</option>
          ${picks.map((p) => `<option value="${p.product_id}">${p.clean_title}</option>`).join("")}
        </select>
      </label>
      <label>
        ${t("sample_or_type_name_label", lang)}
        <input type="text" id="sample-name-input" />
      </label>
      <label>
        ${t("sample_date_received_label", lang)}
        <input type="date" id="sample-date-received-input" value="${todayIso()}" />
      </label>
      <label>
        ${t("sample_value_label", lang)}
        <input type="number" id="sample-value-input" min="0" step="0.01" value="0" />
      </label>
      <label>
        ${t("sample_post_by_label", lang)}
        <input type="date" id="sample-post-by-input" value="${defaultPostByDate(todayIso())}" />
      </label>
      <label>
        ${t("sample_notes_label", lang)}
        <textarea id="sample-notes-input" rows="2"></textarea>
      </label>
      <div class="sample-form-actions">
        <button type="submit" class="btn-primary">${t("save_button", lang)}</button>
        <button type="button" id="cancel-add-sample" class="btn-cancel">${t("cancel_button", lang)}</button>
      </div>
    </form>
  `;
}

export async function renderSamples(container: HTMLElement, lang: Lang): Promise<void> {
  container.innerHTML = `<p class="empty-state">...</p>`;
  const { data: picksData } = await loadPicks();
  const today = new Date();
  const samples = sortSamplesByUrgency(getAllSamples(), today);

  const renderList = () => {
    const current = sortSamplesByUrgency(getAllSamples(), today);
    const list = container.querySelector<HTMLElement>("#samples-list");
    const summary = container.querySelector<HTMLElement>("#samples-summary");
    if (summary) summary.innerHTML = summaryHtml(current, today, lang);
    if (list) {
      list.innerHTML =
        current.length === 0
          ? `<p class="empty-state">${t("muestras_empty", lang)}</p>`
          : current.map((s) => sampleRowHtml(s, today, lang)).join("");
      wireRowActions(list);
    }
  };

  function wireRowActions(list: HTMLElement): void {
    list.querySelectorAll<HTMLElement>(".sample-row").forEach((row) => {
      const id = row.dataset.sampleId!;
      row.querySelector('[data-action="advance"]')?.addEventListener("click", () => {
        const sample = getAllSamples().find((s) => s.id === id);
        if (!sample) return;
        const next = NEXT_STATUS[sample.status];
        if (!next) return;
        if (next === "posted") {
          const url = window.prompt(t("sample_tiktok_url_label", lang)) ?? "";
          upsertSample({ ...sample, status: next, tiktok_url: url || undefined });
        } else {
          upsertSample({ ...sample, status: next });
        }
        renderList();
      });
      row.querySelector('[data-action="delete"]')?.addEventListener("click", () => {
        deleteSample(id);
        renderList();
      });
    });
  }

  container.innerHTML = `
    <h2 class="view-title">${t("muestras_title", lang)}</h2>
    <div id="samples-summary">${summaryHtml(samples, today, lang)}</div>
    <button type="button" id="show-add-sample" class="btn-accent add-sample-toggle">${t("add_sample_button", lang)}</button>
    <div id="add-sample-container"></div>
    <button type="button" id="export-csv-btn" class="export-csv-btn">${t("export_csv_button", lang)}</button>
    <div id="samples-list">
      ${samples.length === 0 ? `<p class="empty-state">${t("muestras_empty", lang)}</p>` : samples.map((s) => sampleRowHtml(s, today, lang)).join("")}
    </div>
  `;
  wireRowActions(container.querySelector<HTMLElement>("#samples-list")!);

  container.querySelector("#show-add-sample")?.addEventListener("click", () => {
    const formContainer = container.querySelector<HTMLElement>("#add-sample-container")!;
    formContainer.innerHTML = addFormHtml(picksData.picks, lang);
    const select = formContainer.querySelector<HTMLSelectElement>("#sample-product-select");
    const nameInput = formContainer.querySelector<HTMLInputElement>("#sample-name-input");
    select?.addEventListener("change", () => {
      const pick = picksData.picks.find((p) => p.product_id === select.value);
      if (pick && nameInput) nameInput.value = pick.clean_title;
    });
    const dateReceivedInput = formContainer.querySelector<HTMLInputElement>("#sample-date-received-input");
    const postByInput = formContainer.querySelector<HTMLInputElement>("#sample-post-by-input");
    dateReceivedInput?.addEventListener("change", () => {
      if (dateReceivedInput.value && postByInput) {
        postByInput.value = defaultPostByDate(dateReceivedInput.value);
      }
    });
    formContainer.querySelector("#cancel-add-sample")?.addEventListener("click", () => {
      formContainer.innerHTML = "";
    });
    formContainer.querySelector("#add-sample-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = nameInput?.value.trim() || picksData.picks.find((p) => p.product_id === select?.value)?.clean_title || "";
      if (!name) return;
      const sample: Sample = {
        id: newSampleId(),
        product_id: select?.value || undefined,
        name,
        date_received: dateReceivedInput?.value || todayIso(),
        value_usd: Number(formContainer.querySelector<HTMLInputElement>("#sample-value-input")?.value || 0),
        post_by_date: postByInput?.value || defaultPostByDate(todayIso()),
        notes: formContainer.querySelector<HTMLTextAreaElement>("#sample-notes-input")?.value || "",
        status: "received",
      };
      upsertSample(sample);
      formContainer.innerHTML = "";
      renderList();
    });
  });

  container.querySelector("#export-csv-btn")?.addEventListener("click", (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    const csv = samplesToCsv(sortSamplesByUrgency(getAllSamples(), today));
    const originalLabel = btn.textContent;
    navigator.clipboard
      .writeText(csv)
      .then(() => {
        btn.textContent = t("export_csv_copied", lang);
        setTimeout(() => {
          btn.textContent = originalLabel;
        }, 1500);
      })
      .catch(() => {
        // clipboard unavailable -- nothing else to fall back to here
      });
  });
}
