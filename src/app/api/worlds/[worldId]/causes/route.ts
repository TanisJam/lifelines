import { NextResponse } from "next/server";
import { indexEventsById, walkCauses, type CauseNode } from "@/domain/causality";
import { narrateEvent } from "@/domain/narrate";
import type { Person } from "@/domain/types";
import { getBranch, getWorld } from "@/server/world-store";

export const runtime = "nodejs";

interface SerializedCauseNode {
  eventId: string;
  year: number;
  kind: string;
  prose: string;
  causes: SerializedCauseNode[];
}

function serialize(node: CauseNode, people: Readonly<Record<string, Person>>, seed: string): SerializedCauseNode {
  return {
    eventId: node.event.id,
    year: node.event.year,
    kind: node.event.kind,
    prose: narrateEvent(node.event, people, seed),
    causes: node.causes.map((c) => serialize(c, people, seed)),
  };
}

export async function GET(request: Request, context: { params: Promise<{ worldId: string }> }): Promise<NextResponse> {
  const { worldId } = await context.params;
  const world = getWorld(worldId);
  if (!world) return NextResponse.json({ error: "World not found." }, { status: 404 });

  const url = new URL(request.url);
  const branchId = url.searchParams.get("branchId") ?? world.originalBranchId;
  const eventId = url.searchParams.get("eventId");
  if (!eventId) return NextResponse.json({ error: "eventId query param is required." }, { status: 400 });

  const branch = getBranch(worldId, branchId);
  if (!branch) return NextResponse.json({ error: "Branch not found." }, { status: 404 });

  const eventsById = indexEventsById(branch.result.events);
  const node = walkCauses(eventId, eventsById);
  if (!node) return NextResponse.json({ error: "Event not found." }, { status: 404 });

  return NextResponse.json({ chain: serialize(node, branch.result.people, world.config.seed) });
}
