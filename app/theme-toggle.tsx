'use client';

// The light/dark switch in the top bar. It works without JavaScript (a plain form post, like the Numbers/Graphs switch);
// with it, the page changes at once and the server keeps the choice in a cookie for the next visit.
import { useEffect, useState } from 'react';
import { MoonIcon, SunIcon } from './icons';
import { setTheme } from './theme-actions';
import { otherTheme, type Theme } from './theme-shared';

/** `saved` is the theme the server rendered with, or null when the page follows the system setting. */
export function ThemeToggle({ saved }: { saved: Theme | null }) {
  // The server can't know the system setting, so the browser reads it, and follows it if it changes.
  const [system, setSystem] = useState<Theme | null>(null);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const follow = () => setSystem(media.matches ? 'dark' : 'light');
    follow();
    media.addEventListener('change', follow);
    return () => media.removeEventListener('change', follow);
  }, []);

  const shown = saved ?? system;
  const next = otherTheme(shown ?? 'light');
  // Until the browser has read the system setting, the label doesn't name a theme: on a dark system it would say
  // "Switch to the dark theme" over a page that is already dark (review of #126).
  const label = shown ? `Switch to the ${next} theme` : 'Switch between the light and dark themes';
  return (
    <form className="theme-toggle" action={setTheme}>
      {/* The click changes the page at once but leaves the button as it is: the form must still send this value. The
          server's next render, with the saved choice, turns the button around. */}
      <button type="submit" name="theme" value={next} aria-label={label} title={label} onClick={() => { document.documentElement.dataset.theme = next; }}>
        {next === 'dark' ? <MoonIcon /> : <SunIcon />}
      </button>
    </form>
  );
}
