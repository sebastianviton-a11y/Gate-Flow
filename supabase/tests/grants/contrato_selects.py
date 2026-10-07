#!/usr/bin/env python3
"""
Contrato código ↔ esquema.

Recorre apps/ y packages/ buscando llamadas PostgREST con nombre de
tabla literal (`.from("tabla")`) y comprueba contra una base LOCAL
migrada que:
  * cada columna de `.select(...)` existe, incluidas las de recursos
    embebidos (`alias:tabla!fk ( ... )`), resolviendo la relación por
    nombre de tabla, de FK o de columna FK;
  * cada clave de `.insert({ ... })` / `.update({ ... })` con objeto
    literal es una columna de la tabla;
  * cada `.rpc("funcion")` existe en public;
  * en las tablas con UPDATE por columna para authenticated
    (tenants), cada clave de `.update({ ... })` tiene ese privilegio:
    el cliente de sesión no puede escribir columnas de plataforma;
  * ningún embebido es ambiguo: si entre las dos tablas hay más de una
    FK (p. ej. la simple y la compuesta (x_id, tenant_id) de la
    integridad multitenant), el embed debe nombrar la FK
    (`tabla!fk ( ... )`), o PostgREST responde 300 / PGRST201;
  * cada FK nombrada existe y une esas dos tablas.
Habría detectado `incidencias.nivel_danio` (42703 en staging),
`registrar_paquete_con_incidencia` y el dashboard caído por PGRST201
antes de llegar a un entorno real.

Uso: contrato_selects.py --repo <raíz> --db <base local> [--solo-embebidos]
  --solo-embebidos: solo relaciones (FK nombradas y ambigüedad), para
  esquemas intermedios donde las columnas nuevas aún no existen.
"""
import argparse
import os
import re
import subprocess
import sys


def psql(db, query):
    out = subprocess.run(["psql", "-X", "-A", "-t", "-F", "\t", "-d", db, "-c", query],
                         check=True, capture_output=True, text=True).stdout
    return [line.split("\t") for line in out.splitlines() if line]


def cargar_esquema(db):
    columnas = {}
    # pg_attribute (no information_schema) para incluir vistas materializadas.
    for tabla, col in psql(db, "select c.relname, a.attname from pg_attribute a join pg_class c on c.oid = a.attrelid "
                               "where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','v','m','p') "
                               "and a.attnum > 0 and not a.attisdropped"):
        columnas.setdefault(tabla, set()).add(col)
    fks = []  # (nombre, tabla_origen, columna_origen, tabla_destino)
    for nombre, origen, col, destino in psql(db, """
        select c.conname, c.conrelid::regclass::text, a.attname, c.confrelid::regclass::text
        from pg_constraint c
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
        where c.contype = 'f' and c.connamespace = 'public'::regnamespace"""):
        fks.append((nombre, origen.replace("public.", ""), col, destino.replace("public.", "")))
    rpcs = {r[0] for r in psql(db, "select proname from pg_proc where pronamespace = 'public'::regnamespace")}
    # Tablas sin UPDATE a nivel de tabla pero con UPDATE en algunas
    # columnas: solo esas columnas son escribibles por la sesión.
    actualizables = {}
    for tabla, col in psql(db, """
        select c.relname, a.attname from pg_class c join pg_attribute a on a.attrelid = c.oid
        where c.relnamespace = 'public'::regnamespace and c.relname = any(array['tenants'])
          and a.attnum > 0 and not a.attisdropped
          and not has_table_privilege('authenticated', c.oid, 'UPDATE')
          and has_column_privilege('authenticated', c.oid, a.attnum, 'UPDATE')"""):
        actualizables.setdefault(tabla, set()).add(col)
    return columnas, fks, rpcs, actualizables


def partir(texto):
    """Separa por comas de primer nivel (fuera de paréntesis)."""
    partes, nivel, actual = [], 0, ""
    for ch in texto:
        if ch == "(":
            nivel += 1
        elif ch == ")":
            nivel -= 1
        if ch == "," and nivel == 0:
            partes.append(actual)
            actual = ""
        else:
            actual += ch
    if actual.strip():
        partes.append(actual)
    return [p.strip() for p in partes if p.strip()]


def relaciones(padre, otra, fks):
    """FKs directas entre dos tablas, en cualquier sentido (las que
    PostgREST considera al embeber `otra` dentro de `padre`)."""
    return [fk for fk, origen, col, destino in fks
            if (origen == padre and destino == otra) or (origen == otra and destino == padre)]


