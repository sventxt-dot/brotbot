export const RETRIEVER_DOMAINS = [
  {
    slug: "filialen_und_kontakt",
    label: "Filialen & Kontakt",
    hint: "Adressen, Öffnungszeiten, Telefon",
  },
  {
    slug: "app_und_kundenkarte",
    label: "App & Kundenkarte",
    hint: "Bonuspunkte, Guthaben, Coupons",
  },
  {
    slug: "produkte_allergene_naehrwerte",
    label: "Produkte & Allergene",
    hint: "Sortiment, Zutaten, Nährwerte",
  },
  {
    slug: "brotwissen_und_service",
    label: "Brot & Service",
    hint: "Lagern, Einfrieren, Aufbacken",
  },
  {
    slug: "unternehmen_und_leistungen",
    label: "Unternehmen",
    hint: "Geschichte, Handwerk, Lieferservice",
  },
  {
    slug: "brot_sorten_und_wissen",
    label: "Brotsorten & Wissen",
    hint: "Roggenbrot, Sauerteig, Vollkorn",
  },
  {
    slug: "brotideen_rezepte_inspiration",
    label: "Brotideen & Rezepte",
    hint: "Inspirationen, Rezepte, Brotzeit",
  },
] as const;

export const RETRIEVER_DESCRIPTIONS: Record<string, string> = {
  filialen_und_kontakt: "Adressen, Öffnungszeiten, Filialtelefone, Kontaktdaten, Standorte",
  app_und_kundenkarte:
    "App-Funktionen, digitale Kundenkarte, Bonuspunkte, Guthaben aufladen, Coupons, Vorbestellung",
  produkte_allergene_naehrwerte:
    "Produktdaten, Zutaten, Allergene, vegan/vegetarisch, Nährwerte, Sortiment",
  brotwissen_und_service:
    "Brot lagern, einfrieren, aufbacken, auftauen, Haltbarkeit, Servicetipps",
  unternehmen_und_leistungen:
    "Unternehmensgeschichte, Backhandwerk, Philosophie, Lieferkunden, Vereine",
  brot_sorten_und_wissen:
    "Brotsorten, Sauerteig, Vollkorn, Roggenbrot, Qualitätsmerkmale, Hintergrundwissen",
  brotideen_rezepte_inspiration:
    "Brotideen, Rezepte, Brotzeit-Inspirationen, Serviervorschläge",
};

export const RETRIEVER_ABBREV: Record<string, string> = {
  filialen_und_kontakt: "Filialen",
  app_und_kundenkarte: "App",
  produkte_allergene_naehrwerte: "Produkte",
  brotwissen_und_service: "Brot & Service",
  unternehmen_und_leistungen: "Unternehmen",
  brot_sorten_und_wissen: "Brotsorten",
  brotideen_rezepte_inspiration: "Brotideen",
};

export interface AdminDocument {
  id: string;
  page_content: string;
  retriever_domain: string[];
  metadata: {
    titel?: string;
    source_type: "admin_input";
    input_type: "freitext" | "url" | "pdf";
    created_by_input: string;
    [key: string]: unknown;
  };
  status: string;
  gueltig_von: string | null;
  gueltig_bis: string | null;
  created_at: string;
}
