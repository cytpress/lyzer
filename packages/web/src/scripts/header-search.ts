// 將頁首搜尋表單導向帶有查詢字串的首頁
export function initHeaderSearch(): void {
  const form = document.querySelector<HTMLFormElement>("[data-header-search-form]");
  const input = document.querySelector<HTMLInputElement>("[data-header-search-input]");
  if (!form || !input) return;

  const current = new URL(window.location.href).searchParams.get("q") ?? "";
  input.value = current;

  // 首頁搜尋元件接收頁首輸入；其他頁面仍由表單提交導向首頁
  input.addEventListener("input", () => {
    if (window.location.pathname === "/") {
      window.dispatchEvent(new CustomEvent("lyzer:header-search", { detail: input.value }));
    }
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = input.value.trim();
    const target = new URL("/", window.location.origin);
    if (query) target.searchParams.set("q", query);
    window.location.href = target.toString();
  });
}
