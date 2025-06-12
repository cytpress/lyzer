export function SiteFooter() {
  return (
    <footer className="bg-white border-t border-neutral-300">
      <div className="container mx-auto flex flex-col items-center px-4 py-8  space-y-6 text-center">
        <div className="max-w-3xl text-neutral-600 text-sm space-y-2">
          <p>
            本站所有摘要內容均由大型語言模型（AI）生成，旨在幫助民眾快速理解立法院委員會的討論要點。
          </p>
          <p>
            生成內容可能存在錯誤或不完整之處，使用者應以每頁詳情中「原始數據」連結，參考立法院官方公報為準。
          </p>
        </div>

        <div className="flex flex-col md:flex-row items-center gap-y-4 md:gap-x-8 text-neutral-600">
          <p className="text-sm">
            資料來源：
            <a
              href="https://ly.govapi.tw/v2/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-neutral-900"
            >
              OpenFun Ltd. LYAPI
            </a>
            （資料依
            <a
              href="https://creativecommons.org/licenses/by/4.0/deed.zh-hant"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-neutral-900"
            >
              CC BY 4.0
            </a>
            授權）
          </p>
          <a
            href="https://github.com/cytpress/ly-gazette"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm underline hover:text-neutral-900"
          >
            GitHub 專案原始碼
          </a>
        </div>

        <div className="border-t border-neutral-200 w-full max-w-3xl pt-6">
          <p className="text-xs text-neutral-500">
            © {new Date().getFullYear()} cytpress 本站所有內容與原始碼均採用{" "}
            <a
              href="https://github.com/cytpress/ly-gazette/blob/main/LICENSE"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-neutral-900"
            >
              MIT 授權
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}
