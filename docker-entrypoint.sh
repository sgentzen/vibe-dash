#!/bin/sh
# Ensure the data volume is writable by the unprivileged `node` user, then drop
# privileges. Runs as root so it can fix ownership on pre-existing named volumes
# created by an earlier image revision (a build-time chown can't reach those —
# the volume mounts over the chowned directory).
set -e

chown -R node:node /data
exec su-exec node "$@"
