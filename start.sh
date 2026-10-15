#!/usr/bin/env sh
# macOS / Linux için başlatıcı. Ayarları ortam değişkenleriyle değiştirebilirsin.
set -e
cd "$(dirname "$0")"
export PORT="${PORT:-38471}"
npm install
npm run build
echo ""
if [ -n "${PUBLIC_HOST:-}" ]; then
  echo "Aç: https://${PUBLIC_HOST}:${PORT}"
else
  echo "Adres sunucu açılınca yazılır. IP otomatik bulunur."
  echo "Şimdilik beklenen adres: https://13.53.198.78:${PORT}"
fi
npm start
