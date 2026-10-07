#!/usr/bin/env bash
# ============================================================
# Concurrencia real de billing (dos sesiones a la vez) contra la base
# LOCAL del runner. Requiere billing_base aplicada y los helpers de
# 96_billing.sql (tests.bc / tests.ev). Imprime líneas PASS|… / FAIL|…
# y deja el residencial A como estaba (active, alta manual).
#
#   C-34  dos admins crean checkout a la vez → quedan 1 abierto y 1 cancelado
#   C-35  el mismo evento llega dos veces a la vez → aplicado + duplicado
#   C-35b dos eventos distintos de la misma suscripción a la vez →
#         serializados (FOR UPDATE), una sola activación auditada
# Uso: concurrencia_billing.sh <base>
# ============================================================
set -euo pipefail
DB="$1"
A="aaaaaaaa-0000-0000-0000-000000000000"
q() { psql -X -q -A -t -v ON_ERROR_STOP=1 -d "$DB" -c "$1"; }

q "update public.suscripciones set estado = 'trialing', trial_started_at = now() - interval '40 days', trial_ends_at = now() - interval '10 days' where tenant_id = '$A'" >/dev/null

# C-34: S1 retiene la fila de la suscripción 1.5 s; S2 espera y luego cancela el checkout de S1.
psql -X -q -A -t -d "$DB" >/dev/null 2>&1 <<SQL &
begin;
set local role service_role;
select tests.bc('00000000-0000-0000-0000-00000000000a', '$A', 'hasta-50');
select pg_sleep(1.5);
commit;
SQL
sleep 0.3
psql -X -q -A -t -d "$DB" -c "set role service_role; select tests.bc('00000000-0000-0000-0000-0000000000aa', '$A', 'hasta-50')" >/dev/null
wait
r=$(q "select count(*) filter (where estado = 'created') || '/' || count(*) filter (where estado = 'canceled') from public.billing_checkouts where tenant_id = '$A'")
if [[ "$r" == "1/1" ]]; then echo "PASS|C-34|dos checkouts simultáneos: 1 abierto, 1 cancelado [$r]"; else echo "FAIL|C-34|dos checkouts simultáneos|$r"; fi

id=$(q "select id from public.billing_checkouts where tenant_id = '$A' and estado = 'created'")
q "set role service_role; select public.billing_registrar_checkout_proveedor('$id', 'cs_conc')" >/dev/null

# C-35: el mismo evento dos veces; C-35b: otro evento de la misma suscripción.
psql -X -q -A -t -d "$DB" > "${TMPDIR:-/tmp}/gf_conc_s1.out" 2>&1 <<SQL &
begin;
set local role service_role;
select tests.ev('evt_conc', 'active', 'cs_conc', 'sub_conc');
select pg_sleep(1.5);
commit;
SQL
sleep 0.3
psql -X -q -A -t -d "$DB" -c "set role service_role; select tests.ev('evt_conc', 'active', 'cs_conc', 'sub_conc')" > "${TMPDIR:-/tmp}/gf_conc_s2.out" 2>&1 &
s3=$(psql -X -q -A -t -d "$DB" -c "set role service_role; select tests.ev('evt_conc_2', 'active', 'cs_conc', 'sub_conc')" 2>&1)
wait
s2=$(grep -E '^(aplicado|duplicado|obsoleto|ignorado|rechazado)' "${TMPDIR:-/tmp}/gf_conc_s2.out" | head -1)
s1=$(grep -E '^(aplicado|duplicado|obsoleto|ignorado|rechazado)' "${TMPDIR:-/tmp}/gf_conc_s1.out" | head -1)
n_evt=$(q "select count(*) from public.billing_eventos where provider_event_id = 'evt_conc'")
n_act=$(q "select count(*) from public.audit_log where tenant_id = '$A' and accion = 'billing.suscripcion_activada'")
estado=$(q "select estado || '/' || provider_subscription_id from public.suscripciones where tenant_id = '$A'")
if [[ "$s1" == "aplicado" && "$s2" == "duplicado" && "$n_evt" == "1" ]]; then
  echo "PASS|C-35|mismo evento simultáneo: aplicado una vez, la segunda llamada esperó y fue duplicado [eventos=$n_evt]"
else
  echo "FAIL|C-35|mismo evento simultáneo|s1=$s1 s2=$s2 eventos=$n_evt"
fi
if [[ "$s3" == "aplicado" || "$s3" == "obsoleto" ]] && [[ "$n_act" == "1" && "$estado" == "active/sub_conc" ]]; then
  echo "PASS|C-35b|eventos distintos simultáneos serializados: estado=$estado, activaciones auditadas=$n_act, segundo=$s3"
else
  echo "FAIL|C-35b|eventos distintos simultáneos|s3=$s3 activaciones=$n_act estado=$estado"
fi

# Limpieza: A vuelve a active / alta manual.
q "delete from public.billing_eventos; delete from public.billing_checkouts where tenant_id = '$A';
   delete from public.audit_log where tenant_id = '$A' and accion like 'billing.%';
   update public.suscripciones set estado = 'active', trial_started_at = null, trial_ends_at = null, plan = null, provider = null,
          provider_customer_id = null, provider_subscription_id = null, current_period_end = null, cancel_at_period_end = false,
          provider_version_at = null where tenant_id = '$A'" >/dev/null
rm -f "${TMPDIR:-/tmp}/gf_conc_s1.out" "${TMPDIR:-/tmp}/gf_conc_s2.out"
