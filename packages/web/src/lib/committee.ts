// 整理委員會名稱、顯示色彩與標籤短名
export interface CommitteeStyle {
  shortName: string;
  tone: string;
}

const committeeStyles: Record<string, CommitteeStyle> = {
  內政委員會: { shortName: "內政", tone: "blue" },
  外交及國防委員會: { shortName: "外交國防", tone: "red" },
  經濟委員會: { shortName: "經濟", tone: "yellow" },
  財政委員會: { shortName: "財政", tone: "lime" },
  教育及文化委員會: { shortName: "教育文化", tone: "green" },
  交通委員會: { shortName: "交通", tone: "orange" },
  司法及法制委員會: { shortName: "司法法制", tone: "violet" },
  社會福利及衛生環境委員會: { shortName: "社福環衛", tone: "teal" },
  黨團協商: { shortName: "黨團協商", tone: "neutral" },
};

const preferredOrder = Object.keys(committeeStyles);

export function splitCommitteeNames(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[、,，]/)
    .map((name) => name.trim())
    .filter(Boolean);
}

export function normalizeCommitteeList(values: string[]): string[] {
  const names = Array.from(new Set(values.flatMap((value) => splitCommitteeNames(value))));
  return names.sort((left, right) => {
    const leftIndex = preferredOrder.indexOf(left);
    const rightIndex = preferredOrder.indexOf(right);
    if (leftIndex !== -1 || rightIndex !== -1) {
      if (leftIndex === -1) return 1;
      if (rightIndex === -1) return -1;
      return leftIndex - rightIndex;
    }
    return left.localeCompare(right, "zh-Hant");
  });
}

export function getCommitteeStyle(name: string): CommitteeStyle {
  const shortName = name.replace(/委員會$/, "");
  return (
    committeeStyles[name] ?? {
      shortName: shortName || name,
      tone: "neutral",
    }
  );
}
