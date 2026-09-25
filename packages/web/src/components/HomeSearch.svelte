<script lang="ts">
  import { onMount } from "svelte";
  import MiniSearch from "minisearch";
  import AgendaCard from "@/components/AgendaCard.svelte";
  import type { AgendaCatalogItem } from "@/lib/catalog";
  import { splitCommitteeNames } from "@/lib/committee";
  import { expandQuery, miniSearchOptions } from "@/lib/search";
  import { filterChipClasses } from "@/lib/styles";

  interface Props {
    firstPage: AgendaCatalogItem[];
    totalCount: number;
    committees: string[];
  }

  let { firstPage, totalCount, committees }: Props = $props();
  const pageSize = 10;

  let catalog = $state<AgendaCatalogItem[] | null>(null);
  const agendas = $derived(catalog ?? firstPage);
  let searchIndexes = $state<MiniSearch[] | null>(null);
  let currentQuery = $state("");
  let selectedCommittee = $state("");
  let currentPage = $state(1);
  let sortOrder = $state("date-desc");
  const catalogLoaded = $derived(catalog !== null);
  let loadingCatalog = $state(false);
  let catalogLoadFailed = $state(false);
  let loadingSearch = $state(false);
  let searchLoadFailed = $state(false);
  let catalogPromise: Promise<void> | null = null;
  let searchPromise: Promise<void> | null = null;

  const query = $derived(currentQuery.trim());
  const waitingForCatalog = $derived(Boolean(selectedCommittee) && !query && !catalogLoaded);
  const results = $derived.by(() => {
    const base =
      query && searchIndexes
        ? searchIndexes
            .flatMap((index) => index.search(expandQuery(query)))
            .sort((left, right) => right.score - left.score)
            .map(agendaFromSearchResult)
            .filter((agenda): agenda is AgendaCatalogItem => agenda !== null)
        : [...agendas];
    const scoped = base.filter(
      (agenda) => !selectedCommittee || splitCommitteeNames(agenda.committee).includes(selectedCommittee)
    );
    if (query && searchIndexes && sortOrder === "relevance") return scoped;
    const direction = sortOrder === "date-asc" && query ? 1 : -1;
    return scoped.sort((left, right) => direction * (left.meetingDate ?? "").localeCompare(right.meetingDate ?? ""));
  });
  const resultCount = $derived(!catalogLoaded && !query && !selectedCommittee ? totalCount : results.length);
  const totalPages = $derived(Math.max(1, Math.ceil(resultCount / pageSize)));
  const shownPage = $derived(Math.min(currentPage, totalPages));
  const visible = $derived(waitingForCatalog ? [] : results.slice((shownPage - 1) * pageSize, shownPage * pageSize));
  const pageNumbers = $derived(
    Array.from({ length: totalPages }, (_, index) => index + 1).filter(
      (page) => page === 1 || page === totalPages || Math.abs(page - shownPage) <= 1
    )
  );
  const status = $derived(
    waitingForCatalog
      ? catalogLoadFailed
        ? "摘要資料載入失敗，請重新整理後再試"
        : "載入完整摘要資料中…"
      : loadingCatalog
        ? "載入摘要資料中"
        : loadingSearch
          ? "載入搜尋索引中"
          : searchLoadFailed && query
            ? "搜尋索引載入失敗，請重新整理後再試"
            : query
              ? `搜尋「${query}」`
              : ""
  );

  function agendaFromSearchResult(result: Record<string, unknown>): AgendaCatalogItem | null {
    const agendaId = typeof result.agendaId === "string" ? result.agendaId : String(result.id ?? "");
    if (!agendaId) return null;
    return {
      agendaId,
      gazetteId: typeof result.gazetteId === "string" ? result.gazetteId : "",
      meetingDate: typeof result.meetingDate === "string" ? result.meetingDate : null,
      subject: typeof result.subject === "string" ? result.subject : null,
      committee: typeof result.committee === "string" ? result.committee : null,
      documentType: typeof result.documentType === "string" ? result.documentType : null,
      summaryTitle: typeof result.summaryTitle === "string" ? result.summaryTitle : agendaId,
      overallSummary: typeof result.overallSummary === "string" ? result.overallSummary : "",
    };
  }

  async function loadCatalog(): Promise<void> {
    if (catalogLoaded) return;
    if (catalogPromise) return catalogPromise;
    catalogPromise = (async () => {
      loadingCatalog = true;
      catalogLoadFailed = false;
      try {
        const response = await fetch("/agenda-catalog.json");
        if (!response.ok) throw new Error(`agenda-catalog ${response.status}`);
        const payload = (await response.json()) as { chunks: string[] };
        const chunks = await Promise.all(
          payload.chunks.map(async (chunk) => {
            const chunkResponse = await fetch(chunk);
            if (!chunkResponse.ok) throw new Error(`agenda-catalog chunk ${chunkResponse.status}`);
            return (await chunkResponse.json()) as AgendaCatalogItem[];
          })
        );
        catalog = chunks.flat();
      } catch (error) {
        console.warn(error);
        catalogLoadFailed = true;
      } finally {
        loadingCatalog = false;
        catalogPromise = null;
      }
    })();
    return catalogPromise;
  }

  async function loadSearch(): Promise<void> {
    if (searchIndexes || searchPromise) return searchPromise ?? Promise.resolve();
    searchPromise = (async () => {
      loadingSearch = true;
      searchLoadFailed = false;
      try {
        const response = await fetch("/search-index.json");
        if (!response.ok) throw new Error(`search-index ${response.status}`);
        const payload = (await response.json()) as { chunks: string[] };
        searchIndexes = await Promise.all(
          payload.chunks.map(async (chunk) => {
            const chunkResponse = await fetch(chunk);
            if (!chunkResponse.ok) throw new Error(`search-index chunk ${chunkResponse.status}`);
            const chunkPayload = (await chunkResponse.json()) as { index: string };
            return MiniSearch.loadJSON(chunkPayload.index, miniSearchOptions);
          })
        );
      } catch (error) {
        console.warn(error);
        searchLoadFailed = true;
      } finally {
        loadingSearch = false;
        searchPromise = null;
      }
    })();
    return searchPromise;
  }

  function updateQuery(value: string): void {
    currentQuery = value.trim();
    currentPage = 1;
    const url = new URL(window.location.href);
    if (currentQuery) url.searchParams.set("q", currentQuery);
    else url.searchParams.delete("q");
    window.history.replaceState({}, "", url);
    const headerInput = document.querySelector<HTMLInputElement>("[data-header-search-input]");
    if (headerInput && headerInput.value !== currentQuery) headerInput.value = currentQuery;
    if (currentQuery) void loadSearch();
  }

  function selectCommittee(name: string): void {
    selectedCommittee = name === selectedCommittee ? "" : name;
    currentPage = 1;
    if (selectedCommittee && !query) void loadCatalog();
  }

  function showPage(page: number): void {
    const changePage = () => {
      if (catalogLoadFailed) return;
      currentPage = page;
      window.scrollTo({ top: 0, behavior: "smooth" });
    };
    if (!catalogLoaded && !query) void loadCatalog().then(changePage);
    else changePage();
  }

  onMount(() => {
    const initialQuery = new URL(window.location.href).searchParams.get("q") ?? "";
    currentQuery = initialQuery;
    if (initialQuery) void loadSearch();
    const onHeaderSearch = (event: Event) => updateQuery((event as CustomEvent<string>).detail);
    const onPopState = () => {
      currentQuery = new URL(window.location.href).searchParams.get("q") ?? "";
      currentPage = 1;
      if (currentQuery) void loadSearch();
    };
    window.addEventListener("lyzer:header-search", onHeaderSearch);
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("lyzer:header-search", onHeaderSearch);
      window.removeEventListener("popstate", onPopState);
    };
  });
