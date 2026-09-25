import MiniSearch from "minisearch";
import { getCommitteeStyle, splitCommitteeNames } from "../lib/committee";
import { expandQuery, miniSearchOptions } from "../lib/search";
import type { HomepageAgenda } from "../types";

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

function renderAgendaCard(agenda: HomepageAgenda): string {
  const meetingDate = agenda.meetingDate ?? agenda.meetingDates[0] ?? "日期未明";
  const committees = splitCommitteeNames(agenda.committee);
  const tags = committees.length > 0 ? committees : [agenda.documentType ?? "委員會"];
  const committeeTags = tags
    .map((name) => {
      const style = getCommitteeStyle(name);
      return `<span class="committee-tag" data-tone="${style.tone}"><span class="md:hidden">${escapeHtml(style.shortName)}</span><span class="hidden md:inline">${escapeHtml(name)}</span></span>`;
    })
    .join("");

  return `
    <li class="page-shell-narrow" data-agenda-card data-agenda-id="${escapeHtml(agenda.agendaId)}">
      <article class="agenda-card relative flex flex-col justify-center px-4 py-5 md:px-8 md:py-7">
        <div class="mb-3">
          <a class="min-w-0 after:absolute after:inset-0 after:content-['']" href="/gazettes/${encodeURIComponent(agenda.agendaId)}">
            <h2 class="text-lg font-medium leading-snug text-neutral-900 md:text-xl">${escapeHtml(agenda.summaryTitle)}</h2>
          </a>
        </div>
        <div class="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-600 md:text-sm">
          ${committeeTags}
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
    documentType: typeof result.documentType === "string" ? result.documentType : null,
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
  const sortControl = root.querySelector<HTMLElement>("[data-sort-control]");

  if (!list || !count || !empty || !pagination) return;

  let miniSearch: MiniSearch[] | null = null;
  let currentPage = 1;
  let selectedCommittee = "";
  let currentQuery = new URL(window.location.href).searchParams.get("q") ?? "";
  let catalogLoaded = false;
  let loadingCatalog = false;
  let catalogLoadFailed = false;
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

    const scoped = base.filter(
      (agenda) => !selectedCommittee || splitCommitteeNames(agenda.committee).includes(selectedCommittee)
    );
    if (!query) return scoped.sort(byDate("desc"));

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
    const needsFullCatalog = Boolean(selectedCommittee) && !currentQuery.trim() && !catalogLoaded;
    if (needsFullCatalog) {
      count.textContent = "篩選結果";
      if (status) {
        status.textContent = catalogLoadFailed ? "摘要資料載入失敗，請重新整理後再試" : "載入完整摘要資料中…";
      }
      list.replaceChildren();
      empty.hidden = true;
      pagination.replaceChildren();
      syncCommitteeButtons();
      return;
    }

    const results = filtered();
    const isSearch = Boolean(currentQuery.trim());
    const resultCount = !catalogLoaded && !isSearch && !selectedCommittee ? totalAgendaCount : results.length;
    const totalPages = Math.max(1, Math.ceil(resultCount / PAGE_SIZE));
    currentPage = Math.min(currentPage, totalPages);
    const start = (currentPage - 1) * PAGE_SIZE;
    const visible = results.slice(start, start + PAGE_SIZE);

    count.textContent = `${resultCount} 筆摘要`;
    sortControl?.classList.toggle("hidden", !isSearch);
    sortControl?.classList.toggle("flex", isSearch);
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
  };

  const ensureCatalog = async () => {
    if (catalogLoaded) return;
    const startedLoading = !loadingCatalog;
    if (startedLoading) {
      catalogLoadFailed = false;
      loadingCatalog = true;
      render();
    }
    try {
      agendas = await loadAgendaCatalog();
      catalogLoaded = true;
      catalogLoadFailed = false;
    } catch (error) {
      console.warn(error);
      agendaCatalogPromise = null;
      catalogLoadFailed = true;
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
    render();
  });
  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      const committee = button.dataset.committee ?? "";
      selectedCommittee = committee && committee === selectedCommittee ? "" : committee;
      currentPage = 1;
      void ensureCatalog().then(render);
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

function initDetailToc(): void {
  detailTocController?.abort();
  detailTocController = new AbortController();
  const { signal } = detailTocController;
  const drawer = document.querySelector<HTMLElement>("[data-mobile-toc]");
  const openButton = document.querySelector<HTMLButtonElement>("[data-toc-open]");
  const closeButtons = document.querySelectorAll<HTMLButtonElement>("[data-toc-close]");
  const tocLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>("[data-detail-toc] a[href^='#']"));
  const targets = Array.from(document.querySelectorAll<HTMLElement>("[data-toc-target][id]"));
  const groupLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>("[data-toc-group-link]"));
  const groupChildren = Array.from(document.querySelectorAll<HTMLElement>("[data-toc-children-for]"));

  if (!drawer || !openButton || tocLinks.length === 0) return;

  const setDrawerOpen = (open: boolean) => {
    drawer.classList.toggle("hidden", !open);
    openButton.setAttribute("aria-expanded", open ? "true" : "false");
    document.body.style.overflow = open ? "hidden" : "";
    if (open) drawer.querySelector<HTMLAnchorElement>("a")?.focus();
    else openButton.focus();
  };

  openButton.addEventListener("click", () => setDrawerOpen(true), { signal });
  closeButtons.forEach((button) => button.addEventListener("click", () => setDrawerOpen(false), { signal }));
  drawer.addEventListener(
    "click",
    (event) => {
      if ((event.target as Element | null)?.closest("a[href^='#']")) setDrawerOpen(false);
    },
    { signal }
  );
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape" && !drawer.classList.contains("hidden")) setDrawerOpen(false);
    },
    { signal }
  );

  const setExpandedGroups = (expandedGroups: Set<string>) => {
    groupChildren.forEach((children) => {
      const groupId = children.dataset.tocChildrenFor;
      const expanded = Boolean(groupId && expandedGroups.has(groupId));
      children.dataset.expanded = expanded ? "true" : "false";
      children.setAttribute("aria-hidden", expanded ? "false" : "true");
      children.style.maxHeight = expanded ? `${children.scrollHeight}px` : "0px";
    });
    groupLinks.forEach((link) => {
      const groupId = link.dataset.tocGroupLink;
      link.setAttribute("aria-expanded", groupId && expandedGroups.has(groupId) ? "true" : "false");
    });
  };

  const setActiveLink = (id: string) => {
    tocLinks.forEach((link) => {
      link.dataset.active = link.hash === `#${id}` ? "true" : "false";
    });

    const target = document.getElementById(id);
    const directGroup = groupLinks.find((link) => link.hash === `#${id}`)?.dataset.tocGroupLink;
    const groupId = target?.dataset.tocParentGroup ?? directGroup;
    setExpandedGroups(groupId ? new Set([groupId]) : new Set());
  };

  let updateScheduled = false;
  let scrollReleaseTimer: number | undefined;
  let scrollingToTarget = false;
  const updateActiveSection = () => {
    updateScheduled = false;
    const anchorOffset = 112;
    let current = targets[0];
    for (const target of targets) {
      if (target.getBoundingClientRect().top > anchorOffset) break;
      current = target;
    }
    if (current?.id) setActiveLink(current.id);
  };
  const scheduleUpdate = () => {
    if (scrollingToTarget) {
      window.clearTimeout(scrollReleaseTimer);
      scrollReleaseTimer = window.setTimeout(() => {
        scrollingToTarget = false;
        scheduleUpdate();
      }, 160);
      return;
    }
    if (updateScheduled) return;
    updateScheduled = true;
    window.requestAnimationFrame(updateActiveSection);
  };

  window.addEventListener("scroll", scheduleUpdate, { passive: true, signal });
  window.addEventListener("resize", scheduleUpdate, { signal });
  tocLinks.forEach((link) =>
    link.addEventListener(
      "click",
      () => {
        const id = decodeURIComponent(link.hash.slice(1));
        scrollingToTarget = true;
        setActiveLink(id);
        scheduleUpdate();
      },
      { signal }
    )
  );

  if (window.location.hash) {
    const id = decodeURIComponent(window.location.hash.slice(1));
    setActiveLink(id);
  } else scheduleUpdate();
}

let detailTocController: AbortController | null = null;

function initPage(): void {
  initHeaderSearch();
  initSearchPage();
  initDetailToc();
}

document.addEventListener("astro:page-load", initPage);
