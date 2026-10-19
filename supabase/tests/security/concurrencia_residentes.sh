#!/usr/bin/env bash
# ============================================================
# Concurrencia real de la revisión de residentes (dos sesiones a la
# vez) contra la base LOCAL del runner. Requiere 20261011000000 y los
# fixtures de seguridad. Imprime líneas PASS|… / FAIL|… y no deja datos
# (el rollback de la migración exige que no los haya).
#
#   RE-C1  dos admins aprueban la MISMA solicitud a la vez → una
#          aprobación (vivienda_nueva), la otra espera y responde
#          ya_revisada; una sola vivienda y una sola auditoría
#   RE-C2  un admin aprueba y otro rechaza la misma a la vez → gana la
#          primera; la segunda responde ya_revisada
#   RE-C3  dos solicitudes DISTINTAS con la misma dirección nueva,
#          aprobadas a la vez → una vivienda; la segunda responde
#          direccion_existente (no se duplica)
# Uso: concurrencia_residentes.sh <base>
# ============================================================
set -euo pipefail
DB="$1"
A="aaaaaaaa-0000-0000-0000-000000000000"
ADMIN1="00000000-0000-0000-0000-00000000000a"   # admin_a
ADMIN2="00000000-0000-0000-0000-0000000000aa"   # admin_ab (también admin en A)
ENLACE="ec000000-0000-0000-0000-000000000000"
S1="ec000000-0000-0000-0000-000000000001"
S2="ec000000-0000-0000-0000-000000000002"
S3="ec000000-0000-0000-0000-000000000003"
S4="ec000000-0000-0000-0000-000000000004"
TMP="$(mktemp -d)"
q() { psql -X -q -A -t -v ON_ERROR_STOP=1 -d "$DB" -c "$1"; }

# Una aprobación/rechazo como lo hace el panel (authenticated con el JWT
# del admin). $2 = la llamada (devuelve jsonb); imprime resultado, motivo
# u ok. $3 = segundos que la transacción retiene los locks.
como_admin() {
  local uid="$1" llamada="$2" espera="${3:-0}"
  psql -X -q -A -t -d "$DB" <<SQL
begin;
select tests.como('$uid');
set local role authenticated;
select coalesce(j->>'resultado', j->>'motivo', j->>'ok') from (select $llamada as j) x;
select pg_sleep($espera);
commit;
SQL
}
resultado() { grep -E '^(vivienda_nueva|contacto_principal|residente_adicional|ya_revisada|direccion_existente|true|false|posible_duplicado)$' "$1" | head -1; }
ms() { date +%s%3N; }

if [[ "$(q "select public.fn_tenant_servicio_vigente('$A')")" != "t" ]]; then
  echo "FAIL|RE-C0|el residencial A debe estar operativo para esta prueba"; exit 0
fi

q "insert into public.residentes_enlaces (id, tenant_id, token) values ('$ENLACE', '$A', repeat('c', 64));
   insert into public.residentes_solicitudes (id, tenant_id, enlace_id, nombre, apellido, direccion, telefono) values
     ('$S1', '$A', '$ENLACE', 'Conc', 'Uno',    'Casa C1', '529981119001'),
     ('$S2', '$A', '$ENLACE', 'Conc', 'Dos',    'Casa C2', '529981119002'),
     ('$S3', '$A', '$ENLACE', 'Conc', 'Tres',   'Casa C3', '529981119003'),
     ('$S4', '$A', '$ENLACE', 'Conc', 'Cuatro', 'casa  c3', '529981119004')" >/dev/null

