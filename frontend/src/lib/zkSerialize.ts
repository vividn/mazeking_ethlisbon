/**
 * ZK-friendly serialization for maze proofs.
 *
 * This module provides functions to serialize maze data in a format
 * compatible with the Noir maze_prover circuit.
 *
 * Cell encoding (4 bits per cell, packed 2 cells per byte):
 * - bit 3: southWall
 * - bit 2: eastWall
 * - bits 1-0: cellType (0=Normal, 1=Text, 2=ZkText, 3=CrownText)
 *
 * Byte packing: high nibble = even cell, low nibble = odd cell
 * Example: byte[0] contains cells[0] (high) and cells[1] (low)
 *
 * ⚠️ CONSENSUS-CRITICAL FILE — see ma-5yi
 *
 * The bit layout in `encodeCell`/`decodeCell`, the nibble packing in
 * `packCells`/`unpackCells`, and the row-major iteration order in
 * `serializeForZk` produce the byte stream that gets Pedersen-hashed into
 * mazeHash → tokenID. Reordering bits, nibbles, or cell-iteration changes
 * mint identity for every existing seed and silently breaks the Noir
 * circuit's `compute_maze_hash` agreement (see `maze_prover/src/main.nr`).
 *
 * Post-mainnet edits require a coordinated migration plan AND a
 * `consensus-critical-change: <bead-id>` line in the commit body.
 * The lint gate `just check-consensus-critical` enforces this; the related
 * gate `just check-abi-drift` catches Sol/circuit/TS shape divergence.
 */

import {
  CellType,
  type Cell,
  type MazeData,
  type Position,
  Move,
} from '../types';
import {
  MAX_MAZE_CELLS as _MAX_CELLS,
  MAX_PACKED_BYTES as _MAX_PACKED_BYTES,
  MAX_MOVES as _MAX_MOVES,
} from './mazeConstants.generated';
import type { ProverInputCircuit } from './proverInput.generated';

// Direction constants matching Noir
export const DIR_UP = 0;
export const DIR_RIGHT = 1;
export const DIR_DOWN = 2;
export const DIR_LEFT = 3;

/**
 * Encode a single cell into a 4-bit value.
 * bit 3: southWall, bit 2: eastWall, bits 1-0: cellType
 *
 * CONSENSUS-CRITICAL: bit layout must match the Noir circuit's cell decode
 * (see maze_prover/src/main.nr). Any reordering changes mazeHash → tokenID.
 */
export function encodeCell(cell: Cell): number {
  let data = 0;
  if (cell.southWall) {
    data |= 0x08; // bit 3
  }
  if (cell.eastWall) {
    data |= 0x04; // bit 2
  }
  data |= cell.cellType & 0x03; // bits 1-0
  return data;
}

/**
 * Decode a 4-bit cell value back to Cell structure.
 */
export function decodeCell(data: number): Cell {
  return {
    southWall: (data & 0x08) !== 0,
    eastWall: (data & 0x04) !== 0,
    cellType: (data & 0x03) as CellType,
  };
}

/**
 * Pack two 4-bit cells into one byte.
 * @param evenCell - Cell at even index (high nibble)
 * @param oddCell - Cell at odd index (low nibble)
 *
 * CONSENSUS-CRITICAL: high-nibble = even-index, low-nibble = odd-index. Swapping
 * nibble assignment changes every packed byte → mazeHash → tokenID.
 */
export function packCells(evenCell: number, oddCell: number): number {
  return ((evenCell & 0x0f) << 4) | (oddCell & 0x0f);
}

/**
 * Unpack a byte into two 4-bit cells.
 * @returns [evenCell, oddCell]
 */
export function unpackCells(byte: number): [number, number] {
  return [(byte >> 4) & 0x0f, byte & 0x0f];
}

/**
 * ZK maze data structure for proof generation.
 */
