export function mergeAssignmentBoardRows(boardRows = [], roster = []) {
  const rosterById = new Map(roster.map((student) => [student.id, student]));
  return boardRows.map((board) => ({
    ...(rosterById.get(board.student_id) || {}),
    ...board,
    board_file_id: board.id,
  }));
}
