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
    el cliente de sesión no puede escribir columnas de plataforma.
Habría detectado `incidencias.nivel_danio` (42703 en staging) y
`registrar_paquete_con_incidencia` antes de llegar a un entorno real.

Uso: contrato_selects.py --repo <raíz> --db <base local>
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


def resolver_embebido(padre, nombre, pista, columnas, fks):
    if pista and pista not in ("inner", "left"):
        for fk, origen, col, destino in fks:
            if fk == pista:
                return destino if origen == padre else origen
        return None
    if nombre in columnas:
        return nombre
    for fk, origen, col, destino in fks:  # alias:columna_fk ( ... )
        if origen == padre and col == nombre:
            return destino
    return None


def revisar_select(tabla, texto, columnas, fks, errores, donde):
    if tabla not in columnas:
        errores.append(f"{donde}: tabla/vista inexistente {tabla}")
        return
    for item in partir(" ".join(texto.split())):
        if item == "*":
            continue
        m = re.match(r"^(?:([a-z_][a-z0-9_]*)\s*:\s*)?([a-z_][a-z0-9_]*)(?:\s*!\s*([a-z_][a-z0-9_]*))?\s*\((.*)\)$", item, re.S)
        if m:
            _, nombre, pista, interior = m.groups()
            destino = resolver_embebido(tabla, nombre, pista, columnas, fks)
            if destino is None:
                errores.append(f"{donde}: relación embebida no resoluble {tabla} → {item.split('(')[0].strip()}")
                continue
            revisar_select(destino, interior, columnas, fks, errores, donde)
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
    args = ap.parse_args()

    columnas, fks, rpcs, actualizables = cargar_esquema(args.db)
    errores, revisadas, sin_verificar = [], 0, 0

    for base in ("apps", "packages"):
        for dp, dn, fn in os.walk(os.path.join(args.repo, base)):
            dn[:] = [d for d in dn if d not in ("node_modules", ".next", "dist")]
            for f in fn:
                if not f.endswith((".ts", ".tsx")):
                    continue
                ruta = os.path.join(dp, f)
                fuente = open(ruta, encoding="utf-8").read()
                rel = os.path.relpath(ruta, args.repo)
                constantes = dict(re.findall(r"const\s+([A-Z_][A-Z0-9_]*)\s*=\s*`([^`]*)`", fuente))

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
                            revisar_select(tabla, texto, columnas, fks, errores, donde)
                            revisadas += 1
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
                    revisadas += 1
                    if m.group(1) not in rpcs:
                        linea = fuente.count("\n", 0, m.start()) + 1
                        errores.append(f"{rel}:{linea}: rpc inexistente public.{m.group(1)}")

    for e in sorted(set(errores)):
        print("FAIL|" + e)
    print(f"contrato: {revisadas} llamadas verificadas, {sin_verificar} sin verificar (argumento dinámico), "
          f"{len(set(errores))} errores")
    sys.exit(1 if errores else 0)


if __name__ == "__main__":
    main()
