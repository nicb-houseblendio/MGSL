import {
  createContext,
  useContext,
  useEffect,
  useState,
  useMemo,
  type ReactNode,
} from 'react';

type Theme = 'light' | 'dark' | 'system';

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  resolvedTheme: 'light' | 'dark';
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * Single source of truth for "what should be on the html element right now".
 *
 * This used to be written out three times — once in each of the two useState
 * initialisers and once per effect — and the copies had already drifted: the
 * `change` handler resolved 'system' correctly but the state initialiser
 * treated an absent localStorage entry differently from an explicit 'system'.
 */
const resolveTheme = (theme: Theme): 'light' | 'dark' => {
  if (theme === 'light' || theme === 'dark') return theme;
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
};

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === 'undefined') return 'system';
    return (localStorage.getItem('theme') as Theme) || 'system';
  });

  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>(() =>
    resolveTheme(typeof window === 'undefined' ? 'system' : ((localStorage.getItem('theme') as Theme) || 'system'))
  );

  useEffect(() => {
    const root = document.documentElement;

    const sync = () => {
      const next = resolveTheme(theme);
      // Idempotent: only touch the class list when it actually disagrees, so the
      // extra triggers below cannot cause a paint on every tab switch.
      if (!root.classList.contains(next)) {
        root.classList.remove('light', 'dark');
        root.classList.add(next);
      }
      setResolvedTheme(next);
    };

    sync();
    localStorage.setItem('theme', theme);

    const mq = window.matchMedia(DARK_QUERY);

    /*
     * The `change` event on its own is not enough, and this is not theoretical:
     * Chrome does not deliver prefers-color-scheme changes to a BACKGROUND tab.
     * The trader screen is left open in a tab all day, so the common case — the
     * OS flips to dark in the evening while the trader is in another tab — is
     * exactly the case the event misses. The screen then stays in the old theme
     * until someone reloads, which is how the dark grid was measured against
     * light-mode colours in the first place.
     *
     * Re-resolving whenever the tab becomes visible again picks up anything the
     * event dropped, whatever the reason.
     */
    const syncIfVisible = () => {
      if (document.visibilityState === 'visible') sync();
    };

    mq.addEventListener('change', sync);
    document.addEventListener('visibilitychange', syncIfVisible);
    window.addEventListener('focus', syncIfVisible);
    return () => {
      mq.removeEventListener('change', sync);
      document.removeEventListener('visibilitychange', syncIfVisible);
      window.removeEventListener('focus', syncIfVisible);
    };
  }, [theme]);

  const value = useMemo(
    () => ({
      theme,
      setTheme: setThemeState,
      resolvedTheme,
    }),
    [theme, resolvedTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
