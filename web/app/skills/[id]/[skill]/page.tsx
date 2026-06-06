import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import SkillDetailClient from "../SkillDetailClient";
import {
  getCanonicalSkillPath,
  resolveSkillRoutePath,
} from "@/lib/skillRouteResolver";
import { buildSkillPageMetadata } from "@/lib/skillPageMetadata";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string; skill: string }>;
}): Promise<Metadata> {
  const { id, skill } = await params;
  const route = await resolveSkillRoutePath(id, skill).catch(() => null);
  return buildSkillPageMetadata(route, `/skills/${id}/${skill}`);
}

export default async function SkillDetailSlugPage({
  params,
}: {
  params: Promise<{ id: string; skill: string }>;
}) {
  const { id, skill } = await params;
  const route = await resolveSkillRoutePath(id, skill).catch(() => null);

  if (!route) {
    notFound();
  }

  const canonicalPath = getCanonicalSkillPath(route);
  const currentPath = `/skills/${encodeURIComponent(id)}/${encodeURIComponent(
    skill
  )}`;
  if (currentPath !== canonicalPath) {
    redirect(canonicalPath);
  }

  return <SkillDetailClient id={route.id} />;
}
