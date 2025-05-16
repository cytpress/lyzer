import { DetailedGazetteItem } from "../types/models";
import { useQuery } from "@tanstack/react-query";
import { fetchDetailedGazetteById } from "../services/gazetteService";
import { useParams } from "react-router-dom";

export default function DetailedGazettePage() {
  const params = useParams<{ id: string }>();
  const gazetteIdFromParams = params.id;
  const { isPending, isError, data, error } = useQuery<
    DetailedGazetteItem | null,
    Error
  >({
    queryKey: ["detailedPageGazette", gazetteIdFromParams],
    queryFn: () => {
      return fetchDetailedGazetteById(gazetteIdFromParams as string);
    },
    enabled: !!gazetteIdFromParams,
  });

  if (isPending && gazetteIdFromParams) return <span>讀取中...</span>;
  if (isError) return <span>錯誤: {error.message}</span>;
  if (!data) return <span>查無公報資料</span>;

  const {
    // analyzed_content_id,
    // parsed_content_url,
    analysis_result,
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
  } = data;

  if (!analysis_result) return <span>無分析結果可用！</span>;
  const { summary_title, overall_summary_sentence, agenda_items } =
    analysis_result;

  return (
    <div>
      <h1>{summary_title}</h1>
      <p>{overall_summary_sentence}</p>
      <div>
        {agenda_items?.map((item, itemIndex) => {
          return (
            <div key={`agenda-item-${itemIndex}`}>
              <h3>{item.item_title}</h3>
              <ul>
                {item.core_issue?.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
              <h3>相關爭議</h3>
              <ul>
                {item.controversy?.map((controversy) => (
                  <li key={controversy}>{controversy}</li>
                ))}
              </ul>
              <h3>立法委員發言</h3>
              <ul>
                {item.legislator_speakers?.map((speaker) => {
                  return (
                    <li key={speaker.speaker_name}>
                      <p>{speaker.speaker_name}</p>
                      <ul>
                        {speaker.speaker_viewpoint?.map((viewpoint) => (
                          <li key={viewpoint}>{viewpoint}</li>
                        ))}
                      </ul>
                    </li>
                  );
                })}
              </ul>
              <h3>相關人員回覆</h3>
              <ul>
                {item.respondent_speakers?.map((speaker) => {
                  return (
                    <li key={speaker.speaker_name}>
                      <p>{speaker.speaker_name}</p>
                      <ul>
                        {speaker.speaker_viewpoint?.map((viewpoint) => (
                          <li key={viewpoint}>{viewpoint}</li>
                        ))}
                      </ul>
                    </li>
                  );
                })}
              </ul>
              <h3>相關後續</h3>
              <ul>
                {item.result_status_next?.map((result_status_next) => (
                  <li key={result_status_next}>{result_status_next}</li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
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
    </div>
  );
}
