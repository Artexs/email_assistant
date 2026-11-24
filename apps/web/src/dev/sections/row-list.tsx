import { RowList } from "../../components/patterns/RowList";
import { Row } from "../../components/patterns/Row";
import { Button } from "../../components/ui/button";
import { Switch } from "../../components/ui/switch";
import type { PatternSection } from "../sections";

function Rows() {
  return (
    <div className="rounded-lg bg-card px-6 shadow-card">
      <RowList>
        <Row title="Daily digest" hint="One mail each morning at 8:00." htmlFor="demo-row-digest">
          <Switch id="demo-row-digest" defaultChecked />
        </Row>
        <Row
          title="Anna Kowalska"
          hint="Delegate for sales mail"
          leading={
            <span className="grid size-10 place-items-center rounded-full bg-primary-soft text-sm font-bold text-primary">
              AK
            </span>
          }
        >
          <Button variant="outline" size="xs" aria-label="Edit Anna Kowalska">
            Edit
          </Button>
        </Row>
        <Row title="Row with a title only" />
      </RowList>
    </div>
  );
}

export const section: PatternSection = { title: "RowList and Row", order: 51, render: () => <Rows /> };
