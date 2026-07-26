import { keccak256, getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { BarretenbergSync, Fr } from "@aztec/bb.js";
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}
function createRng(seed) {
  let state = hashString(seed);
  const next = () => {
    state |= 0;
    state = state + 1831565813 | 0;
    let t = Math.imul(state ^ state >>> 15, 1 | state);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  const nextInt = (min, max) => {
    return Math.floor(next() * (max - min + 1)) + min;
  };
  const shuffle = (array) => {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
      const j = nextInt(0, i);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  };
  const pick = (array) => {
    return array[nextInt(0, array.length - 1)];
  };
  return { next, nextInt, shuffle, pick };
}
function p(rows) {
  return rows.map((row) => row.split("").map((c) => c === "#"));
}
const PIXEL_FONT = {
  // A: Path goes up the left side, across the middle, down the right
  A: p([
    ".###.",
    "##.##",
    "#...#",
    "#...#",
    "#####",
    "#...#",
    "#...#",
    "#...#"
  ]),
  // B: Path winds through the bumps
  B: p([
    "#####",
    "#...#",
    "#..##",
    "####.",
    "#..##",
    "#...#",
    "#...#",
    "#####"
  ]),
  // C: Open path through the gap
  C: p([
    ".###.",
    "##...",
    "#....",
    "#....",
    "#....",
    "#....",
    "##...",
    ".###."
  ]),
  // D: Path around the curve
  D: p([
    "####.",
    "#..##",
    "#...#",
    "#...#",
    "#...#",
    "#...#",
    "#..##",
    "####."
  ]),
  // E: Paths through the horizontal bars
  E: p([
    "#####",
    "#....",
    "#....",
    "####.",
    "#....",
    "#....",
    "#....",
    "#####"
  ]),
  // F: Similar to E but open bottom
  F: p([
    "#####",
    "#....",
    "#....",
    "####.",
    "#....",
    "#....",
    "#....",
    "#...."
  ]),
  // G: Path through the notch
  G: p([
    ".####",
    "##...",
    "#....",
    "#....",
    "#.###",
    "#...#",
    "#..##",
    "####."
  ]),
  // H: Clear path through the middle bar
  H: p([
    "#...#",
    "#...#",
    "#...#",
    "#####",
    "#...#",
    "#...#",
    "#...#",
    "#...#"
  ]),
  // I: Vertical path with top/bottom bars - connected orthogonally
  I: p([
    "#####",
    "..#..",
    "..#..",
    "..#..",
    "..#..",
    "..#..",
    "..#..",
    "#####"
  ]),
  // J: Path curves at bottom - connected orthogonally
  J: p([
    "#####",
    "....#",
    "....#",
    "....#",
    "....#",
    "#...#",
    "##.##",
    ".###."
  ]),
  // K: Fixed to avoid diagonal - fully connected
  K: p([
    "#...#",
    "#..##",
    "#.##.",
    "###..",
    "###..",
    "#.##.",
    "#..##",
    "#...#"
  ]),
  // L: Simple L shape with open right
  L: p([
    "#....",
    "#....",
    "#....",
    "#....",
    "#....",
    "#....",
    "#....",
    "#####"
  ]),
  // M: Fixed to avoid diagonal - connected peaks
  M: p([
    "#...#",
    "##.##",
    "#####",
    "#.#.#",
    "#.#.#",
    "#...#",
    "#...#",
    "#...#"
  ]),
  // N: Fixed to avoid diagonal - uses stepped pattern
  N: p([
    "#...#",
    "##..#",
    "###.#",
    "#.#.#",
    "#.#.#",
    "#.###",
    "#..##",
    "#...#"
  ]),
  // O: Path around the ring
  O: p([
    ".###.",
    "##.##",
    "#...#",
    "#...#",
    "#...#",
    "#...#",
    "##.##",
    ".###."
  ]),
  // P: Path through top loop, open bottom
  P: p([
    "#####",
    "#...#",
    "#...#",
    "#..##",
    "####.",
    "#....",
    "#....",
    "#...."
  ]),
  // Q: O with orthogonal tail
  Q: p([
    ".###.",
    "##.##",
    "#...#",
    "#...#",
    "#.#.#",
    "#.###",
    "##.##",
    ".####"
  ]),
  // R: Like P but with orthogonal leg - fully connected
  R: p([
    "####.",
    "#..##",
    "#...#",
    "#..##",
    "####.",
    "#.##.",
    "#..##",
    "#...#"
  ]),
  // S: Winding path
  S: p([
    "#####",
    "#....",
    "##...",
    ".####",
    "....#",
    "....#",
    "#...#",
    "#####"
  ]),
  // T: Path down the center - connected orthogonally
  T: p([
    "#####",
    "..#..",
    "..#..",
    "..#..",
    "..#..",
    "..#..",
    "..#..",
    "..#.."
  ]),
  // U: Path around the bottom
  U: p([
    "#...#",
    "#...#",
    "#...#",
    "#...#",
    "#...#",
    "#...#",
    "##..#",
    ".####"
  ]),
  // V: Fixed to avoid diagonal - stepped convergence
  V: p([
    "#...#",
    "#...#",
    "#...#",
    "#...#",
    "#...#",
    "##.##",
    ".###.",
    "..#.."
  ]),
  // W: Fixed to avoid diagonal - connected valleys
  W: p([
    "#...#",
    "#...#",
    "#...#",
    "#.#.#",
    "#.#.#",
    "#.#.#",
    "#####",
    ".#.#."
  ]),
  // X: Fixed to avoid diagonal - fully connected cross
  X: p([
    "#...#",
    "##.##",
    ".###.",
    "..#..",
    "..#..",
    ".###.",
    "##.##",
    "#...#"
  ]),
  // Y: Fixed to avoid diagonal - fully connected merge
  Y: p([
    "#...#",
    "#...#",
    "##.##",
    ".###.",
    "..#..",
    "..#..",
    "..#..",
    "..#.."
  ]),
  // Z: Fixed to avoid diagonal - stepped pattern
  Z: p([
    "#####",
    "....#",
    "...##",
    "..##.",
    ".##..",
    "##...",
    "#....",
    "#####"
  ]),
  // Numbers with traversible paths - all fixed for orthogonal connections
  "0": p([
    ".###.",
    "##.##",
    "#...#",
    "#.#.#",
    "#.#.#",
    "#...#",
    "##.##",
    ".###."
  ]),
  "1": p([
    "..#..",
    ".##..",
    "..#..",
    "..#..",
    "..#..",
    "..#..",
    "..#..",
    "#####"
  ]),
  "2": p([
    ".###.",
    "##.##",
    "....#",
    "..###",
    ".##..",
    "##...",
    "#....",
    "#####"
  ]),
  "3": p([
    ".###.",
    "##.##",
    "....#",
    "..###",
    "....#",
    "....#",
    "##.##",
    ".###."
  ]),
  "4": p([
    "#...#",
    "#...#",
    "#...#",
    "#####",
    "....#",
    "....#",
    "....#",
    "....#"
  ]),
  "5": p([
    "#####",
    "#....",
    "#....",
    "#####",
    "....#",
    "....#",
    "##.##",
    ".###."
  ]),
  "6": p([
    ".####",
    "##..#",
    "#....",
    "####.",
    "#..##",
    "#...#",
    "##.##",
    ".###."
  ]),
  "7": p([
    "#####",
    "....#",
    "....#",
    "...##",
    "..##.",
    "..#..",
    "..#..",
    "..#.."
  ]),
  "8": p([
    ".###.",
    "##.##",
    "#...#",
    "##.##",
    "#####",
    "#...#",
    "##.##",
    ".###."
  ]),
  "9": p([
    ".###.",
    "##.##",
    "#...#",
    "##.##",
    ".####",
    "....#",
    "#..##",
    "####."
  ]),
  // Punctuation
  " ": p(["..", "..", "..", "..", "..", "..", "..", ".."]),
  ".": p(["...", "...", "...", "...", "...", "...", "...", "#.."]),
  ",": p([
    "...",
    "...",
    "...",
    "...",
    "...",
    "...",
    "...",
    "#..",
    "#..",
    "..."
  ]),
  "!": p(["#", "#", "#", "#", "#", "#", ".", "#"]),
  "?": p([
    ".###.",
    "##.##",
    "#...#",
    "...##",
    "..##.",
    "..#.",
    ".....",
    "..#.."
  ]),
  '"': p(["#.#", "#.#", "...", "...", "...", "...", "...", "..."]),
  "'": p(["#", "#", ".", ".", ".", ".", ".", "."]),
  "-": p(["....", "....", "....", "....", "####", "....", "....", "...."]),
  ":": p(["..", "..", "#.", "..", "..", "#.", "..", ".."]),
  "♚": p([
    "..........",
    "..........",
    "..........",
    ".#.#.#.#..",
    ".#######..",
    ".#.#.#.#..",
    "..#####...",
    ".........."
  ]),
  // Lowercase letters - same height, different style
  a: p(["....", "....", "....", "####", "...#", "####", "#..#", "####"]),
  b: p([
    "#....",
    "#....",
    "#....",
    "####.",
    "##.##",
    "#...#",
    "##.##",
    "####."
  ]),
  c: p(["....", "....", "....", ".###", "##..", "#...", "##..", ".###"]),
  d: p([
    "....#",
    "....#",
    "....#",
    ".####",
    "##.##",
    "#...#",
    "##.##",
    ".####"
  ]),
  e: p(["....", "....", "....", "####", "#..#", "####", "#...", "####"]),
  f: p([".###", ".#.#", ".#..", "###.", ".#..", ".#..", ".#..", ".#.."]),
  g: p([
    "....",
    "....",
    "....",
    ".###",
    "##.#",
    "#..#",
    "##.#",
    ".###",
    "...#",
    ".###"
  ]),
  h: p(["#...", "#...", "#...", "###.", "#.##", "#..#", "#..#", "#..#"]),
  i: p(["...", ".#.", "...", "##.", ".#.", ".#.", ".#.", "###"]),
  j: p(["...", "..#", "...", ".##", "..#", "..#", "..#", "..#", "..#", "###"]),
  k: p(["#...", "#...", "#..#", "#.##", "###.", "#.##", "#..#", "#..#"]),
  l: p(["##..", ".#..", ".#..", ".#..", ".#..", ".#..", ".#.#", ".###"]),
  m: p([
    ".....",
    ".....",
    ".....",
    "#####",
    "#.#.#",
    "#.#.#",
    "#...#",
    "#...#"
  ]),
  n: p([
    ".....",
    ".....",
    ".....",
    ".###.",
    "##.##",
    "#...#",
    "#...#",
    "#...#"
  ]),
  o: p([
    ".....",
    ".....",
    ".....",
    ".###.",
    "##.##",
    "#...#",
    "##.##",
    ".###."
  ]),
  p: p([
    "....",
    "....",
    "....",
    "###.",
    "#.##",
    "#..#",
    "#.##",
    "###.",
    "#...",
    "#..."
  ]),
  q: p([
    "....",
    "....",
    "....",
    ".###",
    "##.#",
    "#..#",
    "##.#",
    ".###",
    "...#",
    "...#"
  ]),
  r: p(["....", "....", "....", ".##.", "####", "#..#", "#...", "#..."]),
  s: p([".....", ".....", "....", ".###.", "##...", ".###.", "...##", "####."]),
  t: p([".#..", ".#..", ".#..", "####", ".#..", ".#..", ".#.#", ".###"]),
  u: p(["....", "....", "....", "#..#", "#..#", "#..#", "##.#", ".###"]),
  v: p([
    ".....",
    ".....",
    ".....",
    "#...#",
    "#...#",
    "##.##",
    ".###.",
    "..#.."
  ]),
  w: p([
    ".....",
    ".....",
    ".....",
    "#...#",
    "#.#.#",
    "#.#.#",
    "#####",
    ".#.#."
  ]),
  x: p(["....", "....", "....", "#..#", "####", ".##.", "####", "#..#"]),
  y: p([
    "....",
    "....",
    "....",
    "#..#",
    "#..#",
    "#..#",
    "##.#",
    ".###",
    "...#",
    ".###"
  ]),
  z: p(["....", "....", "....", "####", "..##", ".##.", "##..", "####"])
};
function getCharWidth(char) {
  let pattern = PIXEL_FONT[char];
  if (!pattern) {
    pattern = PIXEL_FONT[char.toUpperCase()];
  }
  if (!pattern || pattern.length === 0) return 3;
  return pattern[0].length;
}
function getTextTopRow(text) {
  let top = Infinity;
  for (const ch of text) {
    const pattern = getCharPattern(ch);
    if (!pattern) continue;
    for (let row = 0; row < pattern.length; row++) {
      if (pattern[row].some((cell) => cell)) {
        if (row < top) top = row;
        break;
      }
    }
    if (top === 0) return 0;
  }
  return top === Infinity ? 0 : top;
}
function getTextDimensions(text) {
  let width = 0;
  let height = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    width += getCharWidth(char);
    if (i < text.length - 1) {
      width += 1;
    }
    const pattern = getCharPattern(char);
    if (pattern && pattern.length > height) {
      height = pattern.length;
    }
  }
  return { width, height };
}
function getCharPattern(char) {
  let pattern = PIXEL_FONT[char];
  if (!pattern) {
    pattern = PIXEL_FONT[char.toUpperCase()];
  }
  return pattern;
}
const boundariesCache = /* @__PURE__ */ new Map();
function getCharacterBoundaries(char) {
  const cached = boundariesCache.get(char);
  if (cached) return cached;
  const pattern = PIXEL_FONT[char];
  if (!pattern || pattern.length === 0) {
    const empty = { external: [], internal: [] };
    boundariesCache.set(char, empty);
    return empty;
  }
  const height = pattern.length;
  const width = pattern[0].length;
  const paddedH = height + 2;
  const paddedW = width + 2;
  const padded = [];
  for (let y = 0; y < paddedH; y++) {
    padded[y] = [];
    for (let x = 0; x < paddedW; x++) {
      if (y >= 1 && y <= height && x >= 1 && x <= width) {
        padded[y][x] = pattern[y - 1][x - 1];
      } else {
        padded[y][x] = false;
      }
    }
  }
  const external = [];
  for (let y = 0; y < paddedH; y++) {
    external[y] = new Array(paddedW).fill(false);
  }
  const queue = [[0, 0]];
  external[0][0] = true;
  const dirs = [
    [-1, 0],
    [0, 1],
    [1, 0],
    [0, -1]
  ];
  while (queue.length > 0) {
    const [cy, cx] = queue.shift();
    for (const [dy, dx] of dirs) {
      const ny = cy + dy;
      const nx = cx + dx;
      if (ny >= 0 && ny < paddedH && nx >= 0 && nx < paddedW) {
        if (!padded[ny][nx] && !external[ny][nx]) {
          external[ny][nx] = true;
          queue.push([ny, nx]);
        }
      }
    }
  }
  const sideMap = [
    [-1, 0, "top"],
    // N neighbor means entry from top
    [0, 1, "right"],
    // E neighbor means entry from right
    [1, 0, "bottom"],
    // S neighbor means entry from bottom
    [0, -1, "left"]
    // W neighbor means entry from left
  ];
  const filledRegionAssigned = [];
  for (let y = 0; y < height; y++) {
    filledRegionAssigned[y] = new Array(width).fill(-1);
  }
  const filledRegions = [];
  let filledRegionId = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pattern[y][x] && filledRegionAssigned[y][x] === -1) {
        const regionCells = [];
        const regionQueue = [[y, x]];
        filledRegionAssigned[y][x] = filledRegionId;
        while (regionQueue.length > 0) {
          const [cy, cx] = regionQueue.shift();
          regionCells.push([cy, cx]);
          for (const [dy, dx] of dirs) {
            const ny = cy + dy;
            const nx = cx + dx;
            if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
              if (pattern[ny][nx] && filledRegionAssigned[ny][nx] === -1) {
                filledRegionAssigned[ny][nx] = filledRegionId;
                regionQueue.push([ny, nx]);
              }
            }
          }
        }
        filledRegions.push(regionCells);
        filledRegionId++;
      }
    }
  }
  const externalBoundaries = [];
  for (const regionCells of filledRegions) {
    const regionBoundary = [];
    for (const [y, x] of regionCells) {
      const py = y + 1;
      const px = x + 1;
      for (const [dy, dx, side] of sideMap) {
        const ny = py + dy;
        const nx = px + dx;
        if (external[ny][nx]) {
          regionBoundary.push({ x, y, side });
        }
      }
    }
    if (regionBoundary.length > 0) {
      externalBoundaries.push(regionBoundary);
    }
  }
  const internalRegions = [];
  const regionAssigned = [];
  for (let y = 0; y < paddedH; y++) {
    regionAssigned[y] = new Array(paddedW).fill(-1);
  }
  let regionId = 0;
  for (let y = 1; y <= height; y++) {
    for (let x = 1; x <= width; x++) {
      if (!padded[y][x] && !external[y][x] && regionAssigned[y][x] === -1) {
        const regionCells = [];
        const regionQueue = [[y, x]];
        regionAssigned[y][x] = regionId;
        while (regionQueue.length > 0) {
          const [cy, cx] = regionQueue.shift();
          regionCells.push([cy, cx]);
          for (const [dy, dx] of dirs) {
            const ny = cy + dy;
            const nx = cx + dx;
            if (ny >= 1 && ny <= height && nx >= 1 && nx <= width) {
              if (!padded[ny][nx] && !external[ny][nx] && regionAssigned[ny][nx] === -1) {
                regionAssigned[ny][nx] = regionId;
                regionQueue.push([ny, nx]);
              }
            }
          }
        }
        const regionBoundary = [];
        const addedCells = /* @__PURE__ */ new Set();
        for (const [cy, cx] of regionCells) {
          for (const [dy, dx, side] of sideMap) {
            const ny = cy + dy;
            const nx = cx + dx;
            if (ny >= 1 && ny <= height && nx >= 1 && nx <= width && padded[ny][nx]) {
              const origY = ny - 1;
              const origX = nx - 1;
              const key = `${origX},${origY},${side}`;
              if (!addedCells.has(key)) {
                addedCells.add(key);
                const flippedSide = side === "top" ? "bottom" : side === "bottom" ? "top" : side === "left" ? "right" : "left";
                regionBoundary.push({ x: origX, y: origY, side: flippedSide });
              }
            }
          }
        }
        if (regionBoundary.length > 0) {
          internalRegions.push(regionBoundary);
        }
        regionId++;
      }
    }
  }
  const result = {
    external: externalBoundaries,
    internal: internalRegions
  };
  boundariesCache.set(char, result);
  return result;
}
function calculateEntryCountRange(boundarySize, isInternal) {
  if (boundarySize === 0) return { min: 0, max: 0 };
  const min = isInternal ? 1 : 3;
  const max = min + Math.floor(boundarySize / 6);
  return { min, max };
}
new Set(Object.keys(PIXEL_FONT));
var CellType = /* @__PURE__ */ ((CellType2) => {
  CellType2[CellType2["Normal"] = 0] = "Normal";
  CellType2[CellType2["Text"] = 1] = "Text";
  CellType2[CellType2["ZkText"] = 2] = "ZkText";
  CellType2[CellType2["CrownText"] = 3] = "CrownText";
  return CellType2;
})(CellType || {});
var Move = /* @__PURE__ */ ((Move2) => {
  Move2[Move2["Up"] = 0] = "Up";
  Move2[Move2["Right"] = 1] = "Right";
  Move2[Move2["Down"] = 2] = "Down";
  Move2[Move2["Left"] = 3] = "Left";
  return Move2;
})(Move || {});
const CHAR_HEIGHT = 8;
const CHAR_SPACING = 1;
const LINE_SPACING = 3;
const WORDMARK_MARGIN = 4;
const WRAP_WIDTH_CELLS = 50;
function isTextCell(cell) {
  return cell.cellType !== CellType.Normal;
}
function layoutText(text) {
  const words = text.split(/\s+/);
  const lines = [];
  let currentLine = "";
  for (const word of words) {
    if (currentLine === "") {
      currentLine = word;
    } else {
      const testLine = currentLine + " " + word;
      const testWidth = getTextDimensions(testLine).width;
      if (testWidth <= WRAP_WIDTH_CELLS) {
        currentLine = testLine;
      } else {
        lines.push(currentLine);
        currentLine = word;
      }
    }
  }
  if (currentLine) {
    lines.push(currentLine);
  }
  let maxWidth = 0;
  for (const line of lines) {
    const dims = getTextDimensions(line);
    maxWidth = Math.max(maxWidth, dims.width);
  }
  return {
    lines,
    width: maxWidth,
    height: lines.length * (CHAR_HEIGHT + LINE_SPACING) - LINE_SPACING,
    topOffset: lines.length > 0 ? getTextTopRow(lines[0]) : 0
  };
}
function calculateMazeDimensions(text) {
  const textLayout = layoutText(text);
  return {
    width: textLayout.width + WORDMARK_MARGIN * 2,
    height: textLayout.height - textLayout.topOffset + WORDMARK_MARGIN * 2,
    textLayout
  };
}
function createEmptyMaze(width, height) {
  const cells = [];
  for (let y = 0; y < height; y++) {
    cells[y] = [];
    for (let x = 0; x < width; x++) {
      cells[y][x] = {
        southWall: true,
        eastWall: true,
        cellType: CellType.Normal
      };
    }
  }
  return { cells, width, height };
}
function embedTextCells(maze, textLayout) {
  const { width, height, cells } = maze;
  const placements = [];
  const startX = Math.floor((width - textLayout.width) / 2);
  const startY = WORDMARK_MARGIN - textLayout.topOffset;
  let currentY = startY;
  for (const line of textLayout.lines) {
    const lineDims = getTextDimensions(line);
    let currentX = startX + Math.floor((textLayout.width - lineDims.width) / 2);
    for (const char of line) {
      const charPattern = getCharPattern(char);
      if (!charPattern) {
        currentX += 4;
        continue;
      }
      const charWidth = getCharWidth(char);
      placements.push({
        char,
        startX: currentX,
        startY: currentY,
        width: charWidth,
        height: CHAR_HEIGHT
      });
      const upperChar = char.toUpperCase();
      const isZkLetter = upperChar === "Z" || upperChar === "K";
      const isCrown = char === "♚";
      const cellType = isCrown ? CellType.CrownText : isZkLetter ? CellType.ZkText : CellType.Text;
      for (let py = 0; py < charPattern.length; py++) {
        for (let px = 0; px < charPattern[py].length; px++) {
          const cellX = currentX + px;
          const cellY = currentY + py;
          if (cellX >= 0 && cellX < width && cellY >= 0 && cellY < height) {
            if (charPattern[py][px]) {
              cells[cellY][cellX].cellType = cellType;
            }
          }
        }
      }
      currentX += charWidth + CHAR_SPACING;
    }
    currentY += CHAR_HEIGHT + LINE_SPACING;
  }
  return placements;
}
function createInternalLetterPaths(maze, placements, rng) {
  const { width, height, cells } = maze;
  for (const placement of placements) {
    const charPattern = getCharPattern(placement.char);
    if (!charPattern) continue;
    const textCells = [];
    for (let py = 0; py < charPattern.length; py++) {
      for (let px = 0; px < charPattern[py].length; px++) {
        if (charPattern[py][px]) {
          const cellX = placement.startX + px;
          const cellY = placement.startY + py;
          if (cellX >= 0 && cellX < width && cellY >= 0 && cellY < height) {
            textCells.push({ x: cellX, y: cellY });
          }
        }
      }
    }
    if (textCells.length === 0) continue;
    const parent = /* @__PURE__ */ new Map();
    const key = (p2) => `${p2.x},${p2.y}`;
    for (const cell of textCells) {
      parent.set(key(cell), key(cell));
    }
    const find = (k) => {
      if (parent.get(k) !== k) {
        parent.set(k, find(parent.get(k)));
      }
      return parent.get(k);
    };
    const union = (a, b) => {
      const pa = find(a);
      const pb = find(b);
      if (pa === pb) return false;
      parent.set(pa, pb);
      return true;
    };
    const walls = [];
    for (const cell of textCells) {
      const southPos = { x: cell.x, y: cell.y + 1 };
      if (textCells.some((c) => c.x === southPos.x && c.y === southPos.y)) {
        walls.push({ from: cell, to: southPos, direction: "S" });
      }
      const eastPos = { x: cell.x + 1, y: cell.y };
      if (textCells.some((c) => c.x === eastPos.x && c.y === eastPos.y)) {
        walls.push({ from: cell, to: eastPos, direction: "E" });
      }
    }
    const shuffled = rng.shuffle(walls);
    for (const wall of shuffled) {
      const fromKey = key(wall.from);
      const toKey = key(wall.to);
      if (union(fromKey, toKey)) {
        if (wall.direction === "S") {
          cells[wall.from.y][wall.from.x].southWall = false;
        } else {
          cells[wall.from.y][wall.from.x].eastWall = false;
        }
      }
    }
  }
}
function createLetterBoundaryWalls(maze) {
  const { width, height, cells } = maze;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = cells[y][x];
      if (isTextCell(cell)) {
        const sy = (y + 1) % height;
        if (!isTextCell(cells[sy][x])) {
          cell.southWall = true;
        }
        const ex = (x + 1) % width;
        if (!isTextCell(cells[y][ex])) {
          cell.eastWall = true;
        }
      } else {
        const sy = (y + 1) % height;
        if (isTextCell(cells[sy][x])) {
          cell.southWall = true;
        }
        const ex = (x + 1) % width;
        if (isTextCell(cells[y][ex])) {
          cell.eastWall = true;
        }
      }
    }
  }
}
function createLetterEntryPoints(maze, placements, rng) {
  const { width, height, cells } = maze;
  for (const placement of placements) {
    const boundaries = getCharacterBoundaries(placement.char);
    for (const filledRegion of boundaries.external) {
      const externalRange = calculateEntryCountRange(
        filledRegion.length,
        false
      );
      const numExternal = rng.nextInt(externalRange.min, externalRange.max);
      const selectedExternal = rng.shuffle(filledRegion).slice(0, numExternal);
      for (const entry of selectedExternal) {
        const cellX = placement.startX + entry.x;
        const cellY = placement.startY + entry.y;
        if (cellX < 0 || cellX >= width || cellY < 0 || cellY >= height)
          continue;
        removeWallForEntry(
          cells,
          cellX,
          cellY,
          entry.side,
          width,
          height,
          false
        );
      }
    }
    for (const region of boundaries.internal) {
      const internalRange = calculateEntryCountRange(region.length, true);
      const numInternal = rng.nextInt(internalRange.min, internalRange.max);
      const selectedInternal = rng.shuffle(region).slice(0, numInternal);
      for (const entry of selectedInternal) {
        const cellX = placement.startX + entry.x;
        const cellY = placement.startY + entry.y;
        if (cellX < 0 || cellX >= width || cellY < 0 || cellY >= height)
          continue;
        removeWallForEntry(
          cells,
          cellX,
          cellY,
          entry.side,
          width,
          height,
          true
        );
      }
    }
  }
}
function removeWallForEntry(cells, cellX, cellY, side, width, height, isInternal) {
  switch (side) {
    case "top": {
      const aboveY = cellY - 1;
      if (aboveY >= 0) {
        if (isInternal || !isTextCell(cells[aboveY][cellX])) {
          cells[aboveY][cellX].southWall = false;
        }
      }
      break;
    }
    case "bottom": {
      const belowY = (cellY + 1) % height;
      if (isInternal || !isTextCell(cells[belowY][cellX])) {
        cells[cellY][cellX].southWall = false;
      }
      break;
    }
    case "left": {
      const leftX = cellX - 1;
      if (leftX >= 0) {
        if (isInternal || !isTextCell(cells[cellY][leftX])) {
          cells[cellY][leftX].eastWall = false;
        }
      }
      break;
    }
    case "right": {
      const rightX = (cellX + 1) % width;
      if (isInternal || !isTextCell(cells[cellY][rightX])) {
        cells[cellY][cellX].eastWall = false;
      }
      break;
    }
  }
}
function generateNonTextMazePaths(maze, rng) {
  const { width, height, cells } = maze;
  const parent = [];
  const rank = [];
  for (let i = 0; i < width * height; i++) {
    parent[i] = i;
    rank[i] = 0;
  }
  function find(x) {
    if (parent[x] !== x) {
      parent[x] = find(parent[x]);
    }
    return parent[x];
  }
  function union(x, y) {
    const px = find(x);
    const py = find(y);
    if (px === py) return false;
    if (rank[px] < rank[py]) {
      parent[px] = py;
    } else if (rank[px] > rank[py]) {
      parent[py] = px;
    } else {
      parent[py] = px;
      rank[px]++;
    }
    return true;
  }
  function cellIndex(x, y) {
    return y * width + x;
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx1 = cellIndex(x, y);
      const sy = (y + 1) % height;
      if (!cells[y][x].southWall) {
        union(idx1, cellIndex(x, sy));
      }
      const ex = (x + 1) % width;
      if (!cells[y][x].eastWall) {
        union(idx1, cellIndex(ex, y));
      }
    }
  }
  const walls = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = cells[y][x];
      if (isTextCell(cell)) continue;
      const sy = (y + 1) % height;
      if (!isTextCell(cells[sy][x]) && cell.southWall) {
        walls.push({ x, y, direction: "S" });
      }
      const ex = (x + 1) % width;
      if (!isTextCell(cells[y][ex]) && cell.eastWall) {
        walls.push({ x, y, direction: "E" });
      }
    }
  }
  const shuffledWalls = rng.shuffle(walls);
  for (const wall of shuffledWalls) {
    const { x, y, direction } = wall;
    const idx1 = cellIndex(x, y);
    let nx, ny;
    if (direction === "S") {
      nx = x;
      ny = (y + 1) % height;
    } else {
      nx = (x + 1) % width;
      ny = y;
    }
    const idx2 = cellIndex(nx, ny);
    if (union(idx1, idx2)) {
      if (direction === "S") {
        cells[y][x].southWall = false;
      } else {
        cells[y][x].eastWall = false;
      }
    }
  }
}
function findValidPositions(maze, rng) {
  const { width, height, cells } = maze;
  const candidates = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isTextCell(cells[y][x])) {
        candidates.push({ x, y });
      }
    }
  }
  const pool = candidates.length >= 4 ? candidates : Array.from({ length: width * height }, (_, i) => ({
    x: i % width,
    y: Math.floor(i / width)
  }));
  const shuffled = rng.shuffle(pool);
  const kingPos = shuffled[0];
  let robePos = shuffled[1];
  for (const pos of shuffled.slice(1)) {
    const dist = Math.abs(pos.x - kingPos.x) + Math.abs(pos.y - kingPos.y);
    if (dist > width / 3) {
      robePos = pos;
      break;
    }
  }
  let scepterPos = shuffled[2];
  for (const pos of shuffled.slice(2)) {
    if (pos.x === kingPos.x && pos.y === kingPos.y || pos.x === robePos.x && pos.y === robePos.y) {
      continue;
    }
    const distKing = Math.abs(pos.x - kingPos.x) + Math.abs(pos.y - kingPos.y);
    const distRobe = Math.abs(pos.x - robePos.x) + Math.abs(pos.y - robePos.y);
    if (distKing > width / 3 && distRobe > width / 3) {
      scepterPos = pos;
      break;
    }
  }
  let goalPos = shuffled[3];
  for (const pos of shuffled.slice(3)) {
    if (pos.x === kingPos.x && pos.y === kingPos.y || pos.x === robePos.x && pos.y === robePos.y || pos.x === scepterPos.x && pos.y === scepterPos.y) {
      continue;
    }
    const distKing = Math.abs(pos.x - kingPos.x) + Math.abs(pos.y - kingPos.y);
    const distRobe = Math.abs(pos.x - robePos.x) + Math.abs(pos.y - robePos.y);
    const distScepter = Math.abs(pos.x - scepterPos.x) + Math.abs(pos.y - scepterPos.y);
    if (distKing > width / 4 && distRobe > width / 4 && distScepter > width / 4) {
      goalPos = pos;
      break;
    }
  }
  return { kingPos, robePos, scepterPos, goalPos };
}
const EXTRA_PATH_WALL_REMOVAL_RATIO = 0.02;
function removeExtraWallsForPathVariety(maze, rng) {
  const { width, height, cells } = maze;
  const candidates = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = cells[y][x];
      if (isTextCell(cell)) continue;
      if (cell.southWall && y < height - 1 && !isTextCell(cells[y + 1][x])) {
        candidates.push({ x, y, direction: "S" });
      }
      if (cell.eastWall && x < width - 1 && !isTextCell(cells[y][x + 1])) {
        candidates.push({ x, y, direction: "E" });
      }
    }
  }
  if (candidates.length === 0) return;
  const target = Math.max(
    1,
    Math.round(candidates.length * EXTRA_PATH_WALL_REMOVAL_RATIO)
  );
  const shuffled = rng.shuffle(candidates);
  for (let i = 0; i < target; i++) {
    const wall = shuffled[i];
    if (wall.direction === "S") {
      cells[wall.y][wall.x].southWall = false;
    } else {
      cells[wall.y][wall.x].eastWall = false;
    }
  }
}
const DEBUG_WALL_REMOVAL_PROBABILITY = 0.66;
function debugRemoveInternalWalls(maze, rng) {
  const { width, height, cells } = maze;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = cells[y][x];
      if (isTextCell(cell)) continue;
      if (cell.eastWall && x < width - 1) {
        const east = cells[y][x + 1];
        if (!isTextCell(east) && rng.next() < DEBUG_WALL_REMOVAL_PROBABILITY) {
          cell.eastWall = false;
        }
      }
      if (cell.southWall && y < height - 1) {
        const south = cells[y + 1][x];
        if (!isTextCell(south) && rng.next() < DEBUG_WALL_REMOVAL_PROBABILITY) {
          cell.southWall = false;
        }
      }
    }
  }
}
function generateMaze(seed, opts = {}) {
  const rng = createRng(seed);
  const { width, height, textLayout } = calculateMazeDimensions(seed);
  const maze = createEmptyMaze(width, height);
  const placements = embedTextCells(maze, textLayout);
  createInternalLetterPaths(maze, placements, rng);
  createLetterBoundaryWalls(maze);
  createLetterEntryPoints(maze, placements, rng);
  generateNonTextMazePaths(maze, rng);
  removeExtraWallsForPathVariety(maze, rng);
  if (opts.debug) {
    debugRemoveInternalWalls(maze, rng);
  }
  const { kingPos, robePos, scepterPos, goalPos } = findValidPositions(
    maze,
    rng
  );
  return { maze, kingPos, robePos, scepterPos, goalPos };
}
function canMove(maze, from, direction) {
  const { width, height, cells } = maze;
  const { x, y } = from;
  switch (direction) {
    case "up": {
      const aboveY = (y - 1 + height) % height;
      return !cells[aboveY][x].southWall;
    }
    case "down": {
      return !cells[y][x].southWall;
    }
    case "left": {
      const leftX = (x - 1 + width) % width;
      return !cells[y][leftX].eastWall;
    }
    case "right": {
      return !cells[y][x].eastWall;
    }
  }
}
function getNewPosition(maze, from, direction) {
  const { width, height } = maze;
  const { x, y } = from;
  switch (direction) {
    case "up":
      return { x, y: (y - 1 + height) % height };
    case "down":
      return { x, y: (y + 1) % height };
    case "left":
      return { x: (x - 1 + width) % width, y };
    case "right":
      return { x: (x + 1) % width, y };
  }
}
const DEBUG_SEED = "zkDEBUG";
function isLocalhost() {
  if (typeof window === "undefined") return false;
  return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}
