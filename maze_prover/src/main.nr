mod types;
mod position;
mod walls;
mod hash;
mod fixtures_codegen;

use hash::compute_maze_hash;
use position::next_position;
use types::{Cell, DIR_DOWN, DIR_LEFT, DIR_RIGHT, DIR_UP, Position};
use walls::can_move;

// Maximum cells supported
global MAX_MAZE_CELLS: u32 = 3000;
// Maximum packed bytes (2 cells per byte)
global MAX_PACKED_BYTES: u32 = MAX_MAZE_CELLS / 2;
// Maximum moves supported
global MAX_MOVES: u32 = 1000;

// Verify that a sequence of moves:
// 1. Never passes through walls
// 2. Passes through BOTH the robe and scepter positions (in any order)
// 3. Ends at the goal position
//
// Pure path-validity check; no hash binding. Used both by `main` (after
// the hash binding) and directly by tests.
pub fn verify_solution(
    width: u16,
    height: u16,
    start_x: u16,
    start_y: u16,
    robe_x: u16,
    robe_y: u16,
    scepter_x: u16,
    scepter_y: u16,
    goal_x: u16,
    goal_y: u16,
    packed_cells: [u8; MAX_PACKED_BYTES],
    move_count: u32,
    moves: [u8; MAX_MOVES],
) {
    // Validate dimensions
    let total_cells = (width as u32) * (height as u32);
    assert(total_cells <= MAX_MAZE_CELLS);
    assert(move_count <= MAX_MOVES);
    assert(width > 0);
    assert(height > 0);

    // Validate starting position is within bounds
    assert(start_x < width);
    assert(start_y < height);

    // Initialize state
    let mut pos = Position::new(start_x, start_y);
    let mut has_robe = false;
    let mut has_scepter = false;

    let robe_pos = Position::new(robe_x, robe_y);
    let scepter_pos = Position::new(scepter_x, scepter_y);
    let goal_pos = Position::new(goal_x, goal_y);

    // Check if we start on robe / scepter
    if pos.equals(robe_pos) {
        has_robe = true;
    }
    if pos.equals(scepter_pos) {
        has_scepter = true;
    }

    // Process each move
    for i in 0..MAX_MOVES {
        if i < move_count {
            let direction = moves[i];

            // Validate direction
            assert(direction <= DIR_LEFT);

            // Check wall - movement must be allowed
            assert(can_move(packed_cells, pos, direction, width, height));

            // Update position
            pos = next_position(pos, direction, width, height);

            // Check if we collected robe or scepter
            if pos.equals(robe_pos) {
                has_robe = true;
            }
            if pos.equals(scepter_pos) {
                has_scepter = true;
            }
        }
    }

    // Final assertions: both regalia pieces must be collected, then the goal.
    assert(has_robe);
    assert(has_scepter);
    assert(pos.equals(goal_pos));
}

// Main proof entry point.
//
// Public inputs (committed to in the verifier):
//   maze_hash:  Pedersen hash of the canonical layout (see hash.nr)
//   move_count: number of moves used in the solution
//   sender:     address that will submit the mint, as a field element. Not
//               constrained in-circuit — committing it is the point: a proof
//               only verifies against the public inputs it was made for, so
//               binding the address stops the proof being a bearer credential
//               that a mempool observer could lift and front-run.
//
// Private inputs (witness only):
//   width/height, start/robe/scepter/goal positions, packed cell layout,
//   the move sequence. The Pedersen hash binds them to `maze_hash`.
fn main(
    maze_hash: pub Field,
    move_count: pub u32,
    sender: pub Field,
    width: u16,
    height: u16,
    start_x: u16,
    start_y: u16,
    robe_x: u16,
    robe_y: u16,
    scepter_x: u16,
    scepter_y: u16,
    goal_x: u16,
    goal_y: u16,
    packed_cells: [u8; MAX_PACKED_BYTES],
    moves: [u8; MAX_MOVES],
) {
    // Bind the caller. `sender` is deliberately unconstrained in-circuit: a
    // SNARK proof is valid only for the exact public-input vector it was
    // produced against, so committing the address here is what stops a proof
    // from being a bearer credential. The contract supplies
    // `bytes32(uint160(msg.sender))` as this input, so a proof lifted from
    // someone else's calldata fails verification for the thief.
    let _ = sender;

    // Bind the public maze_hash to the private layout witness. After
    // this assertion, mutating any byte of the layout invalidates the
    // proof.
    let computed = compute_maze_hash(
        width,
        height,
        start_x,
        start_y,
        robe_x,
        robe_y,
        scepter_x,
        scepter_y,
        goal_x,
        goal_y,
        packed_cells,
    );
    assert(computed == maze_hash);

    verify_solution(
        width,
        height,
        start_x,
        start_y,
        robe_x,
        robe_y,
        scepter_x,
        scepter_y,
        goal_x,
        goal_y,
        packed_cells,
        move_count,
        moves,
    );
}

