// The overview's map (Nov 10) lights only the regions the person's access reaches. The others are shown as out of reach,
// never as a number or as zero, and an analyst, whose access reaches every region, sees all three lit.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { regionNodes, ScopeMap } from '../app/scope-map';

const row = (region: string, value: number | null) => ({ region, value, numerator: 120000, denominator: 400000 });
const goal = { target: 3, caution: 2 };
const map = (rows: ReturnType<typeof row>[], allowed: string[]) =>
  renderToStaticMarkup(createElement(ScopeMap, { rows, allowed, period: '2017-Q4', goal, metricCount: 3 }));

describe('regionNodes', () => {
  it('puts every region on the map in map order, West, Central, East', () => {
    expect(regionNodes([], ['east']).map((n) => n.region)).toEqual(['west', 'central', 'east']);
  });

  it('gives a row only to regions in the access, even when the rows hold others', () => {
    const nodes = regionNodes([row('east', 0.52), row('west', 0.9)], ['east']);
    expect(nodes).toEqual([
      { region: 'west', access: false, row: null },
      { region: 'central', access: false, row: null },
      { region: 'east', access: true, row: row('east', 0.52) },
    ]);
  });

  it('lights every region for an analyst', () => {
    const nodes = regionNodes([row('central', 0.7), row('east', 0.52), row('west', 0.9)], ['central', 'east', 'west']);
    expect(nodes.every((n) => n.access && n.row !== null)).toBe(true);
  });
});

describe('ScopeMap', () => {
  it('shows the reachable region\'s coverage and locks the others without a number', () => {
    const html = map([row('east', 0.52), row('west', 0.9)], ['east']);
    expect(html.match(/class="map-node[^"]*\blit\b/g)).toHaveLength(1);
    expect(html.match(/class="map-node[^"]*\blocked\b/g)).toHaveLength(2);
    expect(html).toContain('0.52x');
    // West's row was in the data but is outside the access: its value never reaches the page.
    expect(html).not.toContain('0.90x');
    expect(html).toContain('aria-label="West: not in your access"');
    expect(html).toContain('3 approved metrics');
  });

  it('runs a live spoke only to the reachable regions', () => {
    const html = map([row('east', 0.52)], ['east']);
    expect(html).toContain('map-spoke spoke-east live');
    expect(html).toContain('map-spoke spoke-west idle');
    expect(html).toContain('map-spoke spoke-central idle');
  });

  it('says coverage is not available when a reachable region has no quota, rather than showing 0.00x', () => {
    const html = map([row('east', null)], ['east']);
    expect(html).toContain('coverage is not available');
    expect(html).not.toContain('0.00x');
  });
});
