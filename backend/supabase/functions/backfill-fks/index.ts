// backend/supabase/functions/backfill-fks/index.ts
// 最終優化版：分批查詢 + 逐筆更新，最為穩健

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const BATCH_SIZE = 100;

serve(async (_req) => {
  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    console.log("開始查詢需要更新的 gazette_agendas...");

    const { data: agendasToUpdate, error: selectError } = await supabaseAdmin
      .from("gazette_agendas")
      .select("agenda_id, parsed_content_url")
      .not("parsed_content_url", "is", null)
      .is("analyzed_content_id", null);

    if (selectError) throw selectError;
    if (!agendasToUpdate || agendasToUpdate.length === 0) {
      return new Response("沒有需要更新的資料。", { status: 200 });
    }

    console.log(`找到 ${agendasToUpdate.length} 筆資料需要回填 foreign key。`);

    const allUpdates = [];
    const totalBatches = Math.ceil(agendasToUpdate.length / BATCH_SIZE);

    for (let i = 0; i < totalBatches; i++) {
      const batch = agendasToUpdate.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
      console.log(
        `正在查詢批次 ${i + 1}/${totalBatches} (共 ${batch.length} 筆)...`
      );

      const urls = batch.map((a) => a.parsed_content_url);

      const { data: contents, error: contentError } = await supabaseAdmin
        .from("analyzed_contents")
        .select("id, parsed_content_url")
        .in("parsed_content_url", urls);

      if (contentError) throw contentError;

      const urlToIdMap = new Map(
        contents.map((c) => [c.parsed_content_url, c.id])
      );

      const updates = batch
        .filter((agenda) => urlToIdMap.has(agenda.parsed_content_url))
        .map((agenda) => ({
          agenda_id: agenda.agenda_id,
          analyzed_content_id: urlToIdMap.get(agenda.parsed_content_url),
        }));

      allUpdates.push(...updates);
    }

    console.log(`查詢完成，準備開始更新 ${allUpdates.length} 筆資料...`);

    // --- 改為逐筆更新 ---
    let successCount = 0;
    for (const update of allUpdates) {
      const { error: updateError } = await supabaseAdmin
        .from("gazette_agendas")
        .update({ analyzed_content_id: update.analyzed_content_id }) // 只更新需要的欄位
        .eq("agenda_id", update.agenda_id); // 根據 agenda_id 找到對應的紀錄

      if (updateError) {
        // 如果單筆出錯，印出錯誤但繼續執行下一筆
        console.error(
          `更新 agenda_id: ${update.agenda_id} 失敗:`,
          updateError.message
        );
      } else {
        successCount++;
        if (successCount % 50 === 0) {
          // 每更新50筆，回報一次進度
          console.log(
            `已成功更新 ${successCount} / ${allUpdates.length} 筆...`
          );
        }
      }
    }

    console.log("所有更新操作已完成。");
    return new Response(`成功更新 ${successCount} 筆資料的 foreign key！`, {
      status: 200,
    });
  } catch (error) {
    console.error("腳本執行期間發生嚴重錯誤:", error);
    return new Response(error.message, { status: 500 });
  }
});
