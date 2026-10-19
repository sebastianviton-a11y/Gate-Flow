/**
 * Columnas protegidas de tenants (migración
 * 20261008000000_tenants_columnas_protegidas). Sin framework:
 *   npx tsx apps/admin/lib/__tests__/tenants-columnas.test.ts
 *
 * La base de datos ya rechaza los UPDATE de columnas de plataforma
 * (tests SQL TC-xx y contrato código ↔ esquema). Aquí se verifica,
 * sin base de datos, que el código usa las rutas correctas:
 *   - Super Admin cambia esas columnas solo por las funciones RPC, con
 *     los nombres de parámetro que declara la migración (PostgREST
 *     llama por nombre: un nombre distinto sería un 404 en runtime);
 *   - el panel del admin_residencial solo actualiza columnas que
 *     siguen teniendo UPDATE para authenticated.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { actualizarPlanResidencial, actualizarResidencial, cambiarEstadoServicio } from "@gateflow/paquetes";

type Cliente = Parameters<typeof cambiarEstadoServicio>[0];

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

const RAIZ = join(__dirname, "../../../..");
const leer = (ruta: string) => readFileSync(join(RAIZ, ruta), "utf8");
const MIGRACION = leer("supabase/migrations/20261008000000_tenants_columnas_protegidas.sql");
const COLUMNAS_ADMIN = ["configuracion", "correo", "direccion", "nombre", "onboarding_completado", "telefono"];

/** Nombres de parámetro de `create function public.<nombre>(...)`. */
function parametrosSql(nombre: string): string[] {
  const m = MIGRACION.match(new RegExp(`create function public\\.${nombre}\\(([^)]*)\\)`));
  if (!m?.[1]) return [];
  return m[1]
    .split(",")
    .map((p) => p.trim().split(/\s+/)[0] ?? "")
    .filter((p) => p !== "");
}

interface Llamada {
  fn: string;
  args: Record<string, unknown>;
}

/** Cliente falso: registra las RPC y falla si alguien usa .from(). */
function clienteFalso(error: unknown = null) {
  const llamadas: Llamada[] = [];
  const usosFrom: string[] = [];
  const cliente = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      llamadas.push({ fn, args });
      return { data: null, error };
    },
    from: (tabla: string) => {
      usosFrom.push(tabla);
      throw new Error(`.from("${tabla}") no debería usarse`);
    },
  };
  return { cliente: cliente as unknown as Cliente, llamadas, usosFrom };
}

const mismas = (a: string[], b: string[]) => [...a].sort().join(",") === [...b].sort().join(",");

