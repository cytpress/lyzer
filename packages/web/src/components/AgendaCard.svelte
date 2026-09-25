<script lang="ts">
  import { getCommitteeStyle, getCommitteeTagClasses, splitCommitteeNames } from "@/lib/committee";
  import { agendaCardClasses } from "@/lib/styles";
  import type { AgendaCatalogItem } from "@/lib/catalog";

  let { agenda }: { agenda: AgendaCatalogItem } = $props();
  const tags = $derived(splitCommitteeNames(agenda.committee));
</script>

<li class="page-shell" data-agenda-card data-agenda-id={agenda.agendaId}>
  <article class={agendaCardClasses}>
    <div class="mb-3">
      <a
        class="min-w-0 after:absolute after:inset-0 after:content-['']"
        href={`/gazettes/${encodeURIComponent(agenda.agendaId)}`}
      >
        <h2 class="text-lg font-medium leading-snug text-neutral-900 md:text-xl">{agenda.summaryTitle}</h2>
      </a>
    </div>
    <div class="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-600 md:text-sm">
      {#each tags.length > 0 ? tags : [agenda.documentType ?? "委員會"] as name (name)}
        {@const style = getCommitteeStyle(name)}
        <span class={getCommitteeTagClasses(style.tone)}>
          <span class="md:hidden">{style.shortName}</span>
          <span class="hidden md:inline">{name}</span>
        </span>
      {/each}
      <span>會議日期：{agenda.meetingDate ?? "日期未明"}</span>
      <span class="hidden text-neutral-300 md:inline">／</span>
      <span class="hidden truncate md:inline">{agenda.gazetteId}</span>
    </div>
    <p class="line-clamp-2 text-sm leading-7 text-neutral-600 md:line-clamp-3">
      {agenda.overallSummary || agenda.subject || "此議程尚無摘要。"}
    </p>
  </article>
</li>
