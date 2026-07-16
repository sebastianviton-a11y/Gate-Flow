import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, cn } from "@gateflow/ui";

interface StatCardProps {
  label: string;
  value: number | string;
  icon: LucideIcon;
  tone?: "default" | "warn" | "destructive" | "success";
}

const TONE_CLASSES: Record<NonNullable<StatCardProps["tone"]>, string> = {
  default: "bg-primary/10 text-primary",
  warn: "bg-warn/15 text-warn-foreground",
  destructive: "bg-destructive/10 text-destructive",
  success: "bg-success/10 text-success",
};

export function StatCard({ label, value, icon: Icon, tone = "default" }: StatCardProps) {
  return (
    <Card className="transition-shadow duration-200 hover:shadow-md">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-0">
        <CardTitle>{label}</CardTitle>
        <span className={cn("flex h-8 w-8 items-center justify-center rounded-md", TONE_CLASSES[tone])}>
          <Icon className="h-4 w-4" strokeWidth={2} />
        </span>
      </CardHeader>
      <CardContent>
        <p className="font-display text-3xl font-semibold tracking-tight">{value}</p>
      </CardContent>
    </Card>
  );
}
