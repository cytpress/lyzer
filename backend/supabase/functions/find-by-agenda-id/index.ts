// backend/supabase/functions/find-by-agenda-id/index.ts

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

serve(async (req) => {
  const url = new URL(req.url);
  const agendaId = url.searchParams.get("agenda_id");

  if (!agendaId) {
    return new Response(JSON.stringify({ error: "缺少 agenda_id 參數" }), {
      status: 400,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  try {
    // 以目前 Lyzer API 是否有公開頁面為準，不依賴舊 Supabase 資料庫。
    const pageResponse = await fetch(
      `https://api.lyzer.tw/api/ssg/agendas/${encodeURIComponent(agendaId)}`,
      { signal: AbortSignal.timeout(8_000) },
    );

    if (pageResponse.status === 404) {
      return new Response(JSON.stringify({ error: "新站尚無此議程的公開摘要頁面" }), {
        status: 404,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    if (!pageResponse.ok) {
      console.error("新站頁面查詢失敗:", pageResponse.status);
      return new Response(JSON.stringify({ error: "目前無法確認新站摘要頁面" }), {
        status: 502,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    const redirectUrl = new URL(
      `/gazettes/${encodeURIComponent(agendaId)}/`,
      "https://lyzer.tw",
    );

    return new Response(null, {
      status: 302,
      headers: {
        Location: redirectUrl,
      },
    });
  } catch (error) {
    console.error("伺服器內部錯誤:", error);
    return new Response(JSON.stringify({ error: "伺服器內部錯誤" }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
});
