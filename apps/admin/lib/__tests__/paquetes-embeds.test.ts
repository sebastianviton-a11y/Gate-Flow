/**
 * Embeds de PostgREST sin ambigüedad (dashboard caído en staging tras
 * la integridad multitenant 20261007100000). Sin framework:
 *   npx tsx apps/admin/lib/__tests__/paquetes-embeds.test.ts
 *
 * La integridad multitenant añadió FKs compuestas (x_id, tenant_id)
 * junto a las simples: con dos FKs entre dos tablas, un embed sin FK
 * nombrada responde 300 / PGRST201. El contrato código ↔ esquema
 * (contrato_selects.py) lo comprueba contra la base; aquí se verifica,
 * sin base de datos, en cada pantalla afectada:
 *   - el select que se envía nombra la FK simple de cada par ambiguo;
 *   - solo el widget de actividad reciente tolera un error (dashboard
 *     sin ese widget en vez de caído); el resto lo sigue lanzando.
 */
import {
  buscarPaquetesResumen,
  buscarUnidades,
  listarIncidencias,
  listarPaquetes,
  listarPendientesResumen,
  obtenerActividadReciente,
} from "@gateflow/paquetes";

type Cliente = Parameters<typeof obtenerActividadReciente>[0];

let pasadas = 0;
let fallidas = 0;

function assert(condicion: boolean, mensaje: string) {
  if (condicion) {
    pasadas++;
  } else {
    fallidas++;
    console.error(`✗ FALLÓ: ${mensaje}`);
  }
}

async function seccion(nombre: string, fn: () => void | Promise<void>) {
  console.log(`\n${nombre}`);
  await fn();
}

const A = "aaaaaaaa-0000-0000-0000-000000000000";
const PGRST201 = { code: "PGRST201", message: "Could not embed because more than one relationship was found", details: null, hint: null };

/**
 * Cliente falso encadenable: registra la tabla y el select de cada
 * consulta, acepta cualquier filtro (.eq, .in, .order, .range, .or,
 * .limit, .textSearch…) y al hacer await devuelve `respuesta`.
 */
function clienteFalso(respuesta: { data?: unknown; error?: unknown; count?: number }) {
  const consultas: Array<{ tabla: string; select: string }> = [];
  const cliente = {
    from(tabla: string) {
      const consulta = { tabla, select: "" };
      consultas.push(consulta);
      const builder: unknown = new Proxy(
        {},
        {
          get(_, prop) {
            if (prop === "then") {
              return (ok: (v: unknown) => void) => ok({ data: respuesta.data ?? null, error: respuesta.error ?? null, count: respuesta.count ?? null });
            }
            return (...args: unknown[]) => {
              if (prop === "select") consulta.select = " " + String(args[0]).replace(/\s+/g, " ") + " ";
              return builder;
            };
          },
        },
      );
      return builder;
    },
  };
  return { cliente: cliente as unknown as Cliente, consultas };
}

/** Embeds escritos como `tabla (` o `tabla!inner (` (sin `!fk`): `!inner`
 * y `!left` solo cambian el tipo de join, no eligen la FK. */
function embedsSinFk(select: string, tablas: string[]): string[] {
  return tablas.filter((t) => new RegExp(`[\\s,(:]${t}(?:\\s*!\\s*(?:inner|left))?\\s*\\(`).test(select));
}

const PARES_AMBIGUOS = ["unidades", "ubicaciones", "paquetes", "residentes_unidades"];

async function lanza(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
}

/** Silencia console.error durante `fn` y devuelve lo que se registró. */
async function capturarErrores(fn: () => Promise<unknown>): Promise<{ valor: unknown; registros: string[] }> {
  const original = console.error;
  const registros: string[] = [];
  console.error = (...args: unknown[]) => registros.push(args.map(String).join(" "));
  try {
    return { valor: await fn(), registros };
  } finally {
    console.error = original;
  }
}

