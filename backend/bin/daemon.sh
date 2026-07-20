#!/bin/sh
# NearlyFreeSpeech daemon entry point for the stats collector.
#
# Register via Site -> Manage Daemons with this file as the "Command Line".
# It polls every configured airport every 30s, forever; NFS restarts it if it
# dies. Uses absolute paths so the daemon's working directory doesn't matter.
#
# If "php: not found", set the full path below (find it over SSH with: which php;
# it's usually /usr/local/bin/php on NFS).

exec php /home/protected/backend/bin/collect.php --forever --every 30 --all
