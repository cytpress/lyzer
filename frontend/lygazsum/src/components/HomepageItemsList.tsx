import { HomePageGazetteItem } from "../types/models";
import CommitteeTags from "./HomepageCommitteeTags";
import { Link } from "react-router-dom";
interface GazetteListItemProps {
  gazetteItem: HomePageGazetteItem;
}
export default function GazetteListItem({ gazetteItem }: GazetteListItemProps) {
  return (
    <li>
      <Link to={`/detailedGazette/${gazetteItem.id}`}>
        <div className="flex flex-col justify-center mx-auto w-4/5 px-8 py-8 border-2 rounded-3xl border-neutral-200 hover:border-neutral-500 bg-white">
          <h3 className="font-medium text-xl mb-2 text-neutral-900">
            {gazetteItem.summary_title}
          </h3>

          <div className="flex flex-row items-center mb-2">
            <CommitteeTags committeeNames={gazetteItem.committee_names} />
            <p className="text-sm text-neutral-600">
              ．會議日期：{gazetteItem.meeting_date}
            </p>
          </div>
          <p className="text-neutral-600 leading-relaxed line-clamp-3">
            {gazetteItem.overall_summary_sentence}
          </p>
        </div>
      </Link>
    </li>
  );
}
