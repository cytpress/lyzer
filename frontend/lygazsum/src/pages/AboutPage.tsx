export default function AboutPage() {
  return (
    <article className="flex flex-col px-6 md:px-20 md:w-4/5 mx-auto py-10 md:py-16 space-y-6 md:space-y-12">
      <h1 className="text-2xl md:text-3xl font-semibold">
        關於 LYZER 立院公報摘要
      </h1>
      <section>
        <h2 className="text-neutral-900 text-lg md:text-xl font-semibold mb-2 md:mb-4 ">
          了解國會，從委員會開始
        </h2>
        <p className="text-neutral-800 text-base leading-[180%] md:leading-relaxed mb-2">
          立法院的委員會是國家政策與法案被實質形塑的關鍵場域。從法案的逐條討論、預算審查，到對政府部門的質詢，所有重要的審議過程都在這裡發生。然而，對於一般民眾而言，要深入了解這些複雜的討論，有著極高的門檻。
        </p>
      </section>
      <section>
        <h2 className="text-neutral-900 text-lg md:text-xl font-semibold mb-2 md:mb-4 ">
          資訊的鴻溝
        </h2>
        <p className="text-neutral-800 text-base leading-[180%] md:leading-relaxed mb-2">
          除了新聞媒體的片段報導或社群平台的討論，最直接的原始資訊來源便是立法院的IVOD和官方公報。其中，立法院公報完整記錄了每一次會議的發言細節。但動輒數十甚至上百頁的篇幅，以及資料的查找不便，也加深了想瞭解的難度，因此難以投入時間去閱讀。
        </p>
      </section>
      <section>
        <h2 className="text-neutral-900 text-lg md:text-xl font-semibold mb-2 md:mb-4 ">
          為一般民眾而生的 AI 摘要
        </h2>
        <p className="text-neutral-800 text-base leading-[180%] md:leading-relaxed mb-2">
          本站的誕生，就是為了解決這個問題。透過大型語言模型（AI）的分析能力，將極長的公報內容，盡量濃縮為簡短、易於理解的摘要。好讓使用者能夠快速瞭解每場會議的議題、爭議、討論過程，將數小時的閱讀時間，縮短成幾分鐘的瀏覽。
        </p>
      </section>
      <section>
        <h2 className="text-neutral-900 text-lg md:text-xl font-semibold mb-2 md:mb-4 ">
          聯絡我
        </h2>
        <p className="text-neutral-800 text-base leading-[180%] md:leading-relaxed mb-1">
          若對本站有任何建議、發現任何問題，歡迎透過email與我聯繫。
        </p>
        <p className="text-neutral-800 text-base leading-[180%] md:leading-relaxed mb-2">
          電子郵件：
          <a
            href="mailto:ganymede5035@gmail.com"
            className="text-blue-600 underline hover:text-blue-800"
          >
            ganymede5035@gmail.com
          </a>
        </p>
      </section>
    </article>
  );
}
