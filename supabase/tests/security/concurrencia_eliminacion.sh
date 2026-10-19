#!/usr/bin/env bash
# ============================================================
# Eliminación asistida frente a una contratación (dos sesiones a la
# vez). Requiere 20261018000000 y los helpers de las suites
# (tests.er_escenario / er_simular / er_ejecutar de
# 99_eliminacion_residencial.sql, tests.bc / tests.ev de 96_billing.sql).
#
# Trabaja en una copia desechable (createdb -T) que borra al terminar:
# la eliminación borra de verdad y ER-C3 instala en la copia un trigger
# que pausa el alta del checkout.
#
#   ER-C1  la contratación empieza ANTES de ejecutar y confirma DURANTE:
#          ejecutar espera y CANCELA (contratacion_en_curso); el
#          residencial y su checkout siguen
#   ER-C2  la contratación empieza DURANTE ejecutar (ya pasó la
#          elegibilidad, todavía sin confirmar): la contratación espera y
#          falla sin suscripción; no queda ni el residencial ni un checkout
#   ER-C3  orden cruzado: la contratación ya tomó la suscripción y aún no
#          insertó el checkout cuando ejecutar toma el residencial →
#          Postgres corta el interbloqueo abortando una de las dos;
#          nunca «eliminado» con un checkout confirmado
#   ER-C4  pago hecho en el proveedor con el webhook todavía pendiente
#          (el checkout ya figura vencido en la base) → no elegible; el
#          webhook tardío encuentra el residencial y lo activa
# Imprime solo PASS|… / FAIL|… (el runner cuenta cualquier otra línea
# como falla). Uso: concurrencia_eliminacion.sh <base>
# ============================================================
set -euo pipefail
DB="$1"
COPIA="${DB}_er_concurrencia"
TMP="$(mktemp -d)"
export PGOPTIONS="-c client_min_messages=warning"

dropdb --if-exists "$COPIA" >/dev/null 2>&1
createdb -T "$DB" "$COPIA"
trap 'dropdb --if-exists "$COPIA" >/dev/null 2>&1; rm -rf "$TMP"' EXIT

q() { psql -X -q -A -t -v ON_ERROR_STOP=1 -d "$COPIA" -c "$1"; }
ms() { date +%s%3N; }
campo() { python3 -I -c "import json,sys; v=json.load(sys.stdin).get(sys.argv[1]); print('' if v is None else v)" "$1"; }
existe() { q "select exists (select 1 from public.tenants where id = '$1')"; }
checkouts() { q "select count(*) from public.billing_checkouts where tenant_id = '$1'"; }

# Residencial elegible (terminó hace 40 días) y su simulación, ya confirmados.
preparar() {
  local x r
  x=$(q "select tests.er_escenario('expired')::text")
  T=$(campo t <<< "$x"); ADMIN=$(campo admin <<< "$x")
  r=$(q "select tests.er_simular('$T')::text")
  ID=$(campo eliminacion_id <<< "$r"); CODIGO=$(campo codigo <<< "$r")
  [[ "$(campo elegible <<< "$r")" == "True" ]] || { echo "FAIL|ER-C0|el escenario no quedó elegible|$r"; exit 0; }
}

# Lo que hace el servidor: billing_crear_checkout como service_role.
checkout_sql() { echo "set local role service_role; select tests.bc('$ADMIN', '$T', 'hasta-50');"; }

# ER-C1
preparar
psql -X -q -A -t -d "$COPIA" > "$TMP/c1b" 2>&1 <<SQL &
begin;
$(checkout_sql)
select pg_sleep(1.5);
commit;
SQL
sleep 0.3
t0=$(ms)
r=$(q "select tests.er_ejecutar('$ID', '$CODIGO')::text" 2>&1 || true)
t1=$(ms)
wait
if [[ "$(campo estado <<< "$r" 2>/dev/null)" == "cancelada" && "$(campo motivo <<< "$r" 2>/dev/null)" == "contratacion_en_curso" \
      && "$(existe "$T")" == "t" && "$(checkouts "$T")" == "1" && $((t1 - t0)) -ge 900 ]]; then
  echo "PASS|ER-C1|checkout en curso al ejecutar: ejecutar esperó $((t1 - t0)) ms y canceló (contratacion_en_curso); residencial y checkout intactos"
else
  echo "FAIL|ER-C1|checkout en curso al ejecutar|ejecutar=$r checkout=$(tr '\n' ' ' < "$TMP/c1b") existe=$(existe "$T") checkouts=$(checkouts "$T") espera=$((t1 - t0))ms"
fi

