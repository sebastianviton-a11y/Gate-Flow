import { redirect } from "next/navigation";

// La V2 ya es la landing pública ("/"): los enlaces viejos a la vista
// previa llevan ahí.
export default function V2PreviewPage() {
  redirect("/");
}
