import { docsSchema } from "@astrojs/starlight/schema";
import { defineCollection } from "astro:content";
import { inPlaceLoader } from "./in-place";

export const collections = {
  docs: defineCollection({ loader: inPlaceLoader(), schema: docsSchema() }),
};