# ER-C2
preparar
psql -X -q -A -t -d "$COPIA" > "$TMP/c2a" 2>&1 <<SQL &
begin;
select tests.er_ejecutar('$ID', '$CODIGO')::text;
select pg_sleep(1.5);
commit;
SQL
sleep 0.3
t0=$(ms)
psql -X -q -A -t -d "$COPIA" > "$TMP/c2b" 2>&1 <<SQL || true
begin;
$(checkout_sql)
commit;
SQL
t1=$(ms)
wait
ea=$(grep -o '"estado": "[a-z_]*"' "$TMP/c2a" | head -1 || true)
if [[ "$ea" == '"estado": "en_curso"' ]] && grep -q 'billing:sin_suscripcion' "$TMP/c2b" \
   && [[ "$(existe "$T")" == "f" && "$(checkouts "$T")" == "0" && $((t1 - t0)) -ge 900 ]]; then
  echo "PASS|ER-C2|contratación iniciada durante ejecutar: esperó $((t1 - t0)) ms y falló sin suscripción; no quedó residencial ni checkout"
else
  echo "FAIL|ER-C2|contratación durante ejecutar|ejecutar=$(tr '\n' ' ' < "$TMP/c2a") checkout=$(tr '\n' ' ' < "$TMP/c2b") existe=$(existe "$T") checkouts=$(checkouts "$T") espera=$((t1 - t0))ms"
fi

# ER-C3: el trigger (solo en la copia) pausa el alta del checkout DESPUÉS
# de que billing_crear_checkout bloqueó la suscripción y ANTES del insert.
q "create function tests.pausa_checkout() returns trigger language plpgsql as \$\$
   begin
     if current_setting('tests.pausa_checkout', true) = 'on' then perform pg_sleep(1); end if;
     return new;
   end \$\$;
   create trigger zz_pausa_checkout before insert on public.billing_checkouts
     for each row execute function tests.pausa_checkout();" >/dev/null
preparar
psql -X -q -A -t -d "$COPIA" > "$TMP/c3b" 2>&1 <<SQL &
begin;
set local tests.pausa_checkout = 'on';
$(checkout_sql)
commit;
SQL
sleep 0.3
r=$(q "select tests.er_ejecutar('$ID', '$CODIGO')::text" 2>&1 || true)
wait
ex=$(existe "$T"); nc=$(checkouts "$T")
estado_reg=$(q "select estado from public.eliminaciones_residencial where id = '$ID'")
ej_ok=$([[ "$(campo estado <<< "$r" 2>/dev/null || true)" == "en_curso" ]] && echo si || echo no)
ck_ok=$(grep -qiE 'error|deadlock' "$TMP/c3b" && echo no || echo si)
if grep -qi 'deadlock' <<< "$r$(cat "$TMP/c3b")" \
   && { { [[ "$ej_ok" == "no" && "$ck_ok" == "si" && "$ex" == "t" && "$nc" == "1" && "$estado_reg" == "simulada" ]]; } \
        || { [[ "$ej_ok" == "si" && "$ck_ok" == "no" && "$ex" == "f" && "$nc" == "0" ]]; }; }; then
  quien=$([[ "$ej_ok" == "no" ]] && echo "ejecutar (residencial intacto, simulación reutilizable)" || echo "la contratación (residencial eliminado sin checkout)")
  echo "PASS|ER-C3|orden cruzado de bloqueos: interbloqueo resuelto por Postgres; abortó $quien"
else
  echo "FAIL|ER-C3|orden cruzado de bloqueos|ejecutar=$r checkout=$(tr '\n' ' ' < "$TMP/c3b") existe=$ex checkouts=$nc registro=$estado_reg"
fi
q "drop trigger zz_pausa_checkout on public.billing_checkouts; drop function tests.pausa_checkout();" >/dev/null

# ER-C4
x=$(q "select tests.er_escenario('expired')::text")
T=$(campo t <<< "$x"); ADMIN=$(campo admin <<< "$x")
c=$(q "set role service_role; select tests.bc('$ADMIN', '$T', 'hasta-50')")
q "set role service_role; select public.billing_registrar_checkout_proveedor('$c', 'cs_er_c4')" >/dev/null
# El cliente pagó en Stripe antes del vencimiento; el aviso no llegó y la sesión ya venció.
q "update public.billing_checkouts set created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour' where id = '$c'" >/dev/null
r=$(q "select tests.er_simular('$T')::text")
w=$(q "set role service_role; select tests.ev('evt_er_c4', 'active', 'cs_er_c4', 'sub_er_c4')")
if [[ "$(campo elegible <<< "$r")" == "False" && "$(campo motivo <<< "$r")" == "contratacion_en_curso" && "$w" == "aplicado" \
      && "$(q "select estado from public.suscripciones where tenant_id = '$T'")" == "active" ]]; then
  echo "PASS|ER-C4|pago con el webhook pendiente: no elegible (contratacion_en_curso); el webhook tardío activó el residencial"
else
  echo "FAIL|ER-C4|pago con el webhook pendiente|simular=$(campo elegible <<< "$r")/$(campo motivo <<< "$r") webhook=$w"
fi
