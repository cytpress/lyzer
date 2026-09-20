import MiniSearch from "minisearch";
import { getCommitteeStyle } from "../lib/committee";
import { expandQuery, miniSearchOptions } from "../lib/search";
import type { HomepageAgenda } from "../types";

const BOOKMARK_STORAGE_KEY = "lyzer-bookmarks";
const PAGE_SIZE = 10;
let agendaCatalogPromise: Promise<HomepageAgenda[]> | null = null;
let miniSearchPromise: Promise<MiniSearch[] | null> | null = null;

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
      class="icon-button"
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
  const committeeStyle = getCommitteeStyle(committee);

  return `
    <li class="page-shell-narrow" data-agenda-card data-agenda-id="${escapeHtml(agenda.agendaId)}">
      <article class="agenda-card relative flex flex-col justify-center px-4 py-5 md:px-8 md:py-7">
        <div class="mb-3 flex items-start justify-between gap-4">
          <a class="min-w-0 after:absolute after:inset-0 after:content-['']" href="/gazettes/${encodeURIComponent(agenda.agendaId)}">
            <h2 class="text-lg font-medium leading-snug text-neutral-900 md:text-xl">${escapeHtml(agenda.summaryTitle)}</h2>
          </a>
          <div class="relative z-10">${renderBookmarkButton(agenda.agendaId)}</div>
        </div>
        <div class="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-600 md:text-sm">
          <span class="committee-tag" data-tone="${committeeStyle.tone}"><span class="md:hidden">${escapeHtml(committeeStyle.shortName)}</span><span class="hidden md:inline">${escapeHtml(committee)}</span></span>
          <span>會議日期：${escapeHtml(meetingDate)}</span>
          <span class="hidden text-neutral-300 md:inline">／</span>
          <span class="hidden truncate md:inline">${escapeHtml(agenda.gazetteId)}</span>
        </div>
        <p class="line-clamp-2 text-sm leading-7 text-neutral-600 md:line-clamp-3">${escapeHtml(
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

async function loadMiniSearch(): Promise<MiniSearch[] | null> {
  if (miniSearchPromise) return miniSearchPromise;

  miniSearchPromise = loadMiniSearchChunks();
  return miniSearchPromise;
}

async function loadMiniSearchChunks(): Promise<MiniSearch[] | null> {
  try {
    const response = await fetch("/search-index.json");
    if (!response.ok) throw new Error(`search-index ${response.status}`);
    const payload = (await response.json()) as { chunks: string[] };
    return Promise.all(
      payload.chunks.map(async (chunk) => {
        const chunkResponse = await fetch(chunk);
        if (!chunkResponse.ok) throw new Error(`search-index chunk ${chunkResponse.status}`);
        const chunkPayload = (await chunkResponse.json()) as { index: string };
        return MiniSearch.loadJSON(chunkPayload.index, miniSearchOptions);
      })
    );
  } catch (error) {
    console.warn(error);
    return null;
  }
}

async function loadAgendaCatalog(): Promise<HomepageAgenda[]> {
  if (agendaCatalogPromise) return agendaCatalogPromise;

  agendaCatalogPromise = (async () => {
    const response = await fetch("/agenda-catalog.json");
    if (!response.ok) throw new Error(`agenda-catalog ${response.status}`);
    const payload = (await response.json()) as { chunks: string[] };
    const chunks = await Promise.all(
      payload.chunks.map(async (chunk) => {
        const chunkResponse = await fetch(chunk);
        if (!chunkResponse.ok) throw new Error(`agenda-catalog chunk ${chunkResponse.status}`);
        return (await chunkResponse.json()) as HomepageAgenda[];
      })
    );
    return chunks.flat();
  })();

  return agendaCatalogPromise;
}

function agendaFromSearchResult(result: Record<string, unknown>): HomepageAgenda | null {
  const agendaId = typeof result.agendaId === "string" ? result.agendaId : String(result.id ?? "");
  if (!agendaId) return null;

  return {
    agendaId,
    gazetteId: typeof result.gazetteId === "string" ? result.gazetteId : "",
    meetingDates: [],
    meetingDate: typeof result.meetingDate === "string" ? result.meetingDate : null,
    subject: typeof result.subject === "string" ? result.subject : null,
    committee: typeof result.committee === "string" ? result.committee : null,
    summaryTitle: typeof result.summaryTitle === "string" ? result.summaryTitle : agendaId,
    overallSummary: typeof result.overallSummary === "string" ? result.overallSummary : "",
    agendaItems: [],
    legislators: [],
    respondents: [],
    resultAndNextSteps: [],
    analyzedAt: null,
  };
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

  let agendas = readJsonScript<HomepageAgenda[]>("lyzer-agendas-data") ?? [];
  const totalAgendaCount = Number(root.dataset.totalCount ?? agendas.length);
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

  let miniSearch: MiniSearch[] | null = null;
  let currentPage = 1;
  let selectedCommittee = "";
  let currentQuery = new URL(window.location.href).searchParams.get("q") ?? "";
  let catalogLoaded = false;
  let loadingCatalog = false;
  let loadingSearch = false;

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
            .flatMap((index) => index.search(expandQuery(query)))
            .sort((left, right) => right.score - left.score)
            .map((result) => agendaFromSearchResult(result as Record<string, unknown>))
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
      button.className = "filter-chip";
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
    const isInitialCatalog = !catalogLoaded && !currentQuery && !selectedCommittee;
    const resultCount = isInitialCatalog ? totalAgendaCount : results.length;
    const totalPages = Math.max(1, Math.ceil(resultCount / PAGE_SIZE));
    currentPage = Math.min(currentPage, totalPages);
    const start = (currentPage - 1) * PAGE_SIZE;
    const visible = results.slice(start, start + PAGE_SIZE);

    count.textContent = `${resultCount} 筆摘要`;
    if (status)
      status.textContent = loadingCatalog
        ? "載入摘要資料中"
        : loadingSearch
          ? "載入搜尋索引中"
          : currentQuery
            ? `搜尋「${currentQuery}」`
            : "";
    list.innerHTML = visible.map(renderAgendaCard).join("");
    empty.hidden = visible.length > 0;
    renderPagination(totalPages);
    syncCommitteeButtons();
    syncBookmarkButtons(list);
  };

  const ensureCatalog = async () => {
    if (catalogLoaded) return;
    const startedLoading = !loadingCatalog;
    if (startedLoading) {
      loadingCatalog = true;
      render();
    }
    try {
      agendas = await loadAgendaCatalog();
      catalogLoaded = true;
    } catch (error) {
      console.warn(error);
      if (status) status.textContent = "摘要資料載入失敗，請稍後再試";
    } finally {
      if (startedLoading) {
        loadingCatalog = false;
        render();
      }
    }
  };

  const ensureSearch = async () => {
    if (miniSearch || loadingSearch) return;
    loadingSearch = true;
    render();
    miniSearch = await loadMiniSearch();
    loadingSearch = false;
    render();
  };

  const updateQuery = (query: string) => {
    currentQuery = query.trim();
    currentPage = 1;
    if (input && input.value !== currentQuery) input.value = currentQuery;
    if (headerInput && headerInput.value !== currentQuery) headerInput.value = currentQuery;
    setUrlQuery(currentQuery);
    render();
  };

  input?.addEventListener("input", () => {
    updateQuery(input.value);
    if (input.value.trim()) void ensureSearch();
  });
  headerInput?.addEventListener("input", () => {
    updateQuery(headerInput.value);
    if (headerInput.value.trim()) void ensureSearch();
  });
  sortSelect?.addEventListener("change", () => {
    if (!currentQuery) void ensureCatalog();
    else render();
  });
  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      selectedCommittee = button.dataset.committee ?? "";
      currentPage = 1;
      void ensureCatalog();
    });
  });
  pagination.addEventListener("click", (event) => {
    const button = (event.target as Element | null)?.closest<HTMLButtonElement>("[data-page]");
    if (!button?.dataset.page) return;
    const targetPage = Number(button.dataset.page);
    const showPage = () => {
      currentPage = targetPage;
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
    };
    if (!catalogLoaded && !currentQuery) void ensureCatalog().then(showPage);
    else showPage();
  });

  render();
  if (currentQuery) void ensureSearch();
}

function initBookmarksPage(): void {
  const root = document.querySelector<HTMLElement>("[data-bookmarks-page]");
  if (!root) return;

  const list = root.querySelector<HTMLElement>("[data-bookmarks-list]");
  const empty = root.querySelector<HTMLElement>("[data-empty-state]");
  if (!list || !empty) return;

  const render = (itemById: Map<string, HomepageAgenda>) => {
    const bookmarked = readBookmarks()
      .map((id) => itemById.get(id))
      .filter((agenda): agenda is HomepageAgenda => Boolean(agenda));
    list.innerHTML = bookmarked.map(renderAgendaCard).join("");
    empty.hidden = bookmarked.length > 0;
    syncBookmarkButtons(list);
  };

  const bookmarkIds = readBookmarks();
  if (bookmarkIds.length === 0) {
    empty.hidden = false;
    return;
  }

  empty.textContent = "正在載入收藏的議事摘要…";
  void loadAgendaCatalog()
    .then((agendas) => {
      const itemById = new Map(agendas.map((agenda) => [agenda.agendaId, agenda]));
      const rerender = () => render(itemById);
      window.addEventListener("lyzer-bookmarks-changed", rerender);
      window.addEventListener("storage", rerender);
      empty.textContent = "目前沒有收藏的議事摘要。";
      rerender();
    })
    .catch((error) => {
      console.warn(error);
      empty.textContent = "收藏資料載入失敗，請稍後再試。";
    });
}

initHeaderSearch();
initBookmarks();
initSearchPage();
initBookmarksPage();
