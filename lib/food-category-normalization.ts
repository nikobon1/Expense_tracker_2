import { DEFAULT_CATEGORY } from "@/features/expenses/constants";
import { normalizeCategory } from "@/lib/category-normalization";
import { normalizeStoreName } from "@/lib/store-normalization";

const FOOD_CATEGORY = "\u0415\u0434\u0430";
const COFFEE_CATEGORY = "\u041a\u043e\u0444\u0435";
const DAIRY_CATEGORY = "\u041c\u043e\u043b\u043e\u0447\u043a\u0430";
const MEAT_CATEGORY = "\u041c\u044f\u0441\u043e";
const VEGETABLES_CATEGORY = "\u041e\u0432\u043e\u0449\u0438";
const FISH_CATEGORY = "\u0420\u044b\u0431\u0430";
const TVOROG_CATEGORY = "\u0422\u0432\u043e\u0440\u043e\u0433";
const FRUITS_CATEGORY = "\u0424\u0440\u0443\u043a\u0442\u044b";
const BREAD_CATEGORY = "\u0425\u043b\u0435\u0431";
const EGGS_CATEGORY = "\u042f\u0439\u0446\u0430";

const SPECIFIC_FOOD_CATEGORIES = new Set<string>([
  COFFEE_CATEGORY,
  DAIRY_CATEGORY,
  MEAT_CATEGORY,
  VEGETABLES_CATEGORY,
  FISH_CATEGORY,
  TVOROG_CATEGORY,
  FRUITS_CATEGORY,
  BREAD_CATEGORY,
  EGGS_CATEGORY,
]);

const FOOD_SUBCATEGORY_RULES: Array<{ label: string; keywords: string[] }> = [
  {
    label: EGGS_CATEGORY,
    keywords: ["\u044f\u0439\u0446", "egg", "eggs", "ovo", "ovos"],
  },
  {
    label: TVOROG_CATEGORY,
    keywords: ["\u0442\u0432\u043e\u0440\u043e\u0433", "cottage cheese", "quark", "curd", "tvorog"],
  },
  {
    label: FRUITS_CATEGORY,
    keywords: [
      "\u0444\u0440\u0443\u043a\u0442",
      "\u044f\u0431\u043b\u043e\u043a",
      "\u0431\u0430\u043d\u0430\u043d",
      "\u0430\u043f\u0435\u043b\u044c\u0441\u0438\u043d",
      "\u043c\u0430\u043d\u0434\u0430\u0440\u0438\u043d",
      "\u043b\u0438\u043c\u043e\u043d",
      "\u043b\u0430\u0439\u043c",
      "\u0433\u0440\u0443\u0448",
      "\u0432\u0438\u043d\u043e\u0433\u0440\u0430\u0434",
      "\u043a\u0438\u0432\u0438",
      "\u043f\u0435\u0440\u0441\u0438\u043a",
      "\u0430\u0432\u043e\u043a\u0430\u0434",
      "\u043a\u043b\u0443\u0431\u043d\u0438\u043a",
      "\u0447\u0435\u0440\u0435\u0448\u043d",
      "\u0432\u0438\u0448\u043d",
      "\u043c\u0430\u043b\u0438\u043d",
      "\u0433\u043e\u043b\u0443\u0431\u0438\u043a",
      "fruit",
      "fruta",
      "frutas",
      "apple",
      "banana",
      "orange",
      "pear",
      "grape",
      "kiwi",
      "mango",
      "abacate",
      "maca",
      "ma\u00e7a",
      "laranja",
      "uva",
      "morango",
    ],
  },
  {
    label: VEGETABLES_CATEGORY,
    keywords: [
      "\u043e\u0432\u043e\u0449",
      "\u043f\u043e\u043c\u0438\u0434\u043e\u0440",
      "\u0442\u043e\u043c\u0430\u0442",
      "\u043e\u0433\u0443\u0440",
      "\u043a\u0430\u0440\u0442\u043e\u0444",
      "\u043c\u043e\u0440\u043a\u043e\u0432",
      "\u043b\u0443\u043a",
      "\u0447\u0435\u0441\u043d\u043e\u043a",
      "\u043f\u0435\u0440\u0435\u0446",
      "\u0441\u0430\u043b\u0430\u0442",
      "\u0431\u0440\u043e\u043a\u043a\u043e\u043b",
      "\u043a\u0430\u0431\u0430\u0447",
      "\u0431\u0430\u043a\u043b\u0430\u0436",
      "\u043a\u0430\u043f\u0443\u0441\u0442",
      "\u0441\u0432\u0435\u043a",
      "\u0441\u043f\u0430\u0440\u0436",
      "\u0448\u043f\u0438\u043d\u0430\u0442",
      "\u0437\u0435\u043b\u0435\u043d",
      "vegetable",
      "vegetais",
      "veg",
      "tomato",
      "cucumber",
      "potato",
      "carrot",
      "onion",
      "garlic",
      "lettuce",
      "broccoli",
      "spinach",
      "tomate",
      "pepino",
      "batata",
      "cenoura",
      "cebola",
      "alho",
      "alface",
    ],
  },
  {
    label: DAIRY_CATEGORY,
    keywords: [
      "\u043c\u043e\u043b\u043e\u043a",
      "\u0439\u043e\u0433\u0443\u0440\u0442",
      "\u043a\u0435\u0444\u0438\u0440",
      "\u0441\u043c\u0435\u0442\u0430\u043d",
      "\u0441\u043b\u0438\u0432\u043a",
      "\u0441\u044b\u0440",
      "\u043c\u0430\u0441\u043b\u043e \u0441\u043b\u0438\u0432",
      "milk",
      "yogurt",
      "yoghurt",
      "cheese",
      "butter",
      "kefir",
      "leite",
      "iogurte",
      "queijo",
      "manteiga",
      "mozzarella",
    ],
  },
  {
    label: BREAD_CATEGORY,
    keywords: [
      "\u0445\u043b\u0435\u0431",
      "\u0431\u0430\u0442\u043e\u043d",
      "\u0431\u0443\u043b\u043a",
      "\u0431\u0430\u0433\u0435\u0442",
      "\u043b\u0430\u0432\u0430\u0448",
      "\u0442\u043e\u0441\u0442",
      "\u043a\u0440\u0443\u0430\u0441\u0441",
      "bread",
      "bakery",
      "baguette",
      "toast",
      "croissant",
      "pao",
      "p\u00e3o",
    ],
  },
  {
    label: MEAT_CATEGORY,
    keywords: [
      "\u043c\u044f\u0441",
      "\u043a\u0443\u0440\u0438",
      "\u0438\u043d\u0434\u0435\u0439\u043a",
      "\u0433\u043e\u0432\u044f\u0434",
      "\u0441\u0432\u0438\u043d",
      "\u0444\u0430\u0440\u0448",
      "\u043a\u043e\u043b\u0431\u0430\u0441",
      "\u0441\u043e\u0441\u0438\u0441",
      "\u0432\u0435\u0442\u0447\u0438\u043d",
      "meat",
      "chicken",
      "beef",
      "pork",
      "turkey",
      "ham",
      "bacon",
      "frango",
      "carne",
      "presunto",
    ],
  },
  {
    label: FISH_CATEGORY,
    keywords: [
      "\u0440\u044b\u0431",
      "\u043b\u043e\u0441\u043e\u0441",
      "\u0442\u0443\u043d\u0435\u0446",
      "\u0441\u0435\u043b\u044c\u0434",
      "\u043a\u0440\u0435\u0432\u0435\u0442",
      "\u043c\u0438\u0434\u0438",
      "fish",
      "salmon",
      "tuna",
      "shrimp",
      "peixe",
      "sard",
      "atum",
      "salmao",
      "salm\u00e3o",
    ],
  },
];

