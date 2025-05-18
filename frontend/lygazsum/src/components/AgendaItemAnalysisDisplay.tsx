import { AgendaItemAnalysis, SpeakerDetail } from "../types/analysisTypes";

interface AgendaItemAnalysisDisplayProps {
  item: AgendaItemAnalysis;
}

export default function AgendaItemAnalysisDisplay({
  item,
}: AgendaItemAnalysisDisplayProps) {
  const {
    item_title,
    core_issue,
    controversy,
    legislator_speakers,
    respondent_speakers,
    result_status_next,
  } = item;

  function renderSpeakerDetails(speakers: SpeakerDetail[] | null) {
    if (!speakers || speakers.length === 0) return <li>無相關發言紀錄</li>;
    return speakers.map((speaker) => {
      const { speaker_name, speaker_viewpoint } = speaker;
      return (
        <li key={speaker_name}>
          <p>{speaker_name}</p>
          <ul>
            {speaker_viewpoint?.map((viewpoint) => (
              <li key={viewpoint}>{viewpoint}</li>
            ))}
          </ul>
        </li>
      );
    });
  }

  return (
    <div>
      <h3>{item_title}</h3>
      <ul>
        {core_issue?.map((issue) => (
          <li key={issue}>{issue}</li>
        ))}
      </ul>
      <h3>相關爭議</h3>
      <ul>
        {controversy?.map((controversy) => (
          <li key={controversy}>{controversy}</li>
        ))}
      </ul>
      <h3>立法委員發言</h3>
      <ul>{renderSpeakerDetails(legislator_speakers)}</ul>
      <h3>相關人員回覆</h3>
      <ul>{renderSpeakerDetails(respondent_speakers)}</ul>
      <h3>相關後續</h3>
      <ul>
        {result_status_next?.map((result_status_next) => (
          <li key={result_status_next}>{result_status_next}</li>
        ))}
      </ul>
    </div>
  );
}
