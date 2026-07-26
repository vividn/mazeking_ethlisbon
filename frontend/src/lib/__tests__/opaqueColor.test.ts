/**
 * The wallet menu must not be see-through.
 *
 * The header palette is intentionally translucent —
 * `headerBackgroundColor` is `hsla(h, 28%, 14%, 0.55)` — which suits a bar
 * laid over the maze but makes a popover unreadable, since the maze shows
 * straight through it. `opaque` reuses the hue and drops the alpha.
 */
import { describe, it, expect } from 'vitest';
import { opaque } from '../../components/WalletButton';

describe('opaque', () => {
  it('drops alpha from the real header colour', () => {
    expect(opaque('hsla(210,28%,14%,0.55)')).toBe('hsl(210,28%,14%)');
  });

  it('handles rgba', () => {
    expect(opaque('rgba(10, 20, 30, 0.4)')).toBe('rgb(10,20,30)');
  });

  it('leaves already-opaque colours alone', () => {
    expect(opaque('hsl(210,28%,14%)')).toBe('hsl(210,28%,14%)');
    expect(opaque('#112233')).toBe('#112233');
    expect(opaque('rebeccapurple')).toBe('rebeccapurple');
  });

  it('is a no-op on an hsla that already has no alpha component', () => {
    // Defensive: a 3-part hsla() shouldn't lose a channel.
    expect(opaque('hsla(210,28%,14%)')).toBe('hsl(210,28%,14%)');
  });
});
