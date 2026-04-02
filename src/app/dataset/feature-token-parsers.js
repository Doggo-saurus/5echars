import { toNumber } from "../../ui/formatters.js";
import { cleanSpellInlineTags } from "./text-utils.js";

export function normalizeSourceTag(value) {
  return String(value ?? "").trim().toUpperCase();
}

export function buildEntityId(parts) {
  return parts
    .map((part) =>
      String(part ?? "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
    )
    .filter(Boolean)
    .join("__");
}

export function parseClassFeatureToken(rawToken, fallbackSource = "", classNameHint = "") {
  const token = String(rawToken ?? "").trim();
  if (!token) return null;
  const [nameRaw = "", classNameRaw = "", classSourceRaw = "", levelRaw = "", sourceRaw = ""] = token.split("|");
  const level = toNumber(levelRaw, NaN);
  const name = cleanSpellInlineTags(nameRaw);
  if (!name) return null;
  const className = String(classNameRaw || classNameHint || "").trim();
  const source = normalizeSourceTag(sourceRaw || fallbackSource);
  return {
    id: buildEntityId(["class-feature", className, classSourceRaw, levelRaw, name, source]),
    name,
    level: Number.isFinite(level) ? level : null,
    className,
    source,
    type: "class",
  };
}

export function parseSubclassFeatureToken(rawToken, fallbackSource = "", fallbackClassName = "", fallbackSubclassName = "") {
  const token = String(rawToken ?? "").trim();
  if (!token) return null;
  const [nameRaw = "", classNameRaw = "", classSourceRaw = "", subclassNameRaw = "", subclassSourceRaw = "", levelRaw = "", sourceRaw = ""] =
    token.split("|");
  const level = toNumber(levelRaw, NaN);
  const name = cleanSpellInlineTags(nameRaw);
  if (!name) return null;
  const className = String(classNameRaw || fallbackClassName || "").trim();
  const subclassName = String(subclassNameRaw || fallbackSubclassName || "").trim();
  const source = normalizeSourceTag(sourceRaw || fallbackSource || subclassSourceRaw);
  return {
    id: buildEntityId(["subclass-feature", className, classSourceRaw, subclassName, subclassSourceRaw, levelRaw, name, source]),
    name,
    level: Number.isFinite(level) ? level : null,
    className,
    subclassName,
    source,
    type: "subclass",
  };
}
