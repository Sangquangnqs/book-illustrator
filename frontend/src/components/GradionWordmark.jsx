export function GradionWordmark({ className = "" }) {
  return (
    <span className={`gradion-wordmark ${className}`.trim()} aria-label="Gradion scaling business">
      <span className="gradion-wordmark-main">GRADION</span>
      <span className="gradion-wordmark-sub">scaling business</span>
    </span>
  );
}
