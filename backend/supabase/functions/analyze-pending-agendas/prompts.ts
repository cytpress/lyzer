// supabase/functions/analyze-pending-contents/prompts.ts

export function shouldSkipAnalysis(
  categoryCode: number | null | undefined
): boolean {
  return categoryCode === 99; // 假設 99 是索引，根據實際情況調整
}

// --- 主要分析 Prompt (調整了 speaker_viewpoint 的指示) ---
export function getAnalysisPrompt(
  categoryCode: number | null | undefined,
  textContent: string,
  isTruncated: boolean
): string {
  let contextHint = "";
  let committeeNameInstruction = "";

  if (
    categoryCode === 1 ||
    categoryCode === 2 ||
    categoryCode === 4 ||
    categoryCode === 5
  ) {
    contextHint = "此內容來自立法院院會或相關會議記錄。";
    committeeNameInstruction = `由於類別代碼為 ${categoryCode}，這通常與「立法院院會」相關。請優先在文本中確認，如果符合，請將 "committee_name" 設為 "立法院院會"。如果文本內容明確指向某特定常設委員會，則以文本內容為主。`;
  } else if (categoryCode === 3) {
    contextHint = "此內容來自立法院某委員會記錄。";
    committeeNameInstruction = `由於類別代碼為 3，這代表某個「委員會」。請從以下12個常設委員會名稱中，根據文本內容判斷並選擇最符合的一個填入 "committee_name" 欄位：內政委員會、外交及國防委員會、經濟委員會、財政委員會、教育及文化委員會、交通委員會、司法及法制委員會、社會福利及衛生環境委員會、程序委員會、紀律委員會、經費稽核委員會、修憲委員會。如果文本中提及多個委員會聯席會議，請選擇主導或首次提及的委員會。如果無法從文本明確判斷，則設為 null。`;
  } else if (categoryCode === 8) {
    contextHint = "此內容來自立法院黨團協商記錄。";
    committeeNameInstruction = `由於類別代碼為 8 (黨團協商)，通常不歸屬於單一委員會，請將 "committee_name" 設為 "黨團協商"。`;
  } else if (categoryCode === 9) {
    contextHint = "此內容為特殊議事文件（如總統令、咨文等）。";
    committeeNameInstruction = `由於類別代碼為 9，此類內容可能與院會或特定委員會直接相關性不明確。請優先嘗試從文本內容判斷是否能歸屬到 "立法院院會" 或上述12個常設委員會之一。如果無法明確歸屬，請將 "committee_name" 設為 "其他"。`;
  } else {
    contextHint = "此內容為一般議事記錄。";
    committeeNameInstruction = `請根據文本內容準確提取會議所屬的委員會名稱（從12個常設委員會中選擇）、"立法院院會"、"黨團協商" 或 "其他"。如果無法判斷或不適用，則設為 null。`;
  }

  const truncationWarning = isTruncated
    ? "\n**重要提示：由於原始文本過長，以下提供的內容已被截斷。請基於現有內容進行分析，並盡可能提取核心資訊。**\n"
    : "";

  const fewShotExample = `
**以下是一個分析風格和詳細程度的範例，請學習其如何組織和呈現信息（特別注意當一個欄位有多個點時，應作為 JSON 陣列中的不同字串元素）：**

**範例輸入文本（示意，非真實內容）：**
\`\`\`text
會議開始，主席宣布開會。討論事項一：關於某某法案修正。委員A（立法委員）發言表示支持，並提出理由甲乙丙。[image: image1.jpg] 委員B（某部會首長）表示反對，認為理由丁戊己更為重要。經討論後，主席裁示，此案保留，下週再議，並請相關單位提供補充資料。
\`\`\`

**期望的範例 JSON 輸出 (風格和詳細程度示意，直接輸出陣列，並已忽略圖片標記)：**
\`\`\`json
{
  "summary_title": "範例：委員會審議某某法案修正草案",
  "overall_summary_sentence": "範例：本次會議重點討論了法案A的修正內容，委員甲與委員B就其利弊進行了詳細闡述與辯論，最終主席決定將法案A交付黨團協商，尋求進一步共識。",
  "committee_name": "範例：財政委員會",
  "agenda_items": [
    {
      "item_title": "範例：法案A部分條文修正草案",
      "core_issue": [
        "範例：核心議題點一的詳細描述，包含其背景、主要內容和重要性。例如：討論是否應調整現行法規中的某項關鍵條款，因其已不適應當前社會發展需求，並可能引發某些具體問題。",
        "範例：核心議題點二的詳細描述，闡述另一項討論焦點。例如：審議另一項相關提案，該提案旨在解決前述問題，但其具體措施與影響範圍尚需進一步評估。"
      ],
      "key_speakers": [
        {
          "speaker_name": "範例：委員A 立法委員",
          "speaker_viewpoint": [
            "範例：委員A支持修正的詳細理由一，並引用相關數據或案例。",
            "範例：委員A提出的具體建議或修正方向，並說明其預期效益。"
          ]
        },
        {
          "speaker_name": "範例：委員B 某部會首長",
          "speaker_viewpoint": ["範例：委員B反對或提出不同看法的詳細論點，並解釋其擔憂或替代方案。例如：認為修正草案可能帶來未預期的負面影響，或現有框架下已有其他解決途徑。"]
        }
      ],
      "controversy": [
        "範例：爭議點一的詳細描述：一方認為應如何，另一方則主張為何，兩者之間的具體分歧點和論據。",
        "範例：爭議點二的詳細描述：關於某個特定條款的適用範圍或執行細節，存在不同的解讀和建議方案。"
      ],
      "result_status_next": [
        "範例：經過充分討論後，主席裁示：本案暫時保留，不進行表決。",
        "範例：後續行動：請相關部會於一週內針對委員提出的疑問提供書面說明，並排定於下次會議繼續審議。"
      ]
    }
  ]
}
\`\`\`
--- 範例結束 ---
`;

  return `
${fewShotExample}

**現在，請你扮演一個立法院議事記錄的專業分析師。你的任務是仔細閱讀以下「實際的」 ${contextHint} 議事記錄文本，並**嚴格根據「實際文本內容」**，以 **台灣繁體中文** 提取並組織資訊，生成一份分析報告。**輸出 JSON 的風格和詳細程度應盡可能接近上述範例**，目標是讓不熟悉背景的民眾也能清晰理解會議的實質內容。模型將會以預先定義好的 JSON 結構回應。**

${truncationWarning}

**議事記錄文本內容（實際）：**
\`\`\`text
${textContent}
\`\`\`

**分析指示 (請務必基於「實際文本內容」進行分析，範例僅供風格參考)：**

*   **強制性數值格式規則**: 為了公民易讀性與資料一致性，所有在摘要中提及的數值，**必須且只能使用阿拉伯數字**。**嚴禁使用**中文數字。
    *   **範例**: "第 35 條", "討論事項第 11 案", "113 年", "45%", "2/3", "15 個基數", "50 億 4,750 萬元"。

1.  **summary_title (字串)：** 從**實際文本**中，為整個會議記錄提供一個**簡潔且概括性**的標題 (50字以內)。
2.  **overall_summary_sentence (字串)：** 從**實際文本**中，提供一個摘要開頭的總結句，簡要列出本次記錄涵蓋的主要議程或討論主題。**此句應詳盡提及主要討論的法案全名或關鍵議題，使其能獨立概括會議主要內容，風格類似範例。** (約100-200字)
3.  **committee_name (字串 或 null)：** ${committeeNameInstruction}
4.  **agenda_items (物件陣列)：** 從**實際文本中**識別並**詳細列出**所有主要議程項目。
    *   對於每個議程項目，根據**實際文本內容**提供：
        *   **item_title (字串)：** 該議程項目的**核心法案名稱與議程編號** (省略提案委員姓名，可包含如 '(討論事項第 X 案)' 等輔助信息)。
        *   **core_issue (字串陣列 或 null)：** **詳細且深入地**概括核心問題、背景、主要內容和關鍵面向。**若有多點，作為 JSON 陣列中的不同字串元素。確保每個點論述清晰、完整，反映討論深度。**無明確核心議題則設為 null。
        *   **key_speakers (物件陣列 或 null)：** 列出**最具代表性或影響力的發言者**及其觀點。若無則設為 null。
            *   **speaker_name (字串)：** 發言者的**姓名及其職稱/單位** (若提供)。格式如：「黃國昌 立法委員」。職稱不明確或過長可簡化或僅列姓名。
            *   **speaker_viewpoint (字串陣列 或 null)：** **提取並概括該發言者針對「當前議程項目或法案」提出的「具體論點、主要理由、明確建議或政策回應」。請聚焦於具有實質性內容、能夠反映其對議題看法的陳述。如果發言者提出了多個獨立的具體論點或建議，則此欄位必須是一個字串陣列，每個字串代表一個獨立的點。請確保每個陣列元素的陳述都是清晰、完整且能夠反映其發言的實質內容。**應避免納入純粹的程序性發言、一般性感言、情緒性呼籲或與當前議程無直接關聯的評論。**無明確觀點則設為 null。
        *   **controversy (字串陣列 或 null)：** **詳細描述**主要爭議點、不同意見的**具體內容和理由**。**若有多點，作為 JSON 陣列中的不同字串元素。確保描述清晰、完整。**若無明顯爭議則設為 null。
        *   **result_status_next (字串陣列 或 null)：** **清晰且相對完整地說明**最終處理結果、審查進度或當前狀態，包含必要程序性資訊。**若有多個步驟或決議，作為 JSON 陣列中的不同字串元素。確保說明清晰、完整，反映實際情況。**若無明確結果或下一步則設為 null。

**重要輸出要求：**
1.  **語言：** **台灣繁體中文**。
2.  **內容來源：** **所有分析結果必須嚴格基於提供的「議事記錄文本內容（實際）」，絕不能使用範例文字，力求準確。**
3.  **客觀性與詳細性：** 分析應客觀中立，**追求內容的詳細和全面（類似範例風格，但內容須來自實際文本）**。
4.  **JSON 結構與內容完整性：** **模型必須嚴格遵循預設的 JSON 結構輸出。所有輸出的字串值都必須是完整且語意清晰的，不應包含表示內容未完成的符號。**
5.  **忽略圖片標記：** **完全忽略所有類似 "[image: imageXXX.jpg]" 格式的圖片佔位符。**
6.  **欄位值為 null：** 若無信息或不適用，可為 null 的欄位請明確設為 JSON 的 null。
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

// --- 精簡分析 Prompt (同樣移除了 speaker_viewpoint 的結構性標示建議) ---
export function getShortenedAnalysisPrompt(
  categoryCode: number | null | undefined,
  textContent: string,
  isTruncated: boolean,
  previousErrorHint: string
): string {
  let contextHint = "";
  let committeeNameInstruction = "";

  // (committeeNameInstruction 的邏輯保持不變，這裡省略以保持簡潔，實際代碼中應保留)
  if (
    categoryCode === 1 ||
    categoryCode === 2 ||
    categoryCode === 4 ||
    categoryCode === 5
  ) {
    contextHint = "此內容來自立法院院會或相關會議記錄。";
    committeeNameInstruction = `由於類別代碼為 ${categoryCode}，通常與「立法院院會」相關，請確認文本內容。`;
  } else if (categoryCode === 3) {
    contextHint = "此內容來自立法院某委員會記錄。";
    committeeNameInstruction = `由於類別代碼為 3，代表某「委員會」，請從12個常設委員會中選擇。`;
  } else if (categoryCode === 8) {
    contextHint = "此內容來自立法院黨團協商記錄。";
    committeeNameInstruction = `由於類別代碼為 8，請將 "committee_name" 設為 "黨團協商"。`;
  } else if (categoryCode === 9) {
    contextHint = "此內容為特殊議事文件。";
    committeeNameInstruction = `由於類別代碼為 9，請嘗試判斷歸屬，若無法明確則設為 "其他"。`;
  } else {
    contextHint = "此內容為一般議事記錄。";
    committeeNameInstruction = `請根據文本內容判斷 "committee_name"，若無則設為 null。`;
  }

  const truncationWarning = isTruncated
    ? "\n**重要提示：輸入內容已被截斷，請基於現有內容分析。**\n"
    : "";

  return `
請你扮演一個立法院議事記錄的專業分析師。之前的分析嘗試可能因為輸出過長或其他原因失敗 (提示: ${previousErrorHint})。現在請你閱讀以下 ${contextHint} 的議事記錄文本，並以 **更精簡扼要但仍需清晰完整** 的方式，再次以 **台灣繁體中文** 提取並組織資訊。模型將會以預先定義好的 JSON 結構回應。

${truncationWarning}

**議事記錄文本內容：**
\`\`\`text
${textContent}
\`\`\`

**分析指示 (請盡量精簡，但確保核心信息完整，並遵循數值格式規則：所有數值用阿拉伯數字)：**
*   **數值格式規則**: 所有提及的數值，**必須且只能使用阿拉伯數字** (如："第 35 條", "113 年", "45%", "50 億元")。

1.  **summary_title：** 【精簡】一句話總結核心主題 (盡量少於40字)。
2.  **overall_summary_sentence：** 【精簡】一段話概括主要內容和結論 (盡量少於100字)。
3.  **committee_name：** ${committeeNameInstruction}
4.  **agenda_items：** 識別並列出主要議程項目。
    *   對於每個議程項目 (請精簡)：
        *   **item_title：** 標題或案由 (省略提案人，可包含如 '(討論事項第 X 案)' 等輔助信息)。
        *   **core_issue：** 【精簡】核心問題。**若有多點，請作為 JSON 陣列中的不同字串元素直接列出。每個點仍需語義完整。**
        *   **controversy：** 【精簡】主要爭議點。**若有多點，請作為 JSON 陣列中的不同字串元素直接列出。每個點仍需語義完整。** 若無則為 null。
        *   **key_speakers：** 主要發言者及其觀點。
            *   **speaker_name：** 發言者的**姓名及其職稱/單位（如果文本中提供）。請盡可能以「姓名 職稱」的格式呈現。**
            *   **speaker_viewpoint：** 【精簡】主要觀點。**若有多點，請作為 JSON 陣列中的不同字串元素直接列出。每個觀點仍需語義完整。** 若無則為 null。
        *   **result_status_next：** 【精簡】處理結果或下一步。**若有多點，請作為 JSON 陣列中的不同字串元素直接列出。每個結果仍需語義完整。** 若無則為 null。

**重要輸出要求：**
1.  **語言：** **台灣繁體中文**。
2.  **精簡性與清晰性：** 內容盡可能精簡，但必須傳達核心信息且語義清晰。
3.  **內容來源：** **所有分析結果都必須嚴格基於當前提供的「議事記錄文本內容（實際）」，力求準確反映原文。**
4.  **客觀性：** 保持客觀。
5.  **JSON 結構與內容完整性：** **模型必須嚴格遵循預設的 JSON 結構輸出。所有輸出的字串值都必須是完整且語意清晰的，不應包含表示內容未完成的符號。**
6.  **忽略圖片標記：** **在分析文本時，請完全忽略所有類似 "[image: imageXXX.jpg]" 格式的圖片佔位符。**
7.  **處理程序性內容：** 如果文本內容**僅為簡單的程序宣告或無實質性討論**，請直接輸出以下 JSON：
    \`\`\`json
    {
      "summary_title": "程序性內容",
      "overall_summary_sentence": "本次記錄主要為程序性內容，無實質討論摘要。",
      "committee_name": null,
      "agenda_items": []
    }
    \`\`\`

請開始分析。
`;
}
