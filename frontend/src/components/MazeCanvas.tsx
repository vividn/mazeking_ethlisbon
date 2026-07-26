import React, { useEffect, useRef, useState } from 'react';
import {
  CellType,
  type MazeData,
  type Position,
  type ColorScheme,
} from '../types';
import { drawArrow, drawCornerWarp, getArrowColor } from '../glyphs';
import { useGlyphImages } from '../glyphs/glyphImages';
import {
  drawPerson,
  drawRobe,
  drawScepter,
  drawCrownGoal,
  CrownTier,
} from '../lib/spriteGlyphs';

interface MazeCanvasProps {
  maze: MazeData;
  playerPos: Position;
  robePos: Position | null;
  scepterPos: Position | null;
  goalPos: Position;
  hasRobe: boolean;
  hasScepter: boolean;
  colors: ColorScheme;
  zoom: number;
  visited: Set<string>;
  showEntities?: boolean;
  playerWearsCrown?: boolean;
  crownTier?: CrownTier;
  showKinglyHint?: boolean;
  /** Per-user zoom on top of the `zoom` prop. 1 = no additional zoom. */
  userZoom: number;
  /** Per-user pan offset (px) applied on top of centering. */
  userPan: { x: number; y: number };
  /** Parent container element — canvas sizes itself to its bounding rect. */
  containerRef: React.RefObject<HTMLDivElement>;
}

const KINGLY_HINT_TEXT =
  'Coronation is only for kings in full regalia. Find your robe and scepter first';

