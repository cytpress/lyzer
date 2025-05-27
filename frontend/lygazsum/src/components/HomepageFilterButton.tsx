interface HomepageFilterButtonProps {
  committeeName: string;
  onToggle: (committeeName: string) => void;
}

export function HomepageFilterButton({
  committeeName,
  onToggle,
}: HomepageFilterButtonProps) {
  return (
    <button onClick={() => onToggle(committeeName)}>{committeeName}</button>
  );
}