async function main() {
  await seccion("La migración declara las tres funciones de Super Admin", () => {
    for (const f of ["superadmin_actualizar_residencial", "superadmin_cambiar_estado_servicio", "superadmin_actualizar_plan_residencial"]) {
      assert(parametrosSql(f).length > 0, `${f} existe en la migración`);
    }
    assert(
      /grant update \(nombre, direccion, telefono, correo, configuracion, onboarding_completado\)\s+on public\.tenants to authenticated/.test(MIGRACION),
      "UPDATE por columna: exactamente las 6 columnas del admin_residencial",
    );
    assert(/revoke update on public\.tenants from authenticated;/.test(MIGRACION), "revoca el UPDATE de tabla");
    assert(!/grant [^;]*to anon/i.test(MIGRACION), "no concede nada a anon");
    assert(!/grant execute[^;]*service_role/i.test(MIGRACION), "no concede EXECUTE a service_role");
  });

  await seccion("Super Admin: datos generales → superadmin_actualizar_residencial", async () => {
    const { cliente, llamadas, usosFrom } = clienteFalso();
    await actualizarResidencial(cliente, "t-1", {
      nombre: "  Res  ",
      empresaId: "e-1",
      ciudad: " Mérida ",
      estadoGeografico: "",
      adminContactoNombre: "Ana",
      adminContactoEmail: "ana@x",
      adminContactoTelefono: null,
      observaciones: "nota",
    });
    assert(usosFrom.length === 0, "no usa UPDATE directo sobre tenants");
    assert(llamadas.length === 1 && llamadas[0]?.fn === "superadmin_actualizar_residencial", "llama a la RPC");
    const args = llamadas[0]?.args ?? {};
    assert(mismas(Object.keys(args), parametrosSql("superadmin_actualizar_residencial")), `parámetros = SQL (${Object.keys(args).join(",")})`);
    assert(args.p_tenant_id === "t-1", "tenant_id explícito");
    assert(args.p_nombre === "Res" && args.p_ciudad === "Mérida" && args.p_estado_geografico === null, "normaliza espacios y vacíos");
    assert(!("p_empresa_id" in args) && !("p_pais" in args), "no permite cambiar empresa ni país");
  });

  await seccion("Super Admin: estado del servicio → superadmin_cambiar_estado_servicio", async () => {
    const { cliente, llamadas, usosFrom } = clienteFalso();
    await cambiarEstadoServicio(cliente, "t-2", "suspendido");
    assert(usosFrom.length === 0, "no usa UPDATE directo sobre tenants");
    assert(llamadas[0]?.fn === "superadmin_cambiar_estado_servicio", "llama a la RPC");
    const args = llamadas[0]?.args ?? {};
    assert(mismas(Object.keys(args), parametrosSql("superadmin_cambiar_estado_servicio")), "parámetros = SQL");
    assert(args.p_tenant_id === "t-2" && args.p_estado === "suspendido", "valores correctos");
  });

  await seccion("Super Admin: plan comercial → superadmin_actualizar_plan_residencial", async () => {
    const { cliente, llamadas, usosFrom } = clienteFalso();
    await actualizarPlanResidencial(cliente, "t-3", { plan: "pro", precio: 49, fechaInicio: "", fechaRenovacion: "2027-01-01" });
    assert(usosFrom.length === 0, "no usa UPDATE directo sobre tenants");
    assert(llamadas[0]?.fn === "superadmin_actualizar_plan_residencial", "llama a la RPC");
    const args = llamadas[0]?.args ?? {};
    assert(mismas(Object.keys(args), parametrosSql("superadmin_actualizar_plan_residencial")), "parámetros = SQL");
    assert(args.p_precio === 49 && args.p_fecha_inicio === null && args.p_fecha_renovacion === "2027-01-01", "fechas vacías → null");
  });

  await seccion("Un error de la RPC llega a la UI (antes: 0 filas silencioso)", async () => {
    const { cliente } = clienteFalso({ code: "42501", message: "solo super_admin" });
    let lanzo = false;
    try {
      await cambiarEstadoServicio(cliente, "t-4", "activo");
    } catch {
      lanzo = true;
    }
    assert(lanzo, "cambiarEstadoServicio propaga el error");
  });

  await seccion("Ningún .from(\"tenants\").update() del código toca columnas protegidas", () => {
    const archivos = [
      "apps/admin/app/(app)/configuracion/actions.ts",
      "apps/admin/app/(app)/onboarding/onboarding-wizard.tsx",
      "packages/paquetes/src/superadmin.ts",
    ];
    let encontrados = 0;
    for (const archivo of archivos) {
      const fuente = leer(archivo);
      for (const m of fuente.matchAll(/\.from\("tenants"\)\s*\.update\(\{([^}]*)\}/g)) {
        encontrados++;
        // Claves de primer nivel: se descarta el valor anidado
        // (p. ej. configuracion: { ...actual, logoUrl }).
        const claves = (m[1] ?? "")
          .replace(/\{[\s\S]*$/, "")
          .split(",")
          .map((parte) => parte.trim().match(/^([a-z_]+)\s*(?::|$)/)?.[1])
          .filter((c): c is string => Boolean(c));
        const ajenas = claves.filter((c) => !COLUMNAS_ADMIN.includes(c));
        assert(ajenas.length === 0, `${archivo}: update de tenants solo con columnas del admin (${claves.join(",")})`);
      }
    }
    assert(encontrados === 3, `3 updates de tenants en el panel del admin (configuración + onboarding x2), encontrados ${encontrados}`);
    assert(!/\.from\("tenants"\)\s*\.update/.test(leer("packages/paquetes/src/superadmin.ts")), "superadmin.ts no hace UPDATE directo de tenants");
  });

  console.log(`\n${pasadas} pasadas, ${fallidas} fallidas`);
  if (fallidas > 0) process.exit(1);
}

void main();