async function main() {
  await seccion("Dashboard: actividad reciente", async () => {
    const { cliente, consultas } = clienteFalso({ data: [] });
    await obtenerActividadReciente(cliente, A);
    const s = consultas[0]?.select ?? "";
    assert(consultas[0]?.tabla === "paquete_historial", "lee paquete_historial");
    assert(s.includes("paquetes!paquete_historial_paquete_id_fkey!inner ("), "embed de paquetes con FK simple y !inner");
    assert(s.includes("unidades!paquetes_unidad_id_fkey ("), "unidades anidada con FK simple");
    assert(embedsSinFk(s, PARES_AMBIGUOS).length === 0, `sin embeds ambiguos (${embedsSinFk(s, PARES_AMBIGUOS)})`);

    const ok = clienteFalso({
      data: [{ id: "h1", estado_nuevo_id: "recibido", created_at: "2026-10-07T16:00:00Z", paquetes: { codigo_gateflow: "GF-1", unidades: { identificador: "Casa 1" } } }],
    });
    const items = await obtenerActividadReciente(ok.cliente, A);
    assert(items.length === 1 && items[0]?.descripcion === "Paquete recibido — Casa 1" && items[0]?.codigoGateflow === "GF-1", "mapea la respuesta (clave `paquetes`/`unidades` sin cambios)");

    const fallo = clienteFalso({ error: PGRST201 });
    const { valor, registros } = await capturarErrores(() => obtenerActividadReciente(fallo.cliente, A));
    assert(Array.isArray(valor) && (valor as unknown[]).length === 0, "si la consulta falla devuelve [] (el dashboard no cae)");
    assert(registros.length === 1 && registros[0]!.includes("PGRST201"), "y deja el código del error en el log del servidor");
    const sinPermiso = clienteFalso({ error: { code: "42501", message: "permission denied" } });
    const r2 = await capturarErrores(() => obtenerActividadReciente(sinPermiso.cliente, A));
    assert(Array.isArray(r2.valor) && (r2.valor as unknown[]).length === 0, "cualquier error del widget → [] (no expone datos: no hay filas)");
  });

  await seccion("Admin: lista de paquetes", async () => {
    const { cliente, consultas } = clienteFalso({ data: [], count: 0 });
    await listarPaquetes(cliente, { tenantId: A });
    const s = consultas[0]?.select ?? "";
    assert(s.includes("unidades!paquetes_unidad_id_fkey ("), "unidades con FK simple");
    assert(s.includes("ubicaciones!paquetes_ubicacion_id_fkey ("), "ubicaciones con FK simple");
    assert(s.includes("residente:users!paquetes_residente_id_fkey ("), "las FKs a users siguen nombradas");
    assert(embedsSinFk(s, PARES_AMBIGUOS).length === 0, `sin embeds ambiguos (${embedsSinFk(s, PARES_AMBIGUOS)})`);
    const e = await lanza(() => listarPaquetes(clienteFalso({ error: PGRST201 }).cliente, { tenantId: A }));
    assert((e as { code?: string } | null)?.code === "PGRST201", "un error se sigue lanzando (no se oculta)");
  });

  await seccion("Guard: pendientes y búsqueda (select liviano)", async () => {
    for (const [nombre, fn] of [
      ["listarPendientesResumen", (c: Cliente) => listarPendientesResumen(c, A)],
      ["buscarPaquetesResumen", (c: Cliente) => buscarPaquetesResumen(c, A, "casa")],
    ] as const) {
      const { cliente, consultas } = clienteFalso({ data: [] });
      await fn(cliente);
      const s = consultas[0]?.select ?? "";
      assert(s.includes("unidades!paquetes_unidad_id_fkey ("), `${nombre}: unidades con FK simple`);
      assert(s.includes("ubicaciones!paquetes_ubicacion_id_fkey ("), `${nombre}: ubicaciones con FK simple`);
      assert(embedsSinFk(s, PARES_AMBIGUOS).length === 0, `${nombre}: sin embeds ambiguos`);
      const e = await lanza(() => fn(clienteFalso({ error: PGRST201 }).cliente));
      assert((e as { code?: string } | null)?.code === "PGRST201", `${nombre}: un error se sigue lanzando`);
    }
  });

  await seccion("Búsqueda de unidades (registrar paquete)", async () => {
    const { cliente, consultas } = clienteFalso({ data: [] });
    await buscarUnidades(cliente, A, "A1");
    const s = consultas[0]?.select ?? "";
    assert(consultas[0]?.tabla === "unidades", "lee unidades");
    assert(s.includes("residentes_unidades!residentes_unidades_unidad_id_fkey ("), "residentes_unidades con FK simple");
    assert(embedsSinFk(s, PARES_AMBIGUOS).length === 0, "sin embeds ambiguos");
    const ok = clienteFalso({
      data: [{ id: "u1", identificador: "Casa 1", contacto_nombre: null, contacto_telefono: null, residentes_unidades: [{ fecha_fin: null, users: { id: "r1", nombre_completo: "R" } }] }],
    });
    const unidades = await buscarUnidades(ok.cliente, A, "Casa");
    assert(unidades[0]?.residentes.length === 1, "mapea residentes (clave `residentes_unidades` sin cambios)");
    const e = await lanza(() => buscarUnidades(clienteFalso({ error: PGRST201 }).cliente, A, "A1"));
    assert((e as { code?: string } | null)?.code === "PGRST201", "un error se sigue lanzando");
  });

  await seccion("Incidencias", async () => {
    const { cliente, consultas } = clienteFalso({ data: [] });
    await listarIncidencias(cliente, A);
    const s = consultas[0]?.select ?? "";
    assert(s.includes("paquetes!incidencias_paquete_id_fkey ("), "paquetes con FK simple");
    assert(s.includes("unidades!paquetes_unidad_id_fkey ("), "unidades anidada con FK simple");
    assert(embedsSinFk(s, PARES_AMBIGUOS).length === 0, `sin embeds ambiguos (${embedsSinFk(s, PARES_AMBIGUOS)})`);
    const e = await lanza(() => listarIncidencias(clienteFalso({ error: PGRST201 }).cliente, A));
    assert((e as { code?: string } | null)?.code === "PGRST201", "un error se sigue lanzando");
  });

  console.log(`\n${pasadas} pasadas, ${fallidas} fallidas`);
  if (fallidas > 0) process.exit(1);
}

void main();