// ============================================================================
// Integration Tests
// ============================================================================

// Helper to pack two 4-bit cells into a byte
fn pack_cells(even: u8, odd: u8) -> u8 {
    ((even & 0x0F) << 4) | (odd & 0x0F)
}

// Simple 4x4 test maze with a clear path
// Path: (0,0) -> Right x3 to (3,0) [robe] -> Down x3 to (3,3) -> Left to
// (2,3) [scepter @ (1,3)? no -- make scepter en route] -> ...
//
// We use a different layout from the original: open corridor along the top
// row collects the robe, descent down column 3 to (3,3), then leftward
// across the bottom to pick up the scepter at (0,3) and end at (2,3) goal.
// To keep the tests simple and verify the new dual-collection rule, we use
// a fully-open 4x4 (no walls) and exercise paths over it.
fn create_4x4_test_maze() -> [u8; 8] {
    // 16 cells -> 8 packed bytes, all with no walls (open).
    let c = Cell::from_parts(false, false, 0).data;

    let mut packed: [u8; 8] = [0; 8];
    for i in 0..8 {
        packed[i] = pack_cells(c, c);
    }
    packed
}

#[test]
fn test_valid_4x4_solution_robe_first() {
    // Open 4x4. start=(0,0), robe=(3,0), scepter=(0,3), goal=(2,3).
    // Path: R,R,R,D,D,D,L,L,L (collect robe at (3,0), traverse to (3,3) then
    // wrap-left to (0,3) collecting scepter, then R,R to (2,3) goal).
    // Simpler: R R R (now robe), D D D (now (3,3)), L (now (2,3) goal but no
    // scepter yet) -- bad. Use:  D D D L L L (scepter at (0,3) collected via
    // (0,1)(0,2)(0,3), then wrap-left? No -- open 4x4 is toroidal. Try this:
    //   R R R D D D  -> now at (3,3) with robe collected.
    //   L L L        -> walks to (0,3) collecting scepter.
    //   R R          -> (2,3) goal.
    let cells = create_4x4_test_maze();

    let mut padded_cells: [u8; MAX_PACKED_BYTES] = [0; MAX_PACKED_BYTES];
    for i in 0..8 {
        padded_cells[i] = cells[i];
    }

    let mut moves: [u8; MAX_MOVES] = [0; MAX_MOVES];
    moves[0] = DIR_RIGHT; // (1,0)
    moves[1] = DIR_RIGHT; // (2,0)
    moves[2] = DIR_RIGHT; // (3,0) robe
    moves[3] = DIR_DOWN; // (3,1)
    moves[4] = DIR_DOWN; // (3,2)
    moves[5] = DIR_DOWN; // (3,3)
    moves[6] = DIR_LEFT; // (2,3)
    moves[7] = DIR_LEFT; // (1,3)
    moves[8] = DIR_LEFT; // (0,3) scepter
    moves[9] = DIR_RIGHT; // (1,3)
    moves[10] = DIR_RIGHT; // (2,3) goal

    verify_solution(4, 4, 0, 0, 3, 0, 0, 3, 2, 3, padded_cells, 11, moves);
}

#[test]
fn test_valid_4x4_solution_scepter_first() {
    // Same maze, scepter collected before robe -- must still pass.
    let cells = create_4x4_test_maze();

    let mut padded_cells: [u8; MAX_PACKED_BYTES] = [0; MAX_PACKED_BYTES];
    for i in 0..8 {
        padded_cells[i] = cells[i];
    }

    let mut moves: [u8; MAX_MOVES] = [0; MAX_MOVES];
    moves[0] = DIR_DOWN; // (0,1)
    moves[1] = DIR_DOWN; // (0,2)
    moves[2] = DIR_DOWN; // (0,3) scepter
    moves[3] = DIR_UP; // (0,2)
    moves[4] = DIR_UP; // (0,1)
    moves[5] = DIR_UP; // (0,0)
    moves[6] = DIR_RIGHT; // (1,0)
    moves[7] = DIR_RIGHT; // (2,0)
    moves[8] = DIR_RIGHT; // (3,0) robe
    moves[9] = DIR_DOWN; // (3,1)
    moves[10] = DIR_DOWN; // (3,2)
    moves[11] = DIR_DOWN; // (3,3)
    moves[12] = DIR_LEFT; // (2,3) goal

    verify_solution(4, 4, 0, 0, 3, 0, 0, 3, 2, 3, padded_cells, 13, moves);
}