def resolver_embebido(padre, nombre, pistas, columnas, fks, errores, donde):
    """Tabla destino del embed, o None (con el error ya anotado)."""
    etiqueta = f"{padre} → {nombre}" + "".join(f"!{p}" for p in pistas)
    fk_pistas = [p for p in pistas if p not in ("inner", "left")]
    if fk_pistas:
        pista = fk_pistas[0]
        for fk, origen, col, destino in fks:
            if fk == pista:
                otra = destino if origen == padre else origen
                if padre not in (origen, destino) or (nombre in columnas and nombre != otra):
                    errores.append(f"{donde}: FK {pista} no une {padre} con {nombre}")
                    return None
                return otra
        for fk, origen, col, destino in fks:  # tabla!columna_fk ( ... )
            if origen == padre and col == pista and destino == nombre:
                return destino
        errores.append(f"{donde}: FK inexistente en el embed {etiqueta}")
        return None
    if nombre in columnas:
        if padre != nombre and len(relaciones(padre, nombre, fks)) > 1:
            errores.append(f"{donde}: embed ambiguo (PGRST201) {etiqueta}: "
                           f"{len(relaciones(padre, nombre, fks))} FKs entre {padre} y {nombre} "
                           f"({', '.join(sorted(relaciones(padre, nombre, fks)))}); nombra una con {nombre}!<fk>")
            return None
        return nombre
    for fk, origen, col, destino in fks:  # alias:columna_fk ( ... )
        if origen == padre and col == nombre:
            return destino
    errores.append(f"{donde}: relación embebida no resoluble {etiqueta}")
    return None


def revisar_select(tabla, texto, columnas, fks, errores, donde, solo_embebidos=False):
    if tabla not in columnas:
        errores.append(f"{donde}: tabla/vista inexistente {tabla}")
        return
    for item in partir(" ".join(texto.split())):
        if item == "*":
            continue
        m = re.match(r"^(?:([a-z_][a-z0-9_]*)\s*:\s*)?([a-z_][a-z0-9_]*)((?:\s*!\s*[a-z_][a-z0-9_]*)*)\s*\((.*)\)$", item, re.S)
        if m:
            _, nombre, cadena, interior = m.groups()
            pistas = re.findall(r"!\s*([a-z_][a-z0-9_]*)", cadena)
            destino = resolver_embebido(tabla, nombre, pistas, columnas, fks, errores, donde)
            if destino is not None:
                revisar_select(destino, interior, columnas, fks, errores, donde, solo_embebidos)
            continue
        if solo_embebidos:
            continue
        col = re.sub(r"^[a-z_][a-z0-9_]*\s*:\s*", "", item)      # alias:col
        col = re.split(r"::|->", col)[0].strip()                    # cast / json
        if col not in columnas[tabla]:
            errores.append(f"{donde}: columna inexistente {tabla}.{col}")


def claves_objeto(texto):
    """Claves de primer nivel de un objeto literal { a: x, b: y }."""
    if not texto.startswith("{"):
        return None
    cuerpo = texto[1:texto.rfind("}")] if "}" in texto else ""
    claves = []
    for parte in partir(re.sub(r"\{[^{}]*\}|\[[^\[\]]*\]", "0", cuerpo)):
        m = re.match(r"^([a-z_][a-z0-9_]*)\s*:", parte)
        if m:
            claves.append(m.group(1))
        elif re.match(r"^[a-z_][a-z0-9_]*$", parte):
            claves.append(parte)  # { campo } abreviado
        else:
            return None  # spread u otra forma: no se puede verificar
    return claves


