// Autoprueba de contrato_selects.py (run-local.sh la ejecuta contra el
// esquema completo y exige exactamente estos 4 errores). No es código
// de la app: solo existe para demostrar que el contrato detecta embeds
// ambiguos (PGRST201) y FKs mal nombradas.
declare const supabase: any;

// 1. Ambiguo: paquetes → unidades tiene la FK simple y la compuesta.
supabase.from("paquetes").select("id, unidades ( identificador )");
// 2. Ambiguo: !inner cambia el join, no elige la FK.
supabase.from("paquete_historial").select("id, paquetes!inner ( codigo_gateflow )");
// 3. FK inexistente.
supabase.from("paquetes").select("id, unidades!no_existe_fkey ( identificador )");
// 4. FK que existe pero no une paquetes con unidades.
supabase.from("paquetes").select("id, unidades!incidencias_paquete_id_fkey ( identificador )");
// Correcto: no debe reportarse.
supabase.from("paquete_historial").select("id, paquetes!paquete_historial_paquete_id_fkey!inner ( codigo_gateflow, unidades!paquetes_unidad_id_fkey ( identificador ) )");
