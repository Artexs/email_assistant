import { z } from "zod";

export const membershipRoles = ["owner", "assistant"] as const;
export type MembershipRole = (typeof membershipRoles)[number];
export const membershipRoleSchema = z.enum(membershipRoles);
