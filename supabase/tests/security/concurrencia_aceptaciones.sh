#!/usr/bin/env bash
# ============================================================
# Concurrencia real del registro de aceptaciones legales (dos sesiones
# a la vez). Requiere 20261014000000 y los fixtures de seguridad.
#
# La evidencia es inmutable (sin UPDATE, DELETE ni TRUNCATE), así que la
# prueba NO escribe en la base del runner: trabaja en una copia
# desechable (createdb -T) que borra al terminar. En la copia publica
# versiones sintéticas, carga requisitos y concede EXECUTE a
# authenticated; nada de eso llega a la base original.
#
#   AC-C1  dos admins de A aceptan a la vez el Acuerdo de Tratamiento
#          (alcance residencial) → la primera registra; la segunda
#          espera y responde ya_existentes; UNA fila para A
#   AC-C2  la misma persona envía dos veces a la vez Términos + Aviso →
#          una fila por documento; la segunda espera y responde
#          ya_existentes 2
#   AC-C3  admins de B y de P aceptan a la vez su propio Acuerdo → no se
#          bloquean entre residenciales; una fila para cada uno
# Imprime solo PASS|… / FAIL|… (el runner cuenta cualquier otra línea
# como falla). Uso: concurrencia_aceptaciones.sh <base>
# ============================================================
set -euo pipefail
DB="$1"
COPIA="${DB}_lg_concurrencia"
A="aaaaaaaa-0000-0000-0000-000000000000"
B="bbbbbbbb-0000-0000-0000-000000000000"
P="11111111-0000-0000-0000-000000000000"
ADMIN_A="00000000-0000-0000-0000-00000000000a"
MIXTO="00000000-0000-0000-0000-0000000000ab"
ADMIN_B="00000000-0000-0000-0000-00000000000b"
ADMIN_P="00000000-0000-0000-0000-0000000000f1"
TMP="$(mktemp -d)"
export PGOPTIONS="-c client_min_messages=warning"

dropdb --if-exists "$COPIA" >/dev/null 2>&1
createdb -T "$DB" "$COPIA"
trap 'dropdb --if-exists "$COPIA" >/dev/null 2>&1; rm -rf "$TMP"' EXIT

q() { psql -X -q -A -t -v ON_ERROR_STOP=1 -d "$COPIA" -c "$1"; }

q "select tests.lg_preparar()" >/dev/null
VT=$(q "select tests.lg_vid('terminos', '1.0')")
VP=$(q "select tests.lg_vid('privacidad', '1.0')")
VD=$(q "select tests.lg_vid('acuerdo_tratamiento', '1.0')")

# registrar <uid> <tenant> <ids> [espera_s]: una sesión como la API.
registrar() {
  local uid="$1" tenant="$2" ids="$3" espera="${4:-0}"
  psql -X -q -A -t -d "$COPIA" <<SQL
begin;
select tests.como('$uid');
set local role authenticated;
select public.registrar_aceptaciones('$tenant', array[$ids]::uuid[], 'aceptacion_posterior', true)::text;
select pg_sleep($espera);
commit;
SQL
}
campo() { grep -oE "\"$2\": [0-9]+" "$1" | head -1 | grep -oE '[0-9]+$' || echo "?"; }
ms() { date +%s%3N; }

# AC-C1
registrar "$ADMIN_A" "$A" "'$VD'" 1.5 > "$TMP/c1a" 2>&1 &
sleep 0.3
t0=$(ms)
registrar "$MIXTO" "$A" "'$VD'" > "$TMP/c1b" 2>&1
t1=$(ms)
wait
n=$(q "select count(*) from public.aceptaciones_legales where tenant_id = '$A' and version_id = '$VD'")
if [[ "$(campo "$TMP/c1a" registradas)" == "1" && "$(campo "$TMP/c1b" ya_existentes)" == "1" && "$(campo "$TMP/c1b" registradas)" == "0" \
      && "$n" == "1" && $((t1 - t0)) -ge 900 ]]; then
  echo "PASS|AC-C1|dos admins de A aceptan el Acuerdo a la vez: 1 registrada + 1 ya existente (esperó $((t1 - t0)) ms); filas de A = $n"
else
  echo "FAIL|AC-C1|dos admins de A a la vez|a=$(tr '\n' ' ' < "$TMP/c1a") b=$(tr '\n' ' ' < "$TMP/c1b") filas=$n espera=$((t1 - t0))ms"
fi

# AC-C2
registrar "$ADMIN_B" "$B" "'$VT', '$VP'" 1.5 > "$TMP/c2a" 2>&1 &
sleep 0.3
t0=$(ms)
registrar "$ADMIN_B" "$B" "'$VT', '$VP'" > "$TMP/c2b" 2>&1
t1=$(ms)
wait
n=$(q "select count(*) from public.aceptaciones_legales where user_id = '$ADMIN_B' and version_id in ('$VT', '$VP')")
if [[ "$(campo "$TMP/c2a" registradas)" == "2" && "$(campo "$TMP/c2b" ya_existentes)" == "2" && "$(campo "$TMP/c2b" registradas)" == "0" \
      && "$n" == "2" && $((t1 - t0)) -ge 900 ]]; then
  echo "PASS|AC-C2|doble envío simultáneo de la misma persona: 2 registradas + 2 ya existentes (esperó $((t1 - t0)) ms); filas = $n"
else
  echo "FAIL|AC-C2|doble envío simultáneo|a=$(tr '\n' ' ' < "$TMP/c2a") b=$(tr '\n' ' ' < "$TMP/c2b") filas=$n espera=$((t1 - t0))ms"
fi

# AC-C3
registrar "$ADMIN_B" "$B" "'$VD'" 1.5 > "$TMP/c3a" 2>&1 &
sleep 0.3
t0=$(ms)
registrar "$ADMIN_P" "$P" "'$VD'" > "$TMP/c3b" 2>&1
t1=$(ms)
wait
nb=$(q "select count(*) from public.aceptaciones_legales where tenant_id = '$B' and version_id = '$VD'")
np=$(q "select count(*) from public.aceptaciones_legales where tenant_id = '$P' and version_id = '$VD'")
if [[ "$(campo "$TMP/c3a" registradas)" == "1" && "$(campo "$TMP/c3b" registradas)" == "1" \
      && "$nb" == "1" && "$np" == "1" && $((t1 - t0)) -lt 900 ]]; then
  echo "PASS|AC-C3|B y P aceptan su Acuerdo a la vez sin bloquearse ($((t1 - t0)) ms): una fila cada uno"
else
  echo "FAIL|AC-C3|B y P a la vez|a=$(tr '\n' ' ' < "$TMP/c3a") b=$(tr '\n' ' ' < "$TMP/c3b") filas_b=$nb filas_p=$np espera=$((t1 - t0))ms"
fi