export interface ZkMazeData {
  width: number;
  height: number;
  startX: number;
  startY: number;
  robeX: number;
  robeY: number;
  scepterX: number;
  scepterY: number;
  goalX: number;
  goalY: number;
  packedCells: number[]; // Packed array (2 cells per byte)
}

/**
 * Serialize maze and positions into ZK-friendly format.
 */
export function serializeForZk(
  maze: MazeData,
  startPos: Position,
  robePos: Position,
  scepterPos: Position,
  goalPos: Position
): ZkMazeData {
  const { width, height, cells } = maze;

  // Encode all cells to 4-bit values (row-major order)
  const encodedCells: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      encodedCells.push(encodeCell(cells[y][x]));
    }
  }

  // Pack cells: 2 cells per byte
  const packedCells: number[] = [];
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
    packedCells,
  };
}

/**
 * Convert Move enum to direction constant.
 */
export function moveToDirection(move: Move): number {
  switch (move) {
    case Move.Up:
      return DIR_UP;
    case Move.Right:
      return DIR_RIGHT;
    case Move.Down:
      return DIR_DOWN;
    case Move.Left:
      return DIR_LEFT;
  }
}

/**
 * Convert Move[] to direction number array.
 */
export function serializeMoves(moves: Move[]): number[] {
  return moves.map(moveToDirection);
}

/**
 * Maximum cells supported by the prover.
 * @see mazeConstants.generated.ts (source of truth: maze-config.json)
 */
export const MAX_CELLS = _MAX_CELLS;

/**
 * Maximum packed bytes (MAX_CELLS / 2).
 * @see mazeConstants.generated.ts (source of truth: maze-config.json)
 */
export const MAX_PACKED_BYTES = _MAX_PACKED_BYTES;

/**
 * Maximum moves supported by the prover.
 * @see mazeConstants.generated.ts (source of truth: maze-config.json)
 */
export const MAX_MOVES = _MAX_MOVES;

/**
 * Prover input structure matching the Noir main function signature.
 *
 * Hash-as-public-input architecture (ma-6cr.6):
 *   Public:  maze_hash, move_count
 *   Private: width/height, start/key/goal positions, packed_cells, moves
 *
 * The shape is codegen'd from `maze_prover/target/maze_prover.json` (ma-7qm)
 * — the canonical TS source of truth lives in `proverInput.generated.ts`.
 * Adding/removing/renaming a circuit param and regenerating that file makes
 * any mismatch in `generateProverInput`'s return literal a TypeScript
 * compile error rather than nargo's runtime "input not found" (which
 * doesn't say *which* input). Sibling to the count-side gate in ma-3xv.
 *
 * Noir's InputMap is name-keyed, so field order in this object is irrelevant
 * to the witness; what matters is that every parameter declared in the
 * circuit's main() appears here.
 */
export type ProverInput = ProverInputCircuit;

/**
 * Generate prover input from maze data and solution path.
 *
 * @param zkMaze - ZK-serialized maze data
 * @param solutionMoves - Array of moves representing the solution
 * @param mazeHash - Pedersen hash of the canonical layout bytes (the proof's
 *                   first public input). Compute via `computeMazeHash()` in
 *                   `mazeIdentity.ts`; the circuit re-derives it from the
 *                   private witness and asserts equality.
 * @param sender - Address that will submit the mint. Bound as the third public
 *                 input so the proof is only valid for this account: proofs
 *                 travel in public calldata, and without this binding anyone
 *                 could lift one from the mempool and front-run the mint.
 *                 Must equal `msg.sender` of the `mintWithProof` call or
 *                 verification fails.
 * @returns ProverInput ready for Noir prover
 */
