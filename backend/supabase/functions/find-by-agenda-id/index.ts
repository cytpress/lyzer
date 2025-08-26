// backend/supabase/functions/find-by-agenda-id/index.ts

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

// 取得 Supabase client 的輔助函式
function getSupabaseClient(req: Request): SupabaseClient {
  const authHeader = req.headers.get("Authorization")!;
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } }
  );
}

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
    const supabase = getSupabaseClient(req);

    // --- 簡化後的查詢 ---
    // 直接一次查詢就取得 analyzed_content_id
    const { data, error } = await supabase
      .from("gazette_agendas")
      .select("analyzed_content_id")
      .eq("agenda_id", agendaId)
      .limit(1)
      .single();

    if (error || !data || !data.analyzed_content_id) {
      console.error(
        `找不到議程 ID 或其 analyzed_content_id: ${agendaId}`,
        error
      );
      return new Response(JSON.stringify({ error: "找不到此議程的摘要頁面" }), {
        status: 404,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    // 組合最終的 URL 並執行轉址
    const detailedPageId = data.analyzed_content_id;
    const siteUrl = Deno.env.get("SITE_URL") || "https://ly-gazette.vercel.app";
    const redirectUrl = `${siteUrl}/detailedGazette/${detailedPageId}`;

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
