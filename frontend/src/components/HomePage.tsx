import { useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import type { OutletCtx } from '../App';
import { DEFAULT_SEED } from '../lib/seedUrl';
import { useMazePaletteForSeed } from '../hooks/useMazePaletteForSeed';
import { pickTextColor } from '../lib/contrastText';
import { filterToValidChars } from '../lib/pixelFont';
import { Wordmark } from './Wordmark';

/**
 * Landing screen: what the game is, and one field to start it.
 *
 * The maze is generated from the name typed here, so this field is the whole
 * of the game's input surface. Submitting it empty starts the default maze
 * rather than refusing — an empty field should not be a dead end for someone
 * who just wants to see what this is.
 */
export function HomePage() {
  const { selectSeed } = useOutletContext<OutletCtx>();
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Preview the palette of whatever is being typed, so the page shifts colour
  // toward the maze the name will produce. The page itself uses the same
  // background the game does, so entering a maze is a continuation rather than
  // a jarring switch; the seed's own colours appear as accents.
  const colors = useMazePaletteForSeed(value.trim() || DEFAULT_SEED);
  const fg = pickTextColor(colors.pageBackgroundColor);

  const start = () => {
    const cleaned = filterToValidChars(value).replace(/  +/g, ' ').trim();
    selectSeed(cleaned || DEFAULT_SEED);
  };

  return (
    <div
      style={{
        ...styles.page,
        backgroundColor: colors.pageBackgroundColor,
        color: fg,
      }}
    >
      <div style={styles.inner}>
        <Wordmark
          text={'maze♚\n♚king'}
          pixelSize={6}
          color={colors.wallColor}
          zkColor={colors.zkBackgroundColor}
          crownColor={colors.crownBackgroundColor}
          ariaLabel="MAZEKING"
        />

        <h1 style={{ ...styles.headline, color: fg }}>Become the Maze King!</h1>

        <p style={{ ...styles.directions, color: fg }}>
          Find your scepter and robes and get to the crown to become King of the
          Kaztle!
        </p>

        <form
          style={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            start();
          }}
        >
          <label htmlFor="kaztle-name" style={{ ...styles.label, color: fg }}>
            Kaztle Name:
          </label>
          <input
            id="kaztle-name"
            ref={inputRef}
            data-testid="kaztle-name"
            value={value}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            placeholder="press enter for the default maze"
            onChange={(e) => setValue(e.target.value)}
            style={{
              ...styles.input,
              color: fg,
              borderColor: fg,
              caretColor: colors.uiAccentColor,
            }}
          />
          <button
            type="submit"
            data-testid="kaztle-start"
            style={{
              ...styles.button,
              color: fg,
              borderColor: fg,
            }}
          >
            Enter the Kaztle
          </button>
        </form>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflowY: 'auto',
    padding: '24px',
    boxSizing: 'border-box',
  },
  inner: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '18px',
    maxWidth: '620px',
    textAlign: 'center',
  },
  headline: {
    margin: 0,
    fontSize: 'clamp(24px, 5vw, 38px)',
    fontFamily: 'monospace',
    letterSpacing: '1px',
  },
  directions: {
    margin: 0,
    fontSize: 'clamp(14px, 2.6vw, 18px)',
    lineHeight: 1.5,
    opacity: 0.9,
    maxWidth: '34em',
  },
  form: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10px',
    marginTop: '6px',
  },
  label: {
    fontFamily: 'monospace',
    fontSize: '15px',
    whiteSpace: 'nowrap',
  },
  input: {
    fontFamily: 'monospace',
    fontSize: '16px',
    padding: '8px 10px',
    minWidth: '18em',
    flex: '1 1 18em',
    maxWidth: '24em',
    background: 'transparent',
    border: '1px solid',
    borderRadius: '6px',
    outline: 'none',
  },
  button: {
    fontFamily: 'monospace',
    fontSize: '15px',
    padding: '8px 14px',
    background: 'transparent',
    border: '1px solid',
    borderRadius: '6px',
    cursor: 'pointer',
  },
};
