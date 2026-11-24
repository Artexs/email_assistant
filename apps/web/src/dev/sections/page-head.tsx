import { PageHead } from "@/components/patterns/PageHead";
import { Button } from "@/components/ui/button";

import type { PatternSection } from "../sections";

// The shell renders this head once per page. The samples show the three shapes an island can ask for.
function PageHeadSamples() {
  return (
    <div className="flex flex-col gap-8">
      <PageHead title="Title only" />
      <PageHead title="Title and lead" lead="One line under the title that says what the page is for." />
      <PageHead
        title="Title, lead and action"
        lead="The lead hides below the lg width while the action shows."
        action={<Button>Main action</Button>}
      />
    </div>
  );
}

export const section: PatternSection = { title: "Page head", order: 40, render: () => <PageHeadSamples /> };
