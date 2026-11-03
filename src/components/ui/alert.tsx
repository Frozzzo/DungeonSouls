import type { ReactNode } from "react";
import { cn } from "./cn";

export function Alert({ tone = "error", children }: { tone?: "error" | "success"; children: ReactNode }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "rounded-md border px-3 py-2 text-sm",
        tone === "error" ? "border-blood-500/50 bg-blood-500/10 text-blood-400" : "border-verdigris-400/40 bg-verdigris-400/10 text-verdigris-400",
      )}
    >
      {children}
    </div>
  );
}
