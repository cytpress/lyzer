import getCommitteeTag from "../utils/getCommitteeTag";
interface CommitteeTagsProps {
  committeeNames: string[];
}

export default function CommitteeTags({ committeeNames }: CommitteeTagsProps) {
  return (
    <div className="flex flex-wrap gap-1 md:gap-2 items-center">
      {committeeNames.map((committeeName, index) => {
        const tagInfo = getCommitteeTag(committeeName);
        const { bgColor } = tagInfo;
        return (
          <span key={index} className={`text-sm px-1.5 py-1 rounded-sm text-neutral-600 ${bgColor}`}>
            {committeeName}
          </span>
        );
      })}
    </div>
  );
}
