#!/bin/sh
set -eu
chown node:node /data
chmod 700 /data
exec setpriv --reuid=node --regid=node --init-groups node --import tsx server/index.ts --production
