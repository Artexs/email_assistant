import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import type { PatternSection } from "../sections";

const ROWS = [
  { name: "Anna Nowak", status: "Waiting", count: 3 },
  { name: "Jan Kowalski", status: "Done", count: 12 },
  { name: "Ewa Zielińska", status: "Waiting", count: 1 },
] as const;

function TableDemo() {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Count</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {ROWS.map((row) => (
          <TableRow key={row.name}>
            <TableCell>{row.name}</TableCell>
            <TableCell>{row.status}</TableCell>
            <TableCell className="text-right">{row.count}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export const section: PatternSection = { title: "Table", order: 56, render: () => <TableDemo /> };
