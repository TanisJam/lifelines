import type { Locale } from "@/i18n/config";

/** Medieval feast or farm-year marker for each month, shown as "Haymaking in <village>". */
export const FESTIVALS: Record<Locale, readonly string[]> = {
  en: ["Epiphany", "Candlemas", "Lent", "Easter", "Whitsun", "Midsummer", "Haymaking", "Lammas", "Michaelmas", "Winter sowing", "Martinmas", "Christmas"],
  es: ["Epifanía", "Candelaria", "Cuaresma", "Pascua", "Pentecostés", "San Juan", "Siega del heno", "Primeros frutos", "San Miguel", "Sementera", "San Martín", "Navidad"],
};

/** Short month names for the month tape. */
export const MONTHS: Record<Locale, readonly string[]> = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  es: ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"],
};

/** 0..11 month of a fractional year. */
export const monthIndex = (t: number): number => Math.min(11, Math.floor((t - Math.floor(t)) * 12));

export const festivalAt = (t: number, lang: Locale): string => FESTIVALS[lang][monthIndex(t)]!;
