import type { StructuredMinutes } from "./types";
export type ValidationResult = { ok: boolean; errors: string[]; warnings: string[] };
export function isStructuredMinutesRequest(municipalitySlug: unknown, id: unknown): boolean;
export function matchesStructuredMinutesRequest(data: unknown, municipalitySlug: string, id: string): boolean;
export function isMeetingDate(value: unknown): boolean;
export function validateStructuredMinutes(data: unknown): ValidationResult;
export function normalizeStructuredMinutes(data: unknown): { data: StructuredMinutes | null; validation: ValidationResult };
