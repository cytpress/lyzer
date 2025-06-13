export function slugify(text: string): string {
  if (typeof text !== "string" || !text) {
    return "";
  }

  const a =
    "àáâäæãåāăąçćčđďèéêëēėęěğǵḧîïíīįìłḿñńǹňôöòóœøōõőṕŕřßśšşșťțûüùúūǘůűųẃẍÿýžźż·/_,:;";
  const b =
    "aaaaaaaaaacccddeeeeeeeegghiiiiiilmnnnnoooooooooprrsssssttuuuuuuuuuwxyyzzz------";
  const p = new RegExp(a.split("").join("|"), "g");

  return (
    text
      .toString()
      .toLowerCase()
      // 處理英文特殊字符轉換 (例如：é -> e)
      .replace(p, (c) => b.charAt(a.indexOf(c)))
      // 將空格替換為 '-'
      .replace(/\s+/g, "-")
      // 匹配所有非(中文、英文字母、數字、連字符)的字符，並將它們移除
      // [^\u4e00-\u9fa5a-zA-Z0-9-] 表示 "not any of these characters"
      // \u4e00-\u9fa5 是 CJK 統一表意文字的範圍，涵蓋了絕大部分常用中文字
      .replace(/[^\u4e00-\u9fa5a-zA-Z0-9-]+/g, "")
      // 將多個連續的連字符替換為單個連字符
      .replace(/-+/g, "-")
      // 移除開頭和結尾的連字符
      .replace(/^-+/, "")
      .replace(/-+$/, "")
  );
}
