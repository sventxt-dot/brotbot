import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "BrotBot Admin – Bäckerei Müller",
  description: "Verwaltungsoberfläche für den Müller BrotBot",
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
