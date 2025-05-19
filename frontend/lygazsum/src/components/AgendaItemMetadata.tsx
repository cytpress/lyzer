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

  return (
    <div>
      <h3 className="text-xl font-semibold mb-2">原始數據</h3>
      <table>
        <tbody>
          <tr className="table-row-hover">
            <th className="table-header-cell">公報索引編號</th>
            <td className="table-data-cell">
              第{gazette_volume}卷 第{gazette_issue}期 第{gazette_booklet}冊
            </td>
          </tr>
          <tr className="table-row-hover">
            <th className="table-header-cell">所屬委員會</th>
            <td className="table-data-cell">{committee_names.join("、")}</td>
          </tr>
          <tr className="table-row-hover">
            <th className="table-header-cell">會議日期</th>
            <td className="table-data-cell">{agenda_meeting_date}</td>
          </tr>
          <tr className="table-row-hover">
            <th className="table-header-cell">原始案由</th>
            <td className="table-data-cell">{agenda_subject}</td>
          </tr>
          <tr className="table-row-hover">
            <th className="table-header-cell">公報發布網址</th>
            <td className="table-data-cell">{agenda_official_page_url}</td>
          </tr>
          <tr className="table-row-hover">
            <th className="table-header-cell">公報發布日期</th>
            <td className="table-data-cell">{gazette_publish_date}</td>
          </tr>
          <tr className="table-row-hover">
            <th className="table-header-cell">公報原始pdf</th>
            <td className="table-data-cell">{agenda_official_pdf_url}</td>
          </tr>
          <tr className="table-row-hover">
            <th className="table-header-cell">章節所屬頁碼</th>
            <td className="table-data-cell">
              {agenda_start_page} ~ {agenda_end_page}
            </td>
          </tr>
          <tr className="table-row-hover">
            <th className="table-header-cell">章節ID</th>
            <td className="table-data-cell">{agenda_id}</td>
          </tr>
          <tr className="table-row-hover">
            <th className="table-header-cell">公報ID</th>
            <td className="table-data-cell">{parent_gazette_id}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
