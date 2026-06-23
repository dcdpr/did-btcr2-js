#!/usr/bin/env bash
# E2E: Tarball install smoke test for @did-btcr2/key-manager.
#
# Validates that the package's published shape works for a downstream consumer:
#   - `files: ["dist", "src"]` includes everything needed at install time
#   - `exports`, `main`, `module`, `types` fields point at files that exist
#     in the packed tarball (workspace symlinks can mask missing dist artifacts)
#   - All workspace deps repack cleanly and resolve when installed together
#   - The renamed package imports correctly under the new name
#
# Catches the class of bugs where local `pnpm test` passes (workspace symlinks
# expose the source tree) but `npm install @did-btcr2/key-manager` from a real
# registry fails because `dist/` is empty, `package.json#files` is wrong, or
# `exports.import` points at a missing path.
#
# This is the LAST gate before `npm publish`. Failures here are publish blockers.
#
# Usage:
#   bash packages/key-manager/lib/smoke-test-tarball.sh
#
# Exit code: 0 on full round-trip success, non-zero on any failure.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TMP="$(mktemp -d -t did-btcr2-smoke-XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

echo "Smoke test: @did-btcr2/key-manager tarball install"
echo "  Repo root: $ROOT"
echo "  Workspace: $TMP"
echo ""

# Build everything fresh, never trust stale dist artifacts.
echo "[1] Building all workspace packages ..."
( cd "$ROOT" && pnpm build:ts ) > /dev/null
( cd "$ROOT" && pnpm -r --filter=@did-btcr2/common --filter=@did-btcr2/keypair --filter=@did-btcr2/key-manager build ) > /dev/null
echo "    OK"

# Pack all packages key-manager transitively depends on.
echo "[2] Packing key-manager and its workspace dependencies ..."
PACK_DIR="$TMP/tarballs"
mkdir -p "$PACK_DIR"
for pkg in common keypair key-manager; do
  ( cd "$ROOT/packages/$pkg" && pnpm pack --pack-destination "$PACK_DIR" ) > /dev/null
done
ls "$PACK_DIR"
echo "    OK"

# Build a clean consumer project and install only from the local tarballs.
echo "[3] Bootstrapping a clean consumer project ..."
CONSUMER="$TMP/consumer"
mkdir -p "$CONSUMER"
cat > "$CONSUMER/package.json" <<EOF
{
  "name": "smoke-test-consumer",
  "version": "0.0.0",
  "type": "module",
  "private": true
}
EOF

# npm install resolves file: protocol tarballs locally, no registry needed.
COMMON_TGZ=$(ls "$PACK_DIR"/did-btcr2-common-*.tgz)
KEYPAIR_TGZ=$(ls "$PACK_DIR"/did-btcr2-keypair-*.tgz)
KM_TGZ=$(ls "$PACK_DIR"/did-btcr2-key-manager-*.tgz)

( cd "$CONSUMER" && npm install --silent --no-audit --no-fund \
    "file:$COMMON_TGZ" "file:$KEYPAIR_TGZ" "file:$KM_TGZ" ) > /dev/null
echo "    OK (installed from tarballs only, no registry)"

# Tiny consumer module, exercises the public API surface that a downstream
# user would touch first: package name (renamed), class exports (renamed),
# unified Signer.sign interface (new scheme names), and a sign->verify
# round-trip that crosses the package boundary.
echo "[4] Running consumer module from installed tarball ..."
cat > "$CONSUMER/index.mjs" <<'MJS'
import { LocalKeyManager, KeyManagerSigner } from '@did-btcr2/key-manager';
import { SchnorrKeyPair } from '@did-btcr2/keypair';

const km = new LocalKeyManager();
const kp = SchnorrKeyPair.generate();
const id = km.importKey(kp, { setActive: true });
const signer = new KeyManagerSigner(km, id);

if (signer.publicKey.length !== 33) {
  console.error('FAIL: signer.publicKey not 33 bytes');
  process.exit(1);
}

const msg = new Uint8Array(32).fill(0xab);
const sigBip340 = signer.sign(msg, 'bip340');
const sigBip341 = signer.sign(msg, 'bip341');
const sigEcdsa = signer.sign(msg, 'ecdsa');

if (sigBip340.length !== 64) { console.error('FAIL: bip340 sig not 64 bytes'); process.exit(1); }
if (sigBip341.length !== 64) { console.error('FAIL: bip341 sig not 64 bytes'); process.exit(1); }
if (sigEcdsa[0] !== 0x30)    { console.error('FAIL: ecdsa sig not DER'); process.exit(1); }

// Verify the bip340 sig through the KeyManager (cross-package round-trip).
const ok = km.verify(sigBip340, msg, id, { scheme: 'bip340' });
if (!ok) { console.error('FAIL: bip340 verify round-trip'); process.exit(1); }

console.log('OK: LocalKeyManager + KeyManagerSigner imports + all three schemes signed + verify round-trip');
MJS
( cd "$CONSUMER" && node index.mjs )

# Verify the dist/ shape inside the installed tarball matches package.json's
# exports map. Common bug: `exports.import` references `dist/esm/index.js` but
# the dist/esm directory was excluded from `files: [...]`.
echo "[5] Verifying installed package layout ..."
INSTALLED="$CONSUMER/node_modules/@did-btcr2/key-manager"
for path in dist/esm/index.js dist/types/index.d.ts dist/cjs/index.js package.json; do
  if [[ ! -e "$INSTALLED/$path" ]]; then
    echo "    FAIL: missing $path inside installed tarball"
    exit 1
  fi
done
echo "    OK (dist/esm, dist/types, dist/cjs all present)"

echo ""
echo "══ SMOKE TEST PASSED ══"
echo "  @did-btcr2/key-manager is publish-ready."
echo "  Tarball: $KM_TGZ"
