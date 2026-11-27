// GET /summary: the counts a dashboard shows.

import { isOverdue } from './dates.mjs';

/** `day` is today's date. */
export function summarize(todos, day) {
  const open = todos.filter((todo) => !todo.done);
  return {
    total: todos.length,
    done: todos.length - open.length,
    open: open.length,
    overdue: todos.filter((todo) => isOverdue(todo, day)).length,
    due_today: open.filter((todo) => todo.due_date === day).length,
  };
}
