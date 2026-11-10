'use client';

// The light/dark switch in the top bar. It works without JavaScript (a plain form post, like the Numbers/Graphs switch);
// with it, the page changes at once and the server keeps the choice in a cookie for the next visit.
import { useEffect, useState } from 'react';
import { MoonIcon, SunIcon } from './icons';
import { setTheme } from './theme-actions';
import { otherTheme, type Theme } from './theme-shared';

/** `saved` is the theme the server rendered with, or null when the page follows the system setting. */
export function ThemeToggle({ saved }: { saved: Theme | null }) {
  const [shown, setShown] = useState<Theme | null>(saved);

  // With no saved choice the server can't know the system setting, so the browser reads it, and follows it if it changes.
  useEffect(() => {
    if (saved) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const follow = () => setShown(media.matches ? 'dark' : 'light');
    follow();
    media.addEventListener('change', follow);
    return () => media.removeEventListener('change', follow);
  }, [saved]);

  const next = otherTheme(shown ?? 'light');
  const label = `Switch to the ${next} theme`;
  return (
    <form className="theme-toggle" action={setTheme}>
      <button
        type="submit"
        name="theme"
        value={next}
        aria-label={label}
        title={label}
        onClick={() => {
          // Change now; the form post saves it.
          document.documentElement.dataset.theme = next;
          setShown(next);
        }}
      >
        {next === 'dark' ? <MoonIcon /> : <SunIcon />}
      </button>
    </form>
  );
}
