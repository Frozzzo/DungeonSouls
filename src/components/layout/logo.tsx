import Link from "next/link";
import { siteConfig } from "@/config/site";

export function Logo({ size = "md" }: { size?: "md" | "lg" }) {
  return (
    <Link
      href="/"
      className={
        size === "lg"
          ? "font-display text-5xl font-bold tracking-[0.08em] text-bone-100 ember-glow sm:text-6xl"
          : "font-display text-xl font-bold tracking-[0.08em] text-bone-100"
      }
    >
      {siteConfig.name}
    </Link>
  );
}
