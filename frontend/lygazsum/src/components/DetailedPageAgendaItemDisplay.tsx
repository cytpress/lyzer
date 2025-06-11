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
  const subtitleClasses =
    "text-neutral-900 text-lg md:text-xl font-semibold mb-2 md:mb-4 mt-10";
  const textClasses =
    "text-neutral-800 text-base leading-[180%] md:leading-relaxed mb-2";

  function renderSpeakerDetails(speakers: SpeakerDetail[] | null) {
    if (!speakers || speakers.length === 0) return <li>無相關發言紀錄</li>;
    return speakers.map((speaker) => {
      const { speaker_name, speaker_viewpoint } = speaker;
      return (
        <li key={speaker_name}>
          <section
            id={`${idPrefix}-speaker-${speaker_name}`}
            className="scroll-mt-22 md:scroll-mt-24"
          >
            <p className="text-base font-semibold mt-4 md:mt-6 mb-2">
              {speaker_name}
            </p>
            <ul className="list-disc list-outside pl-8 mb-2">
              {speaker_viewpoint?.map((viewpoint) => (
                <li key={viewpoint} className={textClasses}>
                  {viewpoint}
                </li>
              ))}
            </ul>
          </section>
        </li>
      );
    });
  }

  return (
    <>
      <section id={`${idPrefix}-item-title`} className="scroll-mt-22 md:scroll-mt-24">
        <h3 className={subtitleClasses}>議題摘要</h3>
        <p className="text-base text-neutral-800 leading-[180%] md:leading-relaxed mb-4">
          {item_title}
        </p>
      </section>
      <section id={`${idPrefix}-core-issues`} className="scroll-mt-22 md:scroll-mt-24">
        <h3 className={subtitleClasses}>核心議題</h3>
        <ul className="list-disc list-outside pl-8">
          {core_issue?.map((issue) => (
            <li key={issue} className={textClasses}>
              {issue}
            </li>
          ))}
        </ul>
      </section>
      <section id={`${idPrefix}-controversies`} className="scroll-mt-22 md:scroll-mt-24">
        <h3 className={subtitleClasses}>相關爭議</h3>
        <ul className="list-disc list-outside pl-8">
          {controversy?.map((controversy) => (
            <li key={controversy} className={textClasses}>
              {controversy}
            </li>
          ))}
        </ul>
      </section>
      <section data-toc-observer-target={`${idPrefix}-legislators-speech`}>
        <h3
          className={`${subtitleClasses} scroll-mt-22 md:scroll-mt-24`}
          id={`${idPrefix}-legislators-speech`}
        >
          立法委員發言
        </h3>
        <ul>{renderSpeakerDetails(legislator_speakers)}</ul>
      </section>
      <section data-toc-observer-target={`${idPrefix}-respondents-response`}>
        <h3
          className={`${subtitleClasses} scroll-mt-22 md:scroll-mt-24`}
          id={`${idPrefix}-respondents-response`}
        >
          相關人員發言
        </h3>
        <ul>{renderSpeakerDetails(respondent_speakers)}</ul>
      </section>
      <section className="scroll-mt-22 md:scroll-mt-24" id={`${idPrefix}-result-next`}>
        <h3 className={subtitleClasses}>相關後續</h3>
        <ul className="list-disc list-outside pl-8">
          {result_status_next?.map((result_status_next) => (
            <li key={result_status_next} className={textClasses}>
              {result_status_next}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
