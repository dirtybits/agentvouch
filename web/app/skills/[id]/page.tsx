import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import SkillDetailClient from "./SkillDetailClient";
import {
  getCanonicalSkillPath,
  resolveSkillRouteParam,
} from "@/lib/skillRouteResolver";
import { CHAIN_SKILL_PREFIX } from "@/lib/skillUrls";
import { buildSkillPageMetadata } from "@/lib/skillPageMetadata";
import { loadSkillDetailSnapshot } from "@/lib/skillDetailSnapshot";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const route = await resolveSkillRouteParam(id).catch(() => null);
  return buildSkillPageMetadata(route, `/skills/${id}`);
}

export default async function SkillDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const route = await resolveSkillRouteParam(id).catch(() => null);

  if (!route) {
    notFound();
  }

  if (!route.id.startsWith(CHAIN_SKILL_PREFIX)) {
    const canonicalPath = getCanonicalSkillPath(route);
    const currentPath = `/skills/${encodeURIComponent(id)}`;
    if (currentPath !== canonicalPath) {
      redirect(canonicalPath);
    }
  }

  const initialSkill = route.id.startsWith(CHAIN_SKILL_PREFIX)
    ? null
    : await loadSkillDetailSnapshot(route.id);
  if (!route.id.startsWith(CHAIN_SKILL_PREFIX) && !initialSkill) {
    notFound();
  }

  return <SkillDetailClient id={route.id} initialSkill={initialSkill} />;
}
