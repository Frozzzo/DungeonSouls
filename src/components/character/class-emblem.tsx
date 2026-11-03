import type { ClassId } from "@/game/types";

/** Emblemas vectoriales propios de cada clase. */
export function ClassEmblem({ classId, className = "h-10 w-10" }: { classId: ClassId; className?: string }) {
  const common = { className, viewBox: "0 0 48 48", fill: "none", stroke: "currentColor", strokeWidth: 2, "aria-hidden": true } as const;
  switch (classId) {
    case "TANK":
      return (
        <svg {...common}>
          <path d="M24 4 40 10v12c0 10-7 18-16 22C15 40 8 32 8 22V10z" />
          <path d="M24 12v24M16 20h16" />
        </svg>
      );
    case "DPS":
      return (
        <svg {...common}>
          <path d="M8 40 30 18M12 44l-6-6M30 18l8-12 4 4-12 8" />
          <path d="M40 40 18 18M36 44l6-6M18 18 10 6 6 10l12 8" />
        </svg>
      );
    case "HEALER":
      return (
        <svg {...common}>
          <path d="M24 6c6 8 12 13 12 21a12 12 0 0 1-24 0c0-8 6-13 12-21z" />
          <path d="M24 22v12M18 28h12" />
        </svg>
      );
  }
}
