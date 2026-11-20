# Stage 07 question: the cap of self-classed mutants

Two stage 07 functions still hold 5 or more counted mutants after the new tests, and all of them are self-classed `equivalent` or `unreachable` (`results/stage-07.md` § Self-classed):

- `trustedAuthResults`: 5 left (4 equivalent, 1 unreachable). The cap is 3 per function.
- `trustedAlignedPassDomains`: 8 left (4 equivalent, 4 unreachable). The four unreachable ones are `ArrayDeclaration` mutants whose only visible value is the marker list `["Stryker was here"]`.

The count of both functions fell (14 to 5 and 17 to 8), which meets the ticket's acceptance ("fewer survived or no-coverage mutants in each named function"). It does not meet the stage rule "fewer than 5, or at most 3 self-classed per function".

Options:
1. Accept the classes as they are (default taken; the stage stops here, nothing else is open). The coordinator spot-checks the table.
2. Add four cases with a signature whose `d` is `Stryker was here`, to kill the four marker mutants. A test that names the tool's own marker is weak design; not recommended.

Proposed: option 1.
