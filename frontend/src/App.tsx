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
import { AdminPage } from './components/AdminPage';
import { GalleryPage } from './components/GalleryPage';
import { TestnetBanner } from './components/TestnetBanner';
import { DebugWinModalButton } from './components/DebugWinModalButton';
import { HomePage } from './components/HomePage';
import { filterToValidChars } from './lib/pixelFont';
import { config } from './lib/wagmi';
import { useReplayFromPath } from './hooks/useReplayFromPath';
import { MAX_MAZE_CELLS } from './lib/mazeConstants.generated';
import {
  DEFAULT_SEED as SEED_URL_DEFAULT,
  seedToPath,
  seedFromLocation,
  isGamePath,
  tokenPath,
  tokenIdFromLocation,
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

  // A `/m/<tokenId>` link opened cold has no layout in memory, so fetch it.
  // Without this the page would render the default seed's maze under a URL
  // naming a particular one.
  const fetchedReplay = useReplayFromPath(
    location.pathname,
    replay !== null && tokenIdFromLocation(location.pathname) === replay.tokenId
  );
  useEffect(() => {
    if (fetchedReplay) setReplay(fetchedReplay);
  }, [fetchedReplay]);

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
      // A replay is identified by tokenId, not by a typeable seed, so it gets
      // its own path. Navigating to '/' sent it to the directions screen --
      // which was the game before the URL change, and is not any more.
      navigate(tokenPath(payload.tokenId));
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

  // A pre-existing link of the form /?seed=X used to be the game. `/` is now
  // the directions screen, so those links are rewritten to the canonical path
  // instead of silently landing on a page that ignores their seed.
  useEffect(() => {
    if (location.pathname !== '/') return;
    const legacy = new URLSearchParams(location.search).get('seed');
    if (legacy) navigate(seedToPath(sanitizeSeed(legacy)), { replace: true });
  }, [location.pathname, location.search, navigate]);

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
              <Route index element={<HomePage />} />
              {/* The seed lives in the path: /s/<seed>. Rendering is handled
                  by AppShell for any game path, so the element is null here
                  exactly as it is for the index route. */}
              <Route path="s/:seed" element={null} />
              {/* A replay of a minted maze, by token id. Rendered by AppShell
                  like the seed path, so the element is null here too. */}
              <Route path="m/:tokenId" element={null} />
              <Route path="mazes" element={<MyMazesPage />} />
              <Route path="gallery" element={<GalleryPage />} />
              {/* Not linked from anywhere: it is an operator tool, not a page
                  of the game. Nothing here is privileged by being hidden --
                  every write reverts without OWNER_ROLE -- so the obscurity is
                  about keeping it out of a player's way, not about access. */}
              <Route path="admin" element={<AdminPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

export default App;
