import { DetailedGazetteItem } from "@/types/models";

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
    "w-32 text-neutral-800 text-base font-medium text-left whitespace-nowrap leading-relaxed p-3 md:p-4 border-b border-neutral-300";
  const tableDataCellClasses =
    "text-neutral-700 text-base leading-relaxed p-3 md:p-4 border-b border-l border-neutral-300  wrap-break-word";

  return (
    <section id="metadata-table" className="scroll-mt-24">
      <h2 className="text-neutral-900 text-lg md:text-xl font-semibold mb-2 md:mb-4 mt-10">
        原始數據
      </h2>
      <div className="overflow-hidden rounded-xl border border-neutral-300 mb-6 md:mb-10">
        <table className="table-fixed w-full">
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
                <a
                  href={agenda_official_page_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-neutral-900"
                >
                  {agenda_official_page_url}
                </a>
              </td>
            </tr>
            <tr className="odd:bg-neutral-200/50">
              <th className={tableHeaderClasses}>公報發布日期</th>
              <td className={tableDataCellClasses}>{gazette_publish_date}</td>
            </tr>
            <tr className="odd:bg-neutral-200/50">
              <th className={tableHeaderClasses}>公報原始pdf</th>
              <td className={tableDataCellClasses}>
                <a
                  href={agenda_official_pdf_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-neutral-900"
                >
                  {agenda_official_pdf_url}
                </a>
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
    </section>
  );
}
