#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
PORT=24703 BASE_PATH=./ pnpm --filter @workspace/focus-timer run build

package_dir="$(mktemp -d)"
trap 'rm -rf "$package_dir"' EXIT
mkdir -p "$package_dir/stillpoint-timer/dist" exports
cp wordpress/stillpoint-timer.php "$package_dir/stillpoint-timer/"
cp wordpress/README.md "$package_dir/stillpoint-timer/"
cp -R artifacts/focus-timer/dist/public/. "$package_dir/stillpoint-timer/dist/"

# The app reports its content height to the enclosing shortcode. The script is
# only in the plugin copy, not in the standalone web app's source HTML.
node - "$package_dir/stillpoint-timer/dist/index.html" <<'NODE'
const fs = require('node:fs');
const file = process.argv[2];
const html = fs.readFileSync(file, 'utf8');
if (!html.includes('</body>')) throw new Error('Built HTML has no closing body tag');
const resizeScript = `<script>
(function () {
  function reportHeight() {
    var height = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
    window.parent.postMessage({ type: 'stillpoint:height', height: height }, '*');
  }
  new ResizeObserver(reportHeight).observe(document.body);
  window.addEventListener('load', reportHeight);
  document.fonts.ready.then(reportHeight);
  reportHeight();
}());
</script>`;
fs.writeFileSync(file, html.replace('</body>', resizeScript + '\n</body>'));
NODE

rm -f exports/stillpoint-timer.zip
(cd "$package_dir" && zip -qr "$OLDPWD/exports/stillpoint-timer.zip" stillpoint-timer)
echo "Created exports/stillpoint-timer.zip"