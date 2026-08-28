#!/bin/sh
set -eu

touch /tmp/noneedwork-ready
exec "$@"
