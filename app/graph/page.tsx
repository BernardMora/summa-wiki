import GraphView from "@/components/GraphView.tsx";
import { getT } from "@/lib/i18n.server.ts";

export const dynamic = "force-dynamic";

export default function GraphPage() {
  const t = getT();
  return (
    <article>
      <h1>{t("nav.graph")}</h1>
      <p className="infoline">
        <span>{t("graph.dragToPin")}</span><span>{t("graph.wheelToPan")}</span>
        <span>{t("graph.pinchToZoom")}</span><span>{t("graph.clickExplores")}</span>
        <span>{t("graph.cmdClickOpens")}</span><span>{t("graph.escExits")}</span>
      </p>
      <GraphView />
    </article>
  );
}
