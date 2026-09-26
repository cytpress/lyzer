// 保留舊 Supabase 議程網址並轉址至新站公開摘要

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

  // 新站若沒有這篇公報，由網站自己的 404 頁面處理。
  const redirectUrl = new URL(`/gazettes/${encodeURIComponent(agendaId)}/`, "https://lyzer.tw");
  return Response.redirect(redirectUrl, 302);
});
