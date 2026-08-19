// ═══════════════════════════════════════════════════════════════
// GET /api/groups — the directory's groups, as this app sees them
// ═══════════════════════════════════════════════════════════════
// Read straight through to the identity provider rather than from a local
// copy. `lib/directory-sdk.ts` sets out why in its own header: a synced roster
// is a wrong roster, and somebody approved into a group a minute ago should
// appear in this list now.

import { NextResponse, type NextRequest } from "next/server";

import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";
import { directoryConfigured, listDirectoryGroups } from "@/lib/directory-sdk";
import { STANDARD_GROUPS, groupAddress, resolveGroupDomain } from "@/lib/onboarding-groups";

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request, ["owner", "admin", "hr"]);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  if (!directoryConfigured()) {
    // Said plainly rather than returned as an empty list. "No groups" and "this
    // deployment cannot see groups" look identical to a screen, and only one of
    // them is fixed by adding a group.
    return NextResponse.json(
      {
        items: [],
        count: 0,
        configured: false,
        error:
          "DIRECTORY_SERVICE_TOKEN is not set, so this deployment cannot read the directory. " +
          "Groups are managed at the identity provider.",
      },
      { status: 200 }
    );
  }

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("q") ?? "";

  const groups = await listDirectoryGroups(search);
  const domain = resolveGroupDomain(ctx.email);

  // The standard groups, whether or not they exist yet, so a screen can offer
  // to create the missing ones instead of showing nothing and explaining
  // nothing.
  const present = new Set(groups.map((group) => group.email.toLowerCase()));
  const expected = STANDARD_GROUPS.map((group) => {
    const address = groupAddress(group.localPart, domain);
    return {
      email: address,
      name: group.name,
      description: group.description,
      autoJoin: group.autoJoin,
      exists: present.has(address),
    };
  });

  return NextResponse.json({
    items: groups,
    count: groups.length,
    configured: true,
    expected,
  });
}