export function generateProverInput(
  zkMaze: ZkMazeData,
  solutionMoves: Move[],
  mazeHash: `0x${string}`,
  sender: `0x${string}`
): ProverInput {
  // Validate dimensions
  const totalCells = zkMaze.width * zkMaze.height;
  if (totalCells > MAX_CELLS) {
    throw new Error(
      `Maze too large: ${totalCells} cells exceeds max ${MAX_CELLS}`
    );
  }

  if (solutionMoves.length > MAX_MOVES) {
    throw new Error(
      `Too many moves: ${solutionMoves.length} exceeds max ${MAX_MOVES}`
    );
  }

  // Pad packed cells array to MAX_PACKED_BYTES
  const paddedPackedCells = [...zkMaze.packedCells];
  while (paddedPackedCells.length < MAX_PACKED_BYTES) {
    paddedPackedCells.push(0);
  }

  // Convert and pad moves array to MAX_MOVES
  const directions = serializeMoves(solutionMoves);
  const paddedMoves = [...directions];
  while (paddedMoves.length < MAX_MOVES) {
    paddedMoves.push(0);
  }

  return {
    maze_hash: mazeHash,
    move_count: solutionMoves.length,
    // Address as a field element. The contract supplies the identical value
    // via bytes32(uint256(uint160(msg.sender))); hex parsing is
    // case-insensitive, so a checksummed address is fine here.
    sender,
    width: zkMaze.width,
    height: zkMaze.height,
    start_x: zkMaze.startX,
    start_y: zkMaze.startY,
    robe_x: zkMaze.robeX,
    robe_y: zkMaze.robeY,
    scepter_x: zkMaze.scepterX,
    scepter_y: zkMaze.scepterY,
    goal_x: zkMaze.goalX,
    goal_y: zkMaze.goalY,
    packed_cells: paddedPackedCells,
    moves: paddedMoves,
  };
}

/**
 * Generate Prover.toml content for the Noir prover.
 *
 * @param input - ProverInput structure
 * @returns TOML string for Prover.toml
 */
export function generateProverToml(input: ProverInput): string {
  const lines: string[] = [];

  // Public inputs (hash-as-public-input architecture)
  lines.push(`maze_hash = "${input.maze_hash}"`);

  // Private witness inputs
  lines.push(`width = ${input.width}`);
  lines.push(`height = ${input.height}`);
  lines.push(`start_x = ${input.start_x}`);
  lines.push(`start_y = ${input.start_y}`);
  lines.push(`robe_x = ${input.robe_x}`);
  lines.push(`robe_y = ${input.robe_y}`);
  lines.push(`scepter_x = ${input.scepter_x}`);
  lines.push(`scepter_y = ${input.scepter_y}`);
  lines.push(`goal_x = ${input.goal_x}`);
  lines.push(`goal_y = ${input.goal_y}`);
  lines.push(`move_count = ${input.move_count}`);

  // Packed cells array
  lines.push(`packed_cells = [${input.packed_cells.join(', ')}]`);

  // Moves array (private)
  lines.push(`moves = [${input.moves.join(', ')}]`);

  return lines.join('\n');
}

/**
 * Create a simple test maze for demonstration.
 * This creates a 10x10 maze with a clear path that picks up robe at (9,0)
 * and scepter at (9,9) before reaching the goal at (5,9).
 */
