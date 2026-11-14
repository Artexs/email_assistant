import type { OperatorOrgDetail } from "@ea/core/web";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { t, type TextKey } from "../../i18n";
import { changePlan, planBodyOf, planChangeText, writeErrorKey, type PlanForm } from "../../lib/operator-api";
import { shortId } from "../../lib/operator-view";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

type Plan = OperatorOrgDetail["plan"];

const planTexts: Record<Plan, TextKey> = {
  trial: "op_plan_trial",
  active: "op_plan_active",
  suspended: "op_plan_suspended",
};
const plans = Object.keys(planTexts) as Plan[];

export interface PlanDialogProps {
  orgId: string;
  plan: Plan;
  maxMailboxes: number;
  onChanged(): void;
}

function initialForm(plan: Plan, maxMailboxes: number): PlanForm {
  return { plan, trialDays: "", maxMailboxes: String(maxMailboxes) };
}

export function PlanDialog({ orgId, plan, maxMailboxes, onChanged }: PlanDialogProps) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<PlanForm>(() => initialForm(plan, maxMailboxes));
  const [error, setError] = useState<TextKey | null>(null);
  const [pending, setPending] = useState(false);

  const changeOpen = (next: boolean) => {
    if (pending) return;
    // Each opening starts from the current state of the organization.
    if (next) {
      setForm(initialForm(plan, maxMailboxes));
      setError(null);
    }
    setOpen(next);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const body = planBodyOf({ plan, maxMailboxes }, form);
    if (body === null) {
      setError("op_err_nothing_to_change");
      return;
    }
    setError(null);
    setPending(true);
    try {
      const result = await changePlan(orgId, body);
      toast.success(planChangeText(result));
      setOpen(false);
      onChanged();
    } catch (caught) {
      toast.error(t(writeErrorKey(caught)));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          {t("op_plan_button")}
        </Button>
      </DialogTrigger>
      <DialogContent showCloseButton={!pending}>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{t("op_plan_dialog_title", { id: shortId(orgId) })}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="op-plan">{t("op_plan_state")}</Label>
            <Select
              value={form.plan}
              disabled={pending}
              onValueChange={(value) => setForm((state) => ({ ...state, plan: value as Plan }))}
            >
              <SelectTrigger id="op-plan" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {plans.map((item) => (
                  <SelectItem key={item} value={item}>
                    {t(planTexts[item])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {form.plan === "trial" && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="op-trial-days">{t("op_trial_days_field")}</Label>
              <Input
                id="op-trial-days"
                type="number"
                inputMode="numeric"
                min={1}
                max={365}
                value={form.trialDays}
                disabled={pending}
                onChange={(event) => setForm((state) => ({ ...state, trialDays: event.target.value }))}
              />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="op-max-mailboxes">{t("op_max_mailboxes_field")}</Label>
            <Input
              id="op-max-mailboxes"
              type="number"
              inputMode="numeric"
              min={0}
              max={100}
              value={form.maxMailboxes}
              disabled={pending}
              onChange={(event) => setForm((state) => ({ ...state, maxMailboxes: event.target.value }))}
            />
          </div>
          <p className="text-sm">{t("op_plan_confirm", { id: shortId(orgId), plan: t(planTexts[form.plan]) })}</p>
          {form.plan === "suspended" && <p className="text-sm text-destructive">{t("op_plan_suspend_warning")}</p>}
          {error !== null && (
            <p role="alert" className="text-sm text-destructive">
              {t(error)}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => changeOpen(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {t("op_plan_submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