#[test(should_fail)]
fn test_miss_robe() {
    // Walks scepter+goal but skips robe -- should fail.
    let cells = create_4x4_test_maze();

    let mut padded_cells: [u8; MAX_PACKED_BYTES] = [0; MAX_PACKED_BYTES];
    for i in 0..8 {
        padded_cells[i] = cells[i];
    }

    let mut moves: [u8; MAX_MOVES] = [0; MAX_MOVES];
    moves[0] = DIR_DOWN; // (0,1)
    moves[1] = DIR_DOWN; // (0,2)
    moves[2] = DIR_DOWN; // (0,3) scepter
    moves[3] = DIR_RIGHT; // (1,3)
    moves[4] = DIR_RIGHT; // (2,3) goal -- but no robe

    verify_solution(4, 4, 0, 0, 3, 0, 0, 3, 2, 3, padded_cells, 5, moves);
}

#[test(should_fail)]
fn test_miss_scepter() {
    // Walks robe+goal but skips scepter -- should fail.
    let cells = create_4x4_test_maze();

    let mut padded_cells: [u8; MAX_PACKED_BYTES] = [0; MAX_PACKED_BYTES];
    for i in 0..8 {
        padded_cells[i] = cells[i];
    }

    let mut moves: [u8; MAX_MOVES] = [0; MAX_MOVES];
    moves[0] = DIR_RIGHT; // (1,0)
    moves[1] = DIR_RIGHT; // (2,0)
    moves[2] = DIR_RIGHT; // (3,0) robe
    moves[3] = DIR_DOWN; // (3,1)
    moves[4] = DIR_DOWN; // (3,2)
    moves[5] = DIR_DOWN; // (3,3)
    moves[6] = DIR_LEFT; // (2,3) goal -- but no scepter

    verify_solution(4, 4, 0, 0, 3, 0, 0, 3, 2, 3, padded_cells, 7, moves);
}

#[test(should_fail)]
fn test_miss_both() {
    // Walks straight to goal, no robe and no scepter -- should fail.
    let cells = create_4x4_test_maze();

    let mut padded_cells: [u8; MAX_PACKED_BYTES] = [0; MAX_PACKED_BYTES];
    for i in 0..8 {
        padded_cells[i] = cells[i];
    }

    let mut moves: [u8; MAX_MOVES] = [0; MAX_MOVES];
    moves[0] = DIR_RIGHT; // (1,0)
    moves[1] = DIR_RIGHT; // (2,0)
    moves[2] = DIR_DOWN; // (2,1)
    moves[3] = DIR_DOWN; // (2,2)
    moves[4] = DIR_DOWN; // (2,3) goal

    verify_solution(4, 4, 0, 0, 3, 0, 0, 3, 2, 3, padded_cells, 5, moves);
}

#[test(should_fail)]
fn test_wrong_destination() {
    // Picks up both but ends at the wrong cell.
    let cells = create_4x4_test_maze();

    let mut padded_cells: [u8; MAX_PACKED_BYTES] = [0; MAX_PACKED_BYTES];
    for i in 0..8 {
        padded_cells[i] = cells[i];
    }

    let mut moves: [u8; MAX_MOVES] = [0; MAX_MOVES];
    moves[0] = DIR_RIGHT;
    moves[1] = DIR_RIGHT;
    moves[2] = DIR_RIGHT; // robe
    moves[3] = DIR_DOWN;
    moves[4] = DIR_DOWN;
    moves[5] = DIR_DOWN;
    moves[6] = DIR_LEFT;
    moves[7] = DIR_LEFT;
    moves[8] = DIR_LEFT; // scepter at (0,3)

    verify_solution(4, 4, 0, 0, 3, 0, 0, 3, 2, 3, padded_cells, 9, moves);
}

// ============================================================================
// Wraparound + start-on-collectable tests (open 3x3)
// ============================================================================

fn create_open_3x3() -> [u8; 5] {
    let c = Cell::from_parts(false, false, 0).data;
    let mut packed: [u8; 5] = [0; 5];
    packed[0] = pack_cells(c, c);
    packed[1] = pack_cells(c, c);
    packed[2] = pack_cells(c, c);
    packed[3] = pack_cells(c, c);
    packed[4] = pack_cells(c, 0);
    packed
}

