import { AgendaItemAnalysis, SpeakerDetail } from "../types/analysisTypes";

interface AgendaItemAnalysisDisplayProps {
  item: AgendaItemAnalysis;
  itemIndex: number;
}

export default function AgendaItemAnalysisDisplay({
  item,
  itemIndex,
}: AgendaItemAnalysisDisplayProps) {
  const {
    item_title,
    core_issue,
    controversy,
    legislator_speakers,
    respondent_speakers,
    result_status_next,
  } = item;

  const idPrefix = `item-${itemIndex}`;

  function renderSpeakerDetails(speakers: SpeakerDetail[] | null) {
    if (!speakers || speakers.length === 0) return <li>無相關發言紀錄</li>;
    return speakers.map((speaker) => {
      const { speaker_name, speaker_viewpoint } = speaker;
      return (
        <li key={speaker_name}>
          <p
            className="font-semibold scroll-mt-16"
            id={`${idPrefix}-${speaker_name}`}
          >
            {speaker_name}
          </p>
          <ul className="list-disc list-outside pl-8 mb-2">
            {speaker_viewpoint?.map((viewpoint) => (
              <li key={viewpoint}>{viewpoint}</li>
            ))}
          </ul>
        </li>
      );
    });
  }

  return (
    <div className="space-y-6">
      <h3 className="">{item_title}</h3>
      <h3
        className="text-xl font-semibold mb-2 scroll-mt-16 "
        id={`${idPrefix}-core-issues`}
      >
        核心議題
      </h3>
      <ul className="list-disc list-outside pl-8">
        {core_issue?.map((issue) => (
          <li key={issue} className="">
            {issue}
          </li>
        ))}
      </ul>
      <h3
        className="text-xl font-semibold mb-2 scroll-mt-16 "
        id={`${idPrefix}-controversies`}
      >
        相關爭議
      </h3>
      <ul className="list-disc list-outside pl-8">
        {controversy?.map((controversy) => (
          <li key={controversy}>{controversy}</li>
        ))}
      </ul>
      <h3
        className="text-xl font-semibold mb-4 scroll-mt-16 "
        id={`${idPrefix}-legislators-response`}
      >
        立法委員發言
      </h3>
      <ul>{renderSpeakerDetails(legislator_speakers)}</ul>
      <h3
        className="text-xl font-semibold mb-2 scroll-mt-16"
        id={`${idPrefix}-respondents-response`}
      >
        相關人員回覆
      </h3>
      <ul>{renderSpeakerDetails(respondent_speakers)}</ul>
      <h3
        className="text-xl font-semibold mb-2 scroll-mt-16"
        id={`${idPrefix}-result-next`}
      >
        相關後續
      </h3>
      <ul className="list-disc list-outside pl-8">
        {result_status_next?.map((result_status_next) => (
          <li key={result_status_next}>{result_status_next}</li>
        ))}
      </ul>
    </div>
  );
}