</script>

<section>
  <div class="page-shell mb-6 flex flex-col gap-4">
    <div id="search" class="md:hidden">
      <label class="relative block">
        <span class="sr-only">搜尋公報摘要</span>
        <input
          class={[
            "h-11 w-full rounded-2xl border-2 border-neutral-300 bg-white px-4 text-sm",
            "outline-none placeholder:text-neutral-400 focus:border-neutral-500",
          ]}
          type="search"
          value={currentQuery}
          oninput={(event) => updateQuery(event.currentTarget.value)}
          placeholder="搜尋議題、法案、委員或官員"
        />
      </label>
    </div>

    <div
      class="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0"
      aria-label="依委員會篩選"
    >
      {#each ["", ...committees] as committee (committee)}
        <button
          class={filterChipClasses}
          type="button"
          data-active={selectedCommittee === committee}
          onclick={() => selectCommittee(committee)}>{committee || "全部"}</button
        >
      {/each}
    </div>

    <div class="flex min-h-10 items-center justify-between gap-3 text-sm text-neutral-500">
      <span>{waitingForCatalog ? "篩選結果" : `${resultCount} 筆摘要`}</span>
      <div class="flex items-center gap-2">
        <span role="status" aria-live="polite">{status}</span>
        {#if query}
          <label class="flex items-center gap-2">
            <span>排序</span>
            <select
              class="rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500"
              bind:value={sortOrder}
            >
              <option value="date-desc">日期新到舊</option>
              <option value="date-asc">日期舊到新</option>
              <option value="relevance">相關性</option>
            </select>
          </label>
        {/if}
      </div>
    </div>
  </div>

  <ul class="space-y-4">
    {#each visible as agenda (agenda.agendaId)}
      <AgendaCard {agenda} />
    {/each}
  </ul>

  {#if !visible.length && !waitingForCatalog}
    <div
      class="page-shell mt-10 rounded-3xl border border-dashed border-neutral-300 bg-white p-10 text-center text-neutral-500"
    >
      沒有符合條件的議事摘要。
    </div>
  {/if}

  {#if !waitingForCatalog && totalPages > 1}
    <nav class="page-shell mt-8 flex items-center justify-center gap-2" aria-label="分頁">
      {#if shownPage > 1}
        <button
          class="h-10 min-w-10 rounded-full border border-neutral-200 bg-white px-3 text-sm text-neutral-600"
          type="button"
          aria-label="上一頁"
          onclick={() => showPage(shownPage - 1)}>‹</button
        >
      {/if}
      {#each pageNumbers as page, index (page)}
        {#if index > 0 && page - pageNumbers[index - 1] > 1}<span class="px-1 text-neutral-400">...</span>{/if}
        <button
          class={[
            "h-10 min-w-10 rounded-full border px-3 text-sm transition",
            page === shownPage
              ? "border-neutral-900 bg-neutral-900 text-white"
              : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-500 hover:text-neutral-900",
          ]}
          type="button"
          aria-current={page === shownPage ? "page" : undefined}
          onclick={() => showPage(page)}>{page}</button
        >
      {/each}
      {#if shownPage < totalPages}
        <button
          class="h-10 min-w-10 rounded-full border border-neutral-200 bg-white px-3 text-sm text-neutral-600"
          type="button"
          aria-label="下一頁"
          onclick={() => showPage(shownPage + 1)}>›</button
        >
      {/if}
    </nav>
  {/if}
</section>
