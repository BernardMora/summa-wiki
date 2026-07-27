import { navGroups } from "@/lib/nav.ts";
import { identityBranches, CENTRE } from "@/lib/identity.ts";
import { getIndex } from "@/lib/server.ts";
import SideNavClient from "./SideNavClient.tsx";

export default function SideNav() {
  const centre = getIndex().notes.find((n) => n.id === CENTRE);
  return (
    <SideNavClient
      groups={navGroups(10)}
      centre={centre ? { id: centre.id, title: "¿Quién es Bernardo?" } : null}
      questions={identityBranches(0).map((b) => ({
        id: b.hub, title: b.label, count: b.count,
      }))}
    />
  );
}
