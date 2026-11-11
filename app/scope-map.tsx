// The overview's map: the reviewed metric registry at the hub and every region around it, lit where the signed-in
// person's access reaches (PRD access by role). A region outside their access is shown as out of reach, never as zero.
import type { Answer } from '@/semantic/answer';
import { capitalize, coverageStanding, coverageTrackMax, type CoverageTarget } from '@/semantic/coverage-target';
import { ALL_REGIONS } from '@/semantic/regions';
import { cell, format } from './format';
import { LockIcon, RegistryIcon } from './icons';

type Row = Answer['rows'][number];

/** Left to right on the map: West, Central (above the hub), East. A dataset's other regions follow, in its own order. */
const MAP_ORDER = ['west', 'central', 'east'];

export interface RegionNode {
  region: string;
  /** Whether the person's access reaches this region (read from their account, src/semantic/scope.ts). */
  access: boolean;
  /** The region's coverage row, when access reaches it and the data has one. */
  row: Row | null;
}

/** Every region in map order, with whether the person can see it and, if so, its coverage row. */
export function regionNodes(rows: readonly Row[], allowed: readonly string[], regions: readonly string[] = ALL_REGIONS): RegionNode[] {
  const byRegion = new Map(rows.map((r) => [String(r.region), r]));
  return [...MAP_ORDER.filter((r) => regions.includes(r)), ...regions.filter((r) => !MAP_ORDER.includes(r))].map((region) => {
    const access = allowed.includes(region);
    return { region, access, row: access ? (byRegion.get(region) ?? null) : null };
  });
}

interface Scale {
  period: string;
  goal: CoverageTarget | null;
  /** Where the line sits: the target, or 1.00x when no target is set. */
  line: number;
  max: number;
}

function LockedRegion({ name, region }: { name: string; region: string }) {
  return (
    <article className={`map-node node-${region} locked`} aria-label={`${name}: not in your access`}>
      <header>
        <h3>{name}</h3>
        <span className="node-state"><LockIcon />Not in your access</span>
      </header>
      <p className="node-note">Your role doesn't include {name}, so its numbers aren't shown to you.</p>
    </article>
  );
}

function LitRegion({ name, node, scale }: { name: string; node: RegionNode; scale: Scale }) {
  const raw = node.row?.value;
  const v = raw === null || raw === undefined ? null : Number(raw);
  const standing = scale.goal && v !== null ? coverageStanding(v, scale.goal) : null;
  const tone = standing ? `tone-${standing.tone}` : '';
  return (
    <article className={`map-node node-${node.region} lit`}>
      <header>
        <h3>{name}</h3>
        <span className="node-state"><i className="dot" aria-hidden="true" />In your view</span>
      </header>
      <p className="node-reading">
        <b className={`node-value ${tone}`}>{format(v, 'ratio')}</b>
        {standing && <span className={`node-standing ${tone}`}>{capitalize(standing.standing)}</span>}
      </p>
      <div className="track" aria-hidden="true">
        <div className={tone ? `fill ${tone}` : 'fill'} style={{ width: `${((v ?? 0) / scale.max) * 100}%` }} />
        <div className="target" style={{ left: `${(scale.line / scale.max) * 100}%` }} />
      </div>
      {v === null ? (
        <p className="node-note">No quota for this period, so coverage is not available.</p>
      ) : (
        <dl className="node-figs">
          <div><dt>Closing in {scale.period}</dt><dd>{format(node.row?.numerator, 'currency')}</dd></div>
          <div><dt>Quota</dt><dd>{format(node.row?.denominator, 'currency')}</dd></div>
        </dl>
      )}
    </article>
  );
}

function Spoke({ node }: { node: RegionNode }) {
  return <span className={`map-spoke spoke-${node.region} ${node.access ? 'live' : 'idle'}`} aria-hidden="true" />;
}

export function ScopeMap({ rows, allowed, period, goal, metricCount }: {
  rows: Answer['rows'];
  allowed: readonly string[];
  period: string;
  goal: CoverageTarget | null;
  metricCount: number;
}) {
  const nodes = regionNodes(rows, allowed);
  const line = goal?.target ?? 1;
  const scale: Scale = { period, goal, line, max: coverageTrackMax(line, rows.map((r) => Number(r.value ?? 0))) };
  return (
    <div className="map">
      <div className="map-grid">
        {nodes.map((n) => {
          const name = cell('region', n.region, '');
          return n.access ? <LitRegion key={n.region} name={name} node={n} scale={scale} /> : <LockedRegion key={n.region} name={name} region={n.region} />;
        })}
        <div className="map-hub">
          {nodes.map((n) => (
            <Spoke key={n.region} node={n} />
          ))}
          <div className="map-hub-disc">
            <RegistryIcon />
            <strong>{metricCount} approved metrics</strong>
            <span>One definition each</span>
          </div>
        </div>
      </div>
    </div>
  );
}
