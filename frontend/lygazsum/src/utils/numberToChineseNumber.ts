export default function numberToChineseNumber(number: number): string {
  const chineseNum = [
    "零",
    "一",
    "二",
    "三",
    "四",
    "五",
    "六",
    "七",
    "八",
    "九",
    "十",
  ];
  if (number <= 10) return chineseNum[number];
  return number.toString();
}
