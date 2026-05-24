import MiniSearch from "minisearch";
import { expandQuery, miniSearchOptions } from "../lib/search";
import type { HomepageAgenda } from "../types";

const BOOKMARK_STORAGE_KEY = "lyzer-bookmarks";
const PAGE_SIZE = 10;

function readJsonScript<T>(id: string): T | null {
  const element = document.getElementById(id);
  if (!element?.textContent) return null;

  try {
    return JSON.parse(element.textContent) as T;
  } catch (error) {
    console.warn(error);
    return null;
  }
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function readBookmarks(): string[] {
  const raw = window.localStorage.getItem(BOOKMARK_STORAGE_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function writeBookmarks(ids: string[]): void {
  window.localStorage.setItem(BOOKMARK_STORAGE_KEY, JSON.stringify(Array.from(new Set(ids))));
  window.dispatchEvent(new CustomEvent("lyzer-bookmarks-changed"));
}

function isBookmarked(agendaId: string): boolean {
  return readBookmarks().includes(agendaId);
}

function renderBookmarkButton(agendaId: string): string {
  const active = isBookmarked(agendaId);
  return `
    <button
      class="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-500 transition hover:border-neutral-500 hover:text-neutral-900 data-[active=true]:border-amber-300 data-[active=true]:bg-amber-50 data-[active=true]:text-amber-600"
      type="button"
      data-bookmark-button
      data-agenda-id="${escapeHtml(agendaId)}"
      data-active="${active ? "true" : "false"}"
      aria-label="${active ? "移除收藏" : "加入收藏"}"
      title="${active ? "移除收藏" : "加入收藏"}"
    >
      <svg aria-hidden="true" class="h-5 w-5" data-bookmark-icon fill="${active ? "currentColor" : "none"}" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24">
        <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
      </svg>
    </button>
  `;
}

function renderAgendaCard(agenda: HomepageAgenda): string {
  const meetingDate = agenda.meetingDate ?? agenda.meetingDates[0] ?? "日期未明";
  const committee = agenda.committee ?? "委員會";

  return `
    <li class="mx-auto w-11/12 md:w-4/5" data-agenda-card data-agenda-id="${escapeHtml(agenda.agendaId)}">
      <article class="flex flex-col justify-center rounded-3xl border-2 border-neutral-200 bg-white px-4 py-4 transition-all duration-200 ease-in-out hover:border-neutral-500 md:px-8 md:py-8">
        <div class="mb-2 flex items-start justify-between gap-4">
          <a class="min-w-0" href="/gazettes/${encodeURIComponent(agenda.agendaId)}">
            <h2 class="mb-2 text-lg font-medium leading-snug text-neutral-900 md:text-xl">${escapeHtml(agenda.summaryTitle)}</h2>
          </a>
          ${renderBookmarkButton(agenda.agendaId)}
        </div>
        <div class="mb-3 flex flex-wrap items-center gap-2 text-xs text-neutral-500 md:text-sm">
          <span class="rounded-full bg-neutral-100 px-3 py-1 text-neutral-700">${escapeHtml(committee)}</span>
          <span>${escapeHtml(meetingDate)}</span>
          <span class="hidden md:inline">/</span>
          <span class="truncate">${escapeHtml(agenda.gazetteId)}</span>
        </div>
        <p class="line-clamp-2 text-sm leading-relaxed text-neutral-600 md:line-clamp-3">${escapeHtml(
          agenda.overallSummary || agenda.subject || "此議程尚無摘要。"
        )}</p>
      </article>
    </li>
  `;
}

function syncBookmarkButtons(root: ParentNode = document): void {
  root.querySelectorAll<HTMLButtonElement>("[data-bookmark-button]").forEach((button) => {
    const agendaId = button.dataset.agendaId;
    if (!agendaId) return;

    const active = isBookmarked(agendaId);
    button.dataset.active = active ? "true" : "false";
    button.setAttribute("aria-label", active ? "移除收藏" : "加入收藏");
    button.setAttribute("title", active ? "移除收藏" : "加入收藏");

    const icon = button.querySelector<SVGElement>("[data-bookmark-icon]");
    if (icon) icon.setAttribute("fill", active ? "currentColor" : "none");
  });
}

function initBookmarks(): void {
  document.addEventListener("click", (event) => {
    const button = (event.target as Element | null)?.closest<HTMLButtonElement>("[data-bookmark-button]");
    if (!button?.dataset.agendaId) return;

    const current = readBookmarks();
    const agendaId = button.dataset.agendaId;
    const next = current.includes(agendaId) ? current.filter((id) => id !== agendaId) : [agendaId, ...current];
    writeBookmarks(next);
  });

  window.addEventListener("lyzer-bookmarks-changed", () => syncBookmarkButtons());
  window.addEventListener("storage", () => syncBookmarkButtons());
  syncBookmarkButtons();
}

async function loadMiniSearch(): Promise<MiniSearch | null> {
  try {
    const response = await fetch("/search-index.json");
    if (!response.ok) throw new Error(`search-index ${response.status}`);
    const payload = (await response.json()) as { index: string };
    return MiniSearch.loadJSON(payload.index, miniSearchOptions);
  } catch (error) {
    console.warn(error);
    return null;
  }
}

function setUrlQuery(query: string): void {
  const url = new URL(window.location.href);
  if (query) url.searchParams.set("q", query);
  else url.searchParams.delete("q");
  window.history.replaceState({}, "", url);
}

function initHeaderSearch(): void {
  const form = document.querySelector<HTMLFormElement>("[data-header-search-form]");
  const input = document.querySelector<HTMLInputElement>("[data-header-search-input]");
  if (!form || !input) return;

  const current = new URL(window.location.href).searchParams.get("q") ?? "";
  input.value = current;

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = input.value.trim();
    const target = new URL("/", window.location.origin);
    if (query) target.searchParams.set("q", query);
    window.location.href = target.toString();
  });
}

function initSearchPage(): void {
  const root = document.querySelector<HTMLElement>("[data-search-page]");
  if (!root) return;

  const agendas = readJsonScript<HomepageAgenda[]>("lyzer-agendas-data") ?? [];
  const itemById = new Map(agendas.map((agenda) => [agenda.agendaId, agenda]));
  const input = root.querySelector<HTMLInputElement>("[data-search-input]");
  const headerInput = document.querySelector<HTMLInputElement>("[data-header-search-input]");
  const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-committee-button]"));
  const list = root.querySelector<HTMLElement>("[data-agenda-list]");
  const count = root.querySelector<HTMLElement>("[data-result-count]");
  const status = root.querySelector<HTMLElement>("[data-search-status]");
  const empty = root.querySelector<HTMLElement>("[data-empty-state]");
  const pagination = root.querySelector<HTMLElement>("[data-pagination]");
  const sortSelect = root.querySelector<HTMLSelectElement>("[data-sort-select]");

  if (!list || !count || !empty || !pagination) return;

  let miniSearch: MiniSearch | null = null;
  let currentPage = 1;
  let selectedCommittee = "";
  let currentQuery = new URL(window.location.href).searchParams.get("q") ?? "";

  if (input) input.value = currentQuery;
  if (headerInput) headerInput.value = currentQuery;

  const byDate = (direction: "asc" | "desc") => (a: HomepageAgenda, b: HomepageAgenda) => {
    const left = a.meetingDate ?? "";
    const right = b.meetingDate ?? "";
    return direction === "asc" ? left.localeCompare(right) : right.localeCompare(left);
  };

  const filtered = (): HomepageAgenda[] => {
    const query = currentQuery.trim();
    const base =
      query && miniSearch
        ? miniSearch
            .search(expandQuery(query))
            .map((result) => itemById.get(String(result.id)))
            .filter((agenda): agenda is HomepageAgenda => Boolean(agenda))
        : [...agendas];

    const scoped = base.filter((agenda) => !selectedCommittee || agenda.committee === selectedCommittee);
    const sort = sortSelect?.value ?? "date-desc";

    if (query && miniSearch && sort === "relevance") return scoped;
    return scoped.sort(byDate(sort === "date-asc" ? "asc" : "desc"));
  };

  const syncCommitteeButtons = () => {
    buttons.forEach((button) => {
      const active = (button.dataset.committee ?? "") === selectedCommittee;
      button.dataset.active = active ? "true" : "false";
      button.className = active
        ? "rounded-full border border-neutral-900 bg-neutral-900 px-4 py-2 text-sm text-white transition"
        : "rounded-full border border-neutral-200 bg-white px-4 py-2 text-sm text-neutral-600 transition hover:border-neutral-500 hover:text-neutral-900";
    });
  };

  const renderPagination = (totalPages: number) => {
    if (totalPages <= 1) {
      pagination.innerHTML = "";
      return;
    }

    const pageButton = (page: number, label = String(page)) => `
      <button
        class="${page === currentPage ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-500 hover:text-neutral-900"} h-10 min-w-10 rounded-full border px-3 text-sm transition"
        type="button"
        data-page="${page}"
      >${label}</button>
    `;

    const pages = Array.from({ length: totalPages }, (_, index) => index + 1).filter(
      (page) => page === 1 || page === totalPages || Math.abs(page - currentPage) <= 1
    );

    let previous = 0;
    const html = [
      currentPage > 1 ? pageButton(currentPage - 1, "‹") : "",
      ...pages.map((page) => {
        const spacer = previous && page - previous > 1 ? `<span class="px-1 text-neutral-400">...</span>` : "";
        previous = page;
        return spacer + pageButton(page);
      }),
      currentPage < totalPages ? pageButton(currentPage + 1, "›") : "",
    ].join("");

    pagination.innerHTML = html;
  };

  const render = () => {
    const results = filtered();
    const totalPages = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
    currentPage = Math.min(currentPage, totalPages);
    const start = (currentPage - 1) * PAGE_SIZE;
    const visible = results.slice(start, start + PAGE_SIZE);

    count.textContent = `${results.length} 筆摘要`;
    if (status)
      status.textContent =
        currentQuery && !miniSearch ? "搜尋索引載入中" : currentQuery ? `搜尋「${currentQuery}」` : "";
    list.innerHTML = visible.map(renderAgendaCard).join("");
    empty.hidden = visible.length > 0;
    renderPagination(totalPages);
    syncCommitteeButtons();
    syncBookmarkButtons(list);
  };

  const updateQuery = (query: string) => {
    currentQuery = query.trim();
    currentPage = 1;
    if (input && input.value !== currentQuery) input.value = currentQuery;
    if (headerInput && headerInput.value !== currentQuery) headerInput.value = currentQuery;
    setUrlQuery(currentQuery);
    render();
  };

  input?.addEventListener("input", () => updateQuery(input.value));
  headerInput?.addEventListener("input", () => updateQuery(headerInput.value));
  sortSelect?.addEventListener("change", () => render());
  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      selectedCommittee = button.dataset.committee ?? "";
      currentPage = 1;
      render();
    });
  });
  pagination.addEventListener("click", (event) => {
    const button = (event.target as Element | null)?.closest<HTMLButtonElement>("[data-page]");
    if (!button?.dataset.page) return;
    currentPage = Number(button.dataset.page);
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  render();
  void loadMiniSearch().then((index) => {
    miniSearch = index;
    render();
  });
}

function initBookmarksPage(): void {
  const root = document.querySelector<HTMLElement>("[data-bookmarks-page]");
  if (!root) return;

  const agendas = readJsonScript<HomepageAgenda[]>("lyzer-agendas-data") ?? [];
  const itemById = new Map(agendas.map((agenda) => [agenda.agendaId, agenda]));
  const list = root.querySelector<HTMLElement>("[data-bookmarks-list]");
  const empty = root.querySelector<HTMLElement>("[data-empty-state]");
  if (!list || !empty) return;

  const render = () => {
    const bookmarked = readBookmarks()
      .map((id) => itemById.get(id))
      .filter((agenda): agenda is HomepageAgenda => Boolean(agenda));
    list.innerHTML = bookmarked.map(renderAgendaCard).join("");
    empty.hidden = bookmarked.length > 0;
    syncBookmarkButtons(list);
  };

  window.addEventListener("lyzer-bookmarks-changed", render);
  window.addEventListener("storage", render);
  render();
}

initHeaderSearch();
initBookmarks();
initSearchPage();
initBookmarksPage();
