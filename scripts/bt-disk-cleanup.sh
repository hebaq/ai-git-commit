#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/www/backup}"
LOG_DIR="${LOG_DIR:-/var/log}"
DOCKER_CONTAINER_DIR="${DOCKER_CONTAINER_DIR:-/var/lib/docker/containers}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"
JOURNAL_RETENTION="${JOURNAL_RETENTION:-7d}"
DOCKER_LOG_THRESHOLD_MB="${DOCKER_LOG_THRESHOLD_MB:-100}"
SHOW_TOP_COUNT="${SHOW_TOP_COUNT:-30}"

DO_CLEAN_BACKUPS=1
DO_CLEAN_JOURNAL=1
DO_CLEAN_ROTATED_LOGS=1
DO_CLEAN_DOCKER=1
DO_CLEAN_DOCKER_LOGS=1
DO_CLEAN_NPM_CACHE=1
DRY_RUN=0

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Options:
  --dry-run                  Only print planned actions
  --backup-days <days>       Delete backup files older than N days (default: ${BACKUP_RETENTION_DAYS})
  --journal-retention <age>  Keep systemd journal for this long (default: ${JOURNAL_RETENTION})
  --docker-log-mb <mb>       Truncate Docker json logs larger than this size in MB (default: ${DOCKER_LOG_THRESHOLD_MB})
  --backup-dir <path>        Backup directory (default: ${BACKUP_DIR})
  --log-dir <path>           Log directory (default: ${LOG_DIR})
  --top-count <count>        Show top N backup items in report (default: ${SHOW_TOP_COUNT})
  --skip-backups             Skip backup cleanup
  --skip-journal             Skip journal cleanup
  --skip-rotated-logs        Skip rotated log cleanup
  --skip-docker             Skip docker container/image prune
  --skip-docker-logs         Skip docker json log truncation
  --skip-npm                 Skip npm cache cleanup
  -h, --help                 Show this help

Environment overrides:
  BACKUP_DIR, LOG_DIR, DOCKER_CONTAINER_DIR,
  BACKUP_RETENTION_DAYS, JOURNAL_RETENTION,
  DOCKER_LOG_THRESHOLD_MB, SHOW_TOP_COUNT
EOF
}

log() {
  printf '[INFO] %s\n' "$*"
}

warn() {
  printf '[WARN] %s\n' "$*"
}

run_cmd() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '[DRY-RUN]'
    printf ' %q' "$@"
    printf '\n'
    return 0
  fi

  "$@"
}

report_disk_usage() {
  log "Disk usage"
  df -h
}

