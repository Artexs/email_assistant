import { z } from "zod";

export const membershipRoles = ["owner", "assistant"] as const;
export type MembershipRole = (typeof membershipRoles)[number];
export const membershipRoleSchema = z.enum(membershipRoles);

export const orgPlans = ["trial", "active", "suspended"] as const;
export const orgPlanSchema = z.enum(orgPlans);
export type OrgPlan = z.infer<typeof orgPlanSchema>;
