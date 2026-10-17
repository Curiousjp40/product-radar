import { loadCandidates } from "../api";
import { getCreatorProfile } from "../creatorProfile";
import { t, type Lang } from "../i18n";
import { outreachMessage, outreachShops } from "../outreach";

// H4 brand outreach, part of the 2026-10-15 creator-workflow upgrade.
// Mirrors config/weights.yaml's outreach section (commission_top_fraction,
// creator_count_bottom_fraction) -- not per-week data, so not worth
// exporting a file just for two numbers; keep these in sync if that
// config changes.
const COMMISSION_TOP_FRACTION = 0.5;
const CREATOR_COUNT_BOTTOM_FRACTION = 0.5;

export async function renderOutreach(container: HTMLElement, lang: Lang): Promise<void> {
  container.innerHTML = `<p class="empty-state">...</p>`;
  const [{ data, isSample }, profile] = await Promise.all([loadCandidates(), getCreatorProfile()]);
  const banner = isSample ? `<div class="sample-banner">${t("sample_data_banner", lang)}</div>` : "";

  const shops = outreachShops(data.candidates, COMMISSION_TOP_FRACTION, CREATOR_COUNT_BOTTOM_FRACTION);

  container.innerHTML = `
    ${banner}
    <h2 class="view-title">${t("outreach_title", lang)}</h2>
    ${
      shops.length === 0
        ? `<p class="empty-state">${t("outreach_empty", lang)}</p>`
        : `<div class="outreach-list">
            ${shops
              .map((s) => {
                const message = outreachMessage(
                  s.shop_name,
                  s.representative_product.clean_title,
                  Math.round(s.avg_commission_rate * 100),
                  lang,
                  profile,
                );
                return `
                <div class="outreach-card" data-message="${message.replace(/"/g, "&quot;")}">
                  <h3>${s.shop_name}</h3>
                  <div class="outreach-stats">
                    ${(s.avg_commission_rate * 100).toFixed(0)}% ${t("outreach_commission_label", lang)} &middot; ${s.avg_creator_count.toFixed(0)} ${t("outreach_creators_label", lang)}
                  </div>
                  <p class="outreach-product">${s.representative_product.clean_title}</p>
                  <pre class="outreach-message">${message}</pre>
                  <div class="card-actions">
                    <button type="button" class="btn-primary copy-outreach-btn">${t("copy_message_button", lang)}</button>
                    <a href="${s.representative_product.tiktok_shop_url}" target="_blank" rel="noopener" class="btn-save-pill">${t("open_in_tiktok_shop", lang)}</a>
                  </div>
                </div>`;
              })
              .join("")}
          </div>`
    }
  `;

  container.querySelectorAll<HTMLElement>(".outreach-card").forEach((card) => {
    const btn = card.querySelector<HTMLButtonElement>(".copy-outreach-btn");
    btn?.addEventListener("click", () => {
      const text = card.dataset.message ?? "";
      const originalLabel = btn.textContent;
      navigator.clipboard
        .writeText(text)
        .then(() => {
          btn.textContent = t("copied_label", lang);
          setTimeout(() => {
            btn.textContent = originalLabel;
          }, 1500);
        })
        .catch(() => {
          // clipboard unavailable -- the message is still readable on its own
        });
    });
  });
}
