#!/usr/bin/env bash
# Instala FORTUNER CRM en este servidor Windows desde Git Bash.
#   Uso:  bash scripts/instalar.sh
# Requisitos: Python 3.11+ (py o python en el PATH), Node.js 20+ y el driver ODBC «Advantage StreamlineSQL ODBC» (64 bits).
# Es seguro repetirlo: no borra nada y no toca un .env que ya exista.
set -euo pipefail
cd "$(dirname "$0")/.."
export PYTHONUTF8=1

echo "== 1/4 Entorno Python (.venv)"
if [ ! -x .venv/Scripts/python.exe ]; then
  if command -v py >/dev/null 2>&1; then py -3 -m venv .venv; else python -m venv .venv; fi
fi
PY=.venv/Scripts/python.exe
"$PY" -m pip install --upgrade pip >/dev/null
"$PY" -m pip install -e "./backend[dev]"

echo "== 2/4 Interfaz web (React) -> frontend/dist"
if command -v npm >/dev/null 2>&1; then
  npm --prefix frontend ci --no-audit --no-fund
  npm --prefix frontend run build
else
  echo "AVISO: Node.js no está instalado; la interfaz no se compiló. Instálelo y repita este script." >&2
fi

echo "== 3/4 Configuración (.env)"
if [ ! -f .env ]; then
  cp .env.example .env
  k1=$("$PY" -c "import secrets; print(secrets.token_urlsafe(32))")
  k2=$("$PY" -c "import secrets; print(secrets.token_urlsafe(32))")
  pw=$("$PY" -c "import secrets, string; a = string.ascii_letters + string.digits; print('C' + ''.join(secrets.choice(a) for _ in range(17)))")
  sed -i "s|^CRM_API_KEY=.*|CRM_API_KEY=$k1|; s|^CRM_ADMIN_KEY=.*|CRM_ADMIN_KEY=$k2|; s|^ADS_CRM_PASSWORD=.*|ADS_CRM_PASSWORD=$pw|" .env
  echo "   Se creó .env con claves nuevas (uso, administración y contraseña del diccionario del CRM)."
  echo "   COMPLETE: ADS_DATA_DIRECTORY, ADS_USER, ADS_PASSWORD, ADS_CRM_DIRECTORY, ADS_CATALOGOS_DIRECTORY y DEEPSEEK_API_KEY."
else
  echo "   .env ya existe: no se modifica."
fi

echo "== 4/4 Pruebas automáticas"
"$PY" -m pytest backend/tests -q

echo
echo "Listo. Siguiente: edite .env y luego ejecute  .venv/Scripts/crm.exe probar-ads"
