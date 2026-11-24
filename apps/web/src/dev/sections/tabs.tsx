import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import type { PatternSection } from "../sections";

const SIX_TABS = ["Inbox", "Waiting", "Delegated", "Approved", "Skipped", "Archive"] as const;
const TWO_TABS = ["One", "Two"] as const;

function TabsDemo() {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Pill group with six tabs: on a narrow screen the group scrolls sideways inside itself.
        </p>
        <Tabs defaultValue="Inbox">
          <TabsList aria-label="Six tabs">
            {SIX_TABS.map((tab) => (
              <TabsTrigger key={tab} value={tab}>
                {tab}
              </TabsTrigger>
            ))}
          </TabsList>
          {SIX_TABS.map((tab) => (
            <TabsContent key={tab} value={tab} className="text-sm text-muted-foreground">
              {`Content of the ${tab} tab.`}
            </TabsContent>
          ))}
        </Tabs>
      </div>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">Line variant.</p>
        <Tabs defaultValue="One">
          <TabsList variant="line" aria-label="Line tabs">
            {TWO_TABS.map((tab) => (
              <TabsTrigger key={tab} value={tab}>
                {tab}
              </TabsTrigger>
            ))}
          </TabsList>
          {TWO_TABS.map((tab) => (
            <TabsContent key={tab} value={tab} className="text-sm text-muted-foreground">
              {`Content of the ${tab} tab.`}
            </TabsContent>
          ))}
        </Tabs>
      </div>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">Vertical orientation.</p>
        <Tabs defaultValue="One" orientation="vertical" className="flex-row">
          <TabsList aria-label="Vertical tabs">
            {TWO_TABS.map((tab) => (
              <TabsTrigger key={tab} value={tab}>
                {tab}
              </TabsTrigger>
            ))}
          </TabsList>
          {TWO_TABS.map((tab) => (
            <TabsContent key={tab} value={tab} className="text-sm text-muted-foreground">
              {`Content of the ${tab} tab.`}
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </div>
  );
}

export const section: PatternSection = { title: "Tabs", order: 50, render: () => <TabsDemo /> };
