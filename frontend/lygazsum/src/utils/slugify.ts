/**
 * 將字串轉換為 URL-friendly 的 "slug"。
 * 這個函式對於從標題或姓名生成唯一的、合法的 HTML ID 或 URL 片段非常有用。
 *
 * 處理步驟：
 * 1. 將字串轉為小寫。
 * 2. 轉換拉丁文擴展字符 (如 'é' -> 'e')。
 * 3. 將一個或多個空格替換為單個連字符 '-'。
 * 4. 移除所有非 (中文、英文、數字、連字符) 的字符。
 * 5. 將多個連續的連字符替換為單個。
 * 6. 移除開頭和結尾的連字符。
 *
 * @param {string} text - 需要轉換的原始字串。
 * @returns {string} - 處理過的 slug 字串。
 */
export function slugify(text: string): string {
  if (typeof text !== "string" || !text) {
    return "";
  }

  // 預定義的特殊字符及其對應的普通字符
  const a =
    "àáâäæãåāăąçćčđďèéêëēėęěğǵḧîïíīįìłḿñńǹňôöòóœøōõőṕŕřßśšşșťțûüùúūǘůűųẃẍÿýžźż·/_,:;";
  const b =
    "aaaaaaaaaacccddeeeeeeeegghiiiiiilmnnnnoooooooooprrsssssttuuuuuuuuuwxyyzzz------";
  const p = new RegExp(a.split("").join("|"), "g");

  return (
    text
      .toString()
      .toLowerCase()

      // 步驟 2: 處理英文特殊字符轉換 (例如：é -> e)
      .replace(p, (c) => b.charAt(a.indexOf(c)))

      // 步驟 3: 將空格替換為 '-'
      .replace(/\s+/g, "-")

      // 步驟 4: 匹配所有非(中文、英文字母、數字、連字符)的字符，並將它們移除
      // [^\u4e00-\u9fa5a-zA-Z0-9-] 表示 "not any of these characters"
      // \u4e00-\u9fa5 是 CJK 統一表意文字的範圍，涵蓋了絕大部分常用中文字
      .replace(/[^\u4e00-\u9fa5a-zA-Z0-9-]+/g, "")

      // 步驟 5: 將多個連續的連字符替換為單個連字符
      .replace(/-+/g, "-")

      // 步驟 6: 移除開頭和結尾的連字符
      .replace(/^-+/, "")
      .replace(/-+$/, "")
  );
}
