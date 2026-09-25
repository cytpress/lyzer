// 提供 Astro 頁面編譯所需的環境型別宣告
/* eslint-disable @typescript-eslint/triple-slash-reference */
/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly SSG_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
