#!/bin/sh
set -e

FLAG_VALUE="${FLAG:-flag{dev-flag}}"

printf '%s' "$FLAG_VALUE" > /flag.txt
chown ctfuser:ctfuser /flag.txt
chmod 400 /flag.txt

unset FLAG

exec gosu ctfuser "$@"