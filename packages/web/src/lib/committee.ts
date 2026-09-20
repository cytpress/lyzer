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
};

export function getCommitteeStyle(name: string): CommitteeStyle {
  return (
    committeeStyles[name] ?? {
      shortName: name.replace(/委員會$/, ""),
      tone: "neutral",
    }
  );
}
