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
      原始數據
      <table>
        <tbody>
          <tr>
            <th>公報索引編號</th>
            <td>
              第{gazette_volume}卷 第{gazette_issue}期 第{gazette_booklet}冊
            </td>
          </tr>
          <tr>
            <th>所屬委員會</th>
            <td>{committee_names.join("、")}</td>
          </tr>
          <tr>
            <th>會議日期</th>
            <td>{agenda_meeting_date}</td>
          </tr>
          <tr>
            <th>原始案由</th>
            <td>{agenda_subject}</td>
          </tr>
          <tr>
            <th>公報發布網址</th>
            <td>{agenda_official_page_url}</td>
          </tr>
          <tr>
            <th>公報發布日期</th>
            <td>{gazette_publish_date}</td>
          </tr>
          <tr>
            <th>公報原始pdf</th>
            <td>{agenda_official_pdf_url}</td>
          </tr>
          <tr>
            <th>章節所屬頁碼</th>
            <td>
              {agenda_start_page} ~ {agenda_end_page}
            </td>
          </tr>
          <tr>
            <th>章節ID</th>
            <td>{agenda_id}</td>
          </tr>
          <tr>
            <th>公報ID</th>
            <td>{parent_gazette_id}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
