import { HomePageGazetteItem } from "../types/models";
import { Link } from "react-router-dom";
interface GazetteListItemProps {
  gazetteItem: HomePageGazetteItem;
}
export default function GazetteListItem({ gazetteItem }: GazetteListItemProps) {
  return (
    <li>
      <div className="flex flex-row items-center">
        <span className="flex-shrink-0">{gazetteItem.committee_names}</span>
        <div className="flex flex-col items-start">
          <Link to={`/detailedGazette/${gazetteItem.id}`}>
            <p className="text-left">{gazetteItem.summary_title}</p>
          </Link>
          <p className="text-left">{gazetteItem.overall_summary_sentence}</p>
        </div>
        <span>{gazetteItem.meeting_date}</span>
      </div>
    </li>
  );
}