# RE-C1: el admin 1 aprueba y retiene 1.5 s; el admin 2 aprueba la misma.
como_admin "$ADMIN1" "public.residentes_solicitud_aprobar('$S1', 'Conc', 'Uno', 'Casa C1', '529981119001')" 1.5 > "$TMP/c1a" 2>&1 &
sleep 0.3
t0=$(ms)
como_admin "$ADMIN2" "public.residentes_solicitud_aprobar('$S1', 'Conc', 'Uno', 'Casa C1', '529981119001')" > "$TMP/c1b" 2>&1
t1=$(ms)
wait
r1=$(resultado "$TMP/c1a"); r2=$(resultado "$TMP/c1b")
n=$(q "select count(*) || '/' || (select count(*) from public.audit_log where entidad_id = '$S1' and accion = 'residente_solicitud_aprobada') || '/' || (select revisado_por from public.residentes_solicitudes where id = '$S1')
       from public.unidades where tenant_id = '$A' and identificador = 'Casa C1'")
if [[ "$r1" == "vivienda_nueva" && "$r2" == "ya_revisada" && "$n" == "1/1/$ADMIN1" && $((t1 - t0)) -ge 900 ]]; then
  echo "PASS|RE-C1|dos admins aprueban la misma solicitud a la vez: $r1 + $r2 (esperó $((t1 - t0)) ms); viviendas/auditorías/revisor = $n"
else
  echo "FAIL|RE-C1|misma solicitud a la vez|r1=$r1 r2=$r2 n=$n espera=$((t1 - t0))ms"
fi

# RE-C2: aprobar (retiene) y rechazar a la vez.
como_admin "$ADMIN1" "public.residentes_solicitud_aprobar('$S2', 'Conc', 'Dos', 'Casa C2', '529981119002')" 1.5 > "$TMP/c2a" 2>&1 &
sleep 0.3
como_admin "$ADMIN2" "public.residentes_solicitud_rechazar('$S2', 'duplicado')" > "$TMP/c2b" 2>&1
wait
r1=$(resultado "$TMP/c2a"); r2=$(resultado "$TMP/c2b")
e=$(q "select estado || '/' || coalesce(motivo_rechazo, '-') from public.residentes_solicitudes where id = '$S2'")
if [[ "$r1" == "vivienda_nueva" && "$r2" == "ya_revisada" && "$e" == "aprobada/-" ]]; then
  echo "PASS|RE-C2|aprobar y rechazar a la vez: gana la primera ($r1), la otra responde $r2; estado $e"
else
  echo "FAIL|RE-C2|aprobar y rechazar a la vez|r1=$r1 r2=$r2 estado=$e"
fi

# RE-C3: dos solicitudes distintas, misma dirección nueva («Casa C3» y «casa  c3»).
como_admin "$ADMIN1" "public.residentes_solicitud_aprobar('$S3', 'Conc', 'Tres', 'Casa C3', '529981119003')" 1.5 > "$TMP/c3a" 2>&1 &
sleep 0.3
como_admin "$ADMIN2" "public.residentes_solicitud_aprobar('$S4', 'Conc', 'Cuatro', 'casa  c3', '529981119004')" > "$TMP/c3b" 2>&1
wait
r1=$(resultado "$TMP/c3a"); r2=$(resultado "$TMP/c3b")
n=$(q "select count(*) || '/' || (select estado from public.residentes_solicitudes where id = '$S4')
       from public.unidades where tenant_id = '$A' and public.fn_direccion_clave(identificador) = 'casa c3'")
if [[ "$r1" == "vivienda_nueva" && "$r2" == "direccion_existente" && "$n" == "1/pendiente" ]]; then
  echo "PASS|RE-C3|misma dirección nueva aprobada a la vez: $r1 + $r2; viviendas/estado de la segunda = $n"
else
  echo "FAIL|RE-C3|misma dirección nueva a la vez|r1=$r1 r2=$r2 n=$n"
fi

# Limpieza: nada de esta prueba queda en la base.
q "delete from public.audit_log where entidad_id in ('$S1', '$S2', '$S3', '$S4');
   delete from public.residentes_solicitudes where enlace_id = '$ENLACE';
   delete from public.unidades where tenant_id = '$A' and public.fn_direccion_clave(identificador) in ('casa c1', 'casa c2', 'casa c3');
   delete from public.residentes_enlaces where id = '$ENLACE'" >/dev/null
rm -rf "$TMP"
