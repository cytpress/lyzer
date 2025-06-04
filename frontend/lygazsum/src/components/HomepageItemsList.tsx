import { HomePageGazetteItem } from "../types/models";
import CommitteeTags from "./HomepageCommitteeTags";
import { Link } from "react-router-dom";
interface GazetteListItemProps {
  gazetteItem: HomePageGazetteItem;
}
export default function GazetteListItem({ gazetteItem }: GazetteListItemProps) {
  return (
    <li>
      <div className="flex flex-row items-center justify-center">
        <span className="flex-shrink-0">
          <CommitteeTags committeeNames={gazetteItem.committee_names} />
        </span>
        <div className="flex flex-col items-start w-2/5 ">
          <Link to={`/detailedGazette/${gazetteItem.id}`}>
            <h3 className="font-medium text-left hover:text-blue-600">
              {gazetteItem.summary_title}
            </h3>
          </Link>
          <p className="text-left line-clamp-2">{gazetteItem.overall_summary_sentence}</p>
        </div>
        <span className="flex-shrink-0">{gazetteItem.meeting_date}</span>
      </div>
    </li>
  );
}
