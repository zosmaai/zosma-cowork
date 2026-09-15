# Generation management, markers, and portable activation recipes
# ---------------------------------------------------------------------------

ensure_marker() {
  # Marks an installer-owned directory without overwriting a foreign marker.
  if [ -e "$1/$MARKER_NAME" ] || [ -L "$1/$MARKER_NAME" ]; then
    is_marked_dir "$1" || return 1
  fi
  if [ ! -d "$1" ]; then
    mkdir -p "$1"
    chmod 700 "$1"
  fi
  printf '%s\n' "$MARKER_LINE" > "$1/$MARKER_NAME"
  chmod 600 "$1/$MARKER_NAME"
}

is_marked_dir() {
  [ -f "$1/$MARKER_NAME" ] && [ "$(cat "$1/$MARKER_NAME" 2>/dev/null)" = "$MARKER_LINE" ]
}

mark_root_tree() {
  # Marks each given directory and its parents down to $2 (inclusive),
  # skipping the intermediate `generations` container (not installer-owned).
  d=$1
  while :; do
    ensure_marker "$d"
    [ "$d" = "$2" ] && break
    [ "$d" = "/" ] && break
    parent=${d%/*}
    if [ "$(basename "$d")" = "generations" ]; then
      d=$parent
      continue
    fi
    d=$parent
  done
}

gen_children() {
  # Prints existing generation directory names under $1, sorted ascending.
  [ -d "$1" ] || return 0
  for d in "$1"/*; do
    [ -d "$d" ] || continue
    printf '%s\n' "${d##*/}"
  done | sort
}

new_generation_dir() {
  # Prints a fresh unique generation directory name under $1.
  n=1
  while :; do
    cand=$(printf 'generation-%04d' "$n")
    [ ! -e "$1/$cand" ] && { printf '%s\n' "$cand"; return 0; }
    n=$((n + 1))
  done
}

replace_link() {
  # Portable same-basename link replacement: creates a temporary sibling
  # directory, a symlink with the final basename, moves it over the target
  # parent, then removes the temporary directory. Never passes the existing
  # link as a directory operand (no GNU-only `mv -T`).
  target=$1
  parent=$2
  basename=$3
  tmpdir=$(mktemp -d "$parent/.link.XXXXXX") || return 1
  ln -s "$target" "$tmpdir/$basename" 2>/dev/null || { rm -rf "$tmpdir"; return 1; }
  mv -f "$tmpdir/$basename" "$parent/" 2>/dev/null || { rm -rf "$tmpdir"; return 1; }
  rmdir "$tmpdir" 2>/dev/null || :
  return 0
}

file_replace() {
  # Atomic regular-file replacement: $1 = source file, $2 = destination dir,
  # $3 = final basename. The result is a regular file with mode 0600.
  tmpdir=$(mktemp -d "$2/.atomic.XXXXXX") || return 1
  cp "$1" "$tmpdir/$3" 2>/dev/null || { rm -rf "$tmpdir"; return 1; }
  chmod 600 "$tmpdir/$3"
  mv -f "$tmpdir/$3" "$2/" 2>/dev/null || { rm -rf "$tmpdir"; return 1; }
  rmdir "$tmpdir" 2>/dev/null || :
  return 0
}

# ---------------------------------------------------------------------------
# Secrets generation (reads /dev/urandom through curated utilities)
# ---------------------------------------------------------------------------

gen_hex() {
  # $1 = number of hex chars
  raw=$(dd if=/dev/urandom bs=64 count=1 2>/dev/null | od -An -v -tx1 | tr -d ' \n')
  printf '%s\n' "$raw" | cut -c1-"$1"
}

