// 共用 Astro 元件與用戶端結果卡片使用的 Tailwind class 組合
export const agendaCardClasses =
  "relative flex flex-col justify-center rounded-3xl border-2 border-neutral-200 bg-white px-4 py-5 transition-[border-color,box-shadow] duration-[160ms] hover:border-neutral-400 hover:shadow-[0_10px_30px_rgba(0,0,0,0.04)] md:px-8 md:py-7";

export const filterChipClasses =
  "inline-flex min-h-10 items-center justify-center whitespace-nowrap rounded-full border border-neutral-300 bg-white px-4 text-sm text-neutral-600 transition-[border-color,background-color,color] duration-[160ms] hover:border-neutral-500 hover:text-neutral-900 data-[active=true]:border-neutral-900 data-[active=true]:bg-neutral-900 data-[active=true]:text-white";

export const tocLinkClasses =
  "block leading-6 text-neutral-500 transition-colors duration-[160ms] hover:text-neutral-900 data-[active=true]:font-semibold data-[active=true]:text-neutral-900";
