#!/bin/sh
set -eu

cp -R /seed/. /workspace/
touch /tmp/noneedwork-ready
exec "$@"
