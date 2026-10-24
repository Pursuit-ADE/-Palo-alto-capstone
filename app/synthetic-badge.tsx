// Shown on every view, signed in or not: no real customer or Palo Alto Networks data is used anywhere in the app.
export function SyntheticBadge({ dataset = 'Maven CRM data' }: { dataset?: string }) {
  return (
    <span
      className="badge synthetic"
      title={`${dataset}: a public sample of a fictional company, plus synthetic quotas, contacts, cases and engagements. No real customer or Palo Alto Networks data.`}
    >
      Synthetic data
    </span>
  );
}
