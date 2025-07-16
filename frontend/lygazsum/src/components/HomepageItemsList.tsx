import { HomePageGazetteItem } from "@/types/models";
import CommitteeTags from "@/components/HomepageCommitteeTags";
import { Link } from "react-router-dom";
import { useWindowSize } from "@/hooks/useWindowSize";
import { BREAKPOINT_MD } from "@/constants/breakpoints";

interface GazetteListItemProps {
  gazetteItem: HomePageGazetteItem;
}

export default function GazetteListItem({ gazetteItem }: GazetteListItemProps) {
  const currentWindowWidth = useWindowSize();

  const summaryToShow = gazetteItem.highlighted_summary
    ? gazetteItem.highlighted_summary
    : gazetteItem.overall_summary_sentence;

  return (
    <li className="w-11/12 md:w-4/5 mx-auto">
      <Link to={`/detailedGazette/${gazetteItem.id}`}>
        <div className="flex flex-col justify-center px-4 py-4 md:px-8 md:py-8 border-2 rounded-3xl border-neutral-200 hover:border-neutral-500 bg-white transition-all duration-200 ease-in-out">
          <h3 className="font-medium text-lg md:text-xl mb-2 text-neutral-900">
            {gazetteItem.summary_title}
          </h3>

          <div className="flex flex-row items-center mb-2">
            <CommitteeTags
              committeeNames={gazetteItem.committee_names}
              currentWindowWidth={currentWindowWidth}
            />
            <p className="text-xs md:text-sm text-neutral-600">
              {currentWindowWidth > BREAKPOINT_MD
                ? `．會議日期：${gazetteItem.meeting_date}`
                : `．${gazetteItem.meeting_date}`}
            </p>
          </div>
          <p
            className="text-neutral-600 text-sm leading-relaxed line-clamp-2 md:line-clamp-3"
            dangerouslySetInnerHTML={{ __html: summaryToShow }}
          ></p>
        </div>
      </Link>
    </li>
  );
}
