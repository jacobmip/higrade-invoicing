#!/bin/bash
set -e

# Require a commit message
if [ -z "$1" ]; then
  echo "Usage: ./backup-and-push.sh \"your commit message\""
  exit 1
fi

COMMIT_MSG="$1"

# Backup App.jsx with timestamp
mkdir -p backups
TIMESTAMP=$(date +"%Y-%m-%d-%H%M")
BACKUP="backups/App.jsx.backup-${TIMESTAMP}"
cp src/App.jsx "$BACKUP"
echo "✓ Backed up src/App.jsx → $BACKUP"

# Commit and push
git add -A
git commit -m "${COMMIT_MSG}

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
git push
echo "✓ Pushed to GitHub"
