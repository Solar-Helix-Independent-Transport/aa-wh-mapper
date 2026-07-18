interface Props {
  label: string;
}

export function LoadingState({ label }: Props) {
  return (
    <div className="loading-state">
      <div className="spinner" />
      <p className="dim loading-state-text">{label}</p>
    </div>
  );
}