function isDebugSeedActive(seed) {
  return seed === DEBUG_SEED && isLocalhost();
}
const MAX_PACKED_BYTES = 1500;
const LAYOUT_HEADER_BYTES = 20;
const LAYOUT_TOTAL_BYTES = 1520;
function encodeCell(cell) {
  let data = 0;
  if (cell.southWall) {
    data |= 8;
  }
  if (cell.eastWall) {
    data |= 4;
  }
  data |= cell.cellType & 3;
  return data;
}
function packCells(evenCell, oddCell) {
  return (evenCell & 15) << 4 | oddCell & 15;
}
function serializeForZk(maze, startPos, robePos, scepterPos, goalPos) {
  const { width, height, cells } = maze;
  const encodedCells = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      encodedCells.push(encodeCell(cells[y][x]));
    }
  }
  const packedCells = [];
  for (let i = 0; i < encodedCells.length; i += 2) {
    const evenCell = encodedCells[i];
    const oddCell = i + 1 < encodedCells.length ? encodedCells[i + 1] : 0;
    packedCells.push(packCells(evenCell, oddCell));
  }
  return {
    width,
    height,
    startX: startPos.x,
    startY: startPos.y,
    robeX: robePos.x,
    robeY: robePos.y,
    scepterX: scepterPos.x,
    scepterY: scepterPos.y,
    goalX: goalPos.x,
    goalY: goalPos.y,
    packedCells
  };
}
function serializeLayoutBytes(seedOrZk) {
  const zk = typeof seedOrZk === "string" ? (() => {
    const { maze, kingPos, robePos, scepterPos, goalPos } = generateMaze(
      seedOrZk,
      {
        debug: isDebugSeedActive(seedOrZk)
      }
    );
    return serializeForZk(maze, kingPos, robePos, scepterPos, goalPos);
  })() : seedOrZk;
  const out = new Uint8Array(LAYOUT_TOTAL_BYTES);
  const header = [
    zk.width,
    zk.height,
    zk.startX,
    zk.startY,
    zk.robeX,
    zk.robeY,
    zk.scepterX,
    zk.scepterY,
    zk.goalX,
    zk.goalY
  ];
  for (let i = 0; i < 10; i++) {
    out[i * 2] = header[i] >> 8 & 255;
    out[i * 2 + 1] = header[i] & 255;
  }
  for (let i = 0; i < zk.packedCells.length && i < MAX_PACKED_BYTES; i++) {
    out[LAYOUT_HEADER_BYTES + i] = zk.packedCells[i] & 255;
  }
  return out;
}
function computeTokenIdFromMazeHash(mazeHash) {
  if (!mazeHash) throw new Error("mazeHash is required");
  const clean = mazeHash.startsWith("0x") ? mazeHash : `0x${mazeHash}`;
  return BigInt(clean);
}
function frToBytes32(fr) {
  const buf = fr.toBuffer();
  let hex = "";
  for (let i = 0; i < buf.length; i++) {
    hex += buf[i].toString(16).padStart(2, "0");
  }
  return `0x${hex.padStart(64, "0")}`;
}
const PEDERSEN_FIELD_BYTES = 31;
const LAYOUT_FIELD_COUNT = Math.ceil(LAYOUT_TOTAL_BYTES / PEDERSEN_FIELD_BYTES);
let initPromise = null;
async function getApi() {
  if (!initPromise) {
    initPromise = BarretenbergSync.initSingleton();
  }
  return initPromise;
}
function layoutToFields(layout) {
  if (layout.length !== LAYOUT_TOTAL_BYTES) {
    throw new Error(
      `mazeIdentity: layout must be ${LAYOUT_TOTAL_BYTES} bytes, got ${layout.length}`
    );
  }
  const fields = new Array(LAYOUT_FIELD_COUNT);
  for (let f = 0; f < LAYOUT_FIELD_COUNT; f++) {
    let acc = 0n;
    for (let j = 0; j < PEDERSEN_FIELD_BYTES; j++) {
      const idx = f * PEDERSEN_FIELD_BYTES + j;
      const byte = idx < LAYOUT_TOTAL_BYTES ? layout[idx] : 0;
      acc = acc * 256n + BigInt(byte);
    }
    fields[f] = new Fr(acc);
  }
  return fields;
}
async function computeMazeHash(layout) {
  const api = await getApi();
  const fields = layoutToFields(layout);
  const hash = api.pedersenHash(fields, 0);
  return frToBytes32(hash);
}
function s(rows) {
  return rows.map((row) => row.split("").map((c) => c === "#"));
}
s([
  "..####..",
  "..####..",
  "..####..",
  ".######.",
  ".######.",
  ".######.",
  ".##..##.",
  ".##..##."
]);
s([
  "..####.#",
  "..####.#",
  ".#######",
  ".######.",
  "########",
  "########",
  "########",
  ".######."
]);
s([
  "#...#...",
  // chipped — only 2 left spikes survive
  "##.#####",
  // band with a missing chunk top-left
  "........",
  "........",
  "........",
  "........",
  "........",
  "........"
]);
s([
  "#.#.#.#.",
  // 4 evenly spaced spikes
  "########",
  // solid band
  "........",
  "........",
  "........",
  "........",
  "........",
  "........"
]);
s([
  "#.#.#.#.",
  // same 4 spikes as plain
  "##.##.##",
  // band with 2 jewel notches
  "........",
  "........",
  "........",
  "........",
  "........",
  "........"
]);
s([
  "##.##.##",
  // 3 stout merlon spikes
  "########",
  // clean solid band
  "...##...",
  // single big jewel hanging below band
  "........",
  "........",
  "........",
  "........",
  "........"
]);
s([
  ".#.##.#.",
  // outer spikes shorter, twin tall center spikes
  "########",
  // ornate cresting (top band)
  "##.##.##",
  // jewel band
  "........",
  "........",
  "........",
  "........",
  "........"
]);
s([
  "...##...",
  // single sharp center antenna
  "#.####.#",
  // narrow geometric band with corner brackets
  "........",
  "........",
  "........",
  "........",
  "........",
  "........"
]);
s([
  "##..####",
  "##.#####",
  ".#######",
  ".#######",
  ".#######",
  ".#######",
  ".######.",
  ".##..##."
]);
s([
  "#.#.#.#.",
  "########",
  "#.#.#.#.",
  "########",
  "########",
  ".######.",
  "........",
  "........"
]);
const DIRS = ["up", "right", "down", "left"];
const DIR_TO_MOVE = {
  up: Move.Up,
  right: Move.Right,
  down: Move.Down,
  left: Move.Left
};
function findOptimalPath(maze, start, robe, scepter, goal) {
  const W = maze.width;
  const stateKey = (x, y, hasRobe, hasScepter) => y * W + x << 2 | hasRobe << 1 | hasScepter;
  const startHasRobe = start.x === robe.x && start.y === robe.y ? 1 : 0;
  const startHasScepter = start.x === scepter.x && start.y === scepter.y ? 1 : 0;
  const queue = [
    {
      x: start.x,
      y: start.y,
      hasRobe: startHasRobe,
      hasScepter: startHasScepter,
      parent: -1,
      move: -1
    }
  ];
  const visited = /* @__PURE__ */ new Set();
  visited.add(stateKey(start.x, start.y, startHasRobe, startHasScepter));
  let head = 0;
  while (head < queue.length) {
    const idx = head;
    const node = queue[head++];
    if (node.hasRobe === 1 && node.hasScepter === 1 && node.x === goal.x && node.y === goal.y) {
      const moves = [];
      let cur = idx;
      while (queue[cur].parent !== -1) {
        moves.push(queue[cur].move);
        cur = queue[cur].parent;
      }
      moves.reverse();
      return moves;
    }
    for (const dir of DIRS) {
      if (!canMove(maze, { x: node.x, y: node.y }, dir)) continue;
      const next = getNewPosition(maze, { x: node.x, y: node.y }, dir);
      const nextHasRobe = node.hasRobe === 1 || next.x === robe.x && next.y === robe.y ? 1 : 0;
      const nextHasScepter = node.hasScepter === 1 || next.x === scepter.x && next.y === scepter.y ? 1 : 0;
      const k = stateKey(next.x, next.y, nextHasRobe, nextHasScepter);
      if (visited.has(k)) continue;
      visited.add(k);
      queue.push({
        x: next.x,
        y: next.y,
        hasRobe: nextHasRobe,
        hasScepter: nextHasScepter,
        parent: idx,
        move: DIR_TO_MOVE[dir]
      });
    }
  }
  return null;
}
function bytesToHex(bytes) {
  let hex = "0x";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}
