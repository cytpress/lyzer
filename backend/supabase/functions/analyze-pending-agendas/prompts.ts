// backend/supabase/functions/analyze-pending-agendas/prompts.ts

/**
 * Determines if analysis should be skipped. Only processes if category_code is 3.
 */
export function shouldSkipAnalysis(
  categoryCode: number | null | undefined
): boolean {
  return categoryCode !== 3;
}

/**
 * Generates the main analysis prompt for the Gemini API.
 */
export function getAnalysisPrompt(
  categoryCode: number | null | undefined,
  textContent: string,
  isTruncated: boolean
): string {
  const contextHint = "此內容來自立法院某委員會記錄。";
  const committeeNameInstruction = `由於類別代碼為 3，這代表某個「委員會」。請從以下12個常設委員會名稱中，根據文本內容判斷並選擇最符合的一個或多個名稱，將它們作為一個JSON字串陣列填入 "committee_name" 欄位。
  - 如果是單一委員會，陣列中只有一個元素，例如：["財政委員會"]。
  - 如果是聯席會議，請包含所有主要相關委員會的名稱，例如：["內政委員會", "司法及法制委員會"]。
  - 如果文本明確指出主導委員會，請將其放在陣列的第一個。
  - 可參考的常設委員會包含：內政委員會、外交及國防委員會、經濟委員會、財政委員會、教育及文化委員會、交通委員會、司法及法制委員會、社會福利及衛生環境委員會、程序委員會、紀律委員會、經費稽核委員會、修憲委員會。
  - 如果無法從文本明確判斷，則 "committee_name" 設為 null 或一個空陣列 []。`;

  if (categoryCode !== 3) {
    console.warn(
      `[Prompts] getAnalysisPrompt called with unexpected category_code: ${categoryCode}. This indicates a potential logic issue upstream as shouldSkipAnalysis should prevent this.`
    );
  }

  const truncationWarning = isTruncated
    ? "\n**重要提示：由於原始文本過長，以下提供的內容已被截斷。請基於現有內容進行分析，並盡可能提取核心資訊。**\n"
    : "";

  // Corrected fewShotExample based on your original style and intent,
  // with legislator_speakers and respondent_speakers integrated.
  const fewShotExample = `
**以下是一個分析風格和詳細程度的範例，請學習其如何組織和呈現信息（特別注意當一個欄位有多個點時，應作為 JSON 陣列中的不同字串元素）：**

**範例輸入文本（示意，非真實內容）：**
\`\`\`text
立法院財政、內政委員會第1次聯席會議紀錄
主席：羅委員明才
討論事項：審查「所得稅法第17條條文修正草案」案。
黃委員國昌：本次修法方向正確，但對於扣除額上限建議提高至十五萬元。理由一，現行額度已多年未調整。理由二，有助於減輕育兒家庭負擔。
陳部長建仁（行政院）：黃委員的建議很好，但考量國家整體財政平衡，目前版本已是經多方協調的結果。我們評估，若提高至十五萬，預計稅損將增加約五十億元。
羅委員明才（主席）：針對黃委員所提建議，請財政部回去再行研議，並於一週內提出書面報告。本案保留，下次會議繼續審查。
\`\`\`

**期望的範例 JSON 輸出 (風格和詳細程度示意，直接輸出陣列，並已忽略圖片標記)：**
\`\`\`json
{
  "summary_title": "所得稅法第17條修正草案聯席審查及扣除額上限討論",
  "overall_summary_sentence": "本次財政與內政委員會聯席會議主要審查「所得稅法第17條條文修正草案」，黃國昌委員提議提高扣除額上限，行政院陳建仁部長說明財政考量，最終主席裁示財政部研議並保留議案。",
  "committee_name": ["財政委員會", "內政委員會"],
  "agenda_items": [
    {
      "item_title": "審查「所得稅法第17條條文修正草案」案",
      "core_issue": [
        "討論所得稅法第17條中關於特定扣除額的修正內容。",
        "評估是否應調整扣除額上限以更符合當前社會經濟狀況。"
      ],
      "controversy": [
        "扣除額上限應否從現行額度提高至十五萬元，主要涉及財政收入與民眾減稅利益的平衡。"
      ],
      "legislator_speakers": [
        {
          "speaker_name": "黃委員國昌",
          "speaker_viewpoint": [
            "支持修法方向，但建議將扣除額上限提高至十五萬元。",
            "提高上限的理由一：現行額度多年未調整。",
            "提高上限的理由二：有助於減輕育兒家庭負擔。"
          ]
        }
      ],
      "respondent_speakers": [
        {
          "speaker_name": "陳部長建仁（行政院）",
          "speaker_viewpoint": [
            "回應提高扣除額上限的建議，說明目前版本是多方協調結果。",
            "指出若提高至十五萬元，預估稅損將增加約五十億元，需考量國家整體財政平衡。"
          ]
        }
      ],
      "result_status_next": [
        "主席裁示：請財政部針對黃委員建議再行研議。",
        "後續行動：財政部需於一週內提出書面報告。",
        "本案狀態：保留，下次會議繼續審查。"
      ]
    }
  ]
}
\`\`\`
--- 範例結束 ---
`;

// ${fewShotExample}
  return `

**現在，請你扮演一個立法院議事記錄的專業分析師。你的任務是仔細閱讀以下「實際的」 ${contextHint} 議事記錄文本，並**嚴格根據「實際文本內容」**，以 **台灣繁體中文** 提取並組織資訊，生成一份分析報告。**輸出 JSON 的風格和詳細程度應盡可能接近上述範例**，目標是讓不熟悉背景的民眾也能清晰理解會議的實質內容。模型將會以預先定義好的 JSON 結構回應。**

${truncationWarning}

**議事記錄文本內容（實際）：**
\`\`\`text
${textContent}
\`\`\`

**分析指示 (請務必基於「實際文本內容」進行分析，範例僅供風格參考)：**

*   **強制性數值格式規則**: 為了公民易讀性與資料一致性，所有在摘要中提及的數值，**必須且只能使用阿拉伯數字**。**嚴禁使用**中文數字。範例: "第 35 條", "討論事項第 11 案", "113 年", "45%", "2/3", "15 個基數", "50 億 4,750 萬元"。

1.  **summary_title (字串)：** 從**實際文本**中，為整個會議記錄提供一個代表全文核心焦點的高度概括性摘要標題 (50字以內)。
2.  **overall_summary_sentence (字串)：** 從**實際文本**中，提供一個概括性總結句，涵蓋主要內容、流程、法案全名或關鍵議題、以及重要結論，使讀者能快速理解會議核心 (約100-150字)。
3.  **committee_name (字串陣列 或 null)：** ${committeeNameInstruction}
4.  **agenda_items (物件陣列)：** 從**實際文本中**識別並**詳細列出**所有主要議程項目。
    *   對於每個議程項目，根據**實際文本內容**提供：
        *   **item_title (字串)：** 該議程項目的核心法案名稱與議程編號，例如 '某某法案修正草案 (討論事項第一案)'。請省略提案人姓名。
        *   **core_issue (字串陣列 或 null)：** 詳細且深入地概括該議程項目核心問題、背景或主要討論內容，反映討論深度。若有多點，作為陣列元素，確保每個元素論述完整。無明確核心議題則設為 null。
        *   **controversy (字串陣列 或 null)：** 詳細描述該議程項目主要的爭議點，包含不同意見的具體內容和理由。若有多點，作為陣列元素，確保描述清晰。無明顯爭議則為 null。
        *   **legislator_speakers (物件陣列 或 null)：** 列出主要進行質詢、提案或發表意見的「立法委員」。
            *   **speaker_name (字串)：** 立法委員的姓名及其職稱/黨籍 (若文本提供，例如：「黃國昌 立法委員」)。
            *   **speaker_viewpoint (字串陣列 或 null)：** 提取該立法委員針對「當前議程項目或法案」提出的「具體質詢、論點、主要理由、明確建議」。應避免程序性發言。若有多個獨立觀點，作為陣列元素。
        *   **respondent_speakers (物件陣列 或 null)：** 列出主要進行答詢、報告或說明立場的「政府官員」(如部長、次長、署長等) 或「相關事業單位代表」。
            *   **speaker_name (字串)：** 答詢者的姓名及其完整職稱/所屬單位 (若文本提供，例如：「陳建仁 行政院院長」或「王某某 台電公司董事長」)。
            *   **speaker_viewpoint (字串陣列 或 null)：** 提取該答詢者針對質詢的「政策回應、說明、數據提供、承諾或立場闡述」。應避免程序性發言。若有多個獨立觀點，作為陣列元素。
        *   **result_status_next (字串陣列 或 null)：** 清晰且相對完整地說明關於此議程的最終處理結果、審查進度或下一步行動，反映實際情況。若有多點，作為陣列元素。若無明確結果或下一步則設為 null。

**重要輸出要求：**
1.  **語言：** **台灣繁體中文**。
2.  **內容來源：** **所有分析結果必須嚴格基於提供的「實際議事記錄文本內容」，絕不能使用範例文字，力求準確。**
3.  **客觀性與詳細性：** 分析應客觀中立，**追求內容的詳細和全面（類似範例風格，但內容須來自實際文本）**。
4.  **JSON 結構與內容完整性：** **模型必須嚴格遵循預設的 JSON 結構輸出。所有輸出的字串值都必須是完整且語意清晰的。"committee_name" 若無信息，應為 null 或空陣列。"legislator_speakers" 和 "respondent_speakers" 若無相關發言者，應為 null 或空陣列。**
5.  **忽略圖片標記：** **完全忽略所有類似 "[image: imageXXX.jpg]" 格式的圖片佔位符。**
6.  **欄位值為 null/空陣列：** 若無信息或不適用，可為 null 的欄位請明確設為 JSON 的 null。對於 "committee_name"、"legislator_speakers"、"respondent_speakers" 等陣列類型欄位，若無適用內容，可以是 null 或空陣列 []。
7.  **處理程序性內容：** 若文本**僅為簡單程序宣告或無實質討論**，輸出固定 JSON：
    \`\`\`json
    {
      "summary_title": "程序性內容",
      "overall_summary_sentence": "本次記錄主要為程序性內容，無實質討論摘要。",
      "committee_name": null,
      "agenda_items": []
    }
    \`\`\`

請開始分析「實際的」議事記錄文本內容。
`;
}