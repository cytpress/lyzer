interface CommitteeTagsProps {
  committeeNames: string[];
}

interface CommitteeTagsInfo {
  shortName: string;
  bgColor: string;
  textColor: string;
}

function getCommitteeTag(singleCommitteeName: string): CommitteeTagsInfo {
  switch (singleCommitteeName) {
    case "內政委員會":
      return {
        shortName: "內政",
        bgColor: "bg-red-100",
        textColor: "bg-red-700",
      };
    case "外交及國防委員會":
      return {
        shortName: "外交國防",
        bgColor: "bg-sky-100",
        textColor: "text-sky-700",
      };
    case "經濟委員會":
      return {
        shortName: "經濟",
        bgColor: "bg-amber-100",
        textColor: "text-amber-700",
      };
    case "財政委員會":
      return {
        shortName: "財政",
        bgColor: "bg-lime-100",
        textColor: "text-lime-700",
      };
    case "教育及文化委員會":
      return {
        shortName: "教育文化",
        bgColor: "bg-purple-100",
        textColor: "text-purple-700",
      };
    case "交通委員會":
      return {
        shortName: "交通",
        bgColor: "bg-pink-100",
        textColor: "text-pink-700",
      };
    case "司法及法制委員會":
      return {
        shortName: "司法法制",
        bgColor: "bg-indigo-100",
        textColor: "text-indigo-700",
      };
    case "社會福利及衛生環境委員會":
      return {
        shortName: "社福環衛",
        bgColor: "bg-teal-100",
        textColor: "text-teal-700",
      };
    case "程序委員會":
      return {
        shortName: "程序",
        bgColor: "bg-gray-100",
        textColor: "text-gray-600",
      };
    case "紀律委員會":
      return {
        shortName: "紀律",
        bgColor: "bg-gray-100",
        textColor: "text-gray-600",
      };
    case "經費稽核委員會":
      return {
        shortName: "經費",
        bgColor: "bg-gray-100",
        textColor: "text-gray-600",
      };
    case "修憲委員會":
      return {
        shortName: "修憲",
        bgColor: "bg-gray-100",
        textColor: "text-gray-600",
      };
    default:
      return {
        shortName: singleCommitteeName,
        bgColor: "bg-gray-100",
        textColor: "text-gray-600",
      };
  }
}

export default function CommitteeTags({ committeeNames }: CommitteeTagsProps) {
  return (
    <div className="flex flex-wrap gap-1 md:gap-2 items-center">
      {committeeNames.map((committeeName, index) => {
        const tagInfo = getCommitteeTag(committeeName);
        const { shortName, bgColor, textColor } = tagInfo;
        return (
          <span key={index} className={`${bgColor} ${textColor}`}>
            {shortName}
          </span>
        );
      })}
    </div>
  );
}
