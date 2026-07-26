import { navGroups } from "@/lib/nav.ts";
import SideNavClient from "./SideNavClient.tsx";

export default function SideNav() {
  return <SideNavClient groups={navGroups(10)} />;
}