report_backup_usage() {
  if [[ ! -d "$BACKUP_DIR" ]]; then
    warn "Backup directory not found: $BACKUP_DIR"
    return 0
  fi

  log "Largest items under $BACKUP_DIR"
  du -sh "$BACKUP_DIR"/* 2>/dev/null | sort -h | tail -n "$SHOW_TOP_COUNT" || true
}

clean_backups() {
  if [[ "$DO_CLEAN_BACKUPS" -ne 1 ]]; then
    return 0
  fi

  if [[ ! -d "$BACKUP_DIR" ]]; then
    warn "Backup directory not found, skipping: $BACKUP_DIR"
    return 0
  fi

  log "Deleting backup files older than $BACKUP_RETENTION_DAYS days from $BACKUP_DIR"
  run_cmd find "$BACKUP_DIR" -type f -mtime "+$BACKUP_RETENTION_DAYS" -delete
}

clean_journal() {
  if [[ "$DO_CLEAN_JOURNAL" -ne 1 ]]; then
    return 0
  fi

  if ! command -v journalctl >/dev/null 2>&1; then
    warn "journalctl not found, skipping journal cleanup"
    return 0
  fi

  log "Vacuuming systemd journal to retain $JOURNAL_RETENTION"
  run_cmd journalctl --vacuum-time="$JOURNAL_RETENTION"
}

clean_rotated_logs() {
  if [[ "$DO_CLEAN_ROTATED_LOGS" -ne 1 ]]; then
    return 0
  fi

  if [[ ! -d "$LOG_DIR" ]]; then
    warn "Log directory not found, skipping: $LOG_DIR"
    return 0
  fi

  log "Deleting compressed and rotated logs under $LOG_DIR"
  run_cmd find "$LOG_DIR" -type f -name '*.gz' -delete
  run_cmd find "$LOG_DIR" -type f -name '*.1' -delete
}

clean_docker() {
  if [[ "$DO_CLEAN_DOCKER" -ne 1 ]]; then
    return 0
  fi

  if ! command -v docker >/dev/null 2>&1; then
    warn "docker not found, skipping docker prune"
    return 0
  fi

  log "Pruning stopped containers"
  run_cmd docker container prune -f

  log "Pruning unused images"
  run_cmd docker image prune -a -f
}

clean_docker_logs() {
  if [[ "$DO_CLEAN_DOCKER_LOGS" -ne 1 ]]; then
    return 0
  fi

  if [[ ! -d "$DOCKER_CONTAINER_DIR" ]]; then
    warn "Docker container directory not found, skipping: $DOCKER_CONTAINER_DIR"
    return 0
  fi

  local threshold_bytes
  threshold_bytes=$((DOCKER_LOG_THRESHOLD_MB * 1024 * 1024))

  log "Truncating Docker json logs larger than ${DOCKER_LOG_THRESHOLD_MB}MB"
  while IFS= read -r -d '' file; do
    if [[ "$DRY_RUN" -eq 1 ]]; then
      printf '[DRY-RUN] truncate %s\n' "$file"
    else
      : > "$file"
      printf '[INFO] truncated %s\n' "$file"
    fi
  done < <(find "$DOCKER_CONTAINER_DIR" -name '*-json.log' -type f -size "+${DOCKER_LOG_THRESHOLD_MB}M" -print0)

  if [[ "$DRY_RUN" -eq 0 ]]; then
    log "Docker log threshold in bytes: $threshold_bytes"
  fi
}

clean_npm_cache() {
  if [[ "$DO_CLEAN_NPM_CACHE" -ne 1 ]]; then
    return 0
  fi

  if command -v npm >/dev/null 2>&1; then
    log "Cleaning npm cache"
    run_cmd npm cache clean --force
  else
    warn "npm not found, skipping npm cache clean"
  fi

  if [[ -d /root/.npm/_cacache ]]; then
    log "Removing /root/.npm/_cacache"
    run_cmd rm -rf /root/.npm/_cacache
  fi
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --dry-run)
        DRY_RUN=1
        shift
        ;;
      --backup-days)
        BACKUP_RETENTION_DAYS="$2"
        shift 2
        ;;
      --journal-retention)
        JOURNAL_RETENTION="$2"
        shift 2
        ;;
      --docker-log-mb)
        DOCKER_LOG_THRESHOLD_MB="$2"
        shift 2
        ;;
      --backup-dir)
        BACKUP_DIR="$2"
        shift 2
        ;;
      --log-dir)
        LOG_DIR="$2"
        shift 2
        ;;
      --top-count)
        SHOW_TOP_COUNT="$2"
        shift 2
        ;;
      --skip-backups)
        DO_CLEAN_BACKUPS=0
        shift
        ;;
      --skip-journal)
        DO_CLEAN_JOURNAL=0
        shift
        ;;
      --skip-rotated-logs)
        DO_CLEAN_ROTATED_LOGS=0
        shift
        ;;
      --skip-docker)
        DO_CLEAN_DOCKER=0
        shift
        ;;
      --skip-docker-logs)
        DO_CLEAN_DOCKER_LOGS=0
        shift
        ;;
      --skip-npm)
        DO_CLEAN_NPM_CACHE=0
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        warn "Unknown argument: $1"
        usage
        exit 1
        ;;
    esac
  done
}

main() {
  parse_args "$@"

  report_disk_usage
  report_backup_usage

  clean_backups
  clean_journal
  clean_rotated_logs
  clean_docker
  clean_docker_logs
  clean_npm_cache

  log "Disk usage after cleanup"
  df -h
}

main "$@"