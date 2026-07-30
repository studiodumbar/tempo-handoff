#!/bin/sh
# Guard against the one mistake this file keeps inviting: a backtick inside a
# GLSL comment. The shaders live in JS template literals, so a stray backtick
# closes the string and the whole module fails to parse with a message that
# points nowhere near the comment. Run before reloading after a shader edit.
#
#   sh tools/check-shaders.sh
#
# Exits non-zero and prints the offending lines if any backtick appears between
# the VERT/FRAG literal delimiters.

cd "$(dirname "$0")/.." || exit 2
awk '
  /^const (VERT|FRAG) = \/\* glsl \*\/ `$/ { inlit = 1; next }
  inlit && /^`;$/                         { inlit = 0; next }
  inlit && /`/                            { print FILENAME ":" NR ": " $0; bad = 1 }
  END { exit bad ? 1 : 0 }
' src/particles.js
if [ $? -ne 0 ]; then
  echo "^ backtick inside a shader literal — this will break the module parse" >&2
  exit 1
fi
echo "shader literals clean"
