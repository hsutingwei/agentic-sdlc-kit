// Repository path globs, the way briefs, risk paths and rules write them:
//
//   **   any number of path segments, including none
//   *    any characters inside one segment
//   ?    one character inside one segment
//
// Paths are repository-relative with forward slashes; matching is case-sensitive,
// like git. Anything else is a literal character.

const cache = new Map();

export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      const segmentStart = i === 0 || glob[i - 1] === '/';
      i++;
      if (glob[i + 1] === '/' && segmentStart) {
        i++;
        re += '(?:.*/)?'; // "**/" also matches no directory at all
      } else {
        re += '.*';
      }
    } else if (c === '*') {
      re += '[^/]*';
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

/** True when the repository-relative `file` matches `glob`. Backslashes count as separators. */
export function matchesGlob(file, glob) {
  let re = cache.get(glob);
  if (!re) {
    re = globToRegExp(glob);
    cache.set(glob, re);
  }
  return re.test(file.replace(/\\/g, '/'));
}
