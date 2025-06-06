import { DetailedGazetteItem } from "../types/models";

interface AgendaItemMetadataProps {
  metadata: DetailedGazetteItem;
}

export default function AgendaItemMetadata({
  metadata,
}: AgendaItemMetadataProps) {
  const {
    committee_names,
    agenda_id,
    agenda_subject,
    agenda_meeting_date,
    agenda_start_page,
    agenda_end_page,
    agenda_official_page_url,
    agenda_official_pdf_url,
    parent_gazette_id,
    gazette_volume,
    gazette_issue,
    gazette_booklet,
    gazette_publish_date,
  } = metadata;

  const tableHeaderClasses =
    "text-neutral-800 font-medium text-left whitespace-nowrap leading-relaxed p-4 border-b rounded-lg border-neutral-300";
  const tableDataCellClasses =
    "text-neutral-800 leading-relaxed p-4 border-b border-l rounded-lg border-neutral-300";

  return (
    <>
      <h3
        className="text-neutral-900 text-xl font-semibold mt-10 mb-4"
        id="metadata-table"
      >
        原始數據
      </h3>
      <div className="overflow-hidden rounded-xl border border-neutral-300 mb-10">
        <table>
          <tbody>
            <tr className="odd:bg-neutral-200/50">
              <th className={tableHeaderClasses}>公報索引編號</th>
              <td className={tableDataCellClasses}>
                第{gazette_volume}卷 第{gazette_issue}期 第{gazette_booklet}冊
              </td>
            </tr>
            <tr className="odd:bg-neutral-200/50">
              <th className={tableHeaderClasses}>所屬委員會</th>
              <td className={tableDataCellClasses}>
                {committee_names.join("、")}
              </td>
            </tr>
            <tr className="odd:bg-neutral-200/50">
              <th className={tableHeaderClasses}>會議日期</th>
              <td className={tableDataCellClasses}>{agenda_meeting_date}</td>
            </tr>
            <tr className="odd:bg-neutral-200/50">
              <th className={tableHeaderClasses}>原始案由</th>
              <td className={tableDataCellClasses}>{agenda_subject}</td>
            </tr>
            <tr className="odd:bg-neutral-200/50">
              <th className={tableHeaderClasses}>公報發布網址</th>
              <td className={tableDataCellClasses}>
                {agenda_official_page_url}
              </td>
            </tr>
            <tr className="odd:bg-neutral-200/50">
              <th className={tableHeaderClasses}>公報發布日期</th>
              <td className={tableDataCellClasses}>{gazette_publish_date}</td>
            </tr>
            <tr className="odd:bg-neutral-200/50">
              <th className={tableHeaderClasses}>公報原始pdf</th>
              <td className={tableDataCellClasses}>
                {agenda_official_pdf_url}
              </td>
            </tr>
            <tr className="odd:bg-neutral-200/50">
              <th className={tableHeaderClasses}>章節所屬頁碼</th>
              <td className={tableDataCellClasses}>
                {agenda_start_page} ~ {agenda_end_page}
              </td>
            </tr>
            <tr className="odd:bg-neutral-200/50">
              <th className={tableHeaderClasses}>章節ID</th>
              <td className={tableDataCellClasses}>{agenda_id}</td>
            </tr>
            <tr className="odd:bg-neutral-200/50">
              <th className={tableHeaderClasses}>公報ID</th>
              <td className={tableDataCellClasses}>{parent_gazette_id}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
