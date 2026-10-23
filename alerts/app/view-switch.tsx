'use client';

import { useFormStatus } from 'react-dom';
import { setViewMode } from './view-actions';
import type { View } from './view-mode';
import './chart3d.css';

function Choices({ view }: { view: View }) {
  // While the switch is on its way, show the choice already made.
  const { pending, data } = useFormStatus();
  const asked = pending ? data?.get('view') : null;
  const shown = asked === 'numbers' || asked === 'graphs' ? asked : view;
  return (
    <>
      <fieldset className="view-switch-buttons" aria-labelledby="view-switch-label">
        <button type="submit" name="view" value="numbers" aria-pressed={shown === 'numbers'}>Numbers</button>
        <button type="submit" name="view" value="graphs" aria-pressed={shown === 'graphs'}>Graphs</button>
      </fieldset>
      {shown === 'graphs' && <p className="view-switch-hint">Drag a graph, or the page around it, to turn the graphs into 3D. Double-click or press Esc to flatten.</p>}
    </>
  );
}

/** Show the platform's numbers as numbers or as graphs. Works without JavaScript (a plain form post). */
export function ViewSwitch({ view }: { view: View }) {
  return (
    <form className="view-switch" action={setViewMode}>
      <span id="view-switch-label">Show data as</span>
      <Choices view={view} />
    </form>
  );
}
