import { useState, useEffect, useCallback } from 'react';
import {
  BrowserRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useOutletContext,
} from 'react-router-dom';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Game, type ReplayPayload } from './components/Game';
import { MyMazesPage } from './components/MyMazesPage';
import { GalleryPage } from './components/GalleryPage';
import { TestnetBanner } from './components/TestnetBanner';
import { DebugWinModalButton } from './components/DebugWinModalButton';
import { filterToValidChars } from './lib/pixelFont';
import { config } from './lib/wagmi';
import { MAX_MAZE_CELLS } from './lib/mazeConstants.generated';
import {
  DEFAULT_SEED as SEED_URL_DEFAULT,
  seedToPath,
  seedFromLocation,
  isGamePath,
} from './lib/seedUrl';

const queryClient = new QueryClient();

function sanitizeSeed(seed: string): string {
  const filtered = filterToValidChars(seed);
  const collapsed = filtered.replace(/  +/g, ' ').trim();
  return collapsed || 'maze king';
}

function readSeedFromURL(): string {
  const urlSeed = seedFromLocation(
    window.location.pathname,
    window.location.search
  );
  return urlSeed ? sanitizeSeed(urlSeed) : DEFAULT_SEED;
}

export const DEFAULT_SEED = SEED_URL_DEFAULT;
export { MAX_MAZE_CELLS };

export interface OutletCtx {
  seed: string;
  selectSeed: (seed: string) => void;
  /**
   * Hand the game a replay payload (decoded from on-chain `layouts(tokenId)`).
   * Navigates to `/` and lets `<Game>` decode the layout via
   * `mazeFromLayoutBytes`. Replaces the prior `selectSeed`-based replay path
   * that relied on a localStorage seed→tokenId bridge.
   */
  selectReplay: (payload: ReplayPayload) => void;
}

export function useAppOutlet(): OutletCtx {
  return useOutletContext<OutletCtx>();
}

function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const [seed, setSeed] = useState<string>(readSeedFromURL);
  // Active replay (decoded on-chain layout) overrides seed-driven play. The
  // game returns to seed mode the next time `selectSeed` is called.
  const [replay, setReplay] = useState<ReplayPayload | null>(null);

  const isGameRoute = isGamePath(location.pathname);

  const handleSeedChange = useCallback((newSeed: string) => {
    setSeed(newSeed);
    setReplay(null);
    // Rewrite the path rather than a query parameter, and bypass
    // react-router's navigate() so typing a seed does not churn the route's
    // history entries — same semantics as before routing was introduced.
    window.history.pushState({}, '', seedToPath(newSeed));
  }, []);

  const selectSeed = useCallback(
    (newSeed: string) => {
      setSeed(newSeed);
      setReplay(null);
      navigate(seedToPath(newSeed));
    },
    [navigate]
  );

  const selectReplay = useCallback(
    (payload: ReplayPayload) => {
      setReplay(payload);
      // Drop any seed from the URL — a replay is identified by tokenId, not
      // by a typeable seed string.
      navigate('/');
    },
    [navigate]
  );

  // Browser back/forward updates the seed when we land back on a game path
  // with a different seed. Route-level back/forward is already handled by
  // react-router.
  useEffect(() => {
    const onPop = () => {
      if (isGamePath(window.location.pathname)) {
        setSeed(readSeedFromURL());
        setReplay(null);
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const ctx: OutletCtx = { seed, selectSeed, selectReplay };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
      }}
    >
      <TestnetBanner />
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <div
          style={{
            display: isGameRoute ? 'flex' : 'none',
            flexDirection: 'column',
            width: '100%',
            height: '100%',
          }}
        >
          <Game
            initialSeed={seed}
            onSeedChange={handleSeedChange}
            active={isGameRoute}
            replay={replay}
          />
        </div>
        {!isGameRoute && <Outlet context={ctx} />}
      </div>
      <DebugWinModalButton />
    </div>
  );
}

function App() {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={null} />
              {/* The seed lives in the path: /s/<seed>. Rendering is handled
                  by AppShell for any game path, so the element is null here
                  exactly as it is for the index route. */}
              <Route path="s/:seed" element={null} />
              <Route path="mazes" element={<MyMazesPage />} />
              <Route path="gallery" element={<GalleryPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

export default App;
