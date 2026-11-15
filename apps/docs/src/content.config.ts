import { docsSchema } from "@astrojs/starlight/schema";
import { defineCollection } from "astro:content";
import { frontMatterLoader, frontMatterSchema } from "./front-matter";
import { inPlaceLoader } from "./in-place";

export const collections = {
  docs: defineCollection({
    loader: frontMatterLoader(inPlaceLoader()),
    schema: docsSchema({ extend: frontMatterSchema }),
  }),
};
