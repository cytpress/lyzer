// 在 Astro 頁面切換後初始化各頁互動模組
import { initDetailToc } from "@/scripts/detail-toc";
import { initHeaderSearch } from "@/scripts/header-search";
import { initHomeSearch } from "@/scripts/home-search";

function initPage(): void {
  initHeaderSearch();
  initHomeSearch();
  initDetailToc();
}

document.addEventListener("astro:page-load", initPage);
