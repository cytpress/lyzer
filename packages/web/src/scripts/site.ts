// 在 Astro 頁面切換後初始化各頁互動模組
import { initDetailToc } from "@/scripts/detail-toc";
import { initHeaderSearch } from "@/scripts/header-search";
import { initHomeSearch } from "@/scripts/home-search";

function initPage(): void {
  initHeaderSearch();
  initHomeSearch();
  initDetailToc();
}

// Astro transitions 會替換頁面內容而不重載文件，因此互動要在每次頁面切換後重新初始化
document.addEventListener("astro:page-load", initPage);
