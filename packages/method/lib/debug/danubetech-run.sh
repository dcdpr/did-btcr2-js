#!/usr/bin/env bash
#
# Drives the danubetech driver's 16 example DIDs through the `btcr2` CLI
# and emits a markdown report with per-vector pass/fail/timeout details.
#
# For each vector:
#   - GET vectors:  btcr2 resolve -i <did>
#   - POST vectors: write sidecar to a temp file, btcr2 resolve -i <did> -p <file>
#
# Each vector is wrapped in `timeout` so a hang doesn't block the whole run.
# Terminal output is a brief progress log; the full report (including captured
# stdout/stderr per vector) lands in --out (default: results.md beside this script).
#
# Usage:
#   ./danubetech-run.sh                            # all 16, write to ./results.md
#   ./danubetech-run.sh 04 07 12a                  # specific examples
#   TIMEOUT=120 ./danubetech-run.sh                # bump per-vector timeout (seconds)
#   ./danubetech-run.sh --out /tmp/report.md       # custom output path
#
# Requires: jq, btcr2 (on PATH), GNU timeout
#
set -uo pipefail

readonly HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly VECTORS_FILE="${HERE}/danubetech-vectors.json"
readonly TMP_DIR="$(mktemp -d -t btcr2-danubetech-XXXXXX)"
readonly TIMEOUT="${TIMEOUT:-60}"

trap 'rm -rf "${TMP_DIR}"' EXIT

# Colors (disabled if stdout isn't a TTY)
if [[ -t 1 ]]; then
  readonly C_RED=$'\e[31m' C_GREEN=$'\e[32m' C_YELLOW=$'\e[33m' C_BLUE=$'\e[34m' C_DIM=$'\e[2m' C_RESET=$'\e[0m'
else
  readonly C_RED='' C_GREEN='' C_YELLOW='' C_BLUE='' C_DIM='' C_RESET=''
fi

if ! command -v jq >/dev/null;     then echo "jq is required";     exit 2; fi
if ! command -v btcr2 >/dev/null;  then echo "btcr2 is required";  exit 2; fi
if ! command -v timeout >/dev/null;then echo "GNU timeout is required"; exit 2; fi
if [[ ! -f "${VECTORS_FILE}" ]];   then echo "${VECTORS_FILE} not found"; exit 2; fi

# Parse args: positional = example ids; --out <path> overrides report path.
OUT="${HERE}/results.md"
declare -a EXAMPLES=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --out)  OUT="$2"; shift 2 ;;
    --out=*) OUT="${1#--out=}"; shift ;;
    -h|--help) sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)      EXAMPLES+=("$1"); shift ;;
  esac
done

