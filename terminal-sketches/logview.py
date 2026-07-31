#!/usr/bin/env python3
"""
mpp-terminal log viewer.

Run this in a second terminal while `mpp.py` is running to watch a live,
timestamped stream of what the animation is doing: scene switches, pause /
restart / resize, the grid scene's phase transitions, and a ~1s heartbeat with
the measured frame rate.

Run:  python3 logview.py [logfile]

With no argument it follows the same file mpp.py writes to: $MPP_LOG if set,
otherwise `mpp.log` beside this script. It tails the file (like `tail -f`),
printing existing context first, then new lines as they arrive. Ctrl-C quits.
Because it just streams to stdout (no alternate screen), your terminal's normal
scrollback keeps the full history.
"""

import os
import sys
import time

TAIL_LINES = 25   # how many existing lines to show for context on startup
POLL = 0.15       # seconds between checks for new content


def log_path():
    if len(sys.argv) > 1:
        return sys.argv[1]
    return os.environ.get("MPP_LOG") or os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "mpp.log")


def main():
    path = log_path()
    sys.stdout.write("mpp log viewer — following %s\n" % path)
    sys.stdout.write("(start mpp.py in another terminal; Ctrl-C to quit)\n\n")
    sys.stdout.flush()

    # Wait for the file to exist (mpp.py may not have started yet).
    while not os.path.exists(path):
        try:
            time.sleep(POLL)
        except KeyboardInterrupt:
            return

    try:
        with open(path, "r") as f:
            # Show the last few lines for context, then follow the tail.
            existing = f.readlines()
            for line in existing[-TAIL_LINES:]:
                sys.stdout.write(line)
            sys.stdout.flush()

            inode = os.fstat(f.fileno()).st_ino
            while True:
                line = f.readline()
                if line:
                    sys.stdout.write(line)
                    sys.stdout.flush()
                    continue
                # No new data: nap, and handle the file being replaced.
                time.sleep(POLL)
                try:
                    if os.stat(path).st_ino != inode:
                        f.close()
                        return main()  # reopen the new file
                except OSError:
                    pass
    except KeyboardInterrupt:
        pass
    except BrokenPipeError:
        pass
    sys.stdout.write("\nstopped following.\n")


if __name__ == "__main__":
    main()
