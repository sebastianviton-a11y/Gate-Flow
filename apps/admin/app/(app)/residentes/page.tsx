import { Users } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";

export default function ResidentesPage() {
  return (
    <div className="flex h-full flex-col space-y-6">
      <PageHeader
        title="Residentes"
        description="Personas asociadas a cada unidad, con su vigencia y tipo de relación."
      />
      <EmptyState
        icon={Users}
        title="Sin residentes todavía"
        description="La importación masiva y el alta individual de residentes se conectan cuando el núcleo de plataforma quede integrado con datos reales."
      />
    </div>
  );
}
