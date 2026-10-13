#!/usr/bin/env bash
# ============================================================
# Concurrencia real de la administración manual de suscripciones (dos
# sesiones de Super Admin a la vez) contra la base LOCAL del runner.
# Requiere 20261013000000 y los fixtures de seguridad. Imprime PASS|… /
# FAIL|… y deja la suscripción de A como estaba (sin auditorías de la
# prueba).
#
#   SM-C1  dos sesiones activan A con la MISMA fecha a la vez → la
#          primera aplica, la segunda espera el lock y responde
#          sin_cambios; una sola auditoría
#   SM-C2  activar (retiene el lock) y extender la prueba a la vez → la
#          segunda espera y ve la suscripción ya activa:
#          estado_no_permite; una sola auditoría
#   SM-C3  dos activaciones con fechas DISTINTAS a la vez → gana la
#          primera; la segunda responde ya_activa_manual (la fecha de la
#          primera queda)
# Uso: concurrencia_suscripcion_manual.sh <base>
# ============================================================
set -euo pipefail
DB="$1"
A="aaaaaaaa-0000-0000-0000-000000000000"
SUPER="00000000-0000-0000-0000-000000000001"
TMP="$(mktemp -d)"
# Solo las líneas PASS|/FAIL| van a la salida (el runner cuenta cualquier otra como falla).
export PGOPTIONS="-c client_min_messages=warning"
q() { psql -X -q -A -t -v ON_ERROR_STOP=1 -d "$DB" -c "$1"; }

como_super() {
  local llamada="$1" espera="${2:-0}"
  psql -X -q -A -t -d "$DB" <<SQL
begin;
select tests.como('$SUPER');
set local role authenticated;
select j->>'resultado' from (select $llamada as j) x;
select pg_sleep($espera);
commit;
SQL
}
resultado() { grep -oE '^(aplicado|sin_cambios)$|suscripcion_manual:[a-z_]+' "$1" | head -1 | sed 's/^suscripcion_manual://'; }
ms() { date +%s%3N; }

HOY=$(q "select (now() at time zone timezone)::date from public.tenants where id = '$A'")
D1=$(q "select '$HOY'::date + 30")
D2=$(q "select '$HOY'::date + 60")
SUS=$(q "select id from public.suscripciones where tenant_id = '$A'")

q "drop table if exists tests.sm_respaldo; create table tests.sm_respaldo as select * from public.suscripciones where tenant_id = '$A'" >/dev/null
prueba_vencida() {
  q "update public.suscripciones set estado = 'trialing', origen = 'registro_publico', plan = null,
       trial_started_at = now() - interval '40 days', trial_ends_at = now() - interval '1 day',
       current_period_end = null, cancel_at_period_end = false, impago_desde = null
     where tenant_id = '$A';
     delete from public.audit_log where entidad_id = '$SUS' and accion like 'superadmin.%'" >/dev/null
}
auditorias() { q "select count(*) from public.audit_log where entidad_id = '$SUS' and accion like 'superadmin.%'"; }

# SM-C1
prueba_vencida
como_super "public.superadmin_activar_suscripcion_manual('$A', '$D1', null)" 1.5 > "$TMP/c1a" 2>&1 &
sleep 0.3
t0=$(ms)
como_super "public.superadmin_activar_suscripcion_manual('$A', '$D1', null)" > "$TMP/c1b" 2>&1
t1=$(ms)
wait
r1=$(resultado "$TMP/c1a"); r2=$(resultado "$TMP/c1b"); n=$(auditorias)
if [[ "$r1" == "aplicado" && "$r2" == "sin_cambios" && "$n" == "1" && $((t1 - t0)) -ge 900 ]]; then
  echo "PASS|SM-C1|misma activación a la vez: $r1 + $r2 (esperó $((t1 - t0)) ms); auditorías = $n"
else
  echo "FAIL|SM-C1|misma activación a la vez|r1=$r1 r2=$r2 auditorias=$n espera=$((t1 - t0))ms"
fi

# SM-C2
prueba_vencida
como_super "public.superadmin_activar_suscripcion_manual('$A', '$D1', null)" 1.5 > "$TMP/c2a" 2>&1 &
sleep 0.3
como_super "public.superadmin_extender_trial('$A', '$D2')" > "$TMP/c2b" 2>&1
wait
r1=$(resultado "$TMP/c2a"); r2=$(resultado "$TMP/c2b"); n=$(auditorias)
e=$(q "select estado from public.suscripciones where tenant_id = '$A'")
if [[ "$r1" == "aplicado" && "$r2" == "estado_no_permite" && "$n" == "1" && "$e" == "active" ]]; then
  echo "PASS|SM-C2|activar y extender la prueba a la vez: $r1 + $r2; estado $e; auditorías = $n"
else
  echo "FAIL|SM-C2|activar y extender la prueba a la vez|r1=$r1 r2=$r2 estado=$e auditorias=$n"
fi

# SM-C3
prueba_vencida
como_super "public.superadmin_activar_suscripcion_manual('$A', '$D1', null)" 1.5 > "$TMP/c3a" 2>&1 &
sleep 0.3
como_super "public.superadmin_activar_suscripcion_manual('$A', '$D2', null)" > "$TMP/c3b" 2>&1
wait
r1=$(resultado "$TMP/c3a"); r2=$(resultado "$TMP/c3b"); n=$(auditorias)
f=$(q "select (current_period_end = (('$D1'::date + 1)::timestamp at time zone t.timezone))::text
       from public.suscripciones s join public.tenants t on t.id = s.tenant_id where s.tenant_id = '$A'")
if [[ "$r1" == "aplicado" && "$r2" == "ya_activa_manual" && "$n" == "1" && "$f" == "true" ]]; then
  echo "PASS|SM-C3|dos activaciones con fechas distintas a la vez: $r1 + $r2; queda la fecha de la primera; auditorías = $n"
else
  echo "FAIL|SM-C3|dos activaciones con fechas distintas a la vez|r1=$r1 r2=$r2 fecha_primera=$f auditorias=$n"
fi

# Limpieza: A vuelve exactamente a como estaba y sin auditorías de la prueba.
q "update public.suscripciones s set (estado, origen, plan, trial_started_at, trial_ends_at, current_period_end,
       cancel_at_period_end, impago_desde, provider, provider_customer_id, provider_subscription_id, provider_version_at,
       viviendas_declaradas)
     = (r.estado, r.origen, r.plan, r.trial_started_at, r.trial_ends_at, r.current_period_end, r.cancel_at_period_end,
        r.impago_desde, r.provider, r.provider_customer_id, r.provider_subscription_id, r.provider_version_at, r.viviendas_declaradas)
   from tests.sm_respaldo r where s.id = r.id;
   delete from public.audit_log where entidad_id = '$SUS' and accion like 'superadmin.%';
   drop table tests.sm_respaldo" >/dev/null
rm -rf "$TMP"