export function createTestMaze(): {
  maze: MazeData;
  startPos: Position;
  robePos: Position;
  scepterPos: Position;
  goalPos: Position;
  solution: Move[];
} {
  const width = 10;
  const height = 10;

  // Initialize all cells with both walls
  const cells: Cell[][] = [];
  for (let y = 0; y < height; y++) {
    cells[y] = [];
    for (let x = 0; x < width; x++) {
      cells[y][x] = {
        southWall: true,
        eastWall: true,
        cellType: CellType.Normal,
      };
    }
  }

  // Create path: (0,0) -> right to (9,0) -> down to (9,9) -> left to (5,9)

  // Row 0: open corridor right (remove east walls)
  for (let x = 0; x < 9; x++) {
    cells[0][x].eastWall = false;
  }
  // (9,0) open down
  cells[0][9].southWall = false;

  // Column 9: open corridor down (remove south walls)
  for (let y = 1; y < 9; y++) {
    cells[y][9].southWall = false;
  }

  // Row 9: open corridor left from (9,9) to (5,9) (remove east walls from 4-8)
  for (let x = 4; x < 9; x++) {
    cells[9][x].eastWall = false;
  }

  const startPos: Position = { x: 0, y: 0 };
  const robePos: Position = { x: 9, y: 0 };
  const scepterPos: Position = { x: 9, y: 9 };
  const goalPos: Position = { x: 5, y: 9 };

  // Solution: Right x9 (robe), Down x9 (scepter), Left x4 (goal)
  const solution: Move[] = [];
  for (let i = 0; i < 9; i++) solution.push(Move.Right);
  for (let i = 0; i < 9; i++) solution.push(Move.Down);
  for (let i = 0; i < 4; i++) solution.push(Move.Left);

  return {
    maze: { width, height, cells },
    startPos,
    robePos,
    scepterPos,
    goalPos,
    solution,
  };
}

/**
 * Simulate a path and check if it's valid.
 * Returns true if the path collects both robe and scepter and ends at goal
 * without hitting walls.
 */
export function validatePath(
  maze: MazeData,
  startPos: Position,
  robePos: Position,
  scepterPos: Position,
  goalPos: Position,
  moves: Move[]
): { valid: boolean; error?: string } {
  let pos = { ...startPos };
  let hasRobe = pos.x === robePos.x && pos.y === robePos.y;
  let hasScepter = pos.x === scepterPos.x && pos.y === scepterPos.y;

  for (let i = 0; i < moves.length; i++) {
    const move = moves[i];

    // Check if movement is allowed
    if (!canMove(maze, pos, move)) {
      return {
        valid: false,
        error: `Move ${i}: Cannot move ${Move[move]} from (${pos.x}, ${pos.y}) - wall`,
      };
    }

    // Update position
    pos = getNewPosition(maze, pos, move);

    if (pos.x === robePos.x && pos.y === robePos.y) {
      hasRobe = true;
    }
    if (pos.x === scepterPos.x && pos.y === scepterPos.y) {
      hasScepter = true;
    }
  }

  if (!hasRobe) {
    return { valid: false, error: 'Path does not collect the robe' };
  }
  if (!hasScepter) {
    return { valid: false, error: 'Path does not collect the scepter' };
  }

  if (pos.x !== goalPos.x || pos.y !== goalPos.y) {
    return {
      valid: false,
      error: `Path ends at (${pos.x}, ${pos.y}), not goal (${goalPos.x}, ${goalPos.y})`,
    };
  }

  return { valid: true };
}

/**
 * Check if movement is allowed (no wall blocking).
 * Matches the Noir can_move function exactly.
 */
function canMove(maze: MazeData, from: Position, move: Move): boolean {
  const { width, height, cells } = maze;
  const { x, y } = from;

  switch (move) {
    case Move.Up: {
      const aboveY = (y - 1 + height) % height;
      return !cells[aboveY][x].southWall;
    }
    case Move.Down: {
      return !cells[y][x].southWall;
    }
    case Move.Left: {
      const leftX = (x - 1 + width) % width;
      return !cells[y][leftX].eastWall;
    }
    case Move.Right: {
      return !cells[y][x].eastWall;
    }
  }
}

/**
 * Get new position after a move (with toroidal wrapping).
 */
function getNewPosition(maze: MazeData, from: Position, move: Move): Position {
  const { width, height } = maze;
  const { x, y } = from;

  switch (move) {
    case Move.Up:
      return { x, y: (y - 1 + height) % height };
    case Move.Down:
      return { x, y: (y + 1) % height };
    case Move.Left:
      return { x: (x - 1 + width) % width, y };
    case Move.Right:
      return { x: (x + 1) % width, y };
  }
}
