import globalSetup from "../global-setup";
import { emptySheetDir, sheetDir, sheetRouteFilter } from "./dir";

// Empties the folder of the run when the run covers every route (a picture of an older table must not stay), then seeds as the panel run does.
export default function uiSheetSetup(): void {
  if (sheetRouteFilter() === null) emptySheetDir(sheetDir());
  globalSetup();
}
