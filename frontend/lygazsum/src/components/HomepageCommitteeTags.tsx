import getCommitteeTag from "@/utils/getCommitteeTag";
import { BREAKPOINT_MD } from "@/constants/breakpoints";
interface CommitteeTagsProps {
  committeeNames: string[];
  currentWindowWidth?: number;
  isForceFullName?: boolean;
}

export default function CommitteeTags({
  committeeNames,
  currentWindowWidth,
  isForceFullName = false,
}: CommitteeTagsProps) {
  return (
    <div className="flex flex-wrap gap-1 md:gap-2 items-center">
      {committeeNames.map((committeeName, index) => {
        const tagInfo = getCommitteeTag(committeeName);
        const { bgColor, shortName } = tagInfo;
        return (
          <span
            key={index}
            className={`text-xs md:text-sm px-1.5 py-1 rounded-sm text-neutral-600 ${bgColor}`}
          >
            {isForceFullName ||
            (currentWindowWidth && currentWindowWidth > BREAKPOINT_MD)
              ? committeeName
              : shortName}
          </span>
        );
      })}
    </div>
  );
}
