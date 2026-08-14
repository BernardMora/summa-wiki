import { navGroups } from "@/lib/nav.ts";
import { identityBranches, CENTRE } from "@/lib/identity.ts";
import { getIndex } from "@/lib/server.ts";
import { readConfig, configIconPath } from "@/src/config.ts";
import SideNavClient from "./SideNavClient.tsx";

export default function SideNav() {
  // El título del hub central sale de la nota, no de una constante: el vault
  // de otra persona no tiene por qué llamarlo "¿Quién es Bernardo?".
  const centre = getIndex().notes.find((n) => n.id === CENTRE);
  const cfg = readConfig();
  return (
    <SideNavClient
      name={cfg.name}
      tagline={cfg.tagline}
      hasIcon={configIconPath() !== null}
      groups={navGroups(10)}
      centre={centre ? { id: centre.id, title: centre.title } : null}
      questions={identityBranches(0).map((b) => ({
        id: b.hub, title: b.label, count: b.count,
      }))}
    />
  );
}
