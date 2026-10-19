/** Label-then-value chips (scope, quarter, data date). Used on the overview and under each copilot answer. */
export function FactChips({ items, label }: { items: [string, string][]; label: string }) {
  return (
    <ul className="facts" aria-label={label}>
      {items.map(([k, v]) => (
        <li key={k}><span>{k}</span>{v}</li>
      ))}
    </ul>
  );
}

/** "Scope: East region, Cara Losch's team (6 reps)." -> "East region, Cara Losch's team (6 reps)" */
export const scopeText = (scope: string) => scope.replace(/^Scope: /, '').replace(/\.$/, '');
