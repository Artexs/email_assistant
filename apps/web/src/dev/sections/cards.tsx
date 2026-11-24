import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import type { PatternSection } from "../sections";

function Cards() {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card data-demo="card">
        <CardHeader>
          <CardTitle>Card with header and footer</CardTitle>
          <CardDescription>The card has no border; its shadow lifts it off the page.</CardDescription>
          <CardAction>
            <Button variant="soft" size="xs">
              Action
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <p className="text-sm">A short body text inside the card content.</p>
        </CardContent>
        <CardFooter className="gap-3">
          <Button>Save</Button>
          <Button variant="ghost">Cancel</Button>
        </CardFooter>
      </Card>
      <Card>
        <CardContent>
          <p className="text-sm">A card with content only.</p>
        </CardContent>
      </Card>
    </div>
  );
}

export const section: PatternSection = { title: "Cards", order: 30, render: () => <Cards /> };
