interface CommitteeTagsInfo {
  shortName: string;
  bgColor: string;
  hoverBorderColor: string;
  selectedBorderColor: string;
}

export default function getCommitteeTag(
  singleCommitteeName: string
): CommitteeTagsInfo {
  switch (singleCommitteeName) {
    case "內政委員會":
      return {
        shortName: "內政",
        bgColor: "bg-blue-100",
        hoverBorderColor: "hover:border-blue-300",
        selectedBorderColor:"border-blue-200"
      };
    case "外交及國防委員會":
      return {
        shortName: "外交國防",
        bgColor: "bg-red-100",
        hoverBorderColor: "hover:border-red-300",
        selectedBorderColor:"border-red-200"
      };
    case "經濟委員會":
      return {
        shortName: "經濟",
        bgColor: "bg-yellow-100",
        hoverBorderColor: "hover:border-yellow-300",
        selectedBorderColor:"border-yellow-200"
      };
    case "財政委員會":
      return {
        shortName: "財政",
        bgColor: "bg-lime-100",
        hoverBorderColor: "hover:border-lime-300",
        selectedBorderColor:"border-lime-200"
      };
    case "教育及文化委員會":
      return {
        shortName: "教育文化",
        bgColor: "bg-green-100",
        hoverBorderColor: "hover:border-green-300",
        selectedBorderColor:"border-green-200"
      };
    case "交通委員會":
      return {
        shortName: "交通",
        bgColor: "bg-orange-100",
        hoverBorderColor: "hover:border-orange-300",
        selectedBorderColor:"border-orange-200"
      };
    case "司法及法制委員會":
      return {
        shortName: "司法法制",
        bgColor: "bg-violet-100",
        hoverBorderColor: "hover:border-violet-300",
        selectedBorderColor:"border-violet-200"
      };
    case "社會福利及衛生環境委員會":
      return {
        shortName: "社福環衛",
        bgColor: "bg-teal-100",
        hoverBorderColor: "hover:border-teal-300",
        selectedBorderColor:"border-teal-200"
      };
    case "程序委員會":
      return {
        shortName: "程序",
        bgColor: "bg-gray-100",
        hoverBorderColor: "hover:border-gray-500",
        selectedBorderColor:"border-gray-200"
      };
    case "紀律委員會":
      return {
        shortName: "紀律",
        bgColor: "bg-gray-100",
        hoverBorderColor: "hover:border-gray-500",
        selectedBorderColor:"border-gray-200"
      };
    case "經費稽核委員會":
      return {
        shortName: "經費",
        bgColor: "bg-gray-100",
        hoverBorderColor: "hover:border-gray-500",
        selectedBorderColor:"border-gray-200"
      };
    case "修憲委員會":
      return {
        shortName: "修憲",
        bgColor: "bg-gray-100",
        hoverBorderColor: "hover:border-gray-500",
        selectedBorderColor:"border-gray-200"
      };
    default:
      return {
        shortName: singleCommitteeName,
        bgColor: "bg-gray-100",
        hoverBorderColor: "hover:border-gray-300",
        selectedBorderColor:"border-gray-200"
      };
  }
}