if [[ ${#EXAMPLES[@]} -eq 0 ]]; then
  mapfile -t EXAMPLES < <(jq -r '.[].example' "${VECTORS_FILE}")
fi

btcr2_version="$(btcr2 --version 2>&1 | head -n1 || echo unknown)"
started_at="$(date -Iseconds)"

# Write report header
{
  echo "# Danubetech Vector Resolution Report"
  echo
  echo "- **Generated:** \`${started_at}\`"
  echo "- **btcr2 version:** \`${btcr2_version}\`"
  echo "- **Per-vector timeout:** ${TIMEOUT}s"
  echo "- **Vectors run:** ${#EXAMPLES[@]}"
  echo
} > "${OUT}"

declare -a SUMMARY_ROWS=()
pass=0; fail=0; tout=0; xfail=0

# Classify the fault for a failed vector. Inspects captured output and falls
# back to "unknown" when nothing matches. Operators must do spec analysis to
# reclassify unknowns; we never auto-attribute fault to the other implementation
# without an explicit `knownFault` annotation in the vectors file. See memory:
# project-cross-impl-validation.md.
classify_fault() {
  local status="$1" log="$2" known="$3"
  if [[ "${status}" == "PASS" ]]; then
    echo "n/a"
    return
  fi
  if [[ -n "${known}" && "${known}" != "null" ]]; then
    echo "${known}"
    return
  fi
  echo "unknown"
}

echo
echo "  Running ${#EXAMPLES[@]} danubetech vector(s) through btcr2 CLI"
echo "  Per-vector timeout: ${TIMEOUT}s"
echo "  Report:             ${OUT}"
echo

for example in "${EXAMPLES[@]}"; do
  entry="$(jq --arg ex "${example}" '.[] | select(.example == $ex)' "${VECTORS_FILE}")"
  if [[ -z "${entry}" ]]; then
    echo "  ${C_RED}MISSING${C_RESET}  [${example}] not found in vectors file"
    SUMMARY_ROWS+=("| ${example} | MISSING | - | (not in vectors file) |")
    fail=$((fail + 1))
    continue
  fi

  did="$(jq -r '.did' <<<"${entry}")"
  desc="$(jq -r '.description' <<<"${entry}")"
  method="$(jq -r '.method' <<<"${entry}")"
  notes="$(jq -r '.notes // empty' <<<"${entry}")"
  known_fault="$(jq -r '.knownFault // empty' <<<"${entry}")"
  known_reason="$(jq -r '.knownFailReason // empty' <<<"${entry}")"
  has_options="$(jq -r 'if .resolutionOptions == null then "no" else "yes" end' <<<"${entry}")"

  declare -a cmd=(btcr2 resolve -i "${did}")
  options_file=""
  if [[ "${has_options}" == "yes" ]]; then
    options_file="${TMP_DIR}/vector-${example}.json"
    jq '.resolutionOptions' <<<"${entry}" > "${options_file}"
    cmd+=(-p "${options_file}")
  fi

  log_file="${TMP_DIR}/vector-${example}.log"
  start_ms=$(date +%s%3N)
  set +e
  timeout --kill-after=2 "${TIMEOUT}" "${cmd[@]}" >"${log_file}" 2>&1
  exit_code=$?
  set -e
  end_ms=$(date +%s%3N)
  duration=$((end_ms - start_ms))

  if [[ ${exit_code} -eq 0 ]]; then
    status="PASS"
    pass=$((pass + 1))
    printf "  %sPASS%s      [%s] %dms\n" "${C_GREEN}" "${C_RESET}" "${example}" "${duration}"
  elif [[ ${exit_code} -eq 124 || ${exit_code} -eq 137 ]]; then
    status="TIMEOUT"
    tout=$((tout + 1))
    printf "  %sTIMEOUT%s   [%s] killed after %ds\n" "${C_YELLOW}" "${C_RESET}" "${example}" "${TIMEOUT}"
  elif [[ -n "${known_fault}" ]]; then
    status="XFAIL"
    xfail=$((xfail + 1))
    printf "  %sXFAIL%s     [%s] exit %d  %dms  (expected: %s)\n" "${C_BLUE}" "${C_RESET}" "${example}" "${exit_code}" "${duration}" "${known_fault}"
  else
    status="FAIL"
    fail=$((fail + 1))
    printf "  %sFAIL%s      [%s] exit %d  %dms\n" "${C_RED}" "${C_RESET}" "${example}" "${exit_code}" "${duration}"
  fi

  fault="$(classify_fault "${status}" "${log_file}" "${known_fault}")"
  SUMMARY_ROWS+=("| ${example} | ${status} | ${fault} | ${duration}ms | ${desc} |")

  # Markdown detail section for this vector
  {
    echo "---"
    echo
    echo "## Vector ${example} - ${status}"
    echo
    echo "- **DID:** \`${did}\`"
    echo "- **Description:** ${desc}"
    echo "- **Method:** ${method}"
    [[ -n "${notes}" ]] && echo "- **Notes:** ${notes}"
    echo "- **Fault attribution:** ${fault}"
    [[ -n "${known_reason}" ]] && echo "- **Known fail reason:** ${known_reason}"
    echo "- **Duration:** ${duration}ms"
    echo "- **Exit code:** ${exit_code}"
    echo
    echo "**Command:**"
    echo
    echo '```bash'
    printf '%s' "${cmd[0]}"
    for arg in "${cmd[@]:1}"; do printf ' %q' "${arg}"; done
    echo
    echo '```'
    echo
    if [[ -n "${options_file}" ]]; then
      echo "<details><summary>Sidecar (resolutionOptions sent via -p)</summary>"
      echo
      echo '```json'
      cat "${options_file}"
      echo '```'
      echo
      echo "</details>"
      echo
    fi
    echo "<details><summary>Captured output (stdout + stderr)</summary>"
    echo
    echo '```'
    if [[ -s "${log_file}" ]]; then
      cat "${log_file}"
    else
      echo "(no output captured)"
    fi
    echo '```'
    echo
    echo "</details>"
    echo
  } >> "${OUT}"
done

total=$((pass + fail + tout + xfail))

# Prepend summary table to the report by rewriting it
tmp_report="${TMP_DIR}/report.md"
{
  head -n 6 "${OUT}"
  echo
  echo "## Summary"
  echo
  echo "| Result | Count |"
  echo "|---|---|"
  echo "| PASS | ${pass} |"
  echo "| FAIL | ${fail} |"
  echo "| XFAIL | ${xfail} |"
  echo "| TIMEOUT | ${tout} |"
  echo "| **Total** | **${total}** |"
  echo
  echo "**Status legend:**"
  echo
  echo "- \`PASS\` - resolved successfully"
  echo "- \`FAIL\` - resolution errored; fault attribution may be \`unknown\` pending spec analysis"
  echo "- \`XFAIL\` - expected failure; vector has a \`knownFault\` annotation in \`danubetech-vectors.json\`"
  echo "- \`TIMEOUT\` - killed after ${TIMEOUT}s (treat as a bug to investigate)"
  echo
  echo "**Fault attribution:**"
  echo
  echo "- \`our-impl\` - did-btcr2-js violates the spec; fix in this repo"
  echo "- \`their-impl\` - the other implementation (e.g., danubetech java) violates the spec; file upstream"
  echo "- \`spec-ambiguity\` - spec is silent or ambiguous; needs user decision before action"
  echo "- \`unknown\` - fault not yet determined; requires manual spec analysis to reclassify"
  echo "- \`n/a\` - vector passed, no fault to attribute"
  echo
  echo "See memory: \`project-cross-impl-validation.md\` for the full framework."
  echo
  echo "| # | Status | Fault | Duration | Description |"
  echo "|---|---|---|---|---|"
  printf '%s\n' "${SUMMARY_ROWS[@]}"
  echo
  # Skip the header we already wrote (lines 1-6) and dump the per-vector sections
  tail -n +7 "${OUT}"
} > "${tmp_report}"
mv "${tmp_report}" "${OUT}"

echo
echo "  Summary: ${C_GREEN}${pass} PASS${C_RESET} / ${C_RED}${fail} FAIL${C_RESET} / ${C_BLUE}${xfail} XFAIL${C_RESET} / ${C_YELLOW}${tout} TIMEOUT${C_RESET}  (${total} total)"
echo "  Report:  ${OUT}"
echo

# Exit non-zero only for unexpected failures and timeouts. XFAIL is expected and
# does not count as a regression; flipping an XFAIL to PASS is good news that
# means the upstream impl was fixed or our tolerance changed (then update the
# vectors file).
if [[ $((fail + tout)) -gt 0 ]]; then
  exit 1
fi