function normalizeLookupText(value: string | null | undefined): string {
  return String(value ?? "")
    .toLocaleLowerCase("ru")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isFoodStore(storeName: string | null | undefined): boolean {
  const normalized = normalizeStoreName(String(storeName ?? "")).toLocaleLowerCase("ru");
  return (
    normalized.includes("pingo doce") ||
    normalized.includes("continente") ||
    normalized.includes("\u0433\u0430\u0441\u0442\u0440\u043e\u043d\u043e\u043c \u0441\u043b\u0430\u0432\u044f\u043d\u0441\u043a\u0438\u0439")
  );
}

function looksLikeCoffeeItem(itemName: string | null | undefined): boolean {
  const normalized = normalizeLookupText(itemName);
  return (
    normalized.includes("\u043a\u043e\u0444\u0435") ||
    normalized.includes("coffee") ||
    normalized.includes("cafe") ||
    normalized.includes("espresso") ||
    normalized.includes("\u044d\u0441\u043f\u0440\u0435\u0441\u0441\u043e")
  );
}

function findFoodSubcategoryByItemName(itemName: string | null | undefined): string | null {
  const normalized = normalizeLookupText(itemName);
  if (!normalized) return null;

  for (const rule of FOOD_SUBCATEGORY_RULES) {
    if (rule.keywords.some((keyword) => normalized.includes(keyword))) {
      return rule.label;
    }
  }

  return null;
}

function buildFoodFallbackLabel(itemName: string | null | undefined): string | null {
  const raw = String(itemName ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return null;

  const cleaned = raw.replace(/^[\d\s.,xX*+\-/%]+/, "").trim();
  if (!cleaned) return null;
  if (cleaned.length <= 36) return cleaned;
  return `${cleaned.slice(0, 33).trim()}...`;
}

export function normalizeFoodSubcategory(
  storeName: string | null | undefined,
  itemName: string | null | undefined,
  category: string | null | undefined
): string {
  const normalizedCategory = normalizeCategory(category);

  if (normalizedCategory === COFFEE_CATEGORY) return COFFEE_CATEGORY;
  if (looksLikeCoffeeItem(itemName)) return COFFEE_CATEGORY;
  if (SPECIFIC_FOOD_CATEGORIES.has(normalizedCategory)) return normalizedCategory;

  const detectedFromItemName = findFoodSubcategoryByItemName(itemName);
  if (detectedFromItemName) return detectedFromItemName;

  if (normalizedCategory && normalizedCategory !== FOOD_CATEGORY && normalizedCategory !== DEFAULT_CATEGORY) {
    return normalizedCategory;
  }

  if (isFoodStore(storeName)) {
    return buildFoodFallbackLabel(itemName) ?? FOOD_CATEGORY;
  }

  return normalizedCategory;
}

export function normalizeReceiptCategory(
  storeName: string | null | undefined,
  category: string | null | undefined
): string {
  const normalizedCategory = normalizeCategory(category);

  if (normalizedCategory === COFFEE_CATEGORY) {
    return FOOD_CATEGORY;
  }

  if (SPECIFIC_FOOD_CATEGORIES.has(normalizedCategory)) {
    return FOOD_CATEGORY;
  }

  if (isFoodStore(storeName) && (normalizedCategory === DEFAULT_CATEGORY || normalizedCategory === FOOD_CATEGORY)) {
    return FOOD_CATEGORY;
  }

  return normalizedCategory;
}