async function deriveMaze(seed) {
  const { maze, kingPos, robePos, scepterPos, goalPos } = generateMaze(seed, {
    debug: isDebugSeedActive(seed)
  });
  const zk = serializeForZk(maze, kingPos, robePos, scepterPos, goalPos);
  const layoutBytes = serializeLayoutBytes(zk);
  const mazeHash = await computeMazeHash(layoutBytes);
  const tokenId = computeTokenIdFromMazeHash(mazeHash);
  const path = findOptimalPath(maze, kingPos, robePos, scepterPos, goalPos);
  if (!path) {
    throw new Error(
      `Seed "${seed}" generated an unsolvable maze — refusing to register it. Registering an unsolvable maze would mean nobody can ever mint it.`
    );
  }
  return {
    layoutBytes,
    mazeHash,
    tokenId,
    optimalMoves: path.length,
    width: zk.width,
    height: zk.height
  };
}
const TYPES = {
  MazeAttestation: [
    { name: "mazeHash", type: "bytes32" },
    { name: "layoutHash", type: "bytes32" },
    { name: "optimalMoves", type: "uint32" }
  ]
};
async function signAttestation(seed, opts) {
  const { chainId, verifyingContract, privateKey } = opts;
  if (!chainId) throw new Error("chainId is required");
  if (!verifyingContract) throw new Error("verifyingContract is required");
  if (!privateKey) throw new Error("REGISTRAR_PRIVATE_KEY is not set");
  const derived = await deriveMaze(seed);
  const layout = bytesToHex(derived.layoutBytes);
  const account = privateKeyToAccount(privateKey);
  const signature = await account.signTypedData({
    domain: {
      name: "MazeKing",
      version: "1",
      chainId: Number(chainId),
      verifyingContract: getAddress(verifyingContract)
    },
    types: TYPES,
    primaryType: "MazeAttestation",
    message: {
      mazeHash: derived.mazeHash,
      layoutHash: keccak256(layout),
      optimalMoves: derived.optimalMoves
    }
  });
  return {
    seed,
    mazeHash: derived.mazeHash,
    tokenId: derived.tokenId.toString(),
    layout,
    optimalMoves: derived.optimalMoves,
    signature,
    registrar: account.address
  };
}
const HEADERS = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS"
};
async function handle(event) {
  if (event?.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: HEADERS, body: "" };
  }
  const fromBody = typeof event?.body === "string" ? JSON.parse(event.body).seed : event?.body?.seed;
  const seed = event?.queryStringParameters?.seed ?? fromBody;
  if (!seed || typeof seed !== "string") {
    return {
      statusCode: 400,
      headers: HEADERS,
      body: JSON.stringify({ error: "seed is required" })
    };
  }
  const chainId = process.env.CHAIN_ID;
  const verifyingContract = process.env.NFT_ADDRESS;
  const wantChain = event?.queryStringParameters?.chainId;
  const wantContract = event?.queryStringParameters?.contract;
  const mismatch = wantChain && wantChain !== String(chainId) || wantContract && wantContract.toLowerCase() !== String(verifyingContract).toLowerCase();
  if (mismatch) {
    return {
      statusCode: 409,
      headers: HEADERS,
      body: JSON.stringify({
        error: "this attestor signs for a different deployment",
        chainId,
        contract: verifyingContract
      })
    };
  }
  try {
    const result = await signAttestation(seed, {
      chainId,
      verifyingContract,
      privateKey: process.env.REGISTRAR_PRIVATE_KEY
    });
    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify(result)
    };
  } catch (err) {
    return {
      statusCode: 422,
      headers: HEADERS,
      body: JSON.stringify({
        error: err instanceof Error ? err.message : String(err)
      })
    };
  }
}
function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
if (arg("--seed")) {
  signAttestation(arg("--seed"), {
    chainId: arg("--chain-id", process.env.CHAIN_ID),
    verifyingContract: arg("--contract", process.env.NFT_ADDRESS),
    privateKey: process.env.REGISTRAR_PRIVATE_KEY
  }).then((r) => console.log(JSON.stringify(r, null, 2))).catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
export {
  handle,
  signAttestation
};
