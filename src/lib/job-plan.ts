import { ext } from "./browser";
import type { ChapterRef, TitleMeta } from "../sources/types";

export interface JobPlan {
  sourceKey: string;
  token: string | null;
  format: string;
  meta: TitleMeta;
  chapters: ChapterRef[];
  appendFileId?: string;
}

const PLAN_KEY_PREFIX = "job-plan:";

export async function storeJobPlan(plan: JobPlan): Promise<string> {
  const id = crypto.randomUUID();
  await ext.storage.session.set({ [`${PLAN_KEY_PREFIX}${id}`]: plan });
  return id;
}

export async function takeJobPlan(id: string): Promise<JobPlan | null> {
  const key = `${PLAN_KEY_PREFIX}${id}`;
  const stored = await ext.storage.session.get([key]);
  await ext.storage.session.remove(key);
  const value = stored[key];
  if (!value || typeof value !== "object") return null;
  return value as JobPlan;
}

export async function removeJobPlan(id: string): Promise<void> {
  await ext.storage.session.remove(`${PLAN_KEY_PREFIX}${id}`);
}
