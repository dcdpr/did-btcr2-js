#!/usr/bin/env bash
#
# Regenerates danubetech-vectors.json from a checkout of the danubetech driver
# repo, whose example-dids/ tree is the upstream source of truth:
#
#   https://github.com/danubetech/uni-resolver-driver-did-btcr2
#
# Each example-dids/<id>/ holds did.txt and (for POST vectors)
# resolutionOptions.json. The `description`, `notes`, `knownFault`, and
# `knownFailReason` annotations are ours, not upstream's, so they are carried
# over from the existing vectors file by example id. A new example upstream
# lands with an empty description for an operator to fill in.
#
# The vectors file is a committed snapshot so the harness runs offline and so a
# vector change shows up as a reviewable diff. Re-run this whenever upstream
# regenerates its examples; a silently stale snapshot is how a fixed
# implementation keeps looking broken.
#
# Usage:
#   ./danubetech-sync.sh                       # clone upstream to a temp dir
#   ./danubetech-sync.sh /path/to/driver-repo  # use an existing checkout
#
# Requires: jq, and git when cloning
#
set -euo pipefail

readonly HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly VECTORS_FILE="${HERE}/danubetech-vectors.json"
readonly UPSTREAM='https://github.com/danubetech/uni-resolver-driver-did-btcr2'

command -v jq >/dev/null || { echo "jq is required"; exit 2; }

if [[ $# -ge 1 ]]; then
  DRIVER_REPO="$1"
else
  command -v git >/dev/null || { echo "git is required to clone"; exit 2; }
  DRIVER_REPO="$(mktemp -d -t btcr2-driver-XXXXXX)"
  trap 'rm -rf "${DRIVER_REPO}"' EXIT
  echo "  Cloning ${UPSTREAM}"
  git clone --depth 1 --quiet "${UPSTREAM}" "${DRIVER_REPO}"
fi

readonly EXAMPLES_DIR="${DRIVER_REPO}/example-dids"
[[ -d "${EXAMPLES_DIR}" ]] || { echo "no example-dids/ under ${DRIVER_REPO}"; exit 2; }

# Existing annotations, keyed by example id. Absent file means a first run.
if [[ -f "${VECTORS_FILE}" ]]; then
  prior="$(jq 'map({key: .example, value: {description, notes, knownFault, knownFailReason}}) | from_entries' "${VECTORS_FILE}")"
else
  prior='{}'
fi

entries='[]'
count=0
for dir in "${EXAMPLES_DIR}"/*/; do
  example="$(basename "${dir}")"
  [[ -f "${dir}/did.txt" ]] || continue
  did="$(tr -d '[:space:]' < "${dir}/did.txt")"

  if [[ -f "${dir}/resolutionOptions.json" ]]; then
    method='POST'
    options="$(jq -c '.' "${dir}/resolutionOptions.json")"
  else
    method='GET'
    options='null'
  fi

  entries="$(jq \
    --arg ex "${example}" --arg did "${did}" --arg method "${method}" \
    --argjson options "${options}" --argjson prior "${prior}" \
    '. + [{
       example         : $ex,
       description     : ($prior[$ex].description // ""),
       method          : $method,
       did             : $did,
       notes           : ($prior[$ex].notes // ""),
       knownFault      : ($prior[$ex].knownFault // null),
       knownFailReason : ($prior[$ex].knownFailReason // null),
       resolutionOptions: $options
     }]' <<<"${entries}")"
  count=$((count + 1))
done

# Sort so the committed diff is stable: numeric prefix, then any a/b suffix.
jq 'sort_by((.example | capture("^(?<n>[0-9]+)(?<s>.*)$")) as $p | [($p.n | tonumber), $p.s])' \
  <<<"${entries}" > "${VECTORS_FILE}"

echo "  Wrote ${count} vector(s) to ${VECTORS_FILE}"
missing="$(jq -r '[.[] | select(.description == "") | .example] | join(", ")' "${VECTORS_FILE}")"
[[ -n "${missing}" ]] && echo "  Needs a description: ${missing}"
exit 0
