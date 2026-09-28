import { DEFAULT_LINK_STRENGTH_WEIGHT } from "./constants.js";

export function getLinkStrengthWeight(strength: string | undefined): number {
  switch (strength) {
    case "critical":
      return 9;
    case "important":
      return 3;
    case "helpful":
      return 1;
    default:
      return DEFAULT_LINK_STRENGTH_WEIGHT;
  }
}
