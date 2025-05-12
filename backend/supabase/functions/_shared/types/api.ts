// --- Shared Types (Based on Legislative Yuan Gazette API responses) ---
// Defines structures for data from the external LY Gov API.
// Original Chinese field names are kept for direct API mapping.

/** A single Gazette (official publication) issue from the API. */
export interface Gazette {
  卷: number; 
  期: number; 
  冊別: number; 
  發布日期: string; // Publication date (YYYY-MM-DD).
  公報編號: string; // Unique Gazette ID (e.g., "11302001").
}

/** API response structure for a list of Gazettes. */
export interface GazetteApiResponse {
  total: number;
  total_page: number;
  page: number;
  limit: number;
  gazettes: Gazette[];
}

/** URL to a processed version of gazette content. */
export interface ProcessedUrl {
  type: "html" | "tikahtml" | "txt" | "parsed" | string; // e.g., "txt" for plain text.
  no: number; // Sequence identifier.
  url: string;
}

/** An agenda item within a Gazette, from the API. */
export interface GazetteAgenda {
  公報議程編號: string; // Unique agenda ID (e.g., "11302001_0001").
  卷?: number | null;
  期?: number | null;
  冊別?: number | null;
  屆?: number | null; 
  會期?: number | null; 
  會次?: number | null; 
  臨時會會次?: number | null; 
  目錄編號?: number | null; 
  類別代碼?: number | null; // Category code (e.g., 1=Plenary, 3=Committee).
  會議日期?: string[] | null; 
  案由?: string | null; // Subject/title.
  起始頁碼?: number | null; 
  結束頁碼?: number | null; 
  doc檔案下載位置?: string[] | null; 
  屆別期別篩選條件?: string | null; // Additional filtering metadata.
  公報編號: string; // Parent Gazette ID.
  公報網網址?: string | null; 
  公報完整PDF網址?: string | null; 
  處理後公報網址?: ProcessedUrl[] | null; // URLs to processed versions of this agenda's content.
}

/** API response structure for agenda items of a specific Gazette. */
export interface AgendaApiResponse {
  total: number;
  total_page: number;
  page: number;
  limit: number;
  gazetteagendas: GazetteAgenda[];
}
