// GET /summary: the counts a dashboard shows.

/** `day` is today's date. */
export function summarize(todos, day) {
  const open = todos.filter((todo) => !todo.done);
  return {
    total: todos.length,
    done: todos.length - open.length,
    open: open.length,
    overdue: open.filter((todo) => todo.due_date !== null && todo.due_date <= day).length,
    due_today: open.filter((todo) => todo.due_date === day).length,
  };
}