#[test]
fn test_wrap_around_solution() {
    // 3x3 toroidal. start=(0,0), robe=(2,2), scepter=(2,0), goal=(1,1).
    let cells = create_open_3x3();
    let mut padded_cells: [u8; MAX_PACKED_BYTES] = [0; MAX_PACKED_BYTES];
    for i in 0..5 {
        padded_cells[i] = cells[i];
    }

    let mut moves: [u8; MAX_MOVES] = [0; MAX_MOVES];
    moves[0] = DIR_LEFT; // (0,0) -> (2,0) wrap, scepter
    moves[1] = DIR_DOWN; // (2,1)
    moves[2] = DIR_DOWN; // (2,2) robe
    moves[3] = DIR_LEFT; // (1,2)
    moves[4] = DIR_UP; // (1,1) goal

    verify_solution(3, 3, 0, 0, 2, 2, 2, 0, 1, 1, padded_cells, 5, moves);
}

#[test]
fn test_start_on_robe() {
    // Start on the robe; only need to fetch scepter then reach goal.
    let cells = create_open_3x3();
    let mut padded_cells: [u8; MAX_PACKED_BYTES] = [0; MAX_PACKED_BYTES];
    for i in 0..5 {
        padded_cells[i] = cells[i];
    }

    let mut moves: [u8; MAX_MOVES] = [0; MAX_MOVES];
    moves[0] = DIR_RIGHT; // (1,0) scepter
    moves[1] = DIR_DOWN; // (1,1) goal

    verify_solution(3, 3, 0, 0, 0, 0, 1, 0, 1, 1, padded_cells, 2, moves);
}

#[test]
fn test_start_on_both() {
    // Same cell for robe and scepter -- counts as both collected at start.
    let cells = create_open_3x3();
    let mut padded_cells: [u8; MAX_PACKED_BYTES] = [0; MAX_PACKED_BYTES];
    for i in 0..5 {
        padded_cells[i] = cells[i];
    }

    let mut moves: [u8; MAX_MOVES] = [0; MAX_MOVES];
    moves[0] = DIR_RIGHT;
    moves[1] = DIR_DOWN;

    verify_solution(3, 3, 0, 0, 0, 0, 0, 0, 1, 1, padded_cells, 2, moves);
}

// ============================================================================
// End-to-end main() test (hash binding + path validity)
// ============================================================================

#[test]
fn test_main_4x4_with_hash() {
    let cells = create_4x4_test_maze();

    let mut padded_cells: [u8; MAX_PACKED_BYTES] = [0; MAX_PACKED_BYTES];
    for i in 0..8 {
        padded_cells[i] = cells[i];
    }

    let mut moves: [u8; MAX_MOVES] = [0; MAX_MOVES];
    moves[0] = DIR_RIGHT;
    moves[1] = DIR_RIGHT;
    moves[2] = DIR_RIGHT; // robe
    moves[3] = DIR_DOWN;
    moves[4] = DIR_DOWN;
    moves[5] = DIR_DOWN;
    moves[6] = DIR_LEFT;
    moves[7] = DIR_LEFT;
    moves[8] = DIR_LEFT; // scepter at (0,3)
    moves[9] = DIR_RIGHT;
    moves[10] = DIR_RIGHT; // goal

    let h = compute_maze_hash(4, 4, 0, 0, 3, 0, 0, 3, 2, 3, padded_cells);

    main(h, 11, 0, 4, 4, 0, 0, 3, 0, 0, 3, 2, 3, padded_cells, moves);
}

#[test(should_fail)]
fn test_main_rejects_wrong_hash() {
    let cells = create_4x4_test_maze();

    let mut padded_cells: [u8; MAX_PACKED_BYTES] = [0; MAX_PACKED_BYTES];
    for i in 0..8 {
        padded_cells[i] = cells[i];
    }

    let mut moves: [u8; MAX_MOVES] = [0; MAX_MOVES];
    moves[0] = DIR_RIGHT;
    moves[1] = DIR_RIGHT;
    moves[2] = DIR_RIGHT;
    moves[3] = DIR_DOWN;
    moves[4] = DIR_DOWN;
    moves[5] = DIR_DOWN;
    moves[6] = DIR_LEFT;
    moves[7] = DIR_LEFT;
    moves[8] = DIR_LEFT;
    moves[9] = DIR_RIGHT;
    moves[10] = DIR_RIGHT;

    let truth = compute_maze_hash(4, 4, 0, 0, 3, 0, 0, 3, 2, 3, padded_cells);
    let bogus = truth + 1;

    main(bogus, 11, 0, 4, 4, 0, 0, 3, 0, 0, 3, 2, 3, padded_cells, moves);
}
