// 控制詳細頁目錄展開、捲動追蹤與手機抽屜
let detailTocController: AbortController | null = null;

export function initDetailToc(): void {
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