def argumento(texto, inicio):
    """Texto del primer argumento de la llamada que abre en `inicio`."""
    nivel, i = 0, inicio
    while i < len(texto):
        ch = texto[i]
        if ch in "\"'`":  # salta el literal completo
            cierre = texto.find(ch, i + 1)
            i = (cierre if cierre >= 0 else len(texto)) + 1
            continue
        if ch in "({[":
            nivel += 1
        elif ch in ")}]":
            if nivel == 0:
                break
            nivel -= 1
        elif ch == "," and nivel == 0:
            break
        i += 1
    return texto[inicio:i].strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True)
    ap.add_argument("--db", required=True)
    ap.add_argument("--solo-embebidos", action="store_true")
    args = ap.parse_args()
    solo = args.solo_embebidos

    columnas, fks, rpcs, actualizables = cargar_esquema(args.db)
    errores, revisadas, sin_verificar = [], 0, 0

    fuentes = []
    for base in ("apps", "packages"):
        for dp, dn, fn in os.walk(os.path.join(args.repo, base)):
            dn[:] = [d for d in dn if d not in ("node_modules", ".next", "dist")]
            fuentes += [os.path.join(dp, f) for f in fn if f.endswith((".ts", ".tsx"))]

    # Constantes de select de TODO el código (también las importadas
    # de otro paquete, p. ej. SELECT_MEMBRESIAS_ACCESO), y alias
    # `const A = B;`. Las del propio archivo tienen prioridad.
    globales, alias = {}, {}
    for ruta in fuentes:
        texto = open(ruta, encoding="utf-8").read()
        for nombre, _, valor in re.findall(r"const\s+([A-Z_][A-Z0-9_]*)\s*=\s*([\"'`])(.*?)\2\s*;", texto, re.S):
            globales.setdefault(nombre, valor)
        alias.update(re.findall(r"const\s+([A-Z_][A-Z0-9_]*)\s*=\s*([A-Z_][A-Z0-9_]*)\s*;", texto))
    for nombre, origen in alias.items():
        if origen in globales:
            globales.setdefault(nombre, globales[origen])

    for ruta in fuentes:
        fuente = open(ruta, encoding="utf-8").read()
        rel = os.path.relpath(ruta, args.repo)
        constantes = {**globales, **dict(re.findall(r"const\s+([A-Z_][A-Z0-9_]*)\s*=\s*`([^`]*)`", fuente))}

        for m in re.finditer(r"\.from\(\s*[\"']([a-z_]+)[\"']\s*\)", fuente):
            tabla = m.group(1)
            if "storage" in fuente[max(0, m.start() - 20):m.start()]:
                continue
            linea = fuente.count("\n", 0, m.start()) + 1
            donde = f"{rel}:{linea}"
            tramo = fuente[m.end():m.end() + 2000]
            # La llamada termina en el ";" o donde empieza otra
            # (varios .from() dentro de un Promise.all).
            cortes = [i for i in (tramo.find(";"), tramo.find(".from(")) if i >= 0]
            tramo = tramo[:min(cortes)] if cortes else tramo
            for op in re.finditer(r"\.(select|insert|update|upsert)\(", tramo):
                arg = argumento(tramo, op.end())
                if op.group(1) == "select":
                    if not arg:
                        continue
                    literales = re.fullmatch(r'(?:\s*(["\'`])(.*?)\1\s*\+?)+', arg, re.S)
                    if literales:  # "a" + "b" + ...
                        texto = "".join(m2.group(2) for m2 in re.finditer(r'(["\'`])(.*?)\1', arg, re.S))
                    elif arg in constantes:
                        texto = constantes[arg]
                    else:
                        sin_verificar += 1
                        continue
                    revisar_select(tabla, texto, columnas, fks, errores, donde, solo)
                    revisadas += 1
                elif solo:
                    continue
                else:
                    claves = claves_objeto(arg)
                    if claves is None:
                        sin_verificar += 1
                        continue
                    for c in claves:
                        if c not in columnas.get(tabla, set()):
                            errores.append(f"{donde}: {op.group(1)} con columna inexistente {tabla}.{c}")
                        elif op.group(1) == "update" and tabla in actualizables and c not in actualizables[tabla]:
                            errores.append(f"{donde}: update de columna protegida {tabla}.{c} (sin UPDATE para authenticated)")
                    revisadas += 1

        for m in re.finditer(r"\.rpc\(\s*[\"']([a-z_]+)[\"']", fuente):
            if solo:
                break
            revisadas += 1
            if m.group(1) not in rpcs:
                linea = fuente.count("\n", 0, m.start()) + 1
                errores.append(f"{rel}:{linea}: rpc inexistente public.{m.group(1)}")

    for e in sorted(set(errores)):
        print("FAIL|" + e)
    print(f"contrato{' (solo embebidos)' if solo else ''}: {revisadas} llamadas verificadas, {sin_verificar} sin verificar (argumento dinámico), "
          f"{len(set(errores))} errores")
    sys.exit(1 if errores else 0)


if __name__ == "__main__":
    main()