// Greedy word-wrap to a max pixel width using the currently set ctx.font.
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && ctx.measureText(candidate).width > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Draw a speech bubble carrying the anti-shortcut hint near the player.
 * `anchorY` is the cell edge the bubble's tail points toward — top edge by
 * default, bottom edge when `below` is true (used when the player is in the
 * top row and there's no room above).
 *
 * `maxWidth` caps bubble width (in canvas px). The text wraps to multiple
 * lines if a single line would exceed it.
 */
function drawKinglyHint(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  anchorY: number,
  cellSize: number,
  below: boolean = false,
  maxWidth: number = Infinity
): void {
  // Font size scales with cell size, with a comfortable readable floor.
  const fontPx = Math.max(11, Math.min(16, cellSize * 0.42));
  const padX = fontPx * 0.7;
  const padY = fontPx * 0.4;
  const lineGap = fontPx * 0.25;

  ctx.save();
  ctx.font = `600 ${fontPx}px ui-sans-serif, system-ui, -apple-system, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';

  const innerMax = Math.max(fontPx * 6, maxWidth - padX * 2);
  const lines = wrapText(ctx, KINGLY_HINT_TEXT, innerMax);
  const textW = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const bubbleW = textW + padX * 2;
  const bubbleH =
    fontPx * lines.length + lineGap * (lines.length - 1) + padY * 2;
  const tailH = fontPx * 0.4;
  const gap = Math.max(2, cellSize * 0.08);

  // Edge of the bubble nearest the player (i.e. the side the tail comes off).
  const bubbleNear = below ? anchorY + gap + tailH : anchorY - gap - tailH;
  const bubbleFar = below ? bubbleNear + bubbleH : bubbleNear - bubbleH;
  const bubbleTop = Math.min(bubbleNear, bubbleFar);
  const bubbleBottom = Math.max(bubbleNear, bubbleFar);
  const bubbleLeft = centerX - bubbleW / 2;
  const bubbleRight = centerX + bubbleW / 2;
  const radius = Math.min(bubbleH / 2, fontPx * 0.55);

  // Drop shadow under the bubble.
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
  ctx.shadowBlur = Math.max(2, fontPx * 0.3);
  ctx.shadowOffsetY = 2;

  ctx.fillStyle = '#fefcf2';
  ctx.beginPath();
  ctx.moveTo(bubbleLeft + radius, bubbleTop);
  // Top edge — break for upward tail when bubble sits below the player.
  if (below) {
    const tailHalfW = fontPx * 0.4;
    ctx.lineTo(centerX - tailHalfW, bubbleTop);
    ctx.lineTo(centerX, bubbleTop - tailH);
    ctx.lineTo(centerX + tailHalfW, bubbleTop);
  }
  ctx.lineTo(bubbleRight - radius, bubbleTop);
  ctx.quadraticCurveTo(bubbleRight, bubbleTop, bubbleRight, bubbleTop + radius);
  ctx.lineTo(bubbleRight, bubbleBottom - radius);
  ctx.quadraticCurveTo(
    bubbleRight,
    bubbleBottom,
    bubbleRight - radius,
    bubbleBottom
  );
  // Bottom edge — break for downward tail when bubble sits above the player.
  if (!below) {
    const tailHalfW = fontPx * 0.4;
    ctx.lineTo(centerX + tailHalfW, bubbleBottom);
    ctx.lineTo(centerX, bubbleBottom + tailH);
    ctx.lineTo(centerX - tailHalfW, bubbleBottom);
  }
  ctx.lineTo(bubbleLeft + radius, bubbleBottom);
  ctx.quadraticCurveTo(
    bubbleLeft,
    bubbleBottom,
    bubbleLeft,
    bubbleBottom - radius
  );
  ctx.lineTo(bubbleLeft, bubbleTop + radius);
  ctx.quadraticCurveTo(bubbleLeft, bubbleTop, bubbleLeft + radius, bubbleTop);
  ctx.closePath();
  ctx.fill();

  // Disable shadow for the border + text passes.
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#1a1a1a';
  ctx.stroke();

  ctx.fillStyle = '#1a1a1a';
  const lineH = fontPx + lineGap;
  const firstLineY = bubbleTop + padY + fontPx / 2;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], centerX, firstLineY + i * lineH);
  }

  ctx.restore();
}

/**
 * Pure canvas renderer for the maze. Paints cells, walls, warp arrows,
 * collectibles, the player sprite, and the regalia-hint speech bubble.
 *
 * Owns no transform state — it consumes `userZoom`/`userPan` from a parent
 * (typically MazeViewport) so the same renderer serves both interactive
 * (Game) and static (WinModal/HeaderSeedInput preview) callers.
 */
export function MazeCanvas({
  maze,
  playerPos,
  robePos,
  scepterPos,
  goalPos,
  hasRobe,
  hasScepter,
  colors,
  zoom,
  visited,
  showEntities = true,
  playerWearsCrown = false,
  crownTier = CrownTier.Plain,
  showKinglyHint = false,
  userZoom,
  userPan,
  containerRef,
}: MazeCanvasProps) {
  const fullRegalia = hasRobe && hasScepter;
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Bitmap glyphs (peasant/regalia/king + pickup). Null until loaded — the
  // sprite helpers fall back to the procedural patterns until then.
  const glyphImages = useGlyphImages();

  // Observed size of the container the canvas fills. The paint effect below
  // depends on it, so any change to the container's box re-measures and
  // repaints. That covers two cases a `window` resize listener cannot:
  //
  //  - the container is resized without the window being resized;
  //  - the container goes from zero-sized to laid out, which is what happens
  //    when a subtree mounted under `display: none` is later revealed. The
  //    router keeps the game mounted and hidden while the directions screen
  //    is showing, so the first measurement is 0x0 and the reveal is the only
  //    signal that a real measurement is now possible.
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      const { width, height } = container.getBoundingClientRect();
      setContainerSize((prev) =>
        prev.width === width && prev.height === height
          ? prev
          : { width, height }
      );
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size to match container
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    ctx.scale(dpr, dpr);

    // Calculate cell size to fit maze in available space
    const baseCellSize = Math.min(
      rect.width / maze.width,
      rect.height / maze.height
    );
    const totalZoom = zoom * userZoom;
    const cellSize = baseCellSize * totalZoom;

    // Calculate viewport offset. When the user has applied any pinch/pan,
    // we use neutral (maze-centered) framing and stack their transform on top —
    // this keeps pinch anchoring math stable. Otherwise honor the prop zoom's
    // player-centered behavior (the desktop 1x/2x toggle).
    let offsetX = 0;
    let offsetY = 0;

    const userActive = userZoom !== 1 || userPan.x !== 0 || userPan.y !== 0;

    if (zoom > 1 && !userActive) {
      const playerScreenX = playerPos.x * cellSize;
      const playerScreenY = playerPos.y * cellSize;
      offsetX = rect.width / 2 - playerScreenX - cellSize / 2;
      offsetY = rect.height / 2 - playerScreenY - cellSize / 2;
    } else {
      offsetX = (rect.width - maze.width * cellSize) / 2;
      offsetY = (rect.height - maze.height * cellSize) / 2;
    }
    offsetX += userPan.x;
    offsetY += userPan.y;

    // Clear canvas with dark background
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, rect.width, rect.height);

    ctx.save();
    ctx.translate(offsetX, offsetY);

    // Wall thickness - slightly thicker for outer perimeter
    const wallThickness = Math.max(2, cellSize * 0.1);
    const perimeterWallThickness = Math.max(3, cellSize * 0.13);

    // Draw all cells
    for (let y = 0; y < maze.height; y++) {
      for (let x = 0; x < maze.width; x++) {
        const cell = maze.cells[y][x];
        const cellX = x * cellSize;
        const cellY = y * cellSize;
        const isVisited = visited.has(`${x},${y}`);

        // Determine cell background color based on cell type
        let bgColor: string;
        switch (cell.cellType) {
          case CellType.CrownText:
            bgColor = isVisited
              ? colors.crownVisitedColor
              : colors.crownBackgroundColor;
            break;
          case CellType.ZkText:
            bgColor = isVisited
              ? colors.zkVisitedColor
              : colors.zkBackgroundColor;
            break;
          case CellType.Text:
            bgColor = isVisited
              ? colors.textVisitedColor
              : colors.textBackgroundColor;
            break;
          default:
            bgColor = isVisited
              ? colors.visitedColor
              : colors.mazeBackgroundColor;
        }

        // Fill cell background
        ctx.fillStyle = bgColor;
        ctx.fillRect(cellX, cellY, cellSize, cellSize);

        // Draw walls - use same color for all walls
        ctx.strokeStyle = colors.wallColor;
        ctx.lineWidth = wallThickness;
        ctx.lineCap = 'square';

        // South wall
        if (cell.southWall) {
          ctx.beginPath();
          ctx.moveTo(cellX, cellY + cellSize);
          ctx.lineTo(cellX + cellSize, cellY + cellSize);
          ctx.stroke();
        }

        // East wall
        if (cell.eastWall) {
          ctx.beginPath();
          ctx.moveTo(cellX + cellSize, cellY);
          ctx.lineTo(cellX + cellSize, cellY + cellSize);
          ctx.stroke();
        }

        // North wall (wraps from bottom)
        const northCell = maze.cells[(y - 1 + maze.height) % maze.height][x];
        if (northCell.southWall) {
          ctx.beginPath();
          ctx.moveTo(cellX, cellY);
          ctx.lineTo(cellX + cellSize, cellY);
          ctx.stroke();
        }

        // West wall (wraps from right)
        const westCell = maze.cells[y][(x - 1 + maze.width) % maze.width];
        if (westCell.eastWall) {
          ctx.beginPath();
          ctx.moveTo(cellX, cellY);
          ctx.lineTo(cellX, cellY + cellSize);
          ctx.stroke();
        }
      }
    }

    // Draw thicker outer perimeter walls (inside the playing field, skipping warp passages)
    ctx.strokeStyle = colors.wallColor;
    ctx.lineWidth = perimeterWallThickness;
    ctx.lineCap = 'square';
    const perimeterInset = perimeterWallThickness / 2;

    // Top perimeter - draw segments, skipping warp passages
    for (let x = 0; x < maze.width; x++) {
      // Check if there's a wall at the top (north wall of top row = south wall of bottom row)
      const bottomCell = maze.cells[maze.height - 1][x];
      if (bottomCell.southWall) {
        ctx.beginPath();
        ctx.moveTo(x * cellSize, perimeterInset);
        ctx.lineTo((x + 1) * cellSize, perimeterInset);
        ctx.stroke();
      }
    }

    // Bottom perimeter - draw segments, skipping warp passages
    for (let x = 0; x < maze.width; x++) {
      const bottomCell = maze.cells[maze.height - 1][x];
      if (bottomCell.southWall) {
        ctx.beginPath();
        ctx.moveTo(x * cellSize, maze.height * cellSize - perimeterInset);
        ctx.lineTo((x + 1) * cellSize, maze.height * cellSize - perimeterInset);
        ctx.stroke();
      }
    }

    // Left perimeter - draw segments, skipping warp passages
    for (let y = 0; y < maze.height; y++) {
      // Check if there's a wall on the left (west wall of left column = east wall of right column)
      const rightCell = maze.cells[y][maze.width - 1];
      if (rightCell.eastWall) {
        ctx.beginPath();
        ctx.moveTo(perimeterInset, y * cellSize);
        ctx.lineTo(perimeterInset, (y + 1) * cellSize);
        ctx.stroke();
      }
    }

    // Right perimeter - draw segments, skipping warp passages
    for (let y = 0; y < maze.height; y++) {
      const rightCell = maze.cells[y][maze.width - 1];
      if (rightCell.eastWall) {
        ctx.beginPath();
        ctx.moveTo(maze.width * cellSize - perimeterInset, y * cellSize);
        ctx.lineTo(maze.width * cellSize - perimeterInset, (y + 1) * cellSize);
        ctx.stroke();
      }
    }

    // Draw wraparound arrows at edges where passages exist (BEFORE icons so icons render on top)
    // Each pair of matching arrows (top/bottom or left/right at same position) gets a unique color
    const arrowSize = cellSize * 0.35;

    // Collect vertical wraparound passages and assign colors
    let verticalIndex = 0;
    const verticalArrows: { x: number; color: string }[] = [];
    for (let x = 0; x < maze.width; x++) {
      const bottomCell = maze.cells[maze.height - 1][x];
      if (!bottomCell.southWall) {
        const color = getArrowColor(verticalIndex);
        verticalArrows.push({ x, color });
        verticalIndex++;
      }
    }

    // Collect horizontal wraparound passages and assign colors
    let horizontalIndex = 0;
    const horizontalArrows: { y: number; color: string }[] = [];
    for (let y = 0; y < maze.height; y++) {
      const rightCell = maze.cells[y][maze.width - 1];
      if (!rightCell.eastWall) {
        // Offset the starting hue to differentiate from vertical arrows
        const color = getArrowColor(horizontalIndex + 50);
        horizontalArrows.push({ y, color });
        horizontalIndex++;
      }
    }

    // Identify corner positions (where both vertical and horizontal warps exist)
    const topLeftCornerV = verticalArrows.find((a) => a.x === 0);
    const topLeftCornerH = horizontalArrows.find((a) => a.y === 0);
    const topRightCornerV = verticalArrows.find((a) => a.x === maze.width - 1);
    const topRightCornerH = horizontalArrows.find((a) => a.y === 0);
    const bottomLeftCornerV = verticalArrows.find((a) => a.x === 0);
    const bottomLeftCornerH = horizontalArrows.find(
      (a) => a.y === maze.height - 1
    );
    const bottomRightCornerV = verticalArrows.find(
      (a) => a.x === maze.width - 1
    );
    const bottomRightCornerH = horizontalArrows.find(
      (a) => a.y === maze.height - 1
    );

    // Draw corner warps with special 4-way indicator
    if (topLeftCornerV && topLeftCornerH) {
      drawCornerWarp(
        ctx,
        arrowSize * 1.2,
        arrowSize * 1.2,
        topLeftCornerV.color,
        topLeftCornerH.color,
        arrowSize
      );
    }
    if (topRightCornerV && topRightCornerH) {
      drawCornerWarp(
        ctx,
        maze.width * cellSize - arrowSize * 1.2,
        arrowSize * 1.2,
        topRightCornerV.color,
        topRightCornerH.color,
        arrowSize
      );
    }
    if (bottomLeftCornerV && bottomLeftCornerH) {
      drawCornerWarp(
        ctx,
        arrowSize * 1.2,
        maze.height * cellSize - arrowSize * 1.2,
        bottomLeftCornerV.color,
        bottomLeftCornerH.color,
        arrowSize
      );
    }
    if (bottomRightCornerV && bottomRightCornerH) {
      drawCornerWarp(
        ctx,
        maze.width * cellSize - arrowSize * 1.2,
        maze.height * cellSize - arrowSize * 1.2,
        bottomRightCornerV.color,
        bottomRightCornerH.color,
        arrowSize
      );
    }

    // Draw top arrows (pointing up) - skip corners that have both warps
    for (const arrow of verticalArrows) {
      const isCorner =
        (arrow.x === 0 && topLeftCornerH) ||
        (arrow.x === maze.width - 1 && topRightCornerH);
      if (!isCorner) {
        const cellX = arrow.x * cellSize + cellSize / 2;
        const cellY = arrowSize * 1.2;
        drawArrow(ctx, cellX, cellY, 'up', arrow.color, arrowSize);
      }
    }

    // Draw bottom arrows (pointing down) - skip corners that have both warps
    for (const arrow of verticalArrows) {
      const isCorner =
        (arrow.x === 0 && bottomLeftCornerH) ||
        (arrow.x === maze.width - 1 && bottomRightCornerH);
      if (!isCorner) {
        const cellX = arrow.x * cellSize + cellSize / 2;
        const cellY = maze.height * cellSize - arrowSize * 1.2;
        drawArrow(ctx, cellX, cellY, 'down', arrow.color, arrowSize);
      }
    }

    // Draw left arrows (pointing left) - skip corners that have both warps
    for (const arrow of horizontalArrows) {
      const isCorner =
        (arrow.y === 0 && topLeftCornerV) ||
        (arrow.y === maze.height - 1 && bottomLeftCornerV);
      if (!isCorner) {
        const cellX = arrowSize * 1.2;
        const cellY = arrow.y * cellSize + cellSize / 2;
        drawArrow(ctx, cellX, cellY, 'left', arrow.color, arrowSize);
      }
    }

    // Draw right arrows (pointing right) - skip corners that have both warps
    for (const arrow of horizontalArrows) {
      const isCorner =
        (arrow.y === 0 && topRightCornerV) ||
        (arrow.y === maze.height - 1 && bottomRightCornerV);
      if (!isCorner) {
        const cellX = maze.width * cellSize - arrowSize * 1.2;
        const cellY = arrow.y * cellSize + cellSize / 2;
        drawArrow(ctx, cellX, cellY, 'right', arrow.color, arrowSize);
      }
    }

    // Helper to check if movement from one cell to another is blocked by a wall
    const canMove = (
      fromX: number,
      fromY: number,
      toX: number,
      toY: number
    ): boolean => {
      const dx = toX - fromX;
      const dy = toY - fromY;

      // Check movement direction and corresponding wall
      if (dx === 1 || dx === -(maze.width - 1)) {
        // Moving east (or wrapping from right edge to left)
        return !maze.cells[fromY][fromX].eastWall;
      } else if (dx === -1 || dx === maze.width - 1) {
        // Moving west (or wrapping from left edge to right)
        return !maze.cells[fromY][(fromX - 1 + maze.width) % maze.width]
          .eastWall;
      } else if (dy === 1 || dy === -(maze.height - 1)) {
        // Moving south (or wrapping from bottom to top)
        return !maze.cells[fromY][fromX].southWall;
      } else if (dy === -1 || dy === maze.height - 1) {
        // Moving north (or wrapping from top to bottom)
        return !maze.cells[(fromY - 1 + maze.height) % maze.height][fromX]
          .southWall;
      }
      return false;
    };

    // BFS to find accessible cells within distance, respecting walls
    const getAccessibleCells = (
      startX: number,
      startY: number,
      maxDist: number
    ): Map<string, number> => {
      const distances = new Map<string, number>();
      const queue: { x: number; y: number; dist: number }[] = [
        { x: startX, y: startY, dist: 0 },
      ];
      distances.set(`${startX},${startY}`, 0);

      while (queue.length > 0) {
        const { x, y, dist } = queue.shift()!;
        if (dist >= maxDist) continue;

        // Check all 4 directions
        const dirs = [
          { dx: 0, dy: -1 }, // north
          { dx: 1, dy: 0 }, // east
          { dx: 0, dy: 1 }, // south
          { dx: -1, dy: 0 }, // west
        ];

        for (const { dx, dy } of dirs) {
          const nx = (x + dx + maze.width) % maze.width;
          const ny = (y + dy + maze.height) % maze.height;
          const key = `${nx},${ny}`;

          if (!distances.has(key) && canMove(x, y, x + dx, y + dy)) {
            distances.set(key, dist + 1);
            queue.push({ x: nx, y: ny, dist: dist + 1 });
          }
        }
      }

      return distances;
    };

    // Helper to draw colored square under an entity with distance-based transparency
    const drawAccessibleHighlight = (
      pos: Position,
      baseColor: { r: number; g: number; b: number },
      maxDist: number
    ) => {
      const accessible = getAccessibleCells(pos.x, pos.y, maxDist);

      for (const [key, dist] of accessible) {
        const [x, y] = key.split(',').map(Number);
        const cellX = x * cellSize;
        const cellY = y * cellSize;

        // Opacity decreases with distance: 0.5 for dist 0, 0.3 for dist 1, 0.15 for dist 2
        const opacity = dist === 0 ? 0.5 : dist === 1 ? 0.3 : 0.15;
        ctx.fillStyle = `rgba(${baseColor.r}, ${baseColor.g}, ${baseColor.b}, ${opacity})`;
        ctx.fillRect(cellX, cellY, cellSize, cellSize);
      }
    };

    if (showEntities) {
      // Crown goal — green-tinted accessible halo once both regalia pieces
      // are collected, red while locked. Crown is THE win condition glyph.
      // Skip when the player is wearing the crown (win-modal thumbnail) —
      // the crown has been claimed; rendering it on the goal cell too would
      // double up at the same position.
      if (!playerWearsCrown) {
        const goalHalo = fullRegalia
          ? { r: 100, g: 200, b: 100 }
          : { r: 200, g: 60, b: 60 };
        drawAccessibleHighlight(goalPos, goalHalo, 2);
        drawCrownGoal(
          ctx,
          goalPos.x * cellSize + cellSize / 2,
          goalPos.y * cellSize + cellSize / 2,
          cellSize * 0.9,
          colors.goalColor,
          fullRegalia,
          colors.goalGlowColor,
          glyphImages ?? undefined
        );
      }

      // Robe collectible — only visible until picked up.
      if (robePos !== null) {
        const regaliaHalo = { r: 255, g: 200, b: 50 };
        drawAccessibleHighlight(robePos, regaliaHalo, 2);
        drawRobe(
          ctx,
          robePos.x * cellSize + cellSize / 2,
          robePos.y * cellSize + cellSize / 2,
          cellSize * 0.85,
          colors.keyColor,
          glyphImages ?? undefined
        );
      }

      // Scepter collectible — only visible until picked up.
      if (scepterPos !== null) {
        const regaliaHalo = { r: 255, g: 200, b: 50 };
        drawAccessibleHighlight(scepterPos, regaliaHalo, 2);
        drawScepter(
          ctx,
          scepterPos.x * cellSize + cellSize / 2,
          scepterPos.y * cellSize + cellSize / 2,
          cellSize * 0.85,
          colors.keyColor,
          glyphImages ?? undefined
        );
      }

      // Player figure. Win-modal context renders person-wearing-crown; in-game
      // the player wears regalia (robe+scepter) once both pieces are collected.
      drawPerson(
        ctx,
        playerPos.x * cellSize + cellSize / 2,
        playerPos.y * cellSize + cellSize / 2,
        cellSize * 0.85,
        colors.playerColor,
        hasRobe,
        hasScepter,
        colors.keyColor,
        playerWearsCrown,
        colors.keyColor,
        crownTier,
        glyphImages ?? undefined
      );

      // Anti-shortcut hint: speech bubble above the player when they reach
      // the crown without regalia. Tells first-time players why nothing
      // happened — they need the regalia to claim the throne.
      // Flip the bubble below the player when there's no room above (top row).
      if (showKinglyHint) {
        const playerCenterX = playerPos.x * cellSize + cellSize / 2;
        const flipBelow = playerPos.y === 0;
        const anchorY = flipBelow
          ? (playerPos.y + 1) * cellSize
          : playerPos.y * cellSize;
        // Cap bubble width so the long hint doesn't run offscreen on small
        // viewports — wrap to multiple lines instead.
        const maxBubbleW = Math.min(maze.width * cellSize * 0.9, cellSize * 14);
        drawKinglyHint(
          ctx,
          playerCenterX,
          anchorY,
          cellSize,
          flipBelow,
          maxBubbleW
        );
      }
    }

    ctx.restore();
  }, [
    maze,
    playerPos,
    robePos,
    scepterPos,
    goalPos,
    hasRobe,
    hasScepter,
    fullRegalia,
    colors,
    zoom,
    visited,
    showEntities,
    userZoom,
    userPan,
    playerWearsCrown,
    crownTier,
    showKinglyHint,
    glyphImages,
    containerRef,
    containerSize,
  ]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        display: 'block',
        imageRendering: 'crisp-edges',
      }}
      aria-label={`Maze grid ${maze.width} by ${maze.height}. Player at ${playerPos.x}, ${playerPos.y}. ${hasRobe ? 'Robe collected' : `Robe at ${robePos?.x}, ${robePos?.y}`}. ${hasScepter ? 'Scepter collected' : `Scepter at ${scepterPos?.x}, ${scepterPos?.y}`}. Crown at ${goalPos.x}, ${goalPos.y}.`}
      role="img"
    />
  );
}
